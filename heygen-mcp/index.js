#!/usr/bin/env node
/**
 * HeyGen MCP Server
 * API integration for avatar video generation and translation
 * Requires HEYGEN_API_KEY environment variable
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_BASE = 'https://api.heygen.com';

async function heygenRequest(endpoint, method = 'GET', body = null) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error('HEYGEN_API_KEY environment variable not set');
  }

  const options = {
    method,
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || `API error: ${response.status}`);
  }

  return data;
}

const server = new Server(
  { name: 'heygen-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'heygen_list_avatars',
      description: 'List available avatars for video generation',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'heygen_list_voices',
      description: 'List available voices for video generation',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'heygen_list_templates',
      description: 'List available video templates',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'heygen_create_video',
      description: 'Create an avatar video with text-to-speech',
      inputSchema: {
        type: 'object',
        properties: {
          avatar_id: { type: 'string', description: 'Avatar ID to use' },
          voice_id: { type: 'string', description: 'Voice ID to use' },
          text: { type: 'string', description: 'Script text for the avatar to speak' },
          title: { type: 'string', description: 'Video title' },
          background_color: { type: 'string', description: 'Background color (hex, e.g., #ffffff)' },
          background_image_url: { type: 'string', description: 'Background image URL' },
          width: { type: 'number', description: 'Video width (default: 1920)' },
          height: { type: 'number', description: 'Video height (default: 1080)' }
        },
        required: ['avatar_id', 'voice_id', 'text']
      }
    },
    {
      name: 'heygen_create_video_from_template',
      description: 'Create a video using a template',
      inputSchema: {
        type: 'object',
        properties: {
          template_id: { type: 'string', description: 'Template ID to use' },
          variables: { type: 'object', description: 'Template variables to replace' },
          title: { type: 'string', description: 'Video title' }
        },
        required: ['template_id']
      }
    },
    {
      name: 'heygen_get_video_status',
      description: 'Check the status of a video generation job',
      inputSchema: {
        type: 'object',
        properties: {
          video_id: { type: 'string', description: 'Video ID to check' }
        },
        required: ['video_id']
      }
    },
    {
      name: 'heygen_list_videos',
      description: 'List generated videos',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max videos to return (default: 20)' }
        }
      }
    },
    {
      name: 'heygen_delete_video',
      description: 'Delete a generated video',
      inputSchema: {
        type: 'object',
        properties: {
          video_id: { type: 'string', description: 'Video ID to delete' }
        },
        required: ['video_id']
      }
    },
    {
      name: 'heygen_translate_video',
      description: 'Translate a video to another language',
      inputSchema: {
        type: 'object',
        properties: {
          video_url: { type: 'string', description: 'URL of the video to translate' },
          output_language: { type: 'string', description: 'Target language code (e.g., es, fr, de, zh)' },
          title: { type: 'string', description: 'Title for translated video' }
        },
        required: ['video_url', 'output_language']
      }
    },
    {
      name: 'heygen_get_translation_status',
      description: 'Check status of a video translation job',
      inputSchema: {
        type: 'object',
        properties: {
          translation_id: { type: 'string', description: 'Translation job ID' }
        },
        required: ['translation_id']
      }
    },
    {
      name: 'heygen_create_talking_photo',
      description: 'Create a talking photo video from an image',
      inputSchema: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL of the photo to animate' },
          voice_id: { type: 'string', description: 'Voice ID to use' },
          text: { type: 'string', description: 'Script text for the photo to speak' },
          title: { type: 'string', description: 'Video title' }
        },
        required: ['image_url', 'voice_id', 'text']
      }
    },
    {
      name: 'heygen_upload_talking_photo',
      description: 'Upload an image to use as a talking photo',
      inputSchema: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL of image to upload' }
        },
        required: ['image_url']
      }
    },
    {
      name: 'heygen_get_remaining_quota',
      description: 'Get remaining API quota/credits',
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
      case 'heygen_list_avatars': {
        result = await heygenRequest('/v2/avatars');
        break;
      }

      case 'heygen_list_voices': {
        result = await heygenRequest('/v2/voices');
        break;
      }

      case 'heygen_list_templates': {
        result = await heygenRequest('/v2/templates');
        break;
      }

      case 'heygen_create_video': {
        const payload = {
          video_inputs: [{
            character: {
              type: 'avatar',
              avatar_id: args.avatar_id,
              avatar_style: 'normal'
            },
            voice: {
              type: 'text',
              input_text: args.text,
              voice_id: args.voice_id
            }
          }],
          dimension: {
            width: args.width || 1920,
            height: args.height || 1080
          }
        };

        if (args.background_color) {
          payload.video_inputs[0].background = {
            type: 'color',
            value: args.background_color
          };
        } else if (args.background_image_url) {
          payload.video_inputs[0].background = {
            type: 'image',
            url: args.background_image_url
          };
        }

        if (args.title) {
          payload.title = args.title;
        }

        result = await heygenRequest('/v2/video/generate', 'POST', payload);
        break;
      }

      case 'heygen_create_video_from_template': {
        const payload = {
          template_id: args.template_id
        };
        if (args.variables) {
          payload.variables = args.variables;
        }
        if (args.title) {
          payload.title = args.title;
        }
        result = await heygenRequest('/v2/template/generate', 'POST', payload);
        break;
      }

      case 'heygen_get_video_status': {
        result = await heygenRequest(`/v1/video_status.get?video_id=${args.video_id}`);
        break;
      }

      case 'heygen_list_videos': {
        const limit = args.limit || 20;
        result = await heygenRequest(`/v1/video.list?limit=${limit}`);
        break;
      }

      case 'heygen_delete_video': {
        result = await heygenRequest(`/v1/video.delete?video_id=${args.video_id}`, 'DELETE');
        break;
      }

      case 'heygen_translate_video': {
        const payload = {
          video_url: args.video_url,
          output_language: args.output_language
        };
        if (args.title) {
          payload.title = args.title;
        }
        result = await heygenRequest('/v2/video_translate', 'POST', payload);
        break;
      }

      case 'heygen_get_translation_status': {
        result = await heygenRequest(`/v2/video_translate/${args.translation_id}`);
        break;
      }

      case 'heygen_create_talking_photo': {
        const payload = {
          video_inputs: [{
            character: {
              type: 'talking_photo',
              talking_photo_url: args.image_url
            },
            voice: {
              type: 'text',
              input_text: args.text,
              voice_id: args.voice_id
            }
          }]
        };
        if (args.title) {
          payload.title = args.title;
        }
        result = await heygenRequest('/v2/video/generate', 'POST', payload);
        break;
      }

      case 'heygen_upload_talking_photo': {
        result = await heygenRequest('/v2/talking_photo', 'POST', {
          url: args.image_url
        });
        break;
      }

      case 'heygen_get_remaining_quota': {
        result = await heygenRequest('/v2/user/remaining_quota');
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
  console.error('HeyGen MCP server running on stdio');
}

main().catch(console.error);
