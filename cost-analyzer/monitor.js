#!/usr/bin/env node
/**
 * Cost Monitor - Standalone script for scheduled cost checks
 * Run via: node monitor.js
 * Schedule with Task Scheduler (Windows) or cron (WSL)
 */

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync, spawnSync } from 'child_process';

// Helper to run gcloud commands on Windows (requires shell for .cmd files)
function runGcloud(args) {
  const result = spawnSync('gcloud', args, {
    encoding: 'utf8',
    shell: true,
    timeout: 30000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'gcloud command failed');
  return result.stdout;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, 'config.json');
const LOG_PATH = join(__dirname, 'monitor-log.json');
const ALERT_HISTORY_PATH = join(__dirname, 'alert-history.json');

// Load config
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

async function getAWSCosts(profile) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const args = [
      'ce', 'get-cost-and-usage',
      '--time-period', `Start=${startOfMonth.toISOString().split('T')[0]},End=${now.toISOString().split('T')[0]}`,
      '--granularity', 'MONTHLY',
      '--metrics', 'UnblendedCost',
      '--profile', profile,
      '--output', 'json'
    ];

    const result = JSON.parse(execFileSync('aws', args, { encoding: 'utf8' }));
    const amount = parseFloat(result.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || 0);

    return { provider: 'AWS', profile, total: amount, success: true };
  } catch (error) {
    console.error(`Error getting costs for ${profile}:`, error.message);
    return { provider: 'AWS', profile, total: 0, success: false, error: error.message };
  }
}

