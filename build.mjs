import fs from 'node:fs/promises';
import process from 'node:process';
import ical from 'node-ical';
import icalGen from 'ical-generator';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function toDate(d) {
  return d instanceof Date ? d : new Date(d);
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function normalizeEvent(e, source) {
  // node-ical returns many component types; we only want VEVENT.
  if (!e || e.type !== 'VEVENT') return null;

  const start = toDate(e.start);
  const end = toDate(e.end);
  if (!isValidDate(start) || !isValidDate(end)) return null;

  // All-day events come through as Date objects at midnight; keep as-is.
  // We intentionally remove any guest-identifying summary/description.
  return {
    start,
    end,
    allDay: !!e.datetype && e.datetype === 'date',
    uid: `${source}:${e.uid || `${start.toISOString()}-${end.toISOString()}`}`,
  };
}

async function fetchIcs(url) {
  // node-ical has a built-in async fetch parser.
  // It will follow redirects and parse ICS.
  return ical.async.fromURL(url, {
    // Keep it conservative.
    headers: {
      'User-Agent': 'JarvisCombinedCalendar/1.0',
    },
    timeout: 20000,
  });
}

function addEventsToCalendar(cal, events) {
  for (const ev of events) {
    cal.createEvent({
      id: ev.uid,
      start: ev.start,
      end: ev.end,
      allDay: true, // we only care about blocking ranges
      summary: 'Blocked',
      description: '',
      location: '',
    });
  }
}

async function main() {
  const airbnbUrl = requireEnv('AIRBNB_ICS_URL');
  const bookingUrl = requireEnv('BOOKING_ICS_URL');

  const [airbnbData, bookingData] = await Promise.all([
    fetchIcs(airbnbUrl),
    fetchIcs(bookingUrl),
  ]);

  const airbnbEvents = Object.values(airbnbData)
    .map((e) => normalizeEvent(e, 'airbnb'))
    .filter(Boolean);

  const bookingEvents = Object.values(bookingData)
    .map((e) => normalizeEvent(e, 'booking'))
    .filter(Boolean);

  const cal = icalGen({
    name: 'Reservations (Airbnb + Booking) — Blocked Dates',
    timezone: 'UTC',
  });

  addEventsToCalendar(cal, airbnbEvents);
  addEventsToCalendar(cal, bookingEvents);

  const out = cal.toString();
  await fs.writeFile(new URL('./calendar.ics', import.meta.url), out, 'utf8');

  console.log(`Wrote calendar.ics with ${airbnbEvents.length + bookingEvents.length} events`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
