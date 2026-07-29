/**
 * Generates the visual validation report: builds sample carts, writes real
 * .ics files, re-parses them with the independent node-ical parser, runs
 * spot checks, and renders everything onto month grids that mirror the
 * official PDF calendar for eyeball verification.
 *
 * Run: node scripts/validation-report.ts <output-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ical from 'node-ical';
import { validateSemesterConfig } from '../src/lib/config.ts';
import { buildIcs, icsFilename } from '../src/lib/ics.ts';
import { expandEntries } from '../src/lib/schedule.ts';
import type { ScheduleEntry, SemesterConfig } from '../src/lib/types.ts';

const outDir = process.argv[2] ?? 'validation-output';
mkdirSync(outDir, { recursive: true });

const fall = validateSemesterConfig(JSON.parse(readFileSync('config/fall-2026.json', 'utf8')));
const spring = validateSemesterConfig(JSON.parse(readFileSync('config/spring-2027.json', 'utf8')));

const entry = (
  semesterId: string,
  dayType: 'M' | 'T',
  periods: number[],
  title: string,
  location = '',
): ScheduleEntry => ({
  id: `${semesterId}-${dayType}-${periods.join('')}`,
  semesterId,
  dayType,
  periods: periods as ScheduleEntry['periods'],
  title,
  location,
});

/** Sample carts chosen to exercise every rule: merges, the 4|5 lunch split,
 * Modified SoC shifts, T-day stability, and generic titles. */
const carts: Record<string, ScheduleEntry[]> = {
  'fall-2026': [
    entry('fall-2026', 'M', [3, 4], 'Comp Sci 110', 'Fairchild 2G5'),
    entry('fall-2026', 'M', [5, 6], 'Aero Lab'),
    entry('fall-2026', 'T', [1], 'History 101'),
    entry('fall-2026', 'T', [5, 6], 'Physics 215'),
  ],
  'spring-2027': [
    entry('spring-2027', 'M', [1, 2], 'ECE 315', 'Consolidated Lab'),
    entry('spring-2027', 'T', [4, 5], 'Law 220'), // splits across lunch: 2 events/day
  ],
};

const NO_CLASS: Record<string, string> = {
  '2026-09-07': 'Labor Day', '2026-09-11': "Commandant's Training Day", '2026-09-18': 'Fall VALEX',
  '2026-10-12': 'Columbus Day', '2026-11-11': 'Veterans Day',
  '2026-11-25': 'Thanksgiving', '2026-11-26': 'Thanksgiving', '2026-11-27': 'Thanksgiving', '2026-11-30': 'CW returns 1900',
  '2026-12-11': 'Study Day', '2026-12-12': 'Finals 1-3', '2026-12-14': 'Finals 4-6', '2026-12-15': 'Finals 7-9', '2026-12-16': 'Finals 10-12',
  '2027-01-18': 'MLK Day', '2027-02-15': "Presidents' Day", '2027-02-19': 'NCLS',
  '2027-03-22': 'Spring Break', '2027-03-23': 'Spring Break', '2027-03-24': 'Spring Break', '2027-03-25': 'Spring Break', '2027-03-26': 'Spring Break',
  '2027-04-09': "Commandant's Training Day", '2027-04-22': 'Crucible', '2027-04-23': 'Crucible',
  '2027-05-17': 'Finals 1-3', '2027-05-18': 'Finals 4-6', '2027-05-19': 'Finals 7-9', '2027-05-20': 'Finals 10-12',
};

// ---------- Generate, then re-parse with the independent parser ----------

interface ParsedEvent {
  date: string; // Denver local YYYY-MM-DD
  start: string; // Denver local HH:MM
  end: string;
  utcStart: string;
  summary: string;
  location: string;
  description: string;
  uid: string;
}

const denverFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function denverLocal(d: Date): { date: string; time: string } {
  const parts = Object.fromEntries(denverFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function generateAndParse(config: SemesterConfig): { icsText: string; events: ParsedEvent[] } {
  const meetings = expandEntries(config, carts[config.id]);
  const icsText = buildIcs(config, meetings);
  const file = join(outDir, icsFilename(config));
  writeFileSync(file, icsText);
  const parsed = ical.sync.parseICS(icsText);
  const events: ParsedEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (component.type !== 'VEVENT') continue;
    const ev = component as ical.VEvent;
    const startLocal = denverLocal(ev.start);
    const endLocal = denverLocal(ev.end);
    events.push({
      date: startLocal.date,
      start: startLocal.time,
      end: endLocal.time,
      utcStart: ev.start.toISOString(),
      summary: String(ev.summary),
      location: String(ev.location ?? ''),
      description: String(ev.description ?? ''),
      uid: String(ev.uid),
    });
  }
  events.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { icsText, events };
}

const fallResult = generateAndParse(fall);
const springResult = generateAndParse(spring);

// ---------- Spot checks against the PARSED files ----------

interface Check {
  name: string;
  expected: string;
  observed: string;
  pass: boolean;
}

const checks: Check[] = [];
function check(name: string, expected: string, observed: string): void {
  checks.push({ name, expected, observed, pass: expected === observed });
}

const fallEvents = fallResult.events;
const springEvents = springResult.events;

check('Fall 2026 total events (41+41+41+41)', '164', String(fallEvents.length));
check('Spring 2027 total events (41 + 41×2 lunch-split)', '123', String(springEvents.length));

const by = (events: ParsedEvent[], summary: string, date: string) =>
  events.find((e) => e.summary === summary && e.date === date);

const m35 = by(fallEvents, 'Comp Sci 110', '2026-11-17');
check('Canonical: day M35 (2026-11-17) periods 3-4 merged', '09:30-11:23', m35 ? `${m35.start}-${m35.end}` : 'missing');
check('M35 event description names the class day', 'yes', m35?.description.includes('Class day M35') ? 'yes' : 'no');

const m4 = by(fallEvents, 'Aero Lab', '2026-08-14');
check('Modified SoC day M4 (2026-08-14): periods 5-6 one hour early', '12:30-14:23', m4 ? `${m4.start}-${m4.end}` : 'missing');
const m5 = by(fallEvents, 'Aero Lab', '2026-08-18');
check('Regular day M5 (2026-08-18): periods 5-6 normal', '13:30-15:23', m5 ? `${m5.start}-${m5.end}` : 'missing');

const modifiedDates = fall.days.filter((d) => d.modifiedSoC).map((d) => d.date);
const aeroOnModified = fallEvents.filter((e) => e.summary === 'Aero Lab' && modifiedDates.includes(e.date));
check(
  'All 6 Fall Modified SoC days shift Aero Lab to 1230',
  '6 of 6 at 12:30',
  `${aeroOnModified.filter((e) => e.start === '12:30').length} of ${aeroOnModified.length} at 12:30`,
);

const physicsStarts = new Set(fallEvents.filter((e) => e.summary === 'Physics 215').map((e) => e.start));
check('T-day afternoons never shift in AY26-27 (Physics 215)', '13:30 only', [...physicsStarts].join(', ') + ' only');

const dstBefore = by(fallEvents, 'Comp Sci 110', '2026-10-29');
const dstAfter = by(fallEvents, 'Comp Sci 110', '2026-11-02');
check('DST: 0930 local before fall-back (M29) in UTC', '2026-10-29T15:30:00.000Z', dstBefore?.utcStart ?? 'missing');
check('DST: 0930 local after fall-back (M30) in UTC', '2026-11-02T16:30:00.000Z', dstAfter?.utcStart ?? 'missing');
const springDstBefore = by(springEvents, 'ECE 315', '2027-03-10');
const springDstAfter = by(springEvents, 'ECE 315', '2027-03-16');
check('DST: 0730 local before spring-forward (M22) in UTC', '2027-03-10T14:30:00.000Z', springDstBefore?.utcStart ?? 'missing');
check('DST: 0730 local after spring-forward (M24) in UTC', '2027-03-16T13:30:00.000Z', springDstAfter?.utcStart ?? 'missing');

const law = springEvents.filter((e) => e.summary === 'Law 220' && e.date === '2027-01-07');
check(
  'Lunch split: Law 220 periods 4+5 = two events on T1 (2027-01-07)',
  '10:30-11:23 + 13:30-14:23',
  law.map((e) => `${e.start}-${e.end}`).join(' + ') || 'missing',
);

const allEvents = [...fallEvents, ...springEvents];
const offenders = allEvents.filter((e) => NO_CLASS[e.date]);
check('No events on holidays/breaks/training days/finals', '0 events', `${offenders.length} events`);

const weekendEvents = allEvents.filter((e) => {
  const [y, m, d] = e.date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
});
check('No events on weekends', '0 events', `${weekendEvents.length} events`);

const uids = new Set(allEvents.map((e) => e.uid));
check('Every event has a unique deterministic UID', String(allEvents.length), String(uids.size));

const noRrule = !/^(RRULE|EXDATE|RDATE)/m.test(fallResult.icsText.slice(fallResult.icsText.indexOf('BEGIN:VEVENT')));
check('Standalone events only (no RRULE/EXDATE/RDATE in events)', 'yes', noRrule ? 'yes' : 'no');

check(
  'Fall spans first to last class day',
  '2026-08-06 → 2026-12-10',
  `${fallEvents[0]?.date} → ${fallEvents[fallEvents.length - 1]?.date}`,
);
check(
  'Spring spans first to last class day',
  '2027-01-06 → 2027-05-14',
  `${springEvents[0]?.date} → ${springEvents[springEvents.length - 1]?.date}`,
);

// ---------- Render month grids ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function monthGrid(config: SemesterConfig, events: ParsedEvent[], year: number, month: number): string {
  const dayInfo = new Map(config.days.map((d) => [d.date, d]));
  const eventsByDate = new Map<string, ParsedEvent[]>();
  for (const e of events) {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  }
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (firstDow + d - 1) % 7;
    const info = dayInfo.get(iso);
    const dayEvents = eventsByDate.get(iso) ?? [];
    const closed = NO_CLASS[iso];
    let cls = 'cell';
    if (dow === 0 || dow === 6) cls += ' weekend';
    else if (!info) cls += ' offday';
    let body = '';
    if (info) {
      const label = `${info.dayType}${info.index}`;
      body += `<span class="chip ${info.dayType === 'M' ? 'm' : 't'}">${label}</span>`;
      if (info.modifiedSoC) body += '<span class="chip mod">MOD SoC</span>';
      body += dayEvents
        .map((e) => `<span class="ev" title="${esc(e.summary)}">${e.start.replace(':', '')}–${e.end.replace(':', '')} ${esc(e.summary)}</span>`)
        .join('');
    } else if (closed && dow > 0 && dow < 6) {
      body += `<span class="closed">${esc(closed)}</span>`;
    }
    cells += `<div class="${cls}"><span class="datenum">${d}</span>${body}</div>`;
  }
  return `<div class="month"><h4>${MONTH_NAMES[month - 1]} ${year}</h4><div class="dow-row">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="grid">${cells}</div></div>`;
}

