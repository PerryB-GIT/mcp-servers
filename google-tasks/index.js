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

let cachedClient = null;
let cachedOAuth = null;

async function getTasksClient() {
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
    cachedClient = null;
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
  cachedClient = google.tasks({ version: 'v1', auth: oAuth2Client });
  return cachedClient;
}

const server = new Server(
  { name: 'google-tasks-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'tasks_list_tasklists',
      description: 'List all task lists',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'tasks_list_tasks',
      description: 'List tasks in a task list',
      inputSchema: {
        type: 'object',
        properties: {
          taskListId: { type: 'string', description: 'Task list ID (default: @default for primary list)' },
          showCompleted: { type: 'boolean', description: 'Include completed tasks (default: false)' },
          maxResults: { type: 'number', description: 'Maximum results (default: 20)' }
        }
      }
    },
    {
      name: 'tasks_create_task',
      description: 'Create a new task',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          notes: { type: 'string', description: 'Task notes/description' },
          due: { type: 'string', description: 'Due date (e.g., "today", "tomorrow", "2026-01-30")' },
          taskListId: { type: 'string', description: 'Task list ID (default: @default)' }
        },
        required: ['title']
      }
    },
    {
      name: 'tasks_complete_task',
      description: 'Mark a task as completed',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          taskListId: { type: 'string', description: 'Task list ID (default: @default)' }
        },
        required: ['taskId']
      }
    },
    {
      name: 'tasks_update_task',
      description: 'Update a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          title: { type: 'string', description: 'New title' },
          notes: { type: 'string', description: 'New notes' },
          due: { type: 'string', description: 'New due date' },
          taskListId: { type: 'string', description: 'Task list ID (default: @default)' }
        },
        required: ['taskId']
      }
    },
    {
      name: 'tasks_delete_task',
      description: 'Delete a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          taskListId: { type: 'string', description: 'Task list ID (default: @default)' }
        },
        required: ['taskId']
      }
    },
    {
      name: 'tasks_create_tasklist',
      description: 'Create a new task list',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task list title' }
        },
        required: ['title']
      }
    }
  ]
}));

function parseDueDate(dateStr) {
  const lower = dateStr.toLowerCase();
  const now = new Date();

  if (lower === 'today') {
    return now.toISOString().split('T')[0] + 'T00:00:00.000Z';
  }
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0] + 'T00:00:00.000Z';
  }

  // Parse as date
  const parsed = new Date(dateStr);
  return parsed.toISOString().split('T')[0] + 'T00:00:00.000Z';
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const tasks = await getTasksClient();

    switch (name) {
      case 'tasks_list_tasklists': {
        const result = await tasks.tasklists.list();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskLists: result.data.items?.map(l => ({ id: l.id, title: l.title })) || []
            }, null, 2)
          }]
        };
      }

      case 'tasks_list_tasks': {
        const { taskListId = '@default', showCompleted = false, maxResults = 20 } = args;
        const result = await tasks.tasks.list({
          tasklist: taskListId,
          maxResults,
          showCompleted,
          showHidden: showCompleted
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: result.data.items?.length || 0,
              tasks: result.data.items?.map(t => ({
                id: t.id,
                title: t.title,
                notes: t.notes,
                due: t.due,
                status: t.status,
                completed: t.completed
              })) || []
            }, null, 2)
          }]
        };
      }

      case 'tasks_create_task': {
        const { title, notes, due, taskListId = '@default' } = args;

        const taskBody = { title, notes };
        if (due) taskBody.due = parseDueDate(due);

        const result = await tasks.tasks.insert({
          tasklist: taskListId,
          requestBody: taskBody
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              task: {
                id: result.data.id,
                title: result.data.title,
                notes: result.data.notes,
                due: result.data.due,
                status: result.data.status
              }
            }, null, 2)
          }]
        };
      }

      case 'tasks_complete_task': {
        const { taskId, taskListId = '@default' } = args;

        const result = await tasks.tasks.patch({
          tasklist: taskListId,
          task: taskId,
          requestBody: { status: 'completed' }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Task completed',
              task: { id: result.data.id, title: result.data.title, status: result.data.status }
            }, null, 2)
          }]
        };
      }

      case 'tasks_update_task': {
        const { taskId, title, notes, due, taskListId = '@default' } = args;

        const taskBody = {};
        if (title) taskBody.title = title;
        if (notes) taskBody.notes = notes;
        if (due) taskBody.due = parseDueDate(due);

        const result = await tasks.tasks.patch({
          tasklist: taskListId,
          task: taskId,
          requestBody: taskBody
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              task: {
                id: result.data.id,
                title: result.data.title,
                notes: result.data.notes,
                due: result.data.due,
                status: result.data.status
              }
            }, null, 2)
          }]
        };
      }

      case 'tasks_delete_task': {
        const { taskId, taskListId = '@default' } = args;
        await tasks.tasks.delete({ tasklist: taskListId, task: taskId });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Task deleted' }, null, 2)
          }]
        };
      }

      case 'tasks_create_tasklist': {
        const { title } = args;
        const result = await tasks.tasklists.insert({ requestBody: { title } });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskList: { id: result.data.id, title: result.data.title }
            }, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error.message?.includes('invalid_grant') || error.message?.includes('Token') || error.code === 401) {
      cachedClient = null;
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
  console.error('Google Tasks MCP server running on stdio');
}

main().catch(console.error);
