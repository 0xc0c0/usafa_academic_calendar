/**
 * Single source of truth for the app version shown in the site footer.
 * Discipline: EVERY deployed change bumps this (x.yy.zzz), keeps
 * package.json's "version" in sync, and adds a matching entry at the TOP of
 * CHANGELOG.md describing the change.
 */
export const APP_VERSION = '1.9.0';

export const CHANGELOG_URL =
  'https://github.com/0xc0c0/usafa_academic_calendar/blob/main/CHANGELOG.md';
