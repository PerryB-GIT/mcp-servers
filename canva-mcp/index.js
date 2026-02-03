#!/usr/bin/env node
/**
 * Canva MCP Server
 * API integration for design creation and export
 * Requires OAuth tokens from auth.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOKEN_PATH = join(__dirname, 'token.json');
const API_BASE = 'https://api.canva.com/rest/v1';

function getToken() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
}

async function canvaRequest(endpoint, method = 'GET', body = null) {
  const token = getToken();

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  if (response.status === 204) {
    return { success: true };
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error?.message || `API error: ${response.status}`);
  }

  return data;
}

// Poll for job completion
async function waitForJob(endpoint, maxWait = 60000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const result = await canvaRequest(endpoint);
    if (result.job?.status === 'success') {
      return result;
    }
    if (result.job?.status === 'failed') {
      throw new Error(result.job.error?.message || 'Job failed');
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Job timed out');
}

const server = new Server(
  { name: 'canva-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'canva_list_designs',
      description: 'List user designs',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max designs to return (default: 20)' },
          query: { type: 'string', description: 'Search query' }
        }
      }
    },
    {
      name: 'canva_get_design',
      description: 'Get details about a specific design',
      inputSchema: {
        type: 'object',
        properties: {
          design_id: { type: 'string', description: 'Design ID' }
        },
        required: ['design_id']
      }
    },
    {
      name: 'canva_create_design',
      description: 'Create a new design',
      inputSchema: {
        type: 'object',
        properties: {
          design_type: { type: 'string', description: 'Design type (e.g., Presentation, Poster, InstagramPost)' },
          title: { type: 'string', description: 'Design title' },
          width: { type: 'number', description: 'Width in pixels (for custom size)' },
          height: { type: 'number', description: 'Height in pixels (for custom size)' }
        },
        required: ['design_type']
      }
    },
    {
      name: 'canva_export_design',
      description: 'Export a design to PDF, PNG, or JPG',
      inputSchema: {
        type: 'object',
        properties: {
          design_id: { type: 'string', description: 'Design ID to export' },
          format: { type: 'string', enum: ['pdf', 'png', 'jpg'], description: 'Export format' },
          pages: { type: 'array', items: { type: 'number' }, description: 'Page numbers to export (optional)' }
        },
        required: ['design_id', 'format']
      }
    },
    {
      name: 'canva_upload_asset',
      description: 'Upload an image asset to Canva',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of image to upload' },
          name: { type: 'string', description: 'Asset name' }
        },
        required: ['url']
      }
    },
    {
      name: 'canva_list_assets',
      description: 'List uploaded assets',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max assets to return' }
        }
      }
    },
    {
      name: 'canva_get_asset',
      description: 'Get details about an uploaded asset',
      inputSchema: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset ID' }
        },
        required: ['asset_id']
      }
    },
    {
      name: 'canva_delete_asset',
      description: 'Delete an uploaded asset',
      inputSchema: {
        type: 'object',
        properties: {
          asset_id: { type: 'string', description: 'Asset ID to delete' }
        },
        required: ['asset_id']
      }
    },
    {
      name: 'canva_list_folders',
      description: 'List folders in Canva',
      inputSchema: {
        type: 'object',
        properties: {
          parent_folder_id: { type: 'string', description: 'Parent folder ID (optional, for subfolders)' }
        }
      }
    },
    {
      name: 'canva_create_folder',
      description: 'Create a new folder',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parent_folder_id: { type: 'string', description: 'Parent folder ID (optional)' }
        },
        required: ['name']
      }
    },
    {
      name: 'canva_move_design',
      description: 'Move a design to a folder',
      inputSchema: {
        type: 'object',
        properties: {
          design_id: { type: 'string', description: 'Design ID to move' },
          folder_id: { type: 'string', description: 'Target folder ID' }
        },
        required: ['design_id', 'folder_id']
      }
    },
    {
      name: 'canva_get_user',
      description: 'Get current user info',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'canva_list_brand_templates',
      description: 'List brand templates (requires Canva Pro)',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max templates to return' }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'canva_list_designs': {
        let endpoint = '/designs';
        const params = [];
        if (args.limit) params.push(`limit=${args.limit}`);
        if (args.query) params.push(`query=${encodeURIComponent(args.query)}`);
        if (params.length) endpoint += '?' + params.join('&');
        result = await canvaRequest(endpoint);
        break;
      }

      case 'canva_get_design': {
        result = await canvaRequest(`/designs/${args.design_id}`);
        break;
      }

      case 'canva_create_design': {
        const payload = {
          design_type: { type: args.design_type }
        };
        if (args.title) payload.title = args.title;
        if (args.width && args.height) {
          payload.design_type = {
            type: 'custom',
            width: args.width,
            height: args.height
          };
        }
        result = await canvaRequest('/designs', 'POST', payload);
        break;
      }

      case 'canva_export_design': {
        // Start export job
        const payload = {
          format: { type: args.format }
        };
        if (args.pages) {
          payload.format.pages = args.pages;
        }
        const job = await canvaRequest(`/designs/${args.design_id}/exports`, 'POST', payload);

        // Wait for completion
        result = await waitForJob(`/designs/${args.design_id}/exports/${job.job.id}`);
        break;
      }

      case 'canva_upload_asset': {
        const payload = { url: args.url };
        if (args.name) payload.name = args.name;

        // Start upload job
        const job = await canvaRequest('/asset-uploads', 'POST', payload);

        // Wait for completion
        result = await waitForJob(`/asset-uploads/${job.job.id}`);
        break;
      }

      case 'canva_list_assets': {
        let endpoint = '/assets';
        if (args.limit) endpoint += `?limit=${args.limit}`;
        result = await canvaRequest(endpoint);
        break;
      }

      case 'canva_get_asset': {
        result = await canvaRequest(`/assets/${args.asset_id}`);
        break;
      }

      case 'canva_delete_asset': {
        await canvaRequest(`/assets/${args.asset_id}`, 'DELETE');
        result = { success: true, message: 'Asset deleted' };
        break;
      }

      case 'canva_list_folders': {
        let endpoint = '/folders';
        if (args.parent_folder_id) endpoint += `?parent_folder_id=${args.parent_folder_id}`;
        result = await canvaRequest(endpoint);
        break;
      }

      case 'canva_create_folder': {
        const payload = { name: args.name };
        if (args.parent_folder_id) payload.parent_folder_id = args.parent_folder_id;
        result = await canvaRequest('/folders', 'POST', payload);
        break;
      }

      case 'canva_move_design': {
        result = await canvaRequest(`/folders/${args.folder_id}/items`, 'POST', {
          item_id: args.design_id,
          item_type: 'design'
        });
        break;
      }

      case 'canva_get_user': {
        result = await canvaRequest('/users/me');
        break;
      }

      case 'canva_list_brand_templates': {
        let endpoint = '/brand-templates';
        if (args.limit) endpoint += `?limit=${args.limit}`;
        result = await canvaRequest(endpoint);
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
  console.error('Canva MCP server running on stdio');
}

main().catch(console.error);
