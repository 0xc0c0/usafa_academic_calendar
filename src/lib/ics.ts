import type { Meeting, SemesterConfig } from './types.ts';

const TZID = 'America/Denver';
const PRODID = '-//usafa-academic-calendar//unofficial schedule builder//EN';

/**
 * US DST rules (2007+): forward 2nd Sunday of March, back 1st Sunday of
 * November. Expressed as RRULEs so consumers stay correct in any year.
 */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  `X-LIC-LOCATION:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'TZNAME:MDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'TZNAME:MST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding: lines longer than 75 octets are split with
 * CRLF + single space. Splits on UTF-8 byte count without breaking a
 * multi-byte character.
 */
export function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return [line];
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) out.push(current);
  return out;
}

/** FNV-1a over the meeting identity → stable UID so re-imports update in place. */
export function meetingUid(semesterId: string, m: Meeting): string {
  const key = [semesterId, m.date, m.dayLabel, m.periods.join(','), m.title, m.location].join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  const hash = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  return `${hash}-${m.date}-p${m.periods.join('')}@usafa-academic-calendar`;
}

function localStamp(date: string, hhmm: string): string {
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** Day after an ISO local date, as YYYYMMDD — DTEND for all-day events is the
 * exclusive next day per RFC 5545. UTC math avoids DST edge cases. */
function nextDateStamp(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Serialize meetings as a standalone-VEVENT iCalendar file. Every meeting is
 * its own VEVENT — no RRULEs, per USAFA's irregular M/T-day sequence.
 */
export function buildIcs(config: SemesterConfig, meetings: Meeting[], now: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`USAFA ${config.name}`)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
  ];
  const dtstamp = utcStamp(now);
  for (const m of meetings) {
    lines.push('BEGIN:VEVENT', `UID:${meetingUid(config.id, m)}`, `DTSTAMP:${dtstamp}`);
    if (m.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${m.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDateStamp(m.date)}`);
    } else {
      lines.push(
        `DTSTART;TZID=${TZID}:${localStamp(m.date, m.start)}`,
        `DTEND;TZID=${TZID}:${localStamp(m.date, m.end)}`,
      );
    }
    if (m.free) {
      // Free, non-blocking event (TRANSP per RFC 5545; the X- property is
      // what Outlook and Microsoft Bookings actually read).
      lines.push('TRANSP:TRANSPARENT', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE');
    }
    lines.push(`SUMMARY:${escapeText(m.title)}`);
    if (m.location) lines.push(`LOCATION:${escapeText(m.location)}`);
    lines.push(`DESCRIPTION:${escapeText(m.description)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}

export function icsFilename(config: SemesterConfig): string {
  return `usafa-${config.id}.ics`;
}
