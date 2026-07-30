import { describe, expect, it } from 'vitest';
import {
  expandEntries,
  expandEntry,
  genericTitle,
  mergePeriods,
  periodTimesFor,
  validateEntries,
} from '../src/lib/schedule.ts';
import { getSemester } from '../src/lib/semesters.ts';
import type { PeriodNumber, ScheduleEntry } from '../src/lib/types.ts';

const fall = getSemester('fall-2026')!;
const regularDay = fall.days.find((d) => d.date === '2026-11-17')!; // M35, regular
const modifiedDay = fall.days.find((d) => d.date === '2026-08-14')!; // M4, modified

const entry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: 'test',
  semesterId: 'fall-2026',
  dayType: 'M',
  periods: [3],
  title: '',
  location: '',
  ...overrides,
});

describe('periodTimesFor', () => {
  it('returns regular times on a regular day', () => {
    expect(periodTimesFor(fall, regularDay, 3)).toEqual({ start: '09:30', end: '10:23' });
    expect(periodTimesFor(fall, regularDay, 5)).toEqual({ start: '13:30', end: '14:23' });
  });

  it('shifts only afternoon periods on a Modified SoC day', () => {
    expect(periodTimesFor(fall, modifiedDay, 3)).toEqual({ start: '09:30', end: '10:23' });
    expect(periodTimesFor(fall, modifiedDay, 5)).toEqual({ start: '12:30', end: '13:23' });
    expect(periodTimesFor(fall, modifiedDay, 6)).toEqual({ start: '13:30', end: '14:23' });
  });
});

describe('mergePeriods', () => {
  const cases: Array<[PeriodNumber[], PeriodNumber[][], string]> = [
    [[3, 4], [[3, 4]], 'adjacent morning periods merge'],
    [[1, 2, 3, 4], [[1, 2, 3, 4]], 'whole morning merges'],
    [[4, 5], [[4], [5]], 'lunch gap splits 4 and 5'],
    [[5, 6], [[5, 6]], 'afternoon pair merges'],
    [[1, 4], [[1], [4]], 'non-adjacent periods stay separate'],
    [[2], [[2]], 'single period passes through'],
    [[4, 3], [[3, 4]], 'input order does not matter'],
    [[3, 3, 4], [[3, 4]], 'duplicates are ignored'],
    [[1, 2, 5, 6], [[1, 2], [5, 6]], 'morning and afternoon runs stay separate'],
  ];
  it.each(cases)('%j → %j (%s)', (input, expected) => {
    expect(mergePeriods(fall, regularDay, input)).toEqual(expected);
  });

  it('still splits 4|5 and merges 5+6 on a Modified SoC day', () => {
    expect(mergePeriods(fall, modifiedDay, [4, 5, 6])).toEqual([[4], [5, 6]]);
  });
});