async function getGCPCosts(projectId) {
  try {
    // Get billing account linked to project
    let billingInfo;
    try {
      const billingOut = runGcloud(['billing', 'projects', 'describe', projectId, '--format', 'json']);
      billingInfo = JSON.parse(billingOut);
    } catch (e) {
      billingInfo = { billingAccountName: 'unknown', billingEnabled: true };
    }

    // Query active services
    const servicesOut = runGcloud([
      'services', 'list',
      '--project', projectId,
      '--filter', 'state:ENABLED',
      '--format', 'json'
    ]);

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
      'speech.googleapis.com',
      'language.googleapis.com'
    ];

    const activeExpensive = enabledAPIs.filter(api =>
      expensiveAPIs.some(exp => api.includes(exp.split('.')[0]))
    );

    // Try to get cost estimate from billing budgets
    let estimatedCost = 0;
    let budgetInfo = null;

    try {
      const budgetOut = runGcloud([
        'billing', 'budgets', 'list',
        '--billing-account', billingInfo.billingAccountName?.split('/').pop() || '',
        '--format', 'json'
      ]);
      const budgets = JSON.parse(budgetOut || '[]');
      if (budgets.length > 0) {
        budgetInfo = budgets[0];
        // If there's spend info in budget alerts, use it
        if (budgetInfo.amount?.specifiedAmount?.units) {
          estimatedCost = parseFloat(budgetInfo.amount.specifiedAmount.units) * 0.5; // Estimate 50% spent
        }
      }
    } catch (e) {
      // Budgets API not available or no budgets set
    }

    return {
      provider: 'GCP',
      project: projectId,
      total: estimatedCost,
      success: true,
      billing_account: billingInfo.billingAccountName,
      enabled_apis: enabledAPIs.length,
      expensive_apis_active: activeExpensive,
      budget: budgetInfo ? {
        name: budgetInfo.displayName,
        limit: budgetInfo.amount?.specifiedAmount?.units || 'N/A'
      } : null,
      note: estimatedCost === 0 ? 'Check console.cloud.google.com/billing for exact costs' : null
    };
  } catch (error) {
    console.error(`Error getting GCP costs:`, error.message);
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

async function disableGCPAPIs(projectId, dryRun = true) {
  console.log(`\n🔧 Checking GCP throttle targets for ${projectId}...`);

  // APIs that can be safely disabled to reduce costs
  const throttleableAPIs = [
    'aiplatform.googleapis.com',
    'translate.googleapis.com',
    'vision.googleapis.com',
    'speech.googleapis.com',
    'language.googleapis.com',
    'videointelligence.googleapis.com'
  ];

  try {
    const servicesOut = runGcloud([
      'services', 'list',
      '--project', projectId,
      '--filter', 'state:ENABLED',
      '--format', 'json'
    ]);

    const services = JSON.parse(servicesOut || '[]');
    const enabledAPIs = services.map(s => s.config?.name || s.name).filter(Boolean);

    const toDisable = enabledAPIs.filter(api =>
      throttleableAPIs.some(t => api.includes(t))
    );

    if (toDisable.length > 0) {
      console.log(`   Found ${toDisable.length} throttleable APIs:`);
      toDisable.forEach(api => console.log(`   - ${api}`));

      if (!dryRun) {
        for (const api of toDisable) {
          runGcloud(['services', 'disable', api, '--project', projectId, '--force']);
          console.log(`   ✅ Disabled ${api}`);
        }

        await sendAlert('CRITICAL', `Auto-disabled ${toDisable.length} GCP APIs`, {
          project: projectId,
          disabled_apis: toDisable
        });
      } else {
        console.log('   (Dry run - APIs NOT disabled)');
      }

      return { throttled: toDisable, dryRun };
    }

    console.log('   No throttleable APIs to disable');
    return { throttled: [], message: 'No targets' };
  } catch (error) {
    console.error(`   Error: ${error.message}`);
    return { error: error.message };
  }
}

async function sendAlert(level, message, details) {
  const timestamp = new Date().toISOString();

  // Log alert
  const alertHistory = existsSync(ALERT_HISTORY_PATH)
    ? JSON.parse(readFileSync(ALERT_HISTORY_PATH, 'utf8'))
    : { alerts: [] };

  alertHistory.alerts.push({ timestamp, level, message, details });
  alertHistory.alerts = alertHistory.alerts.slice(-100); // Keep last 100
  writeFileSync(ALERT_HISTORY_PATH, JSON.stringify(alertHistory, null, 2));

  // Console output
  const emoji = level === 'CRITICAL' ? '🚨' : level === 'CAUTION' ? '⚠️' : '📢';
  console.log(`${emoji} [${level}] ${message}`);
  console.log(`   Details: ${JSON.stringify(details)}`);

  // Send email via AWS SES or Gmail API
  // For now, we'll use the Gmail MCP when integrated
  console.log(`   📧 Alert logged - use Gmail MCP to send: gmail_send_email to:${config.alerts.email}`);

  // Could also trigger via webhook/n8n
  if (level === 'CRITICAL') {
    console.log('   🚨 CRITICAL ALERT - Consider immediate action!');
  }
}

async function throttleResources(profile, dryRun = true) {
  console.log(`\n🔧 Checking throttle targets for ${profile}...`);

  try {
    const args = [
      'ec2', 'describe-instances',
      '--filters', 'Name=instance-state-name,Values=running',
      '--profile', profile,
      '--query', 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0]]',
      '--output', 'json'
    ];

    const result = JSON.parse(execFileSync('aws', args, { encoding: 'utf8' }));
    const instances = result.flat().filter(i => i && i.length > 0);

    const stoppable = instances.filter(([id, name]) => {
      const n = (name || '').toLowerCase();
      return !n.includes('prod') && !n.includes('production') && !n.includes('critical');
    });

    if (stoppable.length > 0) {
      console.log(`   Found ${stoppable.length} non-production instances:`);
      stoppable.forEach(([id, name]) => console.log(`   - ${id}: ${name || 'unnamed'}`));

      if (!dryRun) {
        const ids = stoppable.map(([id]) => id);
        const stopArgs = ['ec2', 'stop-instances', '--instance-ids', ...ids, '--profile', profile];
        execFileSync('aws', stopArgs);
        console.log('   ✅ Instances stopped!');

        await sendAlert('CRITICAL', `Auto-throttled ${stoppable.length} instances`, {
          profile,
          stopped_instances: stoppable
        });
      } else {
        console.log('   (Dry run - instances NOT stopped)');
      }

      return { throttled: stoppable, dryRun };
    }

    console.log('   No non-production instances to throttle');
    return { throttled: [], message: 'No targets' };
  } catch (error) {
    console.error(`   Error: ${error.message}`);
    return { error: error.message };
  }
}

