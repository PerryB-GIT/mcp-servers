#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

function getSheetsClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);
  return google.sheets({ version: 'v4', auth: oAuth2Client });
}

const server = new Server(
  { name: 'google-sheets-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'sheets_read_range',
      description: 'Read data from a spreadsheet range',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID (from URL)' },
          range: { type: 'string', description: 'Range in A1 notation (e.g., "Sheet1!A1:D10")' }
        },
        required: ['spreadsheetId', 'range']
      }
    },
    {
      name: 'sheets_write_range',
      description: 'Write data to a spreadsheet range',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          range: { type: 'string', description: 'Range in A1 notation' },
          values: { type: 'array', description: 'Array of rows, each row is an array of values' }
        },
        required: ['spreadsheetId', 'range', 'values']
      }
    },
    {
      name: 'sheets_append_rows',
      description: 'Append rows to the end of a sheet',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          range: { type: 'string', description: 'Target sheet (e.g., "Sheet1")' },
          values: { type: 'array', description: 'Array of rows to append' }
        },
        required: ['spreadsheetId', 'range', 'values']
      }
    },
    {
      name: 'sheets_get_metadata',
      description: 'Get spreadsheet metadata (sheets, titles, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' }
        },
        required: ['spreadsheetId']
      }
    },
    {
      name: 'sheets_create_spreadsheet',
      description: 'Create a new spreadsheet',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Spreadsheet title' },
          sheets: { type: 'array', items: { type: 'string' }, description: 'Sheet names to create' }
        },
        required: ['title']
      }
    },
    {
      name: 'sheets_add_sheet',
      description: 'Add a new sheet to an existing spreadsheet',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          title: { type: 'string', description: 'New sheet title' }
        },
        required: ['spreadsheetId', 'title']
      }
    },
    {
      name: 'sheets_clear_range',
      description: 'Clear values in a range',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          range: { type: 'string', description: 'Range to clear' }
        },
        required: ['spreadsheetId', 'range']
      }
    },
    {
      name: 'sheets_batch_update',
      description: 'Perform batch updates (formatting, borders, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          requests: { type: 'array', description: 'Array of update requests' }
        },
        required: ['spreadsheetId', 'requests']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const sheets = getSheetsClient();

    switch (name) {
      case 'sheets_read_range': {
        const { spreadsheetId, range } = args;
        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              range: result.data.range,
              values: result.data.values || []
            }, null, 2)
          }]
        };
      }

      case 'sheets_write_range': {
        const { spreadsheetId, range, values } = args;
        const result = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              updatedRange: result.data.updatedRange,
              updatedRows: result.data.updatedRows,
              updatedColumns: result.data.updatedColumns,
              updatedCells: result.data.updatedCells
            }, null, 2)
          }]
        };
      }

      case 'sheets_append_rows': {
        const { spreadsheetId, range, values } = args;
        const result = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              updatedRange: result.data.updates.updatedRange,
              updatedRows: result.data.updates.updatedRows
            }, null, 2)
          }]
        };
      }

      case 'sheets_get_metadata': {
        const { spreadsheetId } = args;
        const result = await sheets.spreadsheets.get({ spreadsheetId });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              title: result.data.properties.title,
              spreadsheetUrl: result.data.spreadsheetUrl,
              sheets: result.data.sheets.map(s => ({
                sheetId: s.properties.sheetId,
                title: s.properties.title,
                rowCount: s.properties.gridProperties?.rowCount,
                columnCount: s.properties.gridProperties?.columnCount
              }))
            }, null, 2)
          }]
        };
      }

      case 'sheets_create_spreadsheet': {
        const { title, sheets: sheetNames = ['Sheet1'] } = args;
        const result = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title },
            sheets: sheetNames.map(name => ({ properties: { title: name } }))
          }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              spreadsheetId: result.data.spreadsheetId,
              spreadsheetUrl: result.data.spreadsheetUrl,
              title: result.data.properties.title
            }, null, 2)
          }]
        };
      }

      case 'sheets_add_sheet': {
        const { spreadsheetId, title } = args;
        const result = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title } } }]
          }
        });

        const newSheet = result.data.replies[0].addSheet;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sheetId: newSheet.properties.sheetId,
              title: newSheet.properties.title
            }, null, 2)
          }]
        };
      }

      case 'sheets_clear_range': {
        const { spreadsheetId, range } = args;
        await sheets.spreadsheets.values.clear({ spreadsheetId, range });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: `Cleared ${range}` }, null, 2)
          }]
        };
      }

      case 'sheets_batch_update': {
        const { spreadsheetId, requests } = args;
        const result = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              repliesCount: result.data.replies.length
            }, null, 2)
          }]
        };
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
  console.error('Google Sheets MCP server running on stdio');
}

main().catch(console.error);
