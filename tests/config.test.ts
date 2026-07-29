import { describe, expect, it } from 'vitest';
import { dayLabel, dayOfWeek, validateSemesterConfig } from '../src/lib/config.ts';
import { SEMESTERS, getSemester } from '../src/lib/semesters.ts';
import type { SemesterConfig } from '../src/lib/types.ts';

const fall = getSemester('fall-2026')!;
const spring = getSemester('spring-2027')!;

const clone = (cfg: SemesterConfig): SemesterConfig => JSON.parse(JSON.stringify(cfg));

describe('published semester configs', () => {
  it('exposes exactly Fall 2026 and Spring 2027', () => {
    expect(SEMESTERS.map((s) => s.id)).toEqual(['fall-2026', 'spring-2027']);
    expect(fall.name).toBe('Fall 2026');
    expect(spring.name).toBe('Spring 2027');
  });

  it.each([
    ['fall-2026', fall],
    ['spring-2027', spring],
  ])('%s has exactly 41 M-days and 41 T-days', (_id, cfg) => {
    expect(cfg.days.filter((d) => d.dayType === 'M')).toHaveLength(41);
    expect(cfg.days.filter((d) => d.dayType === 'T')).toHaveLength(41);
    expect(cfg.days).toHaveLength(82);
  });

  it('Fall 2026 starts M1 on 2026-08-06 and ends T41 on 2026-12-10', () => {
    expect(fall.days[0]).toMatchObject({ date: '2026-08-06', dayType: 'M', index: 1 });
    expect(fall.days[fall.days.length - 1]).toMatchObject({ date: '2026-12-10', dayType: 'T', index: 41 });
  });

  it('Spring 2027 starts M1 on 2027-01-06 and ends T41 on 2027-05-14', () => {
    expect(spring.days[0]).toMatchObject({ date: '2027-01-06', dayType: 'M', index: 1 });
    expect(spring.days[spring.days.length - 1]).toMatchObject({ date: '2027-05-14', dayType: 'T', index: 41 });
  });

  it("matches the product owner's canonical example: Fall day M35 is 2026-11-17", () => {
    const m35 = fall.days.find((d) => d.dayType === 'M' && d.index === 35)!;
    expect(m35.date).toBe('2026-11-17');
    expect(m35.modifiedSoC).toBe(false);
  });

  it('Fall 2026 Modified SoC days are exactly M4, M9, M13, M15, M20, M34', () => {
    const modified = fall.days.filter((d) => d.modifiedSoC).map(dayLabel);
    expect(modified).toEqual(['M4', 'M9', 'M13', 'M15', 'M20', 'M34']);
    const dates = fall.days.filter((d) => d.modifiedSoC).map((d) => d.date);
    expect(dates).toEqual(['2026-08-14', '2026-08-28', '2026-09-10', '2026-09-17', '2026-10-02', '2026-11-13']);
  });

  it('Spring 2027 Modified SoC days are exactly M2, M23, M30, M34, M39', () => {
    const modified = spring.days.filter((d) => d.modifiedSoC).map(dayLabel);
    expect(modified).toEqual(['M2', 'M23', 'M30', 'M34', 'M39']);
    const dates = spring.days.filter((d) => d.modifiedSoC).map((d) => d.date);
    expect(dates).toEqual(['2027-01-08', '2027-03-12', '2027-04-08', '2027-04-21', '2027-05-07']);
  });

  it('holidays, training days, breaks, and finals are not class days', () => {
    const fallDates = new Set(fall.days.map((d) => d.date));
    for (const noClass of [
      '2026-09-07', // Labor Day
      '2026-09-11', // Commandant's Training Day
      '2026-09-18', // Fall VALEX
      '2026-10-12', // Columbus Day
      '2026-11-11', // Veterans Day
      '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30', // Thanksgiving
      '2026-12-11', '2026-12-14', '2026-12-15', '2026-12-16', // Study day + finals
    ]) {
      expect(fallDates.has(noClass), `${noClass} must not be a Fall class day`).toBe(false);
    }
    const springDates = new Set(spring.days.map((d) => d.date));
    for (const noClass of [
      '2027-01-18', // MLK Day
      '2027-02-15', // Presidents' Day
      '2027-02-19', // NCLS
      '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', // Spring Break
      '2027-04-09', // Commandant's Training Day
      '2027-04-22', '2027-04-23', // Crucible
      '2027-05-17', '2027-05-18', '2027-05-19', '2027-05-20', // Finals
    ]) {
      expect(springDates.has(noClass), `${noClass} must not be a Spring class day`).toBe(false);
    }
  });

  it('every class day is a weekday', () => {
    for (const cfg of SEMESTERS) {
      for (const day of cfg.days) {
        const dow = dayOfWeek(day.date);
        expect(dow, `${day.date} weekday`).toBeGreaterThanOrEqual(1);
        expect(dow, `${day.date} weekday`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('period times match the official Schedule of Calls exactly', () => {
    for (const cfg of SEMESTERS) {
      expect(cfg.scheduleOfCalls.periods).toEqual({
        '1': { start: '07:30', end: '08:23' },
        '2': { start: '08:30', end: '09:23' },
        '3': { start: '09:30', end: '10:23' },
        '4': { start: '10:30', end: '11:23' },
        '5': { start: '13:30', end: '14:23' },
        '6': { start: '14:30', end: '15:23' },
      });
      expect(cfg.scheduleOfCalls.modified).toEqual({
        '5': { start: '12:30', end: '13:23' },
        '6': { start: '13:30', end: '14:23' },
      });
    }
  });
});

describe('validateSemesterConfig rejects corrupted configs', () => {
  it('rejects a weekend class day', () => {
    const bad = clone(fall);
    bad.days[0].date = '2026-08-08'; // Saturday
    expect(() => validateSemesterConfig(bad)).toThrow(/weekend|out of order/);
  });

  it('rejects an index gap', () => {
    const bad = clone(fall);
    bad.days[2].index = 7; // should be M2
    expect(() => validateSemesterConfig(bad)).toThrow(/expected M2/);
  });

  it('rejects nonexistent calendar dates that Date.UTC would silently roll over', () => {
    const bad = clone(fall);
    bad.days[0].date = '2026-02-29'; // 2026 is not a leap year
    expect(() => validateSemesterConfig(bad)).toThrow(/nonexistent calendar date/);
    const bad2 = clone(fall);
    bad2.days[0].date = '2026-06-31'; // June has 30 days
    expect(() => validateSemesterConfig(bad2)).toThrow(/nonexistent calendar date/);
  });

  it('rejects duplicate dates', () => {
    const bad = clone(fall);
    bad.days[1].date = bad.days[0].date;
    expect(() => validateSemesterConfig(bad)).toThrow(/duplicate|out of order/);
  });

  it('rejects malformed period times', () => {
    const bad = clone(fall);
    bad.scheduleOfCalls.periods['3'] = { start: '25:00', end: '26:00' };
    expect(() => validateSemesterConfig(bad)).toThrow(/malformed time/);
  });

  it('rejects a missing period', () => {
    const bad = clone(fall);
    delete (bad.scheduleOfCalls.periods as Record<string, unknown>)['6'];
    expect(() => validateSemesterConfig(bad)).toThrow(/missing period 6/);
  });

  it('rejects a wrong timezone', () => {
    const bad = clone(fall);
    bad.timezone = 'America/New_York';
    expect(() => validateSemesterConfig(bad)).toThrow(/timezone/);
  });
});
