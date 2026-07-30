/** Period numbers valid at USAFA: six academic periods per class day. */
export type PeriodNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type DayType = 'M' | 'T';

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
  };
  days: SemesterDay[];
}

/** One "shopping cart" item: a course meeting on every M-day or every T-day. */
export interface ScheduleEntry {
  id: string;
  semesterId: string;
  dayType: DayType;
  periods: PeriodNumber[];
  /** Course name; blank falls back to a generic label */
  title: string;
  location: string;
  /** Append the class-day label to each event title, e.g. "CS210 - M35".
   * Optional so entries saved before this option existed still load. */
  includeDayLabel?: boolean;
}

/** A single concrete class meeting (one standalone VEVENT). */
export interface Meeting {
  date: string;
  dayLabel: string;
  /** Contiguous run of periods rendered as one event */
  periods: PeriodNumber[];
  start: string;
  end: string;
  modifiedSoC: boolean;
  title: string;
  location: string;
  description: string;
}

export const MAX_TITLE_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 120;
export const MAX_ENTRIES = 25;
