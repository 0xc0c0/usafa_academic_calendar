/** Period numbers valid at USAFA: six academic periods per class day. */
export type PeriodNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type DayType = 'M' | 'T';

/** What a schedule entry can meet on: one day type, or 'both' = every class
 * day (all M-days and all T-days — 82 days in a 41/41 semester). Calendar
 * days themselves are always exactly 'M' or 'T'. */
export type EntryDayType = DayType | 'both';

export interface PeriodTime {
  /** 24h local wall-clock, "HH:MM" */
  start: string;
  end: string;
}

export interface SemesterDay {
  /** ISO local date, e.g. "2026-08-06" */
  date: string;
  dayType: DayType;
  /** 1-based sequence within the day type; label = `${dayType}${index}`, e.g. "M35" */
  index: number;
  /** True when the calendar marks this day "Modified SoC - Afternoon Sections Start 1 Hr Early" */
  modifiedSoC: boolean;
  note?: string;
}

export interface SemesterConfig {
  id: string;
  name: string;
  academicYear: string;
  /** IANA timezone, always "America/Denver" for USAFA */
  timezone: string;
  source: unknown;
  scheduleOfCalls: {
    periods: Record<string, PeriodTime>;
    /** Overrides applied to afternoon periods on modifiedSoC days */
    modified: Record<string, PeriodTime>;
    /** DF Time: the Dean's extra-instruction/advising block between lunch and
     * 5th period. Official SoC times (1230-1323); occurs on T-days only. */
    dfTime: PeriodTime;
    /** CW Time: the Cadet Wing's counterpart block on M-days, same official
     * SoC slot (1230-1323). Does not occur on Modified SoC days — the
     * shifted periods 5-6 occupy this slot there. */
    cwTime: PeriodTime;
  };
  days: SemesterDay[];
}

/** One "shopping cart" item: a course meeting on every M-day, every T-day,
 * or (dayType 'both') every class day. */
export interface ScheduleEntry {
  id: string;
  semesterId: string;
  dayType: EntryDayType;
  periods: PeriodNumber[];
  /** Course name; blank falls back to a generic label */
  title: string;
  location: string;
  /** Append the class-day label to each event title, e.g. "CS210 - M35".
   * Optional so entries saved before this option existed still load. */
  includeDayLabel?: boolean;
  /** Fixed one-click add-ons (no configuration): 'dfTime' = DF Time block
   * (T-days), 'cwTime' = CW Time block (M-days, skips Modified SoC days),
   * 'allDayM'/'allDayT' = untimed all-day marker events titled by class-day
   * label, marked Free. Absent or 'class' is a normal course entry. */
  kind?: 'class' | 'dfTime' | 'cwTime' | 'allDayM' | 'allDayT';
}

/** A single concrete class meeting (one standalone VEVENT). */
export interface Meeting {
  date: string;
  dayLabel: string;
  /** Contiguous run of periods rendered as one event */
  periods: PeriodNumber[];
  start: string;
  end: string;
  /** Untimed date-only event (DTSTART;VALUE=DATE) marked Free — start/end are
   * empty strings. Used by the all-day class-day markers. */
  allDay?: boolean;
  modifiedSoC: boolean;
  title: string;
  location: string;
  description: string;
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 120;
export const MAX_ENTRIES = 25;
/** Server-side cap on total expanded events per generated file. A real course
 * load tops out around 600; 'both' entries made the worst case (25 entries ×
 * 82 days × 3 unmergeable runs ≈ 6150) heavy enough to bound explicitly. */
export const MAX_EVENTS = 2000;
