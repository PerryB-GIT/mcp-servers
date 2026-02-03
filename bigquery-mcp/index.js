#!/usr/bin/env node
/**
 * Google BigQuery MCP Server
 * Query and manage BigQuery datasets and tables
 * Uses Application Default Credentials (gcloud auth)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BigQuery } from '@google-cloud/bigquery';

// Initialize BigQuery client (uses ADC)
const bigquery = new BigQuery();

const server = new Server(
  { name: 'bigquery-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'bigquery_list_datasets',
      description: 'List all datasets in a project',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'GCP project ID (optional, uses default)' }
        }
      }
    },
    {
      name: 'bigquery_list_tables',
      description: 'List tables in a dataset',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id']
      }
    },
    {
      name: 'bigquery_get_table_schema',
      description: 'Get schema for a table',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          table_id: { type: 'string', description: 'Table ID' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id', 'table_id']
      }
    },
    {
      name: 'bigquery_query',
      description: 'Run a SQL query',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to execute' },
          max_results: { type: 'number', description: 'Max rows to return (default: 100)' },
          dry_run: { type: 'boolean', description: 'Only estimate bytes processed' }
        },
        required: ['query']
      }
    },
    {
      name: 'bigquery_insert_rows',
      description: 'Insert rows into a table',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          table_id: { type: 'string', description: 'Table ID' },
          rows: { type: 'array', items: { type: 'object' }, description: 'Array of row objects to insert' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id', 'table_id', 'rows']
      }
    },
    {
      name: 'bigquery_create_table',
      description: 'Create a new table',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          table_id: { type: 'string', description: 'Table ID to create' },
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                mode: { type: 'string' }
              }
            },
            description: 'Table schema (array of {name, type, mode})'
          },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id', 'table_id', 'schema']
      }
    },
    {
      name: 'bigquery_delete_table',
      description: 'Delete a table',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          table_id: { type: 'string', description: 'Table ID to delete' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id', 'table_id']
      }
    },
    {
      name: 'bigquery_create_dataset',
      description: 'Create a new dataset',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID to create' },
          location: { type: 'string', description: 'Dataset location (default: US)' },
          description: { type: 'string', description: 'Dataset description' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id']
      }
    },
    {
      name: 'bigquery_delete_dataset',
      description: 'Delete a dataset',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID to delete' },
          force: { type: 'boolean', description: 'Delete even if contains tables' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id']
      }
    },
    {
      name: 'bigquery_export_table',
      description: 'Export table to Google Cloud Storage',
      inputSchema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string', description: 'Dataset ID' },
          table_id: { type: 'string', description: 'Table ID to export' },
          destination_uri: { type: 'string', description: 'GCS URI (e.g., gs://bucket/file.csv)' },
          format: { type: 'string', enum: ['CSV', 'JSON', 'AVRO', 'PARQUET'], description: 'Export format' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['dataset_id', 'table_id', 'destination_uri']
      }
    },
    {
      name: 'bigquery_copy_table',
      description: 'Copy a table to another location',
      inputSchema: {
        type: 'object',
        properties: {
          source_dataset_id: { type: 'string', description: 'Source dataset ID' },
          source_table_id: { type: 'string', description: 'Source table ID' },
          dest_dataset_id: { type: 'string', description: 'Destination dataset ID' },
          dest_table_id: { type: 'string', description: 'Destination table ID' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['source_dataset_id', 'source_table_id', 'dest_dataset_id', 'dest_table_id']
      }
    },
    {
      name: 'bigquery_get_job',
      description: 'Get status of a BigQuery job',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Job ID' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        },
        required: ['job_id']
      }
    },
    {
      name: 'bigquery_list_jobs',
      description: 'List recent BigQuery jobs',
      inputSchema: {
        type: 'object',
        properties: {
          max_results: { type: 'number', description: 'Max jobs to return (default: 10)' },
          state_filter: { type: 'string', enum: ['done', 'pending', 'running'], description: 'Filter by state' },
          project_id: { type: 'string', description: 'GCP project ID (optional)' }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    // Get project-specific client if needed
    const getClient = (projectId) => {
      return projectId ? new BigQuery({ projectId }) : bigquery;
    };

    switch (name) {
      case 'bigquery_list_datasets': {
        const client = getClient(args.project_id);
        const [datasets] = await client.getDatasets();
        result = datasets.map(d => ({
          id: d.id,
          location: d.metadata?.location,
          created: d.metadata?.creationTime
        }));
        break;
      }

      case 'bigquery_list_tables': {
        const client = getClient(args.project_id);
        const dataset = client.dataset(args.dataset_id);
        const [tables] = await dataset.getTables();
        result = tables.map(t => ({
          id: t.id,
          type: t.metadata?.type,
          created: t.metadata?.creationTime,
          numRows: t.metadata?.numRows
        }));
        break;
      }

      case 'bigquery_get_table_schema': {
        const client = getClient(args.project_id);
        const table = client.dataset(args.dataset_id).table(args.table_id);
        const [metadata] = await table.getMetadata();
        result = {
          schema: metadata.schema?.fields,
          numRows: metadata.numRows,
          numBytes: metadata.numBytes,
          type: metadata.type,
          created: metadata.creationTime,
          modified: metadata.lastModifiedTime
        };
        break;
      }

      case 'bigquery_query': {
        const options = {
          query: args.query,
          maxResults: args.max_results || 100
        };

        if (args.dry_run) {
          options.dryRun = true;
          const [job] = await bigquery.createQueryJob(options);
          result = {
            dryRun: true,
            totalBytesProcessed: job.metadata.statistics?.totalBytesProcessed,
            estimatedCost: `$${(parseInt(job.metadata.statistics?.totalBytesProcessed || 0) / 1e12 * 5).toFixed(4)}`
          };
        } else {
          const [rows] = await bigquery.query(options);
          result = {
            rowCount: rows.length,
            rows: rows
          };
        }
        break;
      }

      case 'bigquery_insert_rows': {
        const client = getClient(args.project_id);
        const table = client.dataset(args.dataset_id).table(args.table_id);
        await table.insert(args.rows);
        result = { success: true, rowsInserted: args.rows.length };
        break;
      }

      case 'bigquery_create_table': {
        const client = getClient(args.project_id);
        const dataset = client.dataset(args.dataset_id);
        const [table] = await dataset.createTable(args.table_id, {
          schema: args.schema
        });
        result = { success: true, tableId: table.id };
        break;
      }

      case 'bigquery_delete_table': {
        const client = getClient(args.project_id);
        const table = client.dataset(args.dataset_id).table(args.table_id);
        await table.delete();
        result = { success: true, message: `Table ${args.table_id} deleted` };
        break;
      }

      case 'bigquery_create_dataset': {
        const client = getClient(args.project_id);
        const options = {};
        if (args.location) options.location = args.location;
        if (args.description) options.description = args.description;
        const [dataset] = await client.createDataset(args.dataset_id, options);
        result = { success: true, datasetId: dataset.id };
        break;
      }

      case 'bigquery_delete_dataset': {
        const client = getClient(args.project_id);
        const dataset = client.dataset(args.dataset_id);
        await dataset.delete({ force: args.force || false });
        result = { success: true, message: `Dataset ${args.dataset_id} deleted` };
        break;
      }

      case 'bigquery_export_table': {
        const client = getClient(args.project_id);
        const table = client.dataset(args.dataset_id).table(args.table_id);
        const [job] = await table.extract(args.destination_uri, {
          format: args.format || 'CSV'
        });
        result = {
          success: true,
          jobId: job.id,
          status: job.metadata?.status?.state,
          destination: args.destination_uri
        };
        break;
      }

      case 'bigquery_copy_table': {
        const client = getClient(args.project_id);
        const sourceTable = client.dataset(args.source_dataset_id).table(args.source_table_id);
        const destTable = client.dataset(args.dest_dataset_id).table(args.dest_table_id);
        const [job] = await sourceTable.copy(destTable);
        result = {
          success: true,
          jobId: job.id,
          status: job.metadata?.status?.state
        };
        break;
      }

      case 'bigquery_get_job': {
        const client = getClient(args.project_id);
        const job = client.job(args.job_id);
        const [metadata] = await job.getMetadata();
        result = {
          id: metadata.id,
          status: metadata.status,
          statistics: metadata.statistics,
          configuration: metadata.configuration
        };
        break;
      }

      case 'bigquery_list_jobs': {
        const client = getClient(args.project_id);
        const options = {
          maxResults: args.max_results || 10
        };
        if (args.state_filter) options.stateFilter = args.state_filter;
        const [jobs] = await client.getJobs(options);
        result = jobs.map(j => ({
          id: j.id,
          state: j.metadata?.status?.state,
          created: j.metadata?.statistics?.creationTime,
          type: j.metadata?.configuration?.jobType
        }));
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, data: result }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: error.message }, null, 2)
      }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('BigQuery MCP server running on stdio');
}

main().catch(console.error);
