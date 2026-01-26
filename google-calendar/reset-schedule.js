import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');

const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
const { client_id, client_secret } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
oAuth2Client.setCredentials(token);

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
const timeZone = 'America/New_York';

// Optimized schedule - phone calls batched, then active tasks, then focused work
const events = [
  // PHONE CALL BLOCK (9:00-10:30) - All calls together, most urgent first
  {
    summary: '📞 Call Haverhill Ford - Tire/Rim + Rental',
    description: 'URGENT: Car accident repairs - new tire and rim, arrange rental car',
    start: '2026-01-20T09:00:00',
    end: '2026-01-20T09:20:00',
  },
  {
    summary: '📞 Call Geico - Accident Claim',
    description: 'Saturday night accident claim. Phone: 1-800-861-8380',
    start: '2026-01-20T09:20:00',
    end: '2026-01-20T09:50:00',
  },
  {
    summary: '📞 Insurance Follow-up (Other Party)',
    description: 'Follow up with other driver\'s insurance company',
    start: '2026-01-20T09:50:00',
    end: '2026-01-20T10:10:00',
  },
  {
    summary: '📞 Call Utilities - Payment Arrangements',
    description: 'Set up payment arrangements',
    start: '2026-01-20T10:10:00',
    end: '2026-01-20T10:25:00',
  },
  {
    summary: '📞 Call Davidian Dental Beverly',
    description: 'Schedule exam ASAP. Phone: (978) 927-5700',
    start: '2026-01-20T10:25:00',
    end: '2026-01-20T10:35:00',
  },
  {
    summary: '📞 Call Dr. Bahng - Schedule Follow-up',
    description: 'Dr. Edward Bahng, MD - Beverly. Phone: (978) 232-7090',
    start: '2026-01-20T10:35:00',
    end: '2026-01-20T10:45:00',
  },
  // BREAK + ACTIVE TASKS (10:45-12:30)
  {
    summary: '🏠 Chores',
    description: 'Sweep, dishes, take out garbage',
    start: '2026-01-20T10:50:00',
    end: '2026-01-20T11:30:00',
  },
  {
    summary: '💪 Calisthenics Workout',
    description: 'Home workout - calisthenics',
    start: '2026-01-20T11:30:00',
    end: '2026-01-20T12:15:00',
  },
  // LUNCH BREAK (12:15-1:00) - not scheduled, free time
  // FOCUSED WORK BLOCK (1:00-3:00)
  {
    summary: '🎯 SmartBear Interview Prep',
    description: 'Research company, practice questions, review resume. FOCUS TIME - no distractions.',
    start: '2026-01-20T13:00:00',
    end: '2026-01-20T15:00:00',
  },
  // EVENING (5:00-6:00)
  {
    summary: '☕ Coffee + Job Search',
    description: 'Coffee time and job search activities',
    start: '2026-01-20T17:00:00',
    end: '2026-01-20T18:00:00',
  },
];

async function resetSchedule() {
  console.log('Clearing today\'s events...\n');

  // Get today's events
  const startOfDay = '2026-01-20T00:00:00-05:00';
  const endOfDay = '2026-01-20T23:59:59-05:00';

  const existing = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay,
    timeMax: endOfDay,
    singleEvents: true,
  });

  // Delete existing events from today
  for (const event of existing.data.items || []) {
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: event.id,
      });
      console.log(`🗑️  Deleted: ${event.summary}`);
    } catch (e) {
      console.log(`⚠️  Could not delete: ${event.summary}`);
    }
  }

  console.log('\nCreating optimized schedule...\n');

  // Create new events
  for (const event of events) {
    try {
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone },
          end: { dateTime: event.end, timeZone },
        },
      });
      const startTime = event.start.split('T')[1].substring(0, 5);
      const endTime = event.end.split('T')[1].substring(0, 5);
      console.log(`✅ ${startTime}-${endTime}  ${event.summary}`);
    } catch (error) {
      console.log(`❌ Failed: ${event.summary} - ${error.message}`);
    }
  }

  console.log('\n✨ Schedule optimized!');
}

resetSchedule();
