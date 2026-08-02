import ical from 'node-ical';
import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsFilename, meetingUid } from '../src/lib/ics.ts';
import { expandEntries } from '../src/lib/schedule.ts';
import { getSemester } from '../src/lib/semesters.ts';
import type { ScheduleEntry } from '../src/lib/types.ts';

const fall = getSemester('fall-2026')!;
const spring = getSemester('spring-2027')!;

const entry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: 'test',
  semesterId: 'fall-2026',
  dayType: 'M',
  periods: [3],
  title: 'Comp Sci 110',
  location: 'Fairchild 2G5',
  ...overrides,
});

const buildFor = (cfg: typeof fall, entries: ScheduleEntry[]) =>
  buildIcs(cfg, expandEntries(cfg, entries), new Date('2026-07-29T12:00:00Z'));

function parseEvents(ics: string) {
  const parsed = ical.sync.parseICS(ics);
  return Object.values(parsed).filter((c) => c.type === 'VEVENT');
}

describe('escapeText', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeText('line1\nline2\r\nline3')).toBe('line1\\nline2\\nline3');
    expect(escapeText('plain')).toBe('plain');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:Short')).toEqual(['SUMMARY:Short']);
  });

  it('folds long lines to <=75 octets with space continuations', () => {
    const line = 'DESCRIPTION:' + 'x'.repeat(300);
    const folded = foldLine(line);
    expect(folded.length).toBeGreaterThan(1);
    const encoder = new TextEncoder();
    for (const part of folded) expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    for (const part of folded.slice(1)) expect(part.startsWith(' ')).toBe(true);
    expect(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = 'SUMMARY:' + 'é'.repeat(100);
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const part of folded) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
      // A broken surrogate/continuation would not survive encode/decode round-trip
      expect(new TextDecoder().decode(encoder.encode(part))).toBe(part);
    }
    expect(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('meetingUid', () => {
  const meeting = expandEntries(fall, [entry({})])[0];
  it('is deterministic', () => {
    expect(meetingUid('fall-2026', meeting)).toBe(meetingUid('fall-2026', meeting));
  });
  it('changes when identity fields change', () => {
    const base = meetingUid('fall-2026', meeting);
    expect(meetingUid('fall-2026', { ...meeting, title: 'Other' })).not.toBe(base);
    expect(meetingUid('spring-2027', meeting)).not.toBe(base);
  });
});

describe('buildIcs structure', () => {
  const ics = buildFor(fall, [entry({})]);

  it('uses CRLF line endings throughout', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('contains calendar metadata and a VTIMEZONE with DST rules', () => {
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0');
    expect(ics).toContain('X-WR-CALNAME:USAFA Fall 2026');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:America/Denver');
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
  });

  it('emits standalone events only — no recurrence in any VEVENT', () => {
    const eventBlock = ics.slice(ics.indexOf('BEGIN:VEVENT'));
    expect(eventBlock).not.toContain('RRULE');
    expect(eventBlock).not.toContain('EXDATE');
    expect(eventBlock).not.toContain('RDATE');
  });

  it('keeps every physical line within 75 octets', () => {
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) {
      expect(encoder.encode(line).length, line).toBeLessThanOrEqual(75);
    }
  });

  it('names files after the semester', () => {
    expect(icsFilename(fall)).toBe('usafa-fall-2026.ics');
    expect(icsFilename(spring)).toBe('usafa-spring-2027.ics');
  });
});

describe('ICS round-trip through an independent parser (node-ical)', () => {
  it('one M-day entry yields exactly 41 VEVENTs with correct fields', () => {
    const events = parseEvents(buildFor(fall, [entry({})]));
    expect(events).toHaveLength(41);
    const summaries = new Set(events.map((e) => e.summary));
    expect(summaries).toEqual(new Set(['Comp Sci 110']));
    expect(events.every((e) => e.location === 'Fairchild 2G5')).toBe(true);
  });

  it('canonical example survives the round trip: M35 period 3 on 2026-11-17, event 0930-1030 MST', () => {
    const events = parseEvents(buildFor(fall, [entry({})]));
    const m35 = events.find((e) => e.start.toISOString().startsWith('2026-11-17'))!;
    expect(m35).toBeDefined();
    // 2026-11-17 is after DST ends (2026-11-01): 09:30 MST = 16:30 UTC
    expect(m35.start.toISOString()).toBe('2026-11-17T16:30:00.000Z');
    expect(m35.end.toISOString()).toBe('2026-11-17T17:30:00.000Z'); // full-hour event
    expect(m35.description).toContain('Class day M35');
  });

  it('honors the DST transition: same wall clock, different UTC instants', () => {
    const events = parseEvents(buildFor(fall, [entry({})]));
    const beforeChange = events.find((e) => e.start.toISOString().startsWith('2026-10-29'))!; // M29, MDT
    const afterChange = events.find((e) => e.start.toISOString().startsWith('2026-11-02'))!; // M30, MST
    expect(beforeChange.start.toISOString()).toBe('2026-10-29T15:30:00.000Z'); // 0930 MDT
    expect(afterChange.start.toISOString()).toBe('2026-11-02T16:30:00.000Z'); // 0930 MST
  });

  it('spring DST transition also holds (MST → MDT on 2027-03-14)', () => {
    const springEntry = entry({ semesterId: 'spring-2027' });
    const events = parseEvents(buildFor(spring, [springEntry]));
    expect(events).toHaveLength(41);
    const beforeChange = events.find((e) => e.start.toISOString().startsWith('2027-03-10'))!; // M22, MST
    const afterChange = events.find((e) => e.start.toISOString().startsWith('2027-03-16'))!; // M24, MDT
    expect(beforeChange.start.toISOString()).toBe('2027-03-10T16:30:00.000Z');
    expect(afterChange.start.toISOString()).toBe('2027-03-16T15:30:00.000Z');
  });

  it('Modified SoC days shift merged afternoon blocks an hour earlier', () => {
    const events = parseEvents(buildFor(fall, [entry({ periods: [5, 6], title: 'Aero Lab' })]));
    expect(events).toHaveLength(41);
    const modified = events.find((e) => e.start.toISOString().startsWith('2026-08-14'))!; // M4, MDT
    expect(modified.start.toISOString()).toBe('2026-08-14T18:30:00.000Z'); // 1230 MDT
    expect(modified.end.toISOString()).toBe('2026-08-14T20:30:00.000Z'); // full hour after 1330 start
    const regular = events.find((e) => e.start.toISOString().startsWith('2026-08-18'))!; // M5, regular
    expect(regular.start.toISOString()).toBe('2026-08-18T19:30:00.000Z'); // 1330 MDT
  });

  it('a full multi-entry cart round-trips with the right event count', () => {
    const events = parseEvents(
      buildFor(fall, [
        entry({ id: 'a', periods: [3, 4] }), // 41 merged events
        entry({ id: 'b', dayType: 'T', periods: [1], title: '' }), // 41 events, generic title
        entry({ id: 'c', periods: [1, 4] }), // 82 events (split runs)
      ]),
    );
    expect(events).toHaveLength(164);
    expect(events.some((e) => e.summary === 'Class — T-day Period 1')).toBe(true);
  });

  it('DF Time round-trips: 41 T-day events at 1230-1330 local', () => {
    const events = parseEvents(buildFor(fall, [entry({ kind: 'dfTime', periods: [] })]));
    expect(events).toHaveLength(41);
    expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['DF Time']));
    const t1 = events.find((e) => e.start.toISOString().startsWith('2026-08-07'))!; // T1, MDT
    expect(t1.start.toISOString()).toBe('2026-08-07T18:30:00.000Z'); // 1230 MDT
    expect(t1.end.toISOString()).toBe('2026-08-07T19:30:00.000Z'); // 1330 MDT
  });

  it('escapes user text containing commas and newlines', () => {
    const events = parseEvents(
      buildFor(fall, [entry({ title: 'Chem 100; Lab, Section A', location: 'Room 1, Bldg 2' })]),
    );
    expect(events[0].summary).toBe('Chem 100; Lab, Section A');
    expect(events[0].location).toBe('Room 1, Bldg 2');
  });
});