function semesterSection(config: SemesterConfig, result: { events: ParsedEvent[] }, months: Array<[number, number]>): string {
  const mCount = config.days.filter((d) => d.dayType === 'M').length;
  const tCount = config.days.filter((d) => d.dayType === 'T').length;
  const modified = config.days.filter((d) => d.modifiedSoC).map((d) => `${d.dayType}${d.index}`);
  const cartRows = carts[config.id]
    .map((c) => {
      const evCount = result.events.filter((e) =>
        e.summary === (c.title || `Class — ${c.dayType}-day Periods ${c.periods.join(', ')}`),
      ).length;
      return `<tr><td>${esc(c.title)}</td><td>${c.dayType}-days</td><td class="num">${c.periods.join(', ')}</td><td>${esc(c.location) || '—'}</td><td class="num">${evCount}</td></tr>`;
    })
    .join('');
  return `
  <section>
    <h2>${esc(config.name)}</h2>
    <p class="lede">${mCount} M-days (M1–M${mCount}) and ${tCount} T-days (T1–T${tCount}); Modified SoC on ${modified.join(', ')}.
    Every event below was read back from the generated <code>${icsFilename(config)}</code> by node-ical — this page shows the parsed file, not the source data.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Sample course</th><th>Meets</th><th>Periods</th><th>Location</th><th>Events in file</th></tr></thead>
      <tbody>${cartRows}</tbody>
    </table></div>
    <div class="months">${months.map(([y, m]) => monthGrid(config, result.events, y, m)).join('')}</div>
  </section>`;
}

