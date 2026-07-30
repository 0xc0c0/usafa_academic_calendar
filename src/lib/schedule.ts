import { dayLabel } from './config.ts';
import type {
  Meeting,
  PeriodNumber,
  PeriodTime,
  ScheduleEntry,
  SemesterConfig,
  SemesterDay,
} from './types.ts';
import { MAX_ENTRIES, MAX_LOCATION_LENGTH, MAX_TITLE_LENGTH } from './types.ts';

/** Passing periods between classes are 7 minutes; anything longer (lunch, CW/DF
 * time) breaks a contiguous block. */
const MERGE_GAP_MINUTES = 10;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Calendar events span full hours: a period's event ends 60 minutes after it
 * starts, not at the official :23 dismissal — surrounding meeting invites are
 * always rounded to the hour, so :23 ends just clutter calendars (owner
 * decision). Merging still uses the official SoC times.
 */
export function fullHourEnd(start: string): string {
  const total = toMinutes(start) + 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Effective period times for a specific day, honoring Modified SoC. */
export function periodTimesFor(config: SemesterConfig, day: SemesterDay, period: PeriodNumber): PeriodTime {
  const soc = config.scheduleOfCalls;
  if (day.modifiedSoC && soc.modified[String(period)]) return soc.modified[String(period)];
  return soc.periods[String(period)];
}

/**
 * Group selected periods into runs that render as single events: consecutive
 * period numbers whose gap on this specific day is only a passing period.
 * Periods 4→5 never merge (lunch + CW/DF time between), on both regular and
 * modified days.
 */
export function mergePeriods(
  config: SemesterConfig,
  day: SemesterDay,
  periods: PeriodNumber[],
): PeriodNumber[][] {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  const runs: PeriodNumber[][] = [];
  for (const p of sorted) {
    const current = runs[runs.length - 1];
    if (current) {
      const prev = current[current.length - 1];
      const gap = toMinutes(periodTimesFor(config, day, p).start) - toMinutes(periodTimesFor(config, day, prev).end);
      if (p === prev + 1 && gap >= 0 && gap <= MERGE_GAP_MINUTES) {
        current.push(p);
        continue;
      }
    }
    runs.push([p]);
  }
  return runs;
}

export function genericTitle(entry: Pick<ScheduleEntry, 'dayType' | 'periods'>): string {
  const list = [...new Set(entry.periods)].sort((a, b) => a - b).join(', ');
  const plural = entry.periods.length > 1 ? 's' : '';
  return `Class — ${entry.dayType}-day Period${plural} ${list}`;
}

/** Expand the fixed DF Time block: every T-day, between lunch and 5th period. */
function expandDfTime(config: SemesterConfig): Meeting[] {
  const df = config.scheduleOfCalls.dfTime;
  const meetings: Meeting[] = [];
  for (const day of config.days) {
    if (day.dayType !== 'T') continue;
    const label = dayLabel(day);
    meetings.push({
      date: day.date,
      dayLabel: label,
      periods: [],
      start: df.start,
      end: fullHourEnd(df.start),
      modifiedSoC: day.modifiedSoC,
      title: 'DF Time',
      location: '',
      description:
        `DF Time on class day ${label} (${config.name}) — extra instruction, academic advising, ` +
        `majors' meetings, and Dean's calls.` +
        (day.note ? `\nCalendar note: ${day.note}` : ''),
    });
  }
  return meetings;
}

/** Expand one cart entry into concrete meetings (one per class day of its type). */
export function expandEntry(config: SemesterConfig, entry: ScheduleEntry): Meeting[] {
  if (entry.kind === 'dfTime') return expandDfTime(config);
  const title = entry.title.trim() || genericTitle(entry);
  const meetings: Meeting[] = [];
  for (const day of config.days) {
    if (day.dayType !== entry.dayType) continue;
    for (const run of mergePeriods(config, day, entry.periods)) {
      const start = periodTimesFor(config, day, run[0]).start;
      const end = fullHourEnd(periodTimesFor(config, day, run[run.length - 1]).start);
      const label = dayLabel(day);
      const modifiedNote = day.modifiedSoC ? ' — Modified SoC: afternoon sections one hour early' : '';
      meetings.push({
        date: day.date,
        dayLabel: label,
        periods: run,
        start,
        end,
        modifiedSoC: day.modifiedSoC,
        title: entry.includeDayLabel ? `${title} - ${label}` : title,
        location: entry.location.trim(),
        description:
          `Class day ${label} (${config.name}), period${run.length > 1 ? 's' : ''} ${run.join(', ')}${modifiedNote}` +
          (day.note ? `\nCalendar note: ${day.note}` : ''),
      });
    }
  }
  return meetings;
}

/** Expand a whole cart (already filtered to one semester), sorted for output. */
export function expandEntries(config: SemesterConfig, entries: ScheduleEntry[]): Meeting[] {
  const meetings = entries.flatMap((e) => expandEntry(config, e));
  meetings.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return meetings;
}

/**
 * Validate an untrusted cart payload against a semester config. Returns a
 * cleaned list or throws with a client-safe message. Used by the API; the UI
 * enforces the same rules interactively.
 */
export function validateEntries(config: SemesterConfig, raw: unknown): ScheduleEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Cart is empty.');
  if (raw.length > MAX_ENTRIES) throw new Error(`Too many entries (max ${MAX_ENTRIES}).`);
  return raw.map((item, i) => {
    const e = item as Partial<ScheduleEntry>;
    if (e.kind === 'dfTime') {
      // Fixed block: nothing user-configurable, so ignore all other fields.
      return {
        id: typeof e.id === 'string' ? e.id.slice(0, 40) : `entry-${i + 1}`,
        semesterId: config.id,
        dayType: 'T' as const,
        periods: [],
        title: 'DF Time',
        location: '',
        includeDayLabel: false,
        kind: 'dfTime' as const,
      };
    }
    if (e.dayType !== 'M' && e.dayType !== 'T') throw new Error(`Entry ${i + 1}: day type must be M or T.`);
    if (!Array.isArray(e.periods) || e.periods.length === 0) throw new Error(`Entry ${i + 1}: pick at least one period.`);
    const periods = [...new Set(e.periods)];
    if (periods.length > 6 || periods.some((p) => typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 6)) {
      throw new Error(`Entry ${i + 1}: periods must be whole numbers 1-6.`);
    }
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    const location = typeof e.location === 'string' ? e.location.trim() : '';
    if (title.length > MAX_TITLE_LENGTH) throw new Error(`Entry ${i + 1}: title too long (max ${MAX_TITLE_LENGTH}).`);
    if (location.length > MAX_LOCATION_LENGTH) throw new Error(`Entry ${i + 1}: location too long (max ${MAX_LOCATION_LENGTH}).`);
    return {
      id: typeof e.id === 'string' ? e.id.slice(0, 40) : `entry-${i + 1}`,
      semesterId: config.id,
      dayType: e.dayType,
      periods: (periods as PeriodNumber[]).sort((a, b) => a - b),
      title,
      location,
      includeDayLabel: e.includeDayLabel === true,
    };
  });
}
