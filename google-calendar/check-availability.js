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

async function checkAvailability() {
  const now = new Date('2026-01-20T00:00:00');
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  console.log('📅 Checking availability: Jan 20 - Feb 3, 2026\n');

  const result = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: twoWeeksOut.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = result.data.items || [];

  // Group events by date
  const eventsByDate = {};
  for (const event of events) {
    const start = event.start.dateTime || event.start.date;
    const date = start.split('T')[0];
    if (!eventsByDate[date]) eventsByDate[date] = [];
    eventsByDate[date].push({
      summary: event.summary,
      start: event.start.dateTime ? new Date(event.start.dateTime) : null,
      end: event.end.dateTime ? new Date(event.end.dateTime) : null,
      allDay: !event.start.dateTime,
    });
  }

  // Check each day
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const availability = [];

  for (let d = 0; d < 14; d++) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + d);
    const dateStr = checkDate.toISOString().split('T')[0];
    const dayName = days[checkDate.getDay()];
    const dayOfWeek = checkDate.getDay();

    // Skip weekends for interview scheduling
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dayEvents = eventsByDate[dateStr] || [];

    // Business hours: 9am - 5pm
    const busySlots = dayEvents
      .filter(e => !e.allDay && e.start && e.end)
      .map(e => ({
        start: e.start.getHours() + e.start.getMinutes() / 60,
        end: e.end.getHours() + e.end.getMinutes() / 60,
        name: e.summary,
      }))
      .sort((a, b) => a.start - b.start);

    // Find free slots (minimum 1 hour for interview)
    const freeSlots = [];
    let currentTime = 9; // Start at 9am

    for (const busy of busySlots) {
      if (busy.start > currentTime && busy.start - currentTime >= 1) {
        freeSlots.push({ start: currentTime, end: busy.start });
      }
      currentTime = Math.max(currentTime, busy.end);
    }
    // Check remaining time until 5pm
    if (17 - currentTime >= 1) {
      freeSlots.push({ start: currentTime, end: 17 });
    }

    const formatTime = (h) => {
      const hour = Math.floor(h);
      const min = Math.round((h - hour) * 60);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
      return min === 0 ? `${displayHour}${ampm}` : `${displayHour}:${min.toString().padStart(2, '0')}${ampm}`;
    };

    availability.push({
      date: dateStr,
      dayName,
      busySlots,
      freeSlots,
      formatTime,
    });
  }

  // Print results
  for (const day of availability) {
    const dateDisplay = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    console.log(`\n${day.dayName}, ${dateDisplay}`);
    console.log('─'.repeat(30));

    if (day.busySlots.length === 0) {
      console.log('  ✅ Wide open (9AM - 5PM)');
    } else {
      console.log('  Busy:');
      for (const slot of day.busySlots) {
        console.log(`    🔴 ${day.formatTime(slot.start)}-${day.formatTime(slot.end)} ${slot.name}`);
      }
      console.log('  Available:');
      if (day.freeSlots.length === 0) {
        console.log('    ⚠️  No 1+ hour slots');
      } else {
        for (const slot of day.freeSlots) {
          const duration = slot.end - slot.start;
          console.log(`    🟢 ${day.formatTime(slot.start)}-${day.formatTime(slot.end)} (${duration}hr${duration > 1 ? 's' : ''})`);
        }
      }
    }
  }

  // Suggest best options
  console.log('\n' + '═'.repeat(40));
  console.log('📋 SUGGESTED INTERVIEW SLOTS:');
  console.log('═'.repeat(40));

  let suggestions = [];
  for (const day of availability) {
    for (const slot of day.freeSlots) {
      if (slot.end - slot.start >= 1) {
        const dateDisplay = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        suggestions.push({
          date: day.date,
          display: dateDisplay,
          start: slot.start,
          end: slot.end,
          formatTime: day.formatTime,
        });
      }
    }
  }

  // Pick good slots (morning, early afternoon, late afternoon options)
  const goodSlots = suggestions.slice(0, 10).map((s, i) => {
    const startTime = s.formatTime(Math.max(s.start, 9));
    const endTime = s.formatTime(Math.min(s.end, 17));
    return `  ${i + 1}. ${s.display}: ${startTime}-${endTime}`;
  });

  console.log(goodSlots.join('\n'));
}

checkAvailability();