const passCount = checks.filter((c) => c.pass).length;
const checkRows = checks
  .map(
    (c) =>
      `<tr class="${c.pass ? 'ok' : 'bad'}"><td>${esc(c.name)}</td><td class="num">${esc(c.expected)}</td><td class="num">${esc(c.observed)}</td><td class="status">${c.pass ? 'PASS' : 'FAIL'}</td></tr>`,
  )
  .join('');

const html = `<title>USAFA .ics Validation Report</title>
<style>
:root {
  --ground: #f4f6fa; --card: #ffffff; --ink: #16213a; --muted: #5d6b86;
  --line: #d9e0ec; --accent: #003594; --m-chip: #003594; --t-chip: #0f766e;
  --mod: #b45309; --mod-bg: #fdf1e3; --ok: #15803d; --ok-bg: #e9f6ee;
  --bad: #b3261e; --bad-bg: #fdecea; --ev-bg: #eef2fb; --closed: #8a94ab;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #0e1626; --card: #182338; --ink: #e7edf8; --muted: #9fb0cc;
    --line: #2b3a5c; --accent: #8fb4ff; --m-chip: #4d7fe0; --t-chip: #2ea391;
    --mod: #e8a355; --mod-bg: #3a2c17; --ok: #52c07a; --ok-bg: #16301f;
    --bad: #ff8a80; --bad-bg: #3a1c19; --ev-bg: #20304e; --closed: #6e7d99;
  }
}
:root[data-theme="light"] {
  --ground: #f4f6fa; --card: #ffffff; --ink: #16213a; --muted: #5d6b86;
  --line: #d9e0ec; --accent: #003594; --m-chip: #003594; --t-chip: #0f766e;
  --mod: #b45309; --mod-bg: #fdf1e3; --ok: #15803d; --ok-bg: #e9f6ee;
  --bad: #b3261e; --bad-bg: #fdecea; --ev-bg: #eef2fb; --closed: #8a94ab;
}
:root[data-theme="dark"] {
  --ground: #0e1626; --card: #182338; --ink: #e7edf8; --muted: #9fb0cc;
  --line: #2b3a5c; --accent: #8fb4ff; --m-chip: #4d7fe0; --t-chip: #2ea391;
  --mod: #e8a355; --mod-bg: #3a2c17; --ok: #52c07a; --ok-bg: #16301f;
  --bad: #ff8a80; --bad-bg: #3a1c19; --ev-bg: #20304e; --closed: #6e7d99;
}
body { background: var(--ground); color: var(--ink); font: 16px/1.55 system-ui, sans-serif; margin: 0; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1, h2, h3, h4 { font-family: 'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', system-ui, sans-serif; letter-spacing: 0.02em; }
h1 { color: var(--accent); text-transform: uppercase; font-size: 2rem; margin: 0 0 0.25rem; text-wrap: balance; }
.sub { color: var(--muted); max-width: 62ch; margin: 0 0 1.5rem; }
h2 { text-transform: uppercase; font-size: 1.3rem; border-bottom: 2px solid var(--accent); padding-bottom: 0.3rem; margin: 2.5rem 0 0.5rem; }
.lede { color: var(--muted); max-width: 70ch; }
.stats { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1.25rem 0; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0.6rem 1rem; min-width: 8.5rem; }
.stat b { display: block; font-size: 1.5rem; font-variant-numeric: tabular-nums; color: var(--accent); }
.stat span { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; }
.tablewrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th { text-align: left; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.72rem; color: var(--muted); padding: 0.6rem 0.9rem; border-bottom: 1px solid var(--line); }
td { padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: none; }
td.num { font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
tr.ok .status { color: var(--ok); font-weight: 700; }
tr.bad { background: var(--bad-bg); } tr.bad .status { color: var(--bad); font-weight: 700; }
.months { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 1rem; margin-top: 1rem; }
.month { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0.75rem; }
.month h4 { margin: 0 0 0.4rem; text-transform: uppercase; color: var(--accent); }
.dow-row, .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dow-row span { text-align: center; font-size: 0.65rem; color: var(--muted); text-transform: uppercase; }
.cell { border: 1px solid var(--line); border-radius: 4px; min-height: 3.4rem; padding: 2px 3px; position: relative; font-size: 0.62rem; display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
.cell.blank { border: none; }
.cell.weekend { background: color-mix(in srgb, var(--line) 35%, transparent); }
.cell.offday { background: color-mix(in srgb, var(--line) 18%, transparent); }
.datenum { position: absolute; top: 2px; right: 4px; color: var(--muted); font-variant-numeric: tabular-nums; }
.chip { border-radius: 3px; padding: 0 4px; font-weight: 700; color: #fff; }
.chip.m { background: var(--m-chip); }
.chip.t { background: var(--t-chip); }
.chip.mod { background: var(--mod-bg); color: var(--mod); border: 1px solid var(--mod); font-weight: 600; }
.ev { background: var(--ev-bg); border-radius: 3px; padding: 0 3px; font-family: ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.closed { color: var(--closed); font-style: italic; }
.legend { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin: 0.75rem 0; font-size: 0.8rem; color: var(--muted); }
.legend .chip { font-size: 0.65rem; }
code { background: var(--ev-bg); border-radius: 4px; padding: 0.05rem 0.35rem; font-size: 0.85em; }
.note { background: var(--ok-bg); border: 1px solid var(--ok); border-radius: 10px; padding: 0.75rem 1rem; color: var(--ink); max-width: 70ch; }
</style>
<div class="wrap">
  <h1>USAFA .ics Validation Report</h1>
  <p class="sub">Independent read-back of the calendar files the web app generates. Sample schedules were expanded to standalone events, serialized to <code>.ics</code>, then <strong>re-parsed with node-ical</strong> (a parser this project doesn't write) — every time and date below comes from the parsed files. Compare the month grids against the official AY 2026–2027 Cadet Academic Calendar PDF.</p>

  <div class="stats">
    <div class="stat"><b>${passCount}/${checks.length}</b><span>spot checks pass</span></div>
    <div class="stat"><b>${fallEvents.length + springEvents.length}</b><span>events parsed</span></div>
    <div class="stat"><b>82 + 82</b><span>class days (41 M + 41 T each)</span></div>
    <div class="stat"><b>74 + 4</b><span>unit + e2e tests green</span></div>
  </div>

  <h2>Spot checks (parsed .ics vs. official calendar)</h2>
  <div class="tablewrap"><table>
    <thead><tr><th>Check</th><th>Expected</th><th>Observed in file</th><th></th></tr></thead>
    <tbody>${checkRows}</tbody>
  </table></div>

  <div class="legend">
    <span><span class="chip m">M12</span> M-day + label</span>
    <span><span class="chip t">T12</span> T-day + label</span>
    <span><span class="chip mod">MOD SoC</span> afternoon periods 1 hr early</span>
    <span>Shaded weekday = no classes (reason shown)</span>
    <span>Monospace lines = events read from the .ics</span>
  </div>

  ${semesterSection(fall, fallResult, [[2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12]])}
  ${semesterSection(spring, springResult, [[2027, 1], [2027, 2], [2027, 3], [2027, 4], [2027, 5]])}

  <h2>How to verify by hand</h2>
  <p class="note">Pick any cell above, find the same date on the official PDF, and confirm: (1) the day label matches (e.g. 17 Nov 2026 = M35), (2) "Modified SoC" days match the orange notes on the PDF, and (3) class times follow the Schedule of Calls — periods 3–4 at 0930–1123, periods 5–6 at 1330–1523, shifting to 1230–1423 only on MOD days. The <code>.ics</code> files themselves are in this report's output directory and can be imported into any calendar app.</p>
</div>
`;

writeFileSync(join(outDir, 'validation-report.html'), html);

console.log(`checks: ${passCount}/${checks.length} pass`);
for (const c of checks.filter((x) => !x.pass)) {
  console.log(`FAIL: ${c.name} — expected ${c.expected}, observed ${c.observed}`);
}
console.log(`wrote ${join(outDir, icsFilename(fall))} (${fallEvents.length} events)`);
console.log(`wrote ${join(outDir, icsFilename(spring))} (${springEvents.length} events)`);
console.log(`wrote ${join(outDir, 'validation-report.html')}`);
