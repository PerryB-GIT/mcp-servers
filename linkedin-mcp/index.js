#!/usr/bin/env node
/**
 * LinkedIn MCP Server
 * API integration for posts and company updates
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
const API_BASE = 'https://api.linkedin.com/v2';

function getToken() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
}

async function linkedinRequest(endpoint, method = 'GET', body = null, version = 'v2') {
  const token = getToken();
  const baseUrl = version === 'rest' ? 'https://api.linkedin.com/rest' : API_BASE;

  const headers = {
    'Authorization': `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0'
  };

  if (version === 'rest') {
    headers['LinkedIn-Version'] = '202401';
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${endpoint}`, options);

  if (response.status === 204) {
    return { success: true };
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || JSON.stringify(data));
  }

  return data;
}

const server = new Server(
  { name: 'linkedin-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'linkedin_get_profile',
      description: 'Get the authenticated user profile',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'linkedin_create_post',
      description: 'Create a text post on LinkedIn',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Post content' },
          visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS'], description: 'Post visibility (default: PUBLIC)' }
        },
        required: ['text']
      }
    },
    {
      name: 'linkedin_create_post_with_link',
      description: 'Create a post with a link preview',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Post content' },
          url: { type: 'string', description: 'URL to share' },
          title: { type: 'string', description: 'Link title (optional)' },
          description: { type: 'string', description: 'Link description (optional)' },
          visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS'], description: 'Post visibility' }
        },
        required: ['text', 'url']
      }
    },
    {
      name: 'linkedin_create_company_post',
      description: 'Create a post on a company page',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'LinkedIn organization/company ID' },
          text: { type: 'string', description: 'Post content' },
          visibility: { type: 'string', enum: ['PUBLIC', 'LOGGED_IN'], description: 'Post visibility' }
        },
        required: ['organization_id', 'text']
      }
    },
    {
      name: 'linkedin_create_company_post_with_link',
      description: 'Create a company post with a link preview',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'LinkedIn organization/company ID' },
          text: { type: 'string', description: 'Post content' },
          url: { type: 'string', description: 'URL to share' },
          title: { type: 'string', description: 'Link title' },
          description: { type: 'string', description: 'Link description' },
          visibility: { type: 'string', enum: ['PUBLIC', 'LOGGED_IN'], description: 'Post visibility' }
        },
        required: ['organization_id', 'text', 'url']
      }
    },
    {
      name: 'linkedin_delete_post',
      description: 'Delete a LinkedIn post',
      inputSchema: {
        type: 'object',
        properties: {
          post_urn: { type: 'string', description: 'Post URN (e.g., urn:li:share:123456)' }
        },
        required: ['post_urn']
      }
    },
    {
      name: 'linkedin_get_company',
      description: 'Get company/organization details',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'LinkedIn organization ID' }
        },
        required: ['organization_id']
      }
    },
    {
      name: 'linkedin_get_company_followers',
      description: 'Get follower count for a company page',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'LinkedIn organization ID' }
        },
        required: ['organization_id']
      }
    },
    {
      name: 'linkedin_get_post_analytics',
      description: 'Get analytics for a specific post',
      inputSchema: {
        type: 'object',
        properties: {
          post_urn: { type: 'string', description: 'Post URN' }
        },
        required: ['post_urn']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    const token = getToken();

    switch (name) {
      case 'linkedin_get_profile': {
        result = await linkedinRequest('/userinfo', 'GET', null, 'rest');
        break;
      }

      case 'linkedin_create_post': {
        // Get user ID first
        const profile = await linkedinRequest('/userinfo', 'GET', null, 'rest');
        const personUrn = `urn:li:person:${profile.sub}`;

        const payload = {
          author: personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: args.text
              },
              shareMediaCategory: 'NONE'
            }
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': args.visibility || 'PUBLIC'
          }
        };

        result = await linkedinRequest('/ugcPosts', 'POST', payload);
        break;
      }

      case 'linkedin_create_post_with_link': {
        const profile = await linkedinRequest('/userinfo', 'GET', null, 'rest');
        const personUrn = `urn:li:person:${profile.sub}`;

        const payload = {
          author: personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: args.text
              },
              shareMediaCategory: 'ARTICLE',
              media: [{
                status: 'READY',
                originalUrl: args.url,
                title: { text: args.title || '' },
                description: { text: args.description || '' }
              }]
            }
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': args.visibility || 'PUBLIC'
          }
        };

        result = await linkedinRequest('/ugcPosts', 'POST', payload);
        break;
      }

      case 'linkedin_create_company_post': {
        const orgUrn = `urn:li:organization:${args.organization_id}`;

        const payload = {
          author: orgUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: args.text
              },
              shareMediaCategory: 'NONE'
            }
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': args.visibility || 'PUBLIC'
          }
        };

        result = await linkedinRequest('/ugcPosts', 'POST', payload);
        break;
      }

      case 'linkedin_create_company_post_with_link': {
        const orgUrn = `urn:li:organization:${args.organization_id}`;

        const payload = {
          author: orgUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: args.text
              },
              shareMediaCategory: 'ARTICLE',
              media: [{
                status: 'READY',
                originalUrl: args.url,
                title: { text: args.title || '' },
                description: { text: args.description || '' }
              }]
            }
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': args.visibility || 'PUBLIC'
          }
        };

        result = await linkedinRequest('/ugcPosts', 'POST', payload);
        break;
      }

      case 'linkedin_delete_post': {
        const encodedUrn = encodeURIComponent(args.post_urn);
        result = await linkedinRequest(`/ugcPosts/${encodedUrn}`, 'DELETE');
        result = { success: true, message: 'Post deleted' };
        break;
      }

      case 'linkedin_get_company': {
        result = await linkedinRequest(`/organizations/${args.organization_id}`);
        break;
      }

      case 'linkedin_get_company_followers': {
        result = await linkedinRequest(`/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${args.organization_id}`);
        break;
      }

      case 'linkedin_get_post_analytics': {
        const encodedUrn = encodeURIComponent(args.post_urn);
        result = await linkedinRequest(`/socialActions/${encodedUrn}`);
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
  console.error('LinkedIn MCP server running on stdio');
}

main().catch(console.error);
