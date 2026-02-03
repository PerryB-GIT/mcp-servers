#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

let cachedOAuth = null;

async function getAuthClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3334/oauth2callback');
  oAuth2Client.setCredentials(token);

  try {
    const { credentials: newCreds } = await oAuth2Client.refreshAccessToken();
    oAuth2Client.setCredentials(newCreds);
    const tokenToSave = {
      ...newCreds,
      refresh_token: newCreds.refresh_token || token.refresh_token
    };
    writeFileSync(TOKEN_PATH, JSON.stringify(tokenToSave, null, 2));
  } catch (err) {
    cachedOAuth = null;
    throw new Error('Token refresh failed. Run "npm run auth" to re-authenticate.');
  }

  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token || tokens.access_token) {
      const currentToken = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
      const updatedToken = { ...currentToken, ...tokens };
      writeFileSync(TOKEN_PATH, JSON.stringify(updatedToken, null, 2));
    }
  });

  cachedOAuth = oAuth2Client;
  return oAuth2Client;
}

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: await getAuthClient() });
}

async function getDriveClient() {
  return google.drive({ version: 'v3', auth: await getAuthClient() });
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
    },
    {
      name: 'sheets_list',
      description: 'List all spreadsheets in Google Drive',
      inputSchema: {
        type: 'object',
        properties: {
          pageSize: { type: 'number', description: 'Max results (default 20, max 100)' },
          pageToken: { type: 'string', description: 'Token for next page of results' }
        }
      }
    },
    {
      name: 'sheets_delete_sheet',
      description: 'Delete a sheet from a spreadsheet',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          sheetId: { type: 'number', description: 'The sheet ID (numeric, from metadata)' }
        },
        required: ['spreadsheetId', 'sheetId']
      }
    },
    {
      name: 'sheets_copy_sheet',
      description: 'Copy a sheet to another spreadsheet',
      inputSchema: {
        type: 'object',
        properties: {
          sourceSpreadsheetId: { type: 'string', description: 'Source spreadsheet ID' },
          sheetId: { type: 'number', description: 'Sheet ID to copy' },
          destinationSpreadsheetId: { type: 'string', description: 'Destination spreadsheet ID' }
        },
        required: ['sourceSpreadsheetId', 'sheetId', 'destinationSpreadsheetId']
      }
    },
    {
      name: 'sheets_format_cells',
      description: 'Apply formatting to a range (bold, colors, alignment)',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          sheetId: { type: 'number', description: 'Sheet ID (numeric)' },
          startRow: { type: 'number', description: 'Start row index (0-based)' },
          endRow: { type: 'number', description: 'End row index (exclusive)' },
          startColumn: { type: 'number', description: 'Start column index (0-based)' },
          endColumn: { type: 'number', description: 'End column index (exclusive)' },
          bold: { type: 'boolean', description: 'Make text bold' },
          italic: { type: 'boolean', description: 'Make text italic' },
          backgroundColor: { type: 'object', description: 'RGB color {red, green, blue} 0-1' },
          textColor: { type: 'object', description: 'RGB color {red, green, blue} 0-1' },
          horizontalAlignment: { type: 'string', description: 'LEFT, CENTER, or RIGHT' }
        },
        required: ['spreadsheetId', 'sheetId', 'startRow', 'endRow', 'startColumn', 'endColumn']
      }
    },
    {
      name: 'sheets_freeze',
      description: 'Freeze rows or columns in a sheet',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          sheetId: { type: 'number', description: 'Sheet ID (numeric)' },
          frozenRowCount: { type: 'number', description: 'Number of rows to freeze' },
          frozenColumnCount: { type: 'number', description: 'Number of columns to freeze' }
        },
        required: ['spreadsheetId', 'sheetId']
      }
    },
    {
      name: 'sheets_resize_columns',
      description: 'Auto-resize columns to fit content',
      inputSchema: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          sheetId: { type: 'number', description: 'Sheet ID (numeric)' },
          startIndex: { type: 'number', description: 'Start column index (0-based)' },
          endIndex: { type: 'number', description: 'End column index (exclusive)' }
        },
        required: ['spreadsheetId', 'sheetId', 'startIndex', 'endIndex']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const sheets = await getSheetsClient();

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

      case 'sheets_list': {
        const drive = await getDriveClient();
        const { pageSize = 20, pageToken } = args;
        const result = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.spreadsheet'",
          pageSize: Math.min(pageSize, 100),
          pageToken,
          fields: 'nextPageToken, files(id, name, createdTime, modifiedTime, webViewLink)'
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              spreadsheets: result.data.files.map(f => ({
                id: f.id,
                name: f.name,
                createdTime: f.createdTime,
                modifiedTime: f.modifiedTime,
                url: f.webViewLink
              })),
              nextPageToken: result.data.nextPageToken || null
            }, null, 2)
          }]
        };
      }

      case 'sheets_delete_sheet': {
        const { spreadsheetId, sheetId } = args;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ deleteSheet: { sheetId } }]
          }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: `Deleted sheet ${sheetId}` }, null, 2)
          }]
        };
      }

      case 'sheets_copy_sheet': {
        const { sourceSpreadsheetId, sheetId, destinationSpreadsheetId } = args;
        const result = await sheets.spreadsheets.sheets.copyTo({
          spreadsheetId: sourceSpreadsheetId,
          sheetId,
          requestBody: { destinationSpreadsheetId }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              newSheetId: result.data.sheetId,
              newTitle: result.data.title
            }, null, 2)
          }]
        };
      }

      case 'sheets_format_cells': {
        const { spreadsheetId, sheetId, startRow, endRow, startColumn, endColumn,
                bold, italic, backgroundColor, textColor, horizontalAlignment } = args;

        const cellFormat = {};
        const fields = [];

        if (bold !== undefined || italic !== undefined) {
          cellFormat.textFormat = {};
          if (bold !== undefined) { cellFormat.textFormat.bold = bold; fields.push('userEnteredFormat.textFormat.bold'); }
          if (italic !== undefined) { cellFormat.textFormat.italic = italic; fields.push('userEnteredFormat.textFormat.italic'); }
        }
        if (backgroundColor) {
          cellFormat.backgroundColor = backgroundColor;
          fields.push('userEnteredFormat.backgroundColor');
        }
        if (textColor) {
          cellFormat.textFormat = cellFormat.textFormat || {};
          cellFormat.textFormat.foregroundColor = textColor;
          fields.push('userEnteredFormat.textFormat.foregroundColor');
        }
        if (horizontalAlignment) {
          cellFormat.horizontalAlignment = horizontalAlignment;
          fields.push('userEnteredFormat.horizontalAlignment');
        }

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              repeatCell: {
                range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startColumn, endColumnIndex: endColumn },
                cell: { userEnteredFormat: cellFormat },
                fields: fields.join(',')
              }
            }]
          }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Formatting applied' }, null, 2)
          }]
        };
      }

      case 'sheets_freeze': {
        const { spreadsheetId, sheetId, frozenRowCount, frozenColumnCount } = args;
        const gridProperties = {};
        if (frozenRowCount !== undefined) gridProperties.frozenRowCount = frozenRowCount;
        if (frozenColumnCount !== undefined) gridProperties.frozenColumnCount = frozenColumnCount;

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              updateSheetProperties: {
                properties: { sheetId, gridProperties },
                fields: Object.keys(gridProperties).map(k => `gridProperties.${k}`).join(',')
              }
            }]
          }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Freeze settings updated' }, null, 2)
          }]
        };
      }

      case 'sheets_resize_columns': {
        const { spreadsheetId, sheetId, startIndex, endIndex } = args;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              autoResizeDimensions: {
                dimensions: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex,
                  endIndex
                }
              }
            }]
          }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: `Resized columns ${startIndex} to ${endIndex}` }, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error.message?.includes('invalid_grant') || error.message?.includes('Token') || error.code === 401) {
      cachedOAuth = null;
    }
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
