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
  // Delete completed and outdated events
  const toDelete = [
    'Haverhill Ford',
    'Insurance Follow-up',
    'Davidian Dental',
    'Dr. Bahng',
    'Chores',
    'Calisthenics',
    'SmartBear',
    'Geico',
    'Utilities',
  ];

  const existing = await calendar.events.list({
    calendarId: 'primary',
    timeMin: '2026-01-20T00:00:00-05:00',
    timeMax: '2026-01-20T23:59:59-05:00',
    singleEvents: true,
  });

  console.log('Clearing old events...\n');
  for (const event of existing.data.items || []) {
    if (toDelete.some(name => event.summary?.includes(name))) {
      await calendar.events.delete({ calendarId: 'primary', eventId: event.id });
      console.log(`🗑️  ${event.summary}`);
    }
  }

  // New schedule working around 1:30 Bahng appointment
  const newEvents = [
    {
      summary: '📞 Call Geico - Accident Claim',
      description: 'Saturday night accident claim. Phone: 1-800-861-8380',
      start: '2026-01-20T12:45:00',
      end: '2026-01-20T13:15:00',
    },
    {
      summary: '🩺 Dr. Bahng - Virtual Appointment',
      description: 'Virtual follow-up appointment with Dr. Edward Bahng, MD',
      start: '2026-01-20T13:30:00',
      end: '2026-01-20T14:00:00',
    },
    {
      summary: '📞 Call Utilities - Payment Arrangements',
      description: 'Set up payment arrangements',
      start: '2026-01-20T14:00:00',
      end: '2026-01-20T14:15:00',
    },
    {
      summary: '🏠 Chores',
      description: 'Sweep, dishes, take out garbage',
      start: '2026-01-20T14:15:00',
      end: '2026-01-20T15:00:00',
    },
    {
      summary: '💪 Calisthenics Workout',
      description: 'Home workout - calisthenics',
      start: '2026-01-20T15:00:00',
      end: '2026-01-20T15:45:00',
    },
    {
      summary: '🎯 SmartBear Interview Prep',
      description: 'Research company, practice questions, review resume.',
      start: '2026-01-20T15:45:00',
      end: '2026-01-20T17:00:00',
    },
  ];

  console.log('\nUpdated schedule:\n');

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

  console.log('\n✨ Done!');
}

updateSchedule();
