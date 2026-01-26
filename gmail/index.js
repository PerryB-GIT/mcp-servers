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

function getGmailClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

function decodeBase64(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function encodeBase64(data) {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const server = new Server(
  { name: 'gmail-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'gmail_send_email',
      description: 'Send an email via Gmail',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          cc: { type: 'string', description: 'CC recipients (comma-separated)' },
          bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
          isHtml: { type: 'boolean', description: 'Whether body is HTML (default: false)' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'gmail_search_emails',
      description: 'Search emails in Gmail',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g., "from:john@example.com", "is:unread", "subject:meeting")' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)' }
        },
        required: ['query']
      }
    },
    {
      name: 'gmail_read_email',
      description: 'Read a specific email by ID',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The email message ID' }
        },
        required: ['messageId']
      }
    },
    {
      name: 'gmail_list_labels',
      description: 'List all Gmail labels',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'gmail_modify_labels',
      description: 'Add or remove labels from an email',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The email message ID' },
          addLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
          removeLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to remove' }
        },
        required: ['messageId']
      }
    },
    {
      name: 'gmail_draft_email',
      description: 'Create a draft email',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const gmail = getGmailClient();

    switch (name) {
      case 'gmail_send_email': {
        const { to, subject, body, cc, bcc, isHtml = false } = args;
        const contentType = isHtml ? 'text/html' : 'text/plain';

        let message = `To: ${to}\r\n`;
        if (cc) message += `Cc: ${cc}\r\n`;
        if (bcc) message += `Bcc: ${bcc}\r\n`;
        message += `Subject: ${subject}\r\n`;
        message += `Content-Type: ${contentType}; charset=utf-8\r\n\r\n`;
        message += body;

        const result = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodeBase64(message) }
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.data.id, message: `Email sent to ${to}` }, null, 2) }]
        };
      }

      case 'gmail_search_emails': {
        const { query, maxResults = 10 } = args;
        const list = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults
        });

        const messages = list.data.messages || [];
        const emails = await Promise.all(
          messages.map(async (m) => {
            const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
            const headers = msg.data.payload.headers;
            return {
              id: m.id,
              threadId: m.threadId,
              from: headers.find(h => h.name === 'From')?.value,
              to: headers.find(h => h.name === 'To')?.value,
              subject: headers.find(h => h.name === 'Subject')?.value,
              date: headers.find(h => h.name === 'Date')?.value,
              snippet: msg.data.snippet
            };
          })
        );

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, count: emails.length, emails }, null, 2) }]
        };
      }

      case 'gmail_read_email': {
        const { messageId } = args;
        const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
        const headers = msg.data.payload.headers;

        let body = '';
        const parts = msg.data.payload.parts || [msg.data.payload];
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = decodeBase64(part.body.data);
            break;
          }
          if (part.mimeType === 'text/html' && part.body?.data && !body) {
            body = decodeBase64(part.body.data);
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              id: messageId,
              from: headers.find(h => h.name === 'From')?.value,
              to: headers.find(h => h.name === 'To')?.value,
              subject: headers.find(h => h.name === 'Subject')?.value,
              date: headers.find(h => h.name === 'Date')?.value,
              body,
              labels: msg.data.labelIds
            }, null, 2)
          }]
        };
      }

      case 'gmail_list_labels': {
        const result = await gmail.users.labels.list({ userId: 'me' });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, labels: result.data.labels }, null, 2) }]
        };
      }

      case 'gmail_modify_labels': {
        const { messageId, addLabels = [], removeLabels = [] } = args;
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: { addLabelIds: addLabels, removeLabelIds: removeLabels }
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Labels updated' }, null, 2) }]
        };
      }

      case 'gmail_draft_email': {
        const { to, subject, body } = args;
        const message = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
        const result = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw: encodeBase64(message) } }
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, draftId: result.data.id, message: 'Draft created' }, null, 2) }]
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
  console.error('Gmail MCP server running on stdio');
}

main().catch(console.error);
