// Screenshot harness for visual design review: captures empty + populated
// states at desktop and mobile widths (light + dark), plus closeups of the
// build card and Periods strip. Start `npm run dev`, then:
//   node scripts/screenshot.mjs [outdir]   (default outdir: .design-shots/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.design-shots';
mkdirSync(out, { recursive: true });
const URL = 'http://localhost:5173/';

const CART = [
  { id: 'a', semesterId: 'fall-2026', dayType: 'M', periods: [3, 4], title: 'Comp Sci 110', location: 'Fairchild 2G5' },
  { id: 'b', semesterId: 'fall-2026', dayType: 'T', periods: [1], title: '', location: '' },
  { id: 'c', semesterId: 'fall-2026', dayType: 'M', periods: [5, 6], title: 'Aero Lab', location: '', includeDayLabel: true },
  { id: 'd', semesterId: 'fall-2026', dayType: 'T', periods: [], title: 'DF Time', location: '', kind: 'dfTime' },
  { id: 'e', semesterId: 'spring-2027', dayType: 'M', periods: [2], title: 'History 202', location: '' },
];

const browser = await chromium.launch();

async function shot(name, { width, height, seed, closeup, selectPeriods, dark, viewportOnly }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  if (seed) {
    await page.evaluate((cart) => localStorage.setItem('usafa-cal-cart-v1', JSON.stringify(cart)), CART);
    await page.reload();
  } else {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  if (selectPeriods) {
    for (const p of selectPeriods) {
      await page.getByRole('checkbox', { name: new RegExp(`^M${p} `) }).check();
    }
    await page.getByLabel(/Course name/).fill('Comp Sci 110');
    await page.getByLabel(/Location/).fill('Fairchild 2G5');
  }
  await page.waitForTimeout(600);
  if (closeup) {
    await page.locator(closeup).screenshot({ path: `${out}/${name}.png` });
  } else {
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: !viewportOnly });
  }
  await ctx.close();
}

await shot('desktop-empty', { width: 1440, height: 900 });
await shot('desktop-populated', { width: 1440, height: 900, seed: true });
await shot('periods-closeup', { width: 1440, height: 900, selectPeriods: [3, 4], closeup: 'fieldset.periods' });
await shot('buildcard-closeup', { width: 1440, height: 900, selectPeriods: [3, 4], closeup: 'section[aria-label="Build a class"]' });
await shot('mobile-populated', { width: 390, height: 844, seed: true });
await shot('desktop-viewport', { width: 1440, height: 900, seed: true, viewportOnly: true });
await shot('desktop-dark', { width: 1440, height: 900, seed: true, dark: true });
await browser.close();
console.log('done ->', out);