async function runMonitor() {
  console.log('\n========================================');
  console.log('💰 COST MONITOR - ' + new Date().toLocaleString());
  console.log('========================================\n');

  const results = [];

  // Check each AWS profile
  console.log('--- AWS ACCOUNTS ---');
  for (const profile of config.aws_profiles) {
    console.log(`Checking ${profile.name} (${profile.description})...`);
    const costs = await getAWSCosts(profile.name);
    results.push(costs);

    if (costs.success) {
      console.log(`   Total: $${costs.total.toFixed(2)}`);

      // Check thresholds
      if (costs.total >= config.thresholds.critical) {
        await sendAlert('CRITICAL', `AWS ${profile.name} exceeded $${config.thresholds.critical}`, {
          provider: 'AWS',
          profile: profile.name,
          current: costs.total.toFixed(2),
          threshold: config.thresholds.critical
        });

        // Auto-throttle if enabled
        if (config.auto_throttle.enabled) {
          await throttleResources(profile.name, true); // Change to false for real throttling
        }
      } else if (costs.total >= config.thresholds.caution) {
        await sendAlert('CAUTION', `AWS ${profile.name} exceeded $${config.thresholds.caution}`, {
          provider: 'AWS',
          profile: profile.name,
          current: costs.total.toFixed(2),
          threshold: config.thresholds.caution
        });
      } else if (costs.total >= config.thresholds.warning) {
        await sendAlert('WARNING', `AWS ${profile.name} exceeded $${config.thresholds.warning}`, {
          provider: 'AWS',
          profile: profile.name,
          current: costs.total.toFixed(2),
          threshold: config.thresholds.warning
        });
      } else {
        console.log(`   ✅ Within budget`);
      }
    }
  }

  // Check GCP
  console.log('\n--- GOOGLE CLOUD ---');
  if (config.gcp_project) {
    console.log(`Checking GCP project: ${config.gcp_project}...`);
    const gcpCosts = await getGCPCosts(config.gcp_project);
    results.push(gcpCosts);

    if (gcpCosts.success) {
      console.log(`   Enabled APIs: ${gcpCosts.enabled_apis}`);
      if (gcpCosts.expensive_apis_active?.length > 0) {
        console.log(`   Expensive APIs active: ${gcpCosts.expensive_apis_active.join(', ')}`);
      }
      if (gcpCosts.total > 0) {
        console.log(`   Estimated cost: $${gcpCosts.total.toFixed(2)}`);
      }
      if (gcpCosts.note) {
        console.log(`   Note: ${gcpCosts.note}`);
      }

      // Check thresholds for GCP
      if (gcpCosts.total >= config.thresholds.critical) {
        await sendAlert('CRITICAL', `GCP ${config.gcp_project} exceeded $${config.thresholds.critical}`, {
          provider: 'GCP',
          project: config.gcp_project,
          current: gcpCosts.total.toFixed(2),
          threshold: config.thresholds.critical
        });

        if (config.auto_throttle.enabled) {
          await disableGCPAPIs(config.gcp_project, true); // Change to false for real throttling
        }
      } else if (gcpCosts.total >= config.thresholds.caution) {
        await sendAlert('CAUTION', `GCP ${config.gcp_project} exceeded $${config.thresholds.caution}`, {
          provider: 'GCP',
          project: config.gcp_project,
          current: gcpCosts.total.toFixed(2),
          threshold: config.thresholds.caution
        });
      } else {
        console.log(`   ✅ Within budget`);
      }
    } else {
      console.log(`   ⚠️ Could not fetch GCP costs: ${gcpCosts.error}`);
    }
  }

  // Calculate totals
  const awsTotal = results.filter(r => r.provider === 'AWS').reduce((sum, r) => sum + (r.total || 0), 0);
  const gcpTotal = results.filter(r => r.provider === 'GCP').reduce((sum, r) => sum + (r.total || 0), 0);
  const grandTotal = awsTotal + gcpTotal;

  console.log('\n--- SUMMARY ---');
  console.log(`AWS Total:  $${awsTotal.toFixed(2)}`);
  console.log(`GCP Total:  $${gcpTotal.toFixed(2)}`);
  console.log(`────────────────────`);
  console.log(`GRAND TOTAL: $${grandTotal.toFixed(2)}`);

  // Check combined total against thresholds
  if (grandTotal >= config.thresholds.critical) {
    await sendAlert('CRITICAL', `Combined spending exceeded $${config.thresholds.critical}!`, {
      aws_total: awsTotal.toFixed(2),
      gcp_total: gcpTotal.toFixed(2),
      grand_total: grandTotal.toFixed(2),
      threshold: config.thresholds.critical
    });
  }

  // Log results
  const logEntry = {
    timestamp: new Date().toISOString(),
    grand_total: grandTotal.toFixed(2),
    aws_total: awsTotal.toFixed(2),
    gcp_total: gcpTotal.toFixed(2),
    by_service: results.map(r => ({
      provider: r.provider,
      name: r.profile || r.project,
      total: r.total?.toFixed(2) || 'error',
      success: r.success
    })),
    thresholds: config.thresholds
  };

  const log = existsSync(LOG_PATH)
    ? JSON.parse(readFileSync(LOG_PATH, 'utf8'))
    : { entries: [] };

  log.entries.push(logEntry);
  log.entries = log.entries.slice(-365); // Keep 1 year of daily logs
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  console.log('\n✅ Monitor run complete. Log saved.');
  console.log('========================================\n');
}

// Run if called directly
runMonitor().catch(console.error);
