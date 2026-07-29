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
  opts: { dayType: 'M' | 'T'; periods: number[]; title?: string; location?: string },
) {
  await page.getByRole('radio', { name: `${opts.dayType}-days` }).check();
  for (const p of opts.periods) {
    await page.getByRole('checkbox', { name: new RegExp(`^${opts.dayType}${p} `) }).check();
  }
  if (opts.title) await page.getByLabel(/Course name/).fill(opts.title);
  if (opts.location) await page.getByLabel(/Location/).fill(opts.location);
  await page.getByRole('button', { name: 'Add to cart' }).click();
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
  await addEntry(page, { dayType: 'M', periods: [5, 6], title: 'Aero Lab' });

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

  // Canonical example: on M35 (2026-11-17, MST) Comp Sci 110 runs 0930-1123 (merged periods 3-4).
  const compSci = events.filter((e) => e.summary === 'Comp Sci 110');
  expect(compSci).toHaveLength(41);
  const m35 = compSci.find((e) => e.start.toISOString().startsWith('2026-11-17'))!;
  expect(m35.start.toISOString()).toBe('2026-11-17T16:30:00.000Z');
  expect(m35.end.toISOString()).toBe('2026-11-17T18:23:00.000Z');
  expect(m35.location).toBe('Fairchild 2G5');

  // Modified SoC: on M4 (2026-08-14, MDT) Aero Lab (periods 5-6) starts at 1230 instead of 1330.
  const aeroLab = events.filter((e) => e.summary === 'Aero Lab');
  expect(aeroLab).toHaveLength(41);
  const m4 = aeroLab.find((e) => e.start.toISOString().startsWith('2026-08-14'))!;
  expect(m4.start.toISOString()).toBe('2026-08-14T18:30:00.000Z'); // 1230 MDT
  expect(m4.description).toContain('Modified SoC');
  const m5day = aeroLab.find((e) => e.start.toISOString().startsWith('2026-08-18'))!;
  expect(m5day.start.toISOString()).toBe('2026-08-18T19:30:00.000Z'); // regular 1330 MDT
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
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('Course B renamed', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(2);
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