describe('expandEntry', () => {
  it('emits one standalone meeting per M-day (41 in Fall 2026)', () => {
    const meetings = expandEntry(fall, entry({ periods: [3] }));
    expect(meetings).toHaveLength(41);
    expect(new Set(meetings.map((m) => m.date)).size).toBe(41);
  });

  it('emits 41 meetings per run for a split selection (82 total)', () => {
    const meetings = expandEntry(fall, entry({ periods: [1, 4] }));
    expect(meetings).toHaveLength(82);
  });

  it("canonical example: on M35 (2026-11-17) period 3 runs 0930-1023", () => {
    const meetings = expandEntry(fall, entry({ periods: [3] }));
    const m35 = meetings.find((m) => m.date === '2026-11-17')!;
    expect(m35.dayLabel).toBe('M35');
    expect(m35.start).toBe('09:30');
    expect(m35.end).toBe('10:23');
    expect(m35.modifiedSoC).toBe(false);
  });

  it('applies Modified SoC times on M4 (2026-08-14) for merged periods 5+6', () => {
    const meetings = expandEntry(fall, entry({ periods: [5, 6] }));
    const m4 = meetings.find((m) => m.date === '2026-08-14')!;
    expect(m4.start).toBe('12:30');
    expect(m4.end).toBe('14:23');
    expect(m4.modifiedSoC).toBe(true);
    expect(m4.description).toContain('Modified SoC');
    const regular = meetings.find((m) => m.date === '2026-11-17')!;
    expect(regular.start).toBe('13:30');
    expect(regular.end).toBe('15:23');
  });

  it('merges contiguous morning periods into one block', () => {
    const meetings = expandEntry(fall, entry({ periods: [3, 4] }));
    expect(meetings).toHaveLength(41);
    expect(meetings[0].start).toBe('09:30');
    expect(meetings[0].end).toBe('11:23');
  });

  it('T-day entries land only on T-days and are never Modified SoC in AY26-27', () => {
    const meetings = expandEntry(fall, entry({ dayType: 'T', periods: [5] }));
    expect(meetings).toHaveLength(41);
    expect(meetings.every((m) => m.dayLabel.startsWith('T'))).toBe(true);
    expect(meetings.every((m) => m.start === '13:30')).toBe(true);
  });

  it('falls back to a generic title and keeps a custom one', () => {
    const generic = expandEntry(fall, entry({ periods: [3, 4], title: '  ' }));
    expect(generic[0].title).toBe('Class — M-day Periods 3, 4');
    expect(genericTitle({ dayType: 'T', periods: [1] })).toBe('Class — T-day Period 1');
    const custom = expandEntry(fall, entry({ title: 'Comp Sci 110', location: ' Fairchild 2G5 ' }));
    expect(custom[0].title).toBe('Comp Sci 110');
    expect(custom[0].location).toBe('Fairchild 2G5');
  });

  it('appends the class-day label to titles when includeDayLabel is set', () => {
    const meetings = expandEntry(fall, entry({ title: 'CS210', includeDayLabel: true }));
    const m35 = meetings.find((m) => m.date === '2026-11-17')!;
    expect(m35.title).toBe('CS210 - M35');
    expect(meetings[0].title).toBe('CS210 - M1');
    // Every meeting gets its own day's label.
    for (const m of meetings) expect(m.title).toBe(`CS210 - ${m.dayLabel}`);
    // Works with the generic fallback title too.
    const generic = expandEntry(fall, entry({ includeDayLabel: true }));
    expect(generic.find((m) => m.date === '2026-11-17')!.title).toBe('Class — M-day Period 3 - M35');
    // Off (or absent) leaves titles untouched.
    const off = expandEntry(fall, entry({ title: 'CS210' }));
    expect(off[0].title).toBe('CS210');
  });

  it('carries calendar notes into descriptions', () => {
    const meetings = expandEntry(fall, entry({ dayType: 'T', periods: [1] }));
    const parentsWeekend = meetings.find((m) => m.date === '2026-09-04')!;
    expect(parentsWeekend.description).toContain("Parents' Weekend");
  });
});

describe('expandEntries', () => {
  it('sorts the combined cart chronologically then by start time', () => {
    const meetings = expandEntries(fall, [
      entry({ id: 'b', periods: [5] }),
      entry({ id: 'a', periods: [1] }),
    ]);
    expect(meetings).toHaveLength(82);
    expect(meetings[0].date).toBe('2026-08-06');
    expect(meetings[0].start).toBe('07:30');
    expect(meetings[1].date).toBe('2026-08-06');
    expect(meetings[1].start).toBe('13:30');
    const sorted = [...meetings].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    expect(meetings).toEqual(sorted);
  });
});

describe('validateEntries (untrusted input)', () => {
  it('accepts and normalizes a valid payload', () => {
    const cleaned = validateEntries(fall, [
      { dayType: 'M', periods: [4, 3, 3], title: ' Aero 315 ', location: '' },
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].periods).toEqual([3, 4]);
    expect(cleaned[0].title).toBe('Aero 315');
    expect(cleaned[0].semesterId).toBe('fall-2026');
    expect(cleaned[0].includeDayLabel).toBe(false);
  });

  it('coerces includeDayLabel to a strict boolean', () => {
    const on = validateEntries(fall, [{ dayType: 'M', periods: [1], includeDayLabel: true }]);
    expect(on[0].includeDayLabel).toBe(true);
    // Anything other than literal true (missing, truthy junk) is off.
    const junk = validateEntries(fall, [{ dayType: 'M', periods: [1], includeDayLabel: 'yes' }]);
    expect(junk[0].includeDayLabel).toBe(false);
  });

  const badPayloads: Array<[string, unknown, RegExp]> = [
    ['empty cart', [], /empty/i],
    ['not an array', { dayType: 'M' }, /empty/i],
    ['bad day type', [{ dayType: 'X', periods: [1] }], /day type/],
    ['no periods', [{ dayType: 'M', periods: [] }], /at least one period/],
    ['period out of range', [{ dayType: 'M', periods: [7] }], /1-6/],
    ['fractional period', [{ dayType: 'M', periods: [1.5] }], /1-6/],
    ['period as string', [{ dayType: 'M', periods: ['3'] }], /1-6/],
    ['oversized title', [{ dayType: 'M', periods: [1], title: 'x'.repeat(200) }], /title too long/],
    ['oversized location', [{ dayType: 'M', periods: [1], location: 'x'.repeat(200) }], /location too long/],
    [
      'too many entries',
      Array.from({ length: 26 }, () => ({ dayType: 'M', periods: [1] })),
      /Too many/,
    ],
  ];
  it.each(badPayloads)('rejects %s', (_name, payload, message) => {
    expect(() => validateEntries(fall, payload)).toThrow(message);
  });
});
