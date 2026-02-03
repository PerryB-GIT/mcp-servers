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

const events = [
  {
    summary: 'Call Geico - Accident Claim',
    description: 'Call about Saturday night car accident claim. Phone: 1-800-861-8380',
    start: '2026-01-20T09:30:00',
    end: '2026-01-20T10:00:00',
  },
  {
    summary: 'Call Davidian Dental Beverly',
    description: 'Schedule exam appointment ASAP. Phone: {DOCTOR_PHONE}',
    start: '2026-01-20T10:40:00',
    end: '2026-01-20T10:50:00',
  },
  {
    summary: 'Call Dr. Bahng - Schedule Follow-up',
    description: 'Schedule follow-up appointment. Dr. Edward Bahng, MD - Beverly, MA. Phone: {DOCTOR_PHONE_2}',
    start: '2026-01-20T10:50:00',
    end: '2026-01-20T11:00:00',
  },
  {
    summary: 'Chores',
    description: 'Sweep, dishes, take out garbage',
    start: '2026-01-20T11:00:00',
    end: '2026-01-20T11:45:00',
  },
  {
    summary: 'Home Workout - Calisthenics',
    description: 'Calisthenics workout at home',
    start: '2026-01-20T11:45:00',
    end: '2026-01-20T12:30:00',
  },
  {
    summary: 'SmartBear Interview Prep',
    description: 'Prepare for SmartBear interview - research company, practice questions, review resume',
    start: '2026-01-20T13:00:00',
    end: '2026-01-20T15:00:00',
  },
  {
    summary: 'Coffee + Job Search',
    description: 'Coffee time and job search activities',
    start: '2026-01-20T17:00:00',
    end: '2026-01-20T18:00:00',
  },
];

const timeZone = 'America/New_York';

async function createEvents() {
  console.log('Creating calendar events...\n');

  for (const event of events) {
    try {
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone },
          end: { dateTime: event.end, timeZone },
        },
      });
      console.log(`✅ ${event.summary}`);
      console.log(`   ${event.start.split('T')[1]} - ${event.end.split('T')[1]}`);
      console.log(`   Link: ${result.data.htmlLink}\n`);
    } catch (error) {
      console.log(`❌ Failed: ${event.summary} - ${error.message}\n`);
    }
  }

  console.log('Done!');
}

createEvents();
