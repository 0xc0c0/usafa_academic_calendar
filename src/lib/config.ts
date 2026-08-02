import type { PeriodTime, SemesterConfig, SemesterDay } from './types.ts';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(configId: string, message: string): never {
  throw new Error(`Invalid semester config "${configId}": ${message}`);
}

function checkPeriodTime(configId: string, label: string, t: PeriodTime): void {
  if (!TIME_RE.test(t.start) || !TIME_RE.test(t.end)) {
    fail(configId, `${label} has malformed time "${t.start}"-"${t.end}"`);
  }
  if (t.start >= t.end) fail(configId, `${label} start ${t.start} is not before end ${t.end}`);
}

/** Day-of-week (0=Sun..6=Sat) for an ISO local date, timezone-independent. */
export function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True only if the date actually exists — Date.UTC silently rolls over
 * inputs like Feb 29 in a non-leap year, so require a clean round-trip. */
export function isRealDate(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Structural validation for a semester config. Throws with a precise message on
 * the first violation. Returns the config typed for downstream use.
 */
export function validateSemesterConfig(raw: unknown): SemesterConfig {
  const cfg = raw as SemesterConfig;
  const id = cfg?.id ?? '<missing id>';
  if (!cfg || typeof cfg !== 'object') fail(id, 'not an object');
  if (!cfg.id || typeof cfg.id !== 'string') fail(id, 'missing id');
  if (!cfg.name || typeof cfg.name !== 'string') fail(id, 'missing name');
  if (cfg.timezone !== 'America/Denver') fail(id, `unexpected timezone "${cfg.timezone}"`);

  const soc = cfg.scheduleOfCalls;
  if (!soc?.periods || !soc?.modified) fail(id, 'missing scheduleOfCalls.periods/modified');
  for (const p of ['1', '2', '3', '4', '5', '6']) {
    if (!soc.periods[p]) fail(id, `missing period ${p} in scheduleOfCalls`);
    checkPeriodTime(id, `period ${p}`, soc.periods[p]);
  }
  for (const p of Object.keys(soc.modified)) {
    if (!soc.periods[p]) fail(id, `modified override for unknown period ${p}`);
    checkPeriodTime(id, `modified period ${p}`, soc.modified[p]);
  }
  if (!soc.dfTime) fail(id, 'missing scheduleOfCalls.dfTime');
  checkPeriodTime(id, 'dfTime', soc.dfTime);
  if (!soc.cwTime) fail(id, 'missing scheduleOfCalls.cwTime');
  checkPeriodTime(id, 'cwTime', soc.cwTime);

  if (!Array.isArray(cfg.days) || cfg.days.length === 0) fail(id, 'days must be a non-empty array');
  const nextIndex: Record<string, number> = { M: 1, T: 1 };
  let prevDate = '';
  const seen = new Set<string>();
  for (const day of cfg.days as SemesterDay[]) {
    if (!DATE_RE.test(day.date)) fail(id, `malformed date "${day.date}"`);
    if (!isRealDate(day.date)) fail(id, `nonexistent calendar date ${day.date}`);
    if (seen.has(day.date)) fail(id, `duplicate date ${day.date}`);
    seen.add(day.date);
    if (day.date <= prevDate) fail(id, `dates out of order at ${day.date}`);
    prevDate = day.date;
    const dow = dayOfWeek(day.date);
    if (dow === 0 || dow === 6) fail(id, `${day.date} falls on a weekend`);
    if (day.dayType !== 'M' && day.dayType !== 'T') fail(id, `bad dayType on ${day.date}`);
    if (day.index !== nextIndex[day.dayType]) {
      fail(id, `expected ${day.dayType}${nextIndex[day.dayType]} but got ${day.dayType}${day.index} on ${day.date}`);
    }
    nextIndex[day.dayType] += 1;
    if (typeof day.modifiedSoC !== 'boolean') fail(id, `missing modifiedSoC on ${day.date}`);
  }
  return cfg;
}

export function dayLabel(day: SemesterDay): string {
  return `${day.dayType}${day.index}`;
}
