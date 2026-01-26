import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const credentials = JSON.parse(readFileSync(join(__dirname, 'credentials.json'), 'utf8'));
const token = JSON.parse(readFileSync(join(__dirname, 'token.json'), 'utf8'));
const { client_id, client_secret } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
oAuth2Client.setCredentials(token);

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
const timeZone = 'America/New_York';

async function updateSchedule() {
  // Delete specific events that need rescheduling
  const toDelete = ['Chores', 'Calisthenics', 'Haverhill Ford'];

  const existing = await calendar.events.list({
    calendarId: 'primary',
    timeMin: '2026-01-20T00:00:00-05:00',
    timeMax: '2026-01-20T23:59:59-05:00',
    singleEvents: true,
  });

  for (const event of existing.data.items || []) {
    if (toDelete.some(name => event.summary?.includes(name))) {
      await calendar.events.delete({ calendarId: 'primary', eventId: event.id });
      console.log(`🗑️  Removed: ${event.summary}`);
    }
  }

  // Add updated events
  const newEvents = [
    {
      summary: '🚗 Drive to Haverhill Ford - Drop off car',
      description: 'Drop off car for tire/rim repair. Get rental car info.',
      start: '2026-01-20T11:30:00',
      end: '2026-01-20T12:30:00',
    },
    {
      summary: '🏠 Chores',
      description: 'Sweep, dishes, take out garbage',
      start: '2026-01-20T13:00:00',
      end: '2026-01-20T13:45:00',
    },
    {
      summary: '💪 Calisthenics Workout',
      description: 'Home workout - calisthenics',
      start: '2026-01-20T13:45:00',
      end: '2026-01-20T14:30:00',
    },
    {
      summary: '🎯 SmartBear Interview Prep',
      description: 'Research company, practice questions, review resume.',
      start: '2026-01-20T14:30:00',
      end: '2026-01-20T16:30:00',
    },
  ];

  console.log('\nAdding updated events:\n');

  for (const event of newEvents) {
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.start, timeZone },
        end: { dateTime: event.end, timeZone },
      },
    });
    const start = event.start.split('T')[1].substring(0, 5);
    const end = event.end.split('T')[1].substring(0, 5);
    console.log(`✅ ${start}-${end}  ${event.summary}`);
  }

  console.log('\n✨ Schedule updated!');
}

updateSchedule();