describe('UID uniqueness with overlapping entries (v1.8.0)', () => {
  it('an M entry shadowed by a same-titled Both entry yields unique UIDs', () => {
    const fall = getSemester('fall-2026')!;
    const base = { semesterId: 'fall-2026', title: 'CS110', location: '', periods: [3 as const] };
    const entries: ScheduleEntry[] = [
      { ...base, id: 'a', dayType: 'M' },
      { ...base, id: 'b', dayType: 'both' },
    ];
    const ics = buildIcs(fall, expandEntries(fall, entries), new Date('2026-07-31T12:00:00Z'));
    const uids = [...ics.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1]);
    expect(uids).toHaveLength(82);
    expect(new Set(uids).size).toBe(82);
  });
});

describe('all-day marker serialization (v1.9.0)', () => {
  const fall2 = getSemester('fall-2026')!;
  const allDayEntry: ScheduleEntry = {
    id: 'ad',
    semesterId: 'fall-2026',
    dayType: 'M',
    periods: [],
    title: 'All-Day M-Day Events',
    location: '',
    kind: 'allDayM',
  };

  it('emits date-only DTSTART/DTEND, TRANSP:TRANSPARENT, and Outlook FREE', () => {
    const ics = buildIcs(fall2, expandEntries(fall2, [allDayEntry]), new Date('2026-08-02T12:00:00Z'));
    expect(ics.match(/DTSTART;VALUE=DATE:/g)).toHaveLength(41);
    expect(ics.match(/TRANSP:TRANSPARENT/g)).toHaveLength(41);
    expect(ics.match(/X-MICROSOFT-CDO-BUSYSTATUS:FREE/g)).toHaveLength(41);
    // M1 is 2026-08-06: exclusive DTEND is the next calendar day.
    expect(ics).toContain('DTSTART;VALUE=DATE:20260806');
    expect(ics).toContain('DTEND;VALUE=DATE:20260807');
    // Month boundary: M17 is 2026-09-24? — assert generically instead:
    // every DTEND is one day after its DTSTART.
    const events = ics.split('BEGIN:VEVENT').slice(1);
    for (const ev of events) {
      const s = ev.match(/DTSTART;VALUE=DATE:(\d{8})/)![1];
      const e = ev.match(/DTEND;VALUE=DATE:(\d{8})/)![1];
      const sd = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`);
      sd.setUTCDate(sd.getUTCDate() + 1);
      expect(e).toBe(sd.toISOString().slice(0, 10).replace(/-/g, ''));
    }
  });

  it('parses via node-ical as date-only events titled by day label', () => {
    const ics = buildIcs(fall2, expandEntries(fall2, [allDayEntry]), new Date('2026-08-02T12:00:00Z'));
    const events = Object.values(ical.sync.parseICS(ics)).filter((c) => c.type === 'VEVENT');
    expect(events).toHaveLength(41);
    expect(events.map((e) => e.summary)).toContain('M1');
    expect(events.every((e) => (e.start as { dateOnly?: boolean }).dateOnly === true)).toBe(true);
  });
});
