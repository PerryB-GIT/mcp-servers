#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

// Initialize Google Calendar client
function getCalendarClient() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error('Not authenticated. Run "npm run auth" first to authenticate with Google.');
  }

  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);

  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

// Parse date/time strings flexibly
function parseDateTime(dateTimeStr, isAllDay = false) {
  const now = new Date();

  // Handle relative dates
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

  // Try to parse as ISO or other standard formats
  const parsed = new Date(dateTimeStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Could not parse date/time: ${dateTimeStr}`);
}

// Format date for Google Calendar API
function formatForGoogle(date, isAllDay = false) {
  if (isAllDay) {
    return date.toISOString().split('T')[0];
  }
  return date.toISOString();
}

// Create the MCP server
const server = new Server(
  {
    name: 'google-calendar-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'calendar_create_event',
        description: 'Create a new event on Google Calendar',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Event title/summary',
            },
            description: {
              type: 'string',
              description: 'Event description (optional)',
            },
            start: {
              type: 'string',
              description: 'Start date/time (e.g., "today 9am", "tomorrow 2:30pm", "2026-01-20T09:00:00")',
            },
            end: {
              type: 'string',
              description: 'End date/time (e.g., "today 10am", "tomorrow 3:30pm", "2026-01-20T10:00:00")',
            },
            location: {
              type: 'string',
              description: 'Event location (optional)',
            },
            allDay: {
              type: 'boolean',
              description: 'Whether this is an all-day event (default: false)',
            },
            calendarId: {
              type: 'string',
              description: 'Calendar ID (default: primary)',
            },
          },
          required: ['summary', 'start', 'end'],
        },
      },
      {
        name: 'calendar_list_events',
        description: 'List upcoming events from Google Calendar',
        inputSchema: {
          type: 'object',
          properties: {
            maxResults: {
              type: 'number',
              description: 'Maximum number of events to return (default: 10)',
            },
            timeMin: {
              type: 'string',
              description: 'Start of time range (default: now)',
            },
            timeMax: {
              type: 'string',
              description: 'End of time range (optional)',
            },
            calendarId: {
              type: 'string',
              description: 'Calendar ID (default: primary)',
            },
            query: {
              type: 'string',
              description: 'Free text search query (optional)',
            },
          },
        },
      },
      {
        name: 'calendar_update_event',
        description: 'Update an existing event on Google Calendar',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'The event ID to update',
            },
            summary: {
              type: 'string',
              description: 'New event title/summary (optional)',
            },
            description: {
              type: 'string',
              description: 'New event description (optional)',
            },
            start: {
              type: 'string',
              description: 'New start date/time (optional)',
            },
            end: {
              type: 'string',
              description: 'New end date/time (optional)',
            },
            location: {
              type: 'string',
              description: 'New event location (optional)',
            },
            calendarId: {
              type: 'string',
              description: 'Calendar ID (default: primary)',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'calendar_delete_event',
        description: 'Delete an event from Google Calendar',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'The event ID to delete',
            },
            calendarId: {
              type: 'string',
              description: 'Calendar ID (default: primary)',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'calendar_list_calendars',
        description: 'List all available calendars',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const calendar = getCalendarClient();

    switch (name) {
      case 'calendar_create_event': {
        const { summary, description, start, end, location, allDay = false, calendarId = 'primary' } = args;

        const startDate = parseDateTime(start, allDay);
        const endDate = parseDateTime(end, allDay);

        const event = {
          summary,
          description,
          location,
          start: allDay
            ? { date: formatForGoogle(startDate, true) }
            : { dateTime: formatForGoogle(startDate), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          end: allDay
            ? { date: formatForGoogle(endDate, true) }
            : { dateTime: formatForGoogle(endDate), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        };

        const result = await calendar.events.insert({
          calendarId,
          requestBody: event,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Event "${summary}" created successfully`,
                eventId: result.data.id,
                htmlLink: result.data.htmlLink,
                start: result.data.start,
                end: result.data.end,
              }, null, 2),
            },
          ],
        };
      }

      case 'calendar_list_events': {
        const { maxResults = 10, timeMin, timeMax, calendarId = 'primary', query } = args;

        const params = {
          calendarId,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
          timeMin: timeMin ? parseDateTime(timeMin).toISOString() : new Date().toISOString(),
        };

        if (timeMax) {
          params.timeMax = parseDateTime(timeMax).toISOString();
        }

        if (query) {
          params.q = query;
        }

        const result = await calendar.events.list(params);
        const events = result.data.items || [];

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: events.length,
                events: events.map((e) => ({
                  id: e.id,
                  summary: e.summary,
                  description: e.description,
                  start: e.start,
                  end: e.end,
                  location: e.location,
                  htmlLink: e.htmlLink,
                })),
              }, null, 2),
            },
          ],
        };
      }

      case 'calendar_update_event': {
        const { eventId, summary, description, start, end, location, calendarId = 'primary' } = args;

        // Get existing event first
        const existing = await calendar.events.get({
          calendarId,
          eventId,
        });

        const updates = { ...existing.data };

        if (summary) updates.summary = summary;
        if (description) updates.description = description;
        if (location) updates.location = location;
        if (start) {
          const startDate = parseDateTime(start);
          updates.start = { dateTime: formatForGoogle(startDate), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        }
        if (end) {
          const endDate = parseDateTime(end);
          updates.end = { dateTime: formatForGoogle(endDate), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        }

        const result = await calendar.events.update({
          calendarId,
          eventId,
          requestBody: updates,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Event updated successfully`,
                eventId: result.data.id,
                summary: result.data.summary,
                htmlLink: result.data.htmlLink,
              }, null, 2),
            },
          ],
        };
      }

      case 'calendar_delete_event': {
        const { eventId, calendarId = 'primary' } = args;

        await calendar.events.delete({
          calendarId,
          eventId,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Event ${eventId} deleted successfully`,
              }, null, 2),
            },
          ],
        };
      }

      case 'calendar_list_calendars': {
        const result = await calendar.calendarList.list();
        const calendars = result.data.items || [];

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: calendars.length,
                calendars: calendars.map((c) => ({
                  id: c.id,
                  summary: c.summary,
                  description: c.description,
                  primary: c.primary || false,
                  accessRole: c.accessRole,
                })),
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Calendar MCP server running on stdio');
}

main().catch(console.error);
