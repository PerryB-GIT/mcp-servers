#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

function getCalendarClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first.');
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);
  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

const server = new Server(
  { name: 'google-meet-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'meet_create_instant',
      description: 'Create an instant Google Meet link (no calendar event)',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Meeting title (optional)' }
        }
      }
    },
    {
      name: 'meet_schedule',
      description: 'Schedule a Google Meet with calendar event',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Meeting title' },
          description: { type: 'string', description: 'Meeting description' },
          start: { type: 'string', description: 'Start time (e.g., "today 3pm", "tomorrow 10:00", "2026-01-25T15:00:00")' },
          duration: { type: 'number', description: 'Duration in minutes (default: 30)' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses to invite' }
        },
        required: ['summary', 'start']
      }
    },
    {
      name: 'meet_list_upcoming',
      description: 'List upcoming meetings with Google Meet links',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)' }
        }
      }
    }
  ]
}));

function parseDateTime(dateTimeStr) {
  const now = new Date();
  const lowerStr = dateTimeStr.toLowerCase();

  if (lowerStr.includes('today')) {
    const date = new Date();
    const timeMatch = dateTimeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2] || '0');
      const meridiem = timeMatch[3];
      if (meridiem?.toLowerCase() === 'pm' && hours !== 12) hours += 12;
      if (meridiem?.toLowerCase() === 'am' && hours === 12) hours = 0;
      date.setHours(hours, minutes, 0, 0);
    }
    return date;
  }

  if (lowerStr.includes('tomorrow')) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const timeMatch = dateTimeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2] || '0');
      const meridiem = timeMatch[3];
      if (meridiem?.toLowerCase() === 'pm' && hours !== 12) hours += 12;
      if (meridiem?.toLowerCase() === 'am' && hours === 12) hours = 0;
      date.setHours(hours, minutes, 0, 0);
    }
    return date;
  }

  return new Date(dateTimeStr);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const calendar = getCalendarClient();

    switch (name) {
      case 'meet_create_instant': {
        const { summary = 'Quick Meeting' } = args;

        // Create a calendar event starting now with Meet link
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

        const event = {
          summary,
          start: { dateTime: startTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          end: { dateTime: endTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        };

        const result = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
          conferenceDataVersion: 1
        });

        const meetLink = result.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              meetLink,
              eventId: result.data.id,
              htmlLink: result.data.htmlLink,
              summary: result.data.summary
            }, null, 2)
          }]
        };
      }

      case 'meet_schedule': {
        const { summary, description, start, duration = 30, attendees = [] } = args;

        const startTime = parseDateTime(start);
        const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

        const event = {
          summary,
          description,
          start: { dateTime: startTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          end: { dateTime: endTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          attendees: attendees.map(email => ({ email })),
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        };

        const result = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
          conferenceDataVersion: 1,
          sendUpdates: attendees.length > 0 ? 'all' : 'none'
        });

        const meetLink = result.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              meetLink,
              eventId: result.data.id,
              htmlLink: result.data.htmlLink,
              summary: result.data.summary,
              start: result.data.start,
              end: result.data.end,
              attendees: result.data.attendees?.map(a => a.email)
            }, null, 2)
          }]
        };
      }

      case 'meet_list_upcoming': {
        const { maxResults = 10 } = args;

        const result = await calendar.events.list({
          calendarId: 'primary',
          timeMin: new Date().toISOString(),
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
          q: '' // Get all events, we'll filter for Meet links
        });

        const meetings = (result.data.items || [])
          .filter(event => event.conferenceData?.entryPoints?.some(e => e.entryPointType === 'video'))
          .map(event => ({
            id: event.id,
            summary: event.summary,
            start: event.start,
            end: event.end,
            meetLink: event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri,
            htmlLink: event.htmlLink,
            attendees: event.attendees?.map(a => a.email)
          }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, count: meetings.length, meetings }, null, 2)
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
  console.error('Google Meet MCP server running on stdio');
}

main().catch(console.error);
