#!/usr/bin/env node
/**
 * Figma MCP Server
 * API integration for Figma file access, comments, and image export
 * Requires FIGMA_ACCESS_TOKEN environment variable
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_BASE = 'https://api.figma.com/v1';

async function figmaRequest(endpoint, method = 'GET', body = null) {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new Error('FIGMA_ACCESS_TOKEN environment variable not set');
  }

  const options = {
    method,
    headers: {
      'X-Figma-Token': token,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.err || `API error: ${response.status}`);
  }

  return data;
}

const server = new Server(
  { name: 'figma-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'figma_get_file',
      description: 'Get a Figma file by key',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key (from URL)' },
          depth: { type: 'number', description: 'Depth of nodes to return (default: 2)' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_get_file_nodes',
      description: 'Get specific nodes from a Figma file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' },
          node_ids: { type: 'array', items: { type: 'string' }, description: 'Node IDs to retrieve' }
        },
        required: ['file_key', 'node_ids']
      }
    },
    {
      name: 'figma_get_images',
      description: 'Export images from a Figma file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' },
          node_ids: { type: 'array', items: { type: 'string' }, description: 'Node IDs to export' },
          format: { type: 'string', enum: ['jpg', 'png', 'svg', 'pdf'], description: 'Export format (default: png)' },
          scale: { type: 'number', description: 'Scale factor (0.01 to 4, default: 1)' }
        },
        required: ['file_key', 'node_ids']
      }
    },
    {
      name: 'figma_get_image_fills',
      description: 'Get download links for images used in a file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_get_comments',
      description: 'Get comments on a Figma file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_post_comment',
      description: 'Post a comment on a Figma file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' },
          message: { type: 'string', description: 'Comment message' },
          node_id: { type: 'string', description: 'Node ID to comment on (optional)' },
          x: { type: 'number', description: 'X coordinate for comment position' },
          y: { type: 'number', description: 'Y coordinate for comment position' }
        },
        required: ['file_key', 'message']
      }
    },
    {
      name: 'figma_delete_comment',
      description: 'Delete a comment from a Figma file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' },
          comment_id: { type: 'string', description: 'Comment ID to delete' }
        },
        required: ['file_key', 'comment_id']
      }
    },
    {
      name: 'figma_get_team_projects',
      description: 'Get projects for a team',
      inputSchema: {
        type: 'object',
        properties: {
          team_id: { type: 'string', description: 'Team ID' }
        },
        required: ['team_id']
      }
    },
    {
      name: 'figma_get_project_files',
      description: 'Get files in a project',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID' }
        },
        required: ['project_id']
      }
    },
    {
      name: 'figma_get_file_versions',
      description: 'Get version history for a file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_get_file_styles',
      description: 'Get styles from a file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_get_file_components',
      description: 'Get components from a file',
      inputSchema: {
        type: 'object',
        properties: {
          file_key: { type: 'string', description: 'Figma file key' }
        },
        required: ['file_key']
      }
    },
    {
      name: 'figma_get_team_components',
      description: 'Get published components for a team',
      inputSchema: {
        type: 'object',
        properties: {
          team_id: { type: 'string', description: 'Team ID' }
        },
        required: ['team_id']
      }
    },
    {
      name: 'figma_get_me',
      description: 'Get current user info',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'figma_get_file': {
        const depth = args.depth ? `?depth=${args.depth}` : '';
        result = await figmaRequest(`/files/${args.file_key}${depth}`);
        break;
      }

      case 'figma_get_file_nodes': {
        const ids = args.node_ids.join(',');
        result = await figmaRequest(`/files/${args.file_key}/nodes?ids=${encodeURIComponent(ids)}`);
        break;
      }

      case 'figma_get_images': {
        const ids = args.node_ids.join(',');
        const format = args.format || 'png';
        const scale = args.scale || 1;
        result = await figmaRequest(`/images/${args.file_key}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`);
        break;
      }

      case 'figma_get_image_fills': {
        result = await figmaRequest(`/files/${args.file_key}/images`);
        break;
      }

      case 'figma_get_comments': {
        result = await figmaRequest(`/files/${args.file_key}/comments`);
        break;
      }

      case 'figma_post_comment': {
        const body = { message: args.message };
        if (args.node_id) {
          body.client_meta = { node_id: args.node_id };
          if (args.x !== undefined && args.y !== undefined) {
            body.client_meta.node_offset = { x: args.x, y: args.y };
          }
        } else if (args.x !== undefined && args.y !== undefined) {
          body.client_meta = { x: args.x, y: args.y };
        }
        result = await figmaRequest(`/files/${args.file_key}/comments`, 'POST', body);
        break;
      }

      case 'figma_delete_comment': {
        result = await figmaRequest(`/files/${args.file_key}/comments/${args.comment_id}`, 'DELETE');
        result = { success: true, message: 'Comment deleted' };
        break;
      }

      case 'figma_get_team_projects': {
        result = await figmaRequest(`/teams/${args.team_id}/projects`);
        break;
      }

      case 'figma_get_project_files': {
        result = await figmaRequest(`/projects/${args.project_id}/files`);
        break;
      }

      case 'figma_get_file_versions': {
        result = await figmaRequest(`/files/${args.file_key}/versions`);
        break;
      }

      case 'figma_get_file_styles': {
        result = await figmaRequest(`/files/${args.file_key}/styles`);
        break;
      }

      case 'figma_get_file_components': {
        result = await figmaRequest(`/files/${args.file_key}/components`);
        break;
      }

      case 'figma_get_team_components': {
        result = await figmaRequest(`/teams/${args.team_id}/components`);
        break;
      }

      case 'figma_get_me': {
        result = await figmaRequest('/me');
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
  console.error('Figma MCP server running on stdio');
}

main().catch(console.error);
