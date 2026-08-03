import { dayLabel } from './config.ts';
import type {
  DayType,
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
  const kind = entry.dayType === 'both' ? 'M/T-day' : `${entry.dayType}-day`;
  return `Class — ${kind} Period${plural} ${list}`;
}

/**
 * Expand a fixed lunch-block add-on: DF Time (T-days) or CW Time (M-days),
 * both in the official 1230-1323 slot. Skips Modified SoC days — the shifted
 * periods 5-6 occupy this slot there (in AY26-27 all modified days are
 * M-days, so this only bites CW Time in practice; the guard applies to both
 * for the hypothetical modified T-day).
 */
function expandLunchBlock(config: SemesterConfig, kind: 'dfTime' | 'cwTime'): Meeting[] {
  const block = config.scheduleOfCalls[kind];
  const wantType = kind === 'dfTime' ? 'T' : 'M';
  const title = kind === 'dfTime' ? 'DF Time' : 'CW Time';
  const meetings: Meeting[] = [];
  for (const day of config.days) {
    if (day.dayType !== wantType || day.modifiedSoC) continue;
    const label = dayLabel(day);
    meetings.push({
      date: day.date,
      dayLabel: label,
      periods: [],
      start: block.start,
      end: fullHourEnd(block.start),
      modifiedSoC: day.modifiedSoC,
      free: true,
      title,
      location: '',
      description:
        (kind === 'dfTime'
          ? `DF Time on class day ${label} (${config.name}) — extra instruction, academic advising, ` +
            `majors' meetings, and Dean's calls.`
          : `CW Time on class day ${label} (${config.name}) — the Cadet Wing's block between lunch ` +
            `and 5th period. No CW Time on Modified SoC days.`) +
        (day.note ? `\nCalendar note: ${day.note}` : ''),
    });
  }
  return meetings;
}

/**
 * Expand the all-day class-day markers: one untimed, Free (non-blocking)
 * all-day event per class day of the given type, titled by the day's label
 * (e.g. "M12") so the calendar's banner strip shows which class day it is.
 */
function expandAllDay(config: SemesterConfig, wantType: DayType): Meeting[] {
  const meetings: Meeting[] = [];
  for (const day of config.days) {
    if (day.dayType !== wantType) continue;
    const label = dayLabel(day);
    meetings.push({
      date: day.date,
      dayLabel: label,
      periods: [],
      start: '',
      end: '',
      allDay: true,
      free: true,
      modifiedSoC: day.modifiedSoC,
      title: label,
      location: '',
      description:
        `Class day ${label} (${config.name}).` +
        (day.modifiedSoC ? ' Modified SoC — afternoon sections start one hour early.' : '') +
        (day.note ? `\nCalendar note: ${day.note}` : ''),
    });
  }
  return meetings;
}

/** Expand one cart entry into concrete meetings (one per class day of its
 * type; dayType 'both' matches every class day). */
export function expandEntry(config: SemesterConfig, entry: ScheduleEntry): Meeting[] {
  if (entry.kind === 'dfTime' || entry.kind === 'cwTime') return expandLunchBlock(config, entry.kind);
  if (entry.kind === 'allDayM') return expandAllDay(config, 'M');
  if (entry.kind === 'allDayT') return expandAllDay(config, 'T');
  const title = entry.title.trim() || genericTitle(entry);
  // All six periods = the whole class day: one continuous event spanning
  // lunch and CW/DF Time (owner decision 2026-07-31), instead of the merge
  // rule's two blocks split at lunch. Checked against the exact set 1-6, not
  // just distinct-count, so junk values can never fake a full day.
  const selected = new Set(entry.periods);
  const allSix = ([1, 2, 3, 4, 5, 6] as PeriodNumber[]).every((p) => selected.has(p));
  const meetings: Meeting[] = [];
  for (const day of config.days) {
    if (entry.dayType !== 'both' && day.dayType !== entry.dayType) continue;
    const runs = allSix ? [[1, 2, 3, 4, 5, 6] as PeriodNumber[]] : mergePeriods(config, day, entry.periods);
    for (const run of runs) {
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
  // Overlapping entries (e.g. an M-days class alongside a same-titled Both
  // class) would emit byte-identical events with colliding UIDs — calendar
  // apps keep one event per UID and silently drop the rest. Drop exact
  // duplicates here so counts, the .ics file, and imports all agree.
  const seen = new Set<string>();
  return meetings.filter((m) => {
    const key = `${m.date}|${m.start}|${m.end}|${m.title}|${m.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Canonical shape of each fixed one-click add-on (see expandEntry). */
export const FIXED_ADDONS: Record<
  Exclude<NonNullable<ScheduleEntry['kind']>, 'class'>,
  { dayType: DayType; title: string }
> = {
  dfTime: { dayType: 'T', title: 'DF Time' },
  cwTime: { dayType: 'M', title: 'CW Time' },
  allDayM: { dayType: 'M', title: 'All-Day M-Day Events' },
  allDayT: { dayType: 'T', title: 'All-Day T-Day Events' },
};

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
    // Object.hasOwn on a string only: 'constructor' etc. are reachable through
    // the prototype chain, and non-string kinds (e.g. ["dfTime"]) would coerce
    // to a matching key via ToPropertyKey — both must fail as unknown kinds.
    const fixed =
      typeof e.kind === 'string' && e.kind !== 'class' && Object.hasOwn(FIXED_ADDONS, e.kind)
        ? FIXED_ADDONS[e.kind]
        : undefined;
    if (fixed && e.kind && e.kind !== 'class') {
      // Fixed add-on: nothing user-configurable, so ignore all other fields.
      return {
        id: typeof e.id === 'string' ? e.id.slice(0, 40) : `entry-${i + 1}`,
        semesterId: config.id,
        dayType: fixed.dayType,
        periods: [],
        title: fixed.title,
        location: '',
        includeDayLabel: false,
        kind: e.kind,
      };
    }
    if (e.kind && e.kind !== 'class') throw new Error(`Entry ${i + 1}: unknown entry kind.`);
    if (e.dayType !== 'M' && e.dayType !== 'T' && e.dayType !== 'both') {
      throw new Error(`Entry ${i + 1}: day type must be M, T, or both.`);
    }
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
