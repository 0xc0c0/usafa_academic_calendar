# USAFA Academic Calendar → .ics Generator

A free, public web app that lets USAFA cadets, faculty, and families build a
class schedule for a semester — by **M-day/T-day** and **class period** — and
download it as a standards-compliant `.ics` file for Google Calendar, Outlook,
or Apple Calendar.

USAFA doesn't schedule classes by weekday. It alternates **M-days** and
**T-days** in an irregular sequence (41 of each in Fall 2026 and Spring 2027),
so every class meeting is emitted as a **standalone event** — no recurrence
rules. Days marked *"Modified SoC — Afternoon Sections Start 1 Hr Early"* on
the official calendar automatically shift periods 5–6 one hour earlier.

**Unofficial tool** — not affiliated with or endorsed by USAFA. Always verify
against the [official academic calendar](https://www.usafa.edu/academics/academic-calendar/).

See [requirements.md](requirements.md) for the full specification.

## How it works

- `config/*.json` — one file per semester, extracted from the official Cadet
  Academic Calendar PDF (archived in `docs/source/`). Maps every calendar date
  to its class-day label (M1–M41 / T1–T41), Modified SoC flag, and notes, plus
  the Schedule of Calls period times.
- `src/lib/` — shared core: config validation, schedule expansion (entry →
  dated meetings, contiguous periods merged), RFC 5545 serializer with a
  correct `America/Denver` VTIMEZONE.
- `src/` — React SPA: shopping-cart UI, live preview, Cloudflare Turnstile.
- `functions/api/generate.ts` — Cloudflare Pages Function: verifies the
  Turnstile token, re-validates the cart server-side, returns the `.ics`.

## Development

```bash
npm install
npm run dev        # Vite dev server (UI only; /api/generate needs wrangler)
npm run preview    # full stack: build + wrangler pages dev (API + Turnstile test keys)
```

Local dev and CI use Cloudflare's [public Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
(always-pass). `.dev.vars` supplies the test secret to `wrangler pages dev`.

## Testing

```bash
npm run typecheck  # strict TypeScript
npm test           # 74 Vitest unit/integration tests
npm run test:e2e   # Playwright: real browser → cart → captcha → download → parse .ics
```

Coverage highlights:

- Config invariants against the real config files: 41 M-days + 41 T-days per
  semester, weekday-only dates, sequential labels, exact Modified SoC day sets,
  holidays/breaks/finals excluded, exact Schedule of Calls times.
- Merge logic: periods 3+4 → one 0930–1123 event; 4|5 never merge across
  lunch; 5+6 merge on regular (1330–1523) and modified (1230–1423) days.
- ICS round-trip through an independent parser (`node-ical`), including UTC
  instants on both sides of both DST transitions.
- API: captcha accept/reject, payload validation, missing-secret fail-safe.
- E2E: downloads the actual file in Chromium and asserts days/times make sense.

## Deploying (Cloudflare Pages, free)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to
   Git** → select this repo.
   - Build command: `npm run build` — Build output: `dist`
   - Functions in `functions/` deploy automatically.
2. **Turnstile** → Add widget for your domain → copy the site key + secret.
3. Pages project → **Settings → Environment variables** (Production):
   - `VITE_TURNSTILE_SITE_KEY` = site key (build-time)
   - `TURNSTILE_SECRET_KEY` = secret (runtime, encrypt)
4. Redeploy, then smoke-test: build a cart, download, import into a calendar.
5. Optional: attach a custom domain under **Custom domains**.

## Adding a future semester

1. Create `config/<semester-id>.json` following the schema in
   [requirements.md](requirements.md) (see existing files).
2. Import it in `src/lib/semesters.ts`.
3. Update the expected-values tests in `tests/config.test.ts`.
4. `npm test` — the validator and invariants will catch structural mistakes.
