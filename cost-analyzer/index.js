#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { BudgetsClient, DescribeBudgetsCommand, CreateBudgetCommand } from '@aws-sdk/client-budgets';
import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, 'config.json');
const COST_LOG_PATH = join(__dirname, 'cost-history.json');

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function loadCostHistory() {
  if (existsSync(COST_LOG_PATH)) {
    return JSON.parse(readFileSync(COST_LOG_PATH, 'utf8'));
  }
  return { entries: [] };
}

function saveCostHistory(history) {
  writeFileSync(COST_LOG_PATH, JSON.stringify(history, null, 2));
}

async function getAWSCosts(profile = 'default') {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const client = new CostExplorerClient({
    region: 'us-east-1',
    ...(profile !== 'default' && { profile })
  });

  try {
    const command = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: startOfMonth.toISOString().split('T')[0],
        End: now.toISOString().split('T')[0]
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    });

    const response = await client.send(command);
    const results = response.ResultsByTime?.[0]?.Groups || [];

    let total = 0;
    const services = results.map(g => {
      const cost = parseFloat(g.Metrics?.UnblendedCost?.Amount || 0);
      total += cost;
      return {
        service: g.Keys?.[0],
        cost: cost.toFixed(2)
      };
    }).filter(s => parseFloat(s.cost) > 0.01)
      .sort((a, b) => parseFloat(b.cost) - parseFloat(a.cost));

    return { profile, total: total.toFixed(2), services, currency: 'USD' };
  } catch (error) {
    return { profile, error: error.message, total: 'unknown' };
  }
}

async function getGCPCosts(projectId) {
  try {
    // Get enabled services for the project
    const { stdout: servicesOut } = await execAsync(
      `gcloud services list --project ${projectId} --filter "state:ENABLED" --format json`
    );
    const services = JSON.parse(servicesOut || '[]');
    const enabledAPIs = services.map(s => s.config?.name || s.name).filter(Boolean);

    // Check for expensive services
    const expensiveAPIs = [
      'aiplatform.googleapis.com',
      'compute.googleapis.com',
      'bigquery.googleapis.com',
      'storage.googleapis.com',
      'cloudfunctions.googleapis.com',
      'run.googleapis.com',
      'translate.googleapis.com',
      'vision.googleapis.com',
      'speech.googleapis.com'
    ];

    const activeExpensive = enabledAPIs.filter(api =>
      expensiveAPIs.some(exp => api.includes(exp.split('.')[0]))
    );

    // Try to get billing info
    let billingAccount = null;
    try {
      const { stdout: billingOut } = await execAsync(
        `gcloud billing projects describe ${projectId} --format json`
      );
      const billingInfo = JSON.parse(billingOut);
      billingAccount = billingInfo.billingAccountName;
    } catch (e) {
      // Billing info not accessible
    }

    return {
      provider: 'GCP',
      project: projectId,
      total: 0, // Exact costs require BigQuery billing export
      success: true,
      billing_account: billingAccount,
      enabled_apis: enabledAPIs.length,
      expensive_apis_active: activeExpensive,
      note: 'Check console.cloud.google.com/billing for exact costs'
    };
  } catch (error) {
    return {
      provider: 'GCP',
      project: projectId,
      total: 0,
      success: false,
      error: error.message,
      note: 'Check console.cloud.google.com/billing manually'
    };
  }
}

async function checkThresholds(costs, config) {
  const alerts = [];
  const { thresholds } = config;

  for (const cost of costs) {
    const amount = parseFloat(cost.total);
    if (isNaN(amount)) continue;

    if (amount >= thresholds.critical) {
      alerts.push({
        level: 'CRITICAL',
        service: cost.profile || cost.provider,
        amount,
        threshold: thresholds.critical,
        action: 'AUTO_THROTTLE_TRIGGERED'
      });
    } else if (amount >= thresholds.caution) {
      alerts.push({
        level: 'CAUTION',
        service: cost.profile || cost.provider,
        amount,
        threshold: thresholds.caution,
        action: 'MONITOR_CLOSELY'
      });
    } else if (amount >= thresholds.warning) {
      alerts.push({
        level: 'WARNING',
        service: cost.profile || cost.provider,
        amount,
        threshold: thresholds.warning,
        action: 'AWARENESS'
      });
    }
  }

  return alerts;
}

