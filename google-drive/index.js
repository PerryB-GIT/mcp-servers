#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { readFileSync, existsSync, createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

function getDriveClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

const server = new Server(
  { name: 'google-drive-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'drive_list_files',
      description: 'List files in Google Drive',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "name contains \'report\'", "mimeType=\'application/pdf\'")' },
          folderId: { type: 'string', description: 'Folder ID to list files from (default: root)' },
          maxResults: { type: 'number', description: 'Maximum results (default: 20)' }
        }
      }
    },
    {
      name: 'drive_get_file',
      description: 'Get file metadata by ID',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file ID' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive_read_file',
      description: 'Read content of a Google Doc, Sheet, or text file',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'The file ID' },
          mimeType: { type: 'string', description: 'Export format (text/plain, text/csv, application/pdf)' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive_create_folder',
      description: 'Create a new folder',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parentId: { type: 'string', description: 'Parent folder ID (default: root)' }
        },
        required: ['name']
      }
    },
    {
      name: 'drive_move_file',
      description: 'Move a file to a different folder',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'File ID to move' },
          newParentId: { type: 'string', description: 'Destination folder ID' }
        },
        required: ['fileId', 'newParentId']
      }
    },
    {
      name: 'drive_delete_file',
      description: 'Move a file to trash',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'File ID to delete' }
        },
        required: ['fileId']
      }
    },
    {
      name: 'drive_share_file',
      description: 'Share a file with someone',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'File ID to share' },
          email: { type: 'string', description: 'Email address to share with' },
          role: { type: 'string', description: 'Permission role: reader, writer, commenter' }
        },
        required: ['fileId', 'email', 'role']
      }
    },
    {
      name: 'drive_search',
      description: 'Search for files across Drive',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Full-text search query' },
          maxResults: { type: 'number', description: 'Maximum results (default: 20)' }
        },
        required: ['query']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const drive = getDriveClient();

    switch (name) {
      case 'drive_list_files': {
        const { query, folderId, maxResults = 20 } = args;
        let q = folderId ? `'${folderId}' in parents` : "'root' in parents";
        if (query) q += ` and ${query}`;
        q += ' and trashed=false';

        const result = await drive.files.list({
          q,
          pageSize: maxResults,
          fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, parents)'
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, count: result.data.files.length, files: result.data.files }, null, 2) }]
        };
      }

      case 'drive_get_file': {
        const { fileId } = args;
        const result = await drive.files.get({
          fileId,
          fields: 'id, name, mimeType, size, modifiedTime, webViewLink, parents, owners, shared'
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, file: result.data }, null, 2) }]
        };
      }

      case 'drive_read_file': {
        const { fileId, mimeType = 'text/plain' } = args;
        const meta = await drive.files.get({ fileId, fields: 'mimeType, name' });

        let content;
        if (meta.data.mimeType.includes('google-apps')) {
          const response = await drive.files.export({ fileId, mimeType }, { responseType: 'text' });
          content = response.data;
        } else {
          const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
          content = response.data;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, name: meta.data.name, content: content.substring(0, 50000) }, null, 2) }]
        };
      }

      case 'drive_create_folder': {
        const { name, parentId } = args;
        const result = await drive.files.create({
          requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: parentId ? [parentId] : undefined
          },
          fields: 'id, name, webViewLink'
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, folder: result.data }, null, 2) }]
        };
      }

      case 'drive_move_file': {
        const { fileId, newParentId } = args;
        const file = await drive.files.get({ fileId, fields: 'parents' });
        const previousParents = file.data.parents.join(',');

        const result = await drive.files.update({
          fileId,
          addParents: newParentId,
          removeParents: previousParents,
          fields: 'id, name, parents'
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, file: result.data }, null, 2) }]
        };
      }

      case 'drive_delete_file': {
        const { fileId } = args;
        await drive.files.update({ fileId, requestBody: { trashed: true } });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'File moved to trash' }, null, 2) }]
        };
      }

      case 'drive_share_file': {
        const { fileId, email, role } = args;
        await drive.permissions.create({
          fileId,
          requestBody: { type: 'user', role, emailAddress: email },
          sendNotificationEmail: true
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Shared with ${email} as ${role}` }, null, 2) }]
        };
      }

      case 'drive_search': {
        const { query, maxResults = 20 } = args;
        const result = await drive.files.list({
          q: `fullText contains '${query}' and trashed=false`,
          pageSize: maxResults,
          fields: 'files(id, name, mimeType, modifiedTime, webViewLink)'
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, count: result.data.files.length, files: result.data.files }, null, 2) }]
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
  console.error('Google Drive MCP server running on stdio');
}

main().catch(console.error);
