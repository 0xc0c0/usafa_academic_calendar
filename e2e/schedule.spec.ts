import { expect, test, type Download, type Page } from '@playwright/test';
import ical from 'node-ical';

/** Parse a Playwright download as iCalendar VEVENTs via node-ical. */
async function parseDownload(download: Download) {
  const path = await download.path();
  const parsed = await ical.async.parseFile(path);
  return Object.values(parsed).filter((c) => c.type === 'VEVENT');
}

async function addEntry(
  page: Page,
  opts: {
    dayType: 'M' | 'T' | 'both';
    periods: number[];
    title?: string;
    location?: string;
    includeDayLabel?: boolean;
  },
) {
  await page.getByRole('radio', { name: opts.dayType === 'both' ? 'Both' : `${opts.dayType}-days` }).check();
  for (const p of opts.periods) {
    // Tiles read "M3 0930–1023" normally, "M3/T3 0930–1023" under Both.
    const tile = opts.dayType === 'both' ? `^M${p}/T${p} ` : `^${opts.dayType}${p} `;
    await page.getByRole('checkbox', { name: new RegExp(tile) }).check();
  }
  if (opts.title) await page.getByLabel(/Course name/).fill(opts.title);
  if (opts.location) await page.getByLabel(/Location/).fill(opts.location);
  if (opts.includeDayLabel) await page.getByRole('checkbox', { name: /Include the class day/ }).check();
  await page.getByRole('button', { name: 'Add to schedule' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('full user journey: multi-entry cart → captcha → download → the .ics days and times make sense', async ({
  page,
}) => {
  // Build a realistic three-course load in Fall 2026.
  await addEntry(page, { dayType: 'M', periods: [3, 4], title: 'Comp Sci 110', location: 'Fairchild 2G5' });
  await addEntry(page, { dayType: 'T', periods: [1] }); // no title → generic label
  await addEntry(page, { dayType: 'M', periods: [5, 6], title: 'Aero Lab', includeDayLabel: true });

  await expect(page.getByText('Comp Sci 110', { exact: true })).toBeVisible();
  await expect(page.getByText('Class — T-day Period 1', { exact: true })).toBeVisible();
  // 41 merged + 41 + 41 merged = 123 events, spanning the whole semester.
  await expect(page.getByText(/123 events from 2026-08-06 \(M1\) through 2026-12-10 \(T41\)/)).toBeVisible();

  // The Turnstile test site key auto-passes; wait for the token to enable downloads.
  const downloadButton = page.getByRole('button', { name: /Download usafa-fall-2026\.ics/ });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('usafa-fall-2026.ics');

  const events = await parseDownload(download);
  expect(events).toHaveLength(123);

  // Every event falls on a real Fall 2026 class day; none on holidays/breaks.
  const dates = events.map((e) => e.start.toISOString().slice(0, 10));
  // Earliest event in this cart: M1 (2026-08-06) periods 3-4 at 0930 MDT.
  expect(Math.min(...events.map((e) => e.start.getTime()))).toBe(Date.UTC(2026, 7, 6, 15, 30));
  for (const noClass of ['2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-14']) {
    expect(dates).not.toContain(noClass);
  }

  // Canonical example: on M35 (2026-11-17, MST) Comp Sci 110 meets 0930-1123 (merged
  // periods 3-4); the calendar event spans full hours, so it ends at 1130.
  const compSci = events.filter((e) => e.summary === 'Comp Sci 110');
  expect(compSci).toHaveLength(41);
  const m35 = compSci.find((e) => e.start.toISOString().startsWith('2026-11-17'))!;
  expect(m35.start.toISOString()).toBe('2026-11-17T16:30:00.000Z');
  expect(m35.end.toISOString()).toBe('2026-11-17T18:30:00.000Z');
  expect(m35.location).toBe('Fairchild 2G5');

  // Modified SoC: on M4 (2026-08-14, MDT) Aero Lab (periods 5-6) starts at 1230 instead of 1330.
  // Aero Lab was added with "include class day in titles", so each summary carries its day label.
  const aeroLab = events.filter((e) => e.summary.startsWith('Aero Lab'));
  expect(aeroLab).toHaveLength(41);
  const m4 = aeroLab.find((e) => e.start.toISOString().startsWith('2026-08-14'))!;
  expect(m4.summary).toBe('Aero Lab - M4');
  expect(m4.start.toISOString()).toBe('2026-08-14T18:30:00.000Z'); // 1230 MDT
  expect(m4.description).toContain('Modified SoC');
  const m5day = aeroLab.find((e) => e.start.toISOString().startsWith('2026-08-18'))!;
  expect(m5day.summary).toBe('Aero Lab - M5');
  expect(m5day.start.toISOString()).toBe('2026-08-18T19:30:00.000Z'); // regular 1330 MDT
  // Comp Sci 110 left the option off, so its titles stay plain (asserted exact above).
});

test('spring semester carts download separately with correct dates', async ({ page }) => {
  await page.getByLabel('Semester').selectOption('spring-2027');
  await addEntry(page, { dayType: 'M', periods: [2], title: 'History 202' });

  const downloadButton = page.getByRole('button', { name: /Download usafa-spring-2027\.ics/ });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const events = await parseDownload(await downloadPromise);

  expect(events).toHaveLength(41);
  const first = events.reduce((a, b) => (a.start < b.start ? a : b));
  const last = events.reduce((a, b) => (a.start > b.start ? a : b));
  expect(first.start.toISOString()).toBe('2027-01-06T15:30:00.000Z'); // M1, 0830 MST
  expect(last.start.toISOString()).toBe('2027-05-13T14:30:00.000Z'); // M41, 0830 MDT
});

test('editing is non-destructive: entries survive reloads and switching edits', async ({ page }) => {
  await addEntry(page, { dayType: 'M', periods: [1], title: 'Course A' });
  await addEntry(page, { dayType: 'T', periods: [2], title: 'Course B' });

  // Start editing A: it must stay in the cart, so a reload loses nothing.
  await page.getByRole('listitem').filter({ hasText: 'Course A' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('editing…')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Course A', { exact: true })).toBeVisible();
  await expect(page.getByText('Course B', { exact: true })).toBeVisible();

  // Switching from editing A to editing B must not destroy A.
  await page.getByRole('listitem').filter({ hasText: 'Course A' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Course B' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('Course A', { exact: true })).toBeVisible();

  // Saving an edit updates in place instead of appending a duplicate.
  await page.getByLabel(/Course name/).fill('Course B renamed');
  await page.getByRole('button', { name: 'Save class' }).click();
  await expect(page.getByText('Course B renamed', { exact: true })).toBeVisible();
  // Scoped to the schedule card defensively: since v1.7.2 the import directions
  // are <details> disclosures (no listitems), but the undo-help dialog's steps
  // are lists and must never leak into this count if a future test opens it.
  await expect(page.getByLabel('Fall 2026 schedule').getByRole('listitem')).toHaveCount(2);
});

test('two-semester carts download sequentially without reusing a captcha token', async ({ page }) => {
  await addEntry(page, { dayType: 'M', periods: [3], title: 'Fall Course' });
  await page.getByLabel('Semester').selectOption('spring-2027');
  await addEntry(page, { dayType: 'T', periods: [2], title: 'Spring Course' });

  const fallButton = page.getByRole('button', { name: /Download usafa-fall-2026\.ics/ });
  const springButton = page.getByRole('button', { name: /Download usafa-spring-2027\.ics/ });
  await expect(fallButton).toBeEnabled({ timeout: 30_000 });

  const fallDownload = page.waitForEvent('download');
  await fallButton.click();
  expect((await fallDownload).suggestedFilename()).toBe('usafa-fall-2026.ics');

  // The widget resets after each download (tokens are single-use); the button
  // re-enables once a fresh token arrives, and the second download succeeds.
  await expect(springButton).toBeEnabled({ timeout: 30_000 });
  const springDownload = page.waitForEvent('download');
  await springButton.click();
  const events = await parseDownload(await springDownload);
  expect(events).toHaveLength(41);
});

test('cart persists across a page reload', async ({ page }) => {
  await addEntry(page, { dayType: 'M', periods: [1], title: 'Persistent 101' });
  await expect(page.getByText('Persistent 101', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Persistent 101', { exact: true })).toBeVisible();
});

test('server rejection surfaces a friendly error', async ({ page }) => {
  await addEntry(page, { dayType: 'M', periods: [1], title: 'Blocked 101' });
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Captcha verification failed. Please try again.' }),
    }),
  );
  const downloadButton = page.getByRole('button', { name: /Download usafa-fall-2026\.ics/ });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });
  await downloadButton.click();
  await expect(page.getByRole('alert')).toContainText('Captcha verification failed');
});

test('undo-import help dialog opens from both entry points and closes', async ({ page }) => {
  await page.getByRole('button', { name: /Imported the wrong thing/ }).click();
  const heading = page.getByRole('heading', { name: 'Imported the wrong thing? How to undo it' });
  await expect(heading).toBeVisible();
  // Classic Outlook mass-delete steps are expanded by default.
  await expect(page.getByText('View → Change View → List')).toBeVisible();
  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(heading).not.toBeVisible();

  // Also reachable from the link under each semester's download button.
  await addEntry(page, { dayType: 'M', periods: [1], title: 'CS210' });
  await page.getByRole('button', { name: 'see how to undo an import' }).click();
  await expect(heading).toBeVisible();
});

test('DF Time: one click adds every T-day 1230-1330, downloads correctly, cannot be added twice', async ({
  page,
}) => {
  const addButton = page.getByRole('button', { name: /Add DF Time \(Fall 2026\)/ });
  await addButton.click();
  await expect(page.getByLabel('Fall 2026 schedule').getByText('DF Time', { exact: true })).toBeVisible();
  await expect(page.getByText(/T-days, 1230–1330 — 41 class days · 41 calendar events/)).toBeVisible();
  // The button flips to a disabled "already added" state; no duplicates possible.
  await expect(page.getByRole('button', { name: /Added to Fall 2026/ })).toBeDisabled();
  // Nothing to configure, so DF Time entries have Remove but no Edit.
  const dfItem = page.getByRole('listitem').filter({ hasText: 'DF Time' });
  await expect(dfItem.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(dfItem.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  const downloadButton = page.getByRole('button', { name: /Download usafa-fall-2026\.ics/ });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const events = await parseDownload(await downloadPromise);

  expect(events).toHaveLength(41);
  expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['DF Time']));
  const t1 = events.find((e) => e.start.toISOString().startsWith('2026-08-07'))!; // T1, MDT
  expect(t1.start.toISOString()).toBe('2026-08-07T18:30:00.000Z'); // 1230 MDT
  expect(t1.end.toISOString()).toBe('2026-08-07T19:30:00.000Z'); // 1330 MDT
  const t35 = events.find((e) => e.start.toISOString().startsWith('2026-11-18'))!; // T35, MST
  expect(t35.start.toISOString()).toBe('2026-11-18T19:30:00.000Z'); // 1230 MST
});

test('Both + all six periods: one continuous block on every class day', async ({ page }) => {
  await addEntry(page, { dayType: 'both', periods: [1, 2, 3, 4, 5, 6], title: 'Cadet Day' });

  // 41 M-days + 41 T-days, one full-day block each (not lunch-split pairs).
  await expect(page.getByText(/M\/T-days, periods 1, 2, 3, 4, 5, 6 — 82 class days · 82 calendar events/)).toBeVisible();

  const downloadButton = page.getByRole('button', { name: /Download usafa-fall-2026\.ics/ });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const events = await parseDownload(await downloadPromise);

  expect(events).toHaveLength(82);
  expect(new Set(events.map((e) => e.start.toISOString().slice(0, 10))).size).toBe(82);
  expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['Cadet Day']));

  // M1 (2026-08-06, regular): 0730–1530 MDT, spanning lunch.
  const m1 = events.find((e) => e.start.toISOString().startsWith('2026-08-06'))!;
  expect(m1.start.toISOString()).toBe('2026-08-06T13:30:00.000Z');
  expect(m1.end.toISOString()).toBe('2026-08-06T21:30:00.000Z');

  // T1 (2026-08-07): T-days included too, same block.
  const t1 = events.find((e) => e.start.toISOString().startsWith('2026-08-07'))!;
  expect(t1.start.toISOString()).toBe('2026-08-07T13:30:00.000Z');
  expect(t1.end.toISOString()).toBe('2026-08-07T21:30:00.000Z');

  // M4 (2026-08-14, Modified SoC): afternoon shifts an hour early → 0730–1430 MDT.
  const m4 = events.find((e) => e.start.toISOString().startsWith('2026-08-14'))!;
  expect(m4.start.toISOString()).toBe('2026-08-14T13:30:00.000Z');
  expect(m4.end.toISOString()).toBe('2026-08-14T20:30:00.000Z');
});