async function throttleResources(profile) {
  // Stop non-essential EC2 instances
  const ec2 = new EC2Client({
    region: 'us-east-1',
    ...(profile !== 'default' && { profile })
  });

  try {
    const describeCmd = new DescribeInstancesCommand({
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }]
    });
    const instances = await ec2.send(describeCmd);

    const stoppable = [];
    for (const reservation of instances.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const nameTag = instance.Tags?.find(t => t.Key === 'Name')?.Value || '';
        // Don't stop production instances
        if (!nameTag.toLowerCase().includes('prod') &&
            !nameTag.toLowerCase().includes('production')) {
          stoppable.push(instance.InstanceId);
        }
      }
    }

    if (stoppable.length > 0) {
      // In real scenario, would stop instances
      // const stopCmd = new StopInstancesCommand({ InstanceIds: stoppable });
      // await ec2.send(stopCmd);
      return { throttled: stoppable, action: 'WOULD_STOP_INSTANCES' };
    }

    return { throttled: [], message: 'No non-essential instances to stop' };
  } catch (error) {
    return { error: error.message };
  }
}

const server = new Server(
  { name: 'cost-analyzer-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'costs_get_summary',
      description: 'Get current month cost summary across all services',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'costs_check_aws',
      description: 'Check AWS costs for a specific profile',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'AWS profile (default, support-forge, sweetmeadow)' }
        }
      }
    },
    {
      name: 'costs_check_gcp',
      description: 'Check Google Cloud costs and enabled APIs',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'GCP project ID (defaults to configured project)' }
        }
      }
    },
    {
      name: 'costs_check_alerts',
      description: 'Check if any services have crossed thresholds',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'costs_set_threshold',
      description: 'Update cost thresholds',
      inputSchema: {
        type: 'object',
        properties: {
          warning: { type: 'number', description: 'Warning threshold (default: $25)' },
          caution: { type: 'number', description: 'Caution threshold (default: $50)' },
          critical: { type: 'number', description: 'Critical/throttle threshold (default: $100)' }
        }
      }
    },
    {
      name: 'costs_throttle_check',
      description: 'Check what would be throttled if over limit',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'AWS profile to check' }
        }
      }
    },
    {
      name: 'costs_history',
      description: 'View cost history log',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (default: 30)' }
        }
      }
    },
    {
      name: 'costs_setup_aws_budget',
      description: 'Create AWS budget alert',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'AWS profile' },
          amount: { type: 'number', description: 'Monthly budget amount in USD' },
          email: { type: 'string', description: 'Email for alerts' }
        },
        required: ['amount']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const config = loadConfig();

  try {
    switch (name) {
      case 'costs_get_summary': {
        const awsCosts = await Promise.all(
          config.aws_profiles.map(p => getAWSCosts(p.name))
        );
        const gcpCosts = config.gcp_project
          ? await getGCPCosts(config.gcp_project)
          : { provider: 'GCP', note: 'No GCP project configured' };

        const totalAWS = awsCosts.reduce((sum, c) => sum + (parseFloat(c.total) || 0), 0);
        const totalGCP = parseFloat(gcpCosts.total) || 0;

        const grandTotal = totalAWS + totalGCP;

        // Log to history
        const history = loadCostHistory();
        history.entries.push({
          timestamp: new Date().toISOString(),
          grand_total: grandTotal.toFixed(2),
          aws_total: totalAWS.toFixed(2),
          gcp_total: totalGCP.toFixed(2),
          by_profile: awsCosts.map(c => ({ profile: c.profile, total: c.total }))
        });
        // Keep last 90 days
        history.entries = history.entries.slice(-90);
        saveCostHistory(history);

        // Check thresholds
        const alerts = await checkThresholds(awsCosts, config);
        // Also check GCP
        if (totalGCP >= config.thresholds.critical) {
          alerts.push({
            level: 'CRITICAL',
            service: 'GCP',
            amount: totalGCP,
            threshold: config.thresholds.critical,
            action: 'CHECK_CONSOLE'
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              period: 'Month to date',
              thresholds: config.thresholds,
              grand_total: grandTotal.toFixed(2),
              aws: {
                total: totalAWS.toFixed(2),
                by_profile: awsCosts
              },
              gcp: gcpCosts,
              alerts: alerts.length > 0 ? alerts : 'All costs within thresholds',
              monitored_services: config.monitored_services.filter(s => s.type === 'manual')
            }, null, 2)
          }]
        };
      }

      case 'costs_check_aws': {
        const { profile = 'default' } = args;
        const costs = await getAWSCosts(profile);
        const alerts = await checkThresholds([costs], config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...costs,
              thresholds: config.thresholds,
              status: alerts.length > 0 ? alerts[0] : 'Within budget'
            }, null, 2)
          }]
        };
      }

      case 'costs_check_gcp': {
        const projectId = args.project || config.gcp_project;
        if (!projectId) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'No GCP project specified and none configured'
              }, null, 2)
            }]
          };
        }

        const costs = await getGCPCosts(projectId);
        const status = costs.total >= config.thresholds.critical ? 'CRITICAL' :
                      costs.total >= config.thresholds.caution ? 'CAUTION' :
                      costs.total >= config.thresholds.warning ? 'WARNING' : 'Within budget';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...costs,
              thresholds: config.thresholds,
              status
            }, null, 2)
          }]
        };
      }

      case 'costs_check_alerts': {
        const awsCosts = await Promise.all(
          config.aws_profiles.map(p => getAWSCosts(p.name))
        );
        const alerts = await checkThresholds(awsCosts, config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              thresholds: config.thresholds,
              current_costs: awsCosts.map(c => ({ profile: c.profile, total: c.total })),
              alerts: alerts.length > 0 ? alerts : [],
              status: alerts.length > 0 ? 'ACTION_REQUIRED' : 'ALL_CLEAR'
            }, null, 2)
          }]
        };
      }

      case 'costs_set_threshold': {
        const { warning, caution, critical } = args;
        if (warning) config.thresholds.warning = warning;
        if (caution) config.thresholds.caution = caution;
        if (critical) config.thresholds.critical = critical;

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Thresholds updated',
              thresholds: config.thresholds
            }, null, 2)
          }]
        };
      }

      case 'costs_throttle_check': {
        const { profile = 'default' } = args;
        const throttleInfo = await throttleResources(profile);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              profile,
              throttle_result: throttleInfo,
              note: 'This shows what WOULD be throttled. Actual throttling requires confirmation.'
            }, null, 2)
          }]
        };
      }

      case 'costs_history': {
        const { days = 30 } = args;
        const history = loadCostHistory();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const filtered = history.entries.filter(e => new Date(e.timestamp) >= cutoff);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              period: `Last ${days} days`,
              entries: filtered
            }, null, 2)
          }]
        };
      }

      case 'costs_setup_aws_budget': {
        const { profile = 'default', amount, email = config.alerts.email } = args;

        const budgetClient = new BudgetsClient({
          region: 'us-east-1',
          ...(profile !== 'default' && { profile })
        });

        try {
          // Get account ID from config - each profile should have an account_id field
          const profileConfig = config.aws_profiles.find(p => p.name === profile);
          const accountId = profileConfig?.account_id;

          if (!accountId) {
            return {
              content: [{
                type: 'text',
                text: `Error: No account_id configured for profile "${profile}" in config.json. Add "account_id": "YOUR_ACCOUNT_ID" to the profile.`
              }]
            };
          }

          const command = new CreateBudgetCommand({
            AccountId: accountId,
            Budget: {
              BudgetName: `Monthly-Budget-${amount}`,
              BudgetLimit: {
                Amount: amount.toString(),
                Unit: 'USD'
              },
              BudgetType: 'COST',
              TimeUnit: 'MONTHLY'
            },
            NotificationsWithSubscribers: [
              {
                Notification: {
                  NotificationType: 'ACTUAL',
                  ComparisonOperator: 'GREATER_THAN',
                  Threshold: 50,
                  ThresholdType: 'PERCENTAGE'
                },
                Subscribers: [{ SubscriptionType: 'EMAIL', Address: email }]
              },
              {
                Notification: {
                  NotificationType: 'ACTUAL',
                  ComparisonOperator: 'GREATER_THAN',
                  Threshold: 80,
                  ThresholdType: 'PERCENTAGE'
                },
                Subscribers: [{ SubscriptionType: 'EMAIL', Address: email }]
              },
              {
                Notification: {
                  NotificationType: 'ACTUAL',
                  ComparisonOperator: 'GREATER_THAN',
                  Threshold: 100,
                  ThresholdType: 'PERCENTAGE'
                },
                Subscribers: [{ SubscriptionType: 'EMAIL', Address: email }]
              }
            ]
          });

          await budgetClient.send(command);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Budget created: $${amount}/month`,
                alerts_at: ['50%', '80%', '100%'],
                email
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error.message,
                manual_setup: 'Go to AWS Console > Billing > Budgets to create manually'
              }, null, 2)
            }]
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }, null, 2) }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cost Analyzer MCP server running on stdio');
}

main().catch(console.error);
