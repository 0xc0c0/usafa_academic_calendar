# USAFA Academic Calendar → .ics Generator — Requirements

**Status:** Live in production — https://usafa-calendar.benslab.dev · **Last updated:** 2026-07-31
**Product owner:** bnheruska@gmail.com
**Versioning:** every deployed change bumps the version (x.yy.zzz) shown in the site
footer and gets an entry in [`CHANGELOG.md`](CHANGELOG.md) (newest first).

## 1. Overview

A free, public, unauthenticated web application that lets visitors (cadets, faculty,
families) build a personal class schedule for a U.S. Air Force Academy semester and
download it as a standards-compliant `.ics` (iCalendar) file they can import into
Google Calendar, Outlook, Apple Calendar, etc.

USAFA does not schedule classes by weekday (MWF/TR). It uses **alternating class
days**: *M-days* and *T-days* (an A/B-day system). A course meets on all M-days or
all T-days at one or more numbered periods. Because the M/T sequence is irregular
(interrupted by holidays, training days, and breaks), **every class meeting is
emitted as a standalone VEVENT — recurrence rules (RRULE) are never used.**

## 2. Source data (authoritative)

| Document | URL | Local copy |
|---|---|---|
| Cadet Academic Calendar AY 2026–2027 (Approved 7 Jan 2026) | https://www.usafa.edu/app/uploads/AY_2026_2027_Calendar.pdf | `docs/source/AY_2026_2027_Calendar.pdf` |
| USAFA Schedule of Calls 2026–2027 AY (Approved 27 Feb 2026) | https://www.usafa.edu/app/uploads/26_27_Schedule_of_Calls.pdf | `docs/source/26_27_Schedule_of_Calls.pdf` |

Calendar index page: https://www.usafa.edu/academics/academic-calendar/

"AY26-27" = the academic year spanning 2026 and 2027 = **Fall 2026** + **Spring 2027**
semesters. Those two semesters are the launch content. The system must make adding a
future semester a pure configuration change (drop in a new config file; no code changes).

## 3. Domain model

### 3.1 Class days (M-days and T-days)

- Each semester has a sequence of class days, each labeled `M<n>` or `T<n>`.
- **Fall 2026 has exactly 41 M-days (M1–M41) and 41 T-days (T1–T41).**
- **Spring 2027 also has exactly 41 M-days (M1–M41) and 41 T-days (T1–T41).**
- Class days fall only on weekdays (Mon–Fri), but the M/T alternation is independent
  of weekday and is interrupted by holidays/training days, so the mapping
  *calendar date → day label* is irregular and must come from configuration.

### 3.2 Periods (time blocks)

Naming caution: period labels reuse the day-label alphabet. "M3" means *3rd period
on any M-day* in period context, and *the 3rd M-day of the semester* in day context.
Example from the product owner: **on day M35, period M3 runs 0930–1023.** The UI and
config schema must keep these namespaces separate and unambiguous.

**Regular Schedule of Calls** (identical Mon–Fri, identical for M- and T-days), from
the official 26–27 Schedule of Calls:

| Period | Start | End |
|---|---|---|
| 1 | 07:30 | 08:23 |
| 2 | 08:30 | 09:23 |
| 3 | 09:30 | 10:23 |
| 4 | 10:30 | 11:23 |
| — Noon Meal Formation / Lunch | 11:30 | 12:23 |
| — CW Time (M-days) / DF Time (T-days) | 12:30 | 13:23 |
| 5 | 13:30 | 14:23 |
| 6 | 14:30 | 15:23 |

**DF Time** (added 2026-07-30, v1.5.0): the 12:30–13:23 block is schedulable as a
one-click fixed entry. Per the SoC notes it is the Dean's block for extra
instruction, academic advising, majors' meetings, and Dean's calls — **T-days
only**. Config carries it as `scheduleOfCalls.dfTime` with the official times.

**CW Time** (added 2026-08-02, v1.9.0): the Cadet Wing's counterpart block on
M-days, same official slot, one-click via the Calendar Add-ons section. **No CW
Time on Modified SoC days** (owner ruling 2026-08-02): the shifted periods 5–6
occupy the 1230–1330 slot there, so Fall 2026 has 35 CW events and Spring 2027
has 36. The same guard applies to DF Time for symmetry (a no-op in AY26-27,
which has no modified T-days). Config carries `scheduleOfCalls.cwTime`.

**Full-hour events** (owner decision 2026-07-30, v1.5.0): generated calendar
*events* end 60 minutes after their start (period 3 event = 09:30–10:30; merged
3+4 = 09:30–11:30; DF Time = 12:30–13:30) rather than at the official :23
dismissal, so they line up with surrounding meeting invites. The tables above and
the config files keep the official Schedule of Calls times as ground truth; the
rounding is applied only at event generation (`fullHourEnd()`), and the
contiguous-period merge rule still evaluates official times.

### 3.3 Modified Schedule of Calls ("Modified SoC")

Some class days are marked on the academic calendar as **"Modified SoC — Afternoon
Sections Start 1 Hr Early."** On those days only, the afternoon periods shift one
hour earlier; morning periods are unchanged:

| Period | Start | End |
|---|---|---|
| 5 | 12:30 | 13:23 |
| 6 | 13:30 | 14:23 |

Which specific days are modified comes solely from the semester configuration
(extracted from the calendar PDF). In AY26-27 all Modified SoC days happen to be
M-days, but the schema must allow any day to carry the flag.

### 3.4 Timezone

All times are local to USAFA: **America/Denver**. Fall 2026 crosses the DST-end
transition (2026-11-01) and Spring 2027 crosses DST-start (2027-03-14); events must
carry `TZID=America/Denver` with a correct `VTIMEZONE` definition so imported events
stay at the right wall-clock time on both sides of each transition.

## 4. Semester configuration files

One JSON file per semester in `config/`. Launch files:

- `config/fall-2026.json` — Fall 2026 (M1–M41, T1–T41; first class day 2026-08-06)
- `config/spring-2027.json` — Spring 2027 (M1–M41, T1–T41; first class day 2027-01-06)

### 4.1 Schema (enforced by a validator + tests)

```jsonc
{
  "id": "fall-2026",              // slug, unique
  "name": "Fall 2026",            // display name
  "academicYear": "AY26-27",
  "timezone": "America/Denver",
  "source": {                      // provenance
    "document": "AY 2026-2027 Cadet Academic Calendar",
    "approved": "2026-01-07",
    "url": "https://www.usafa.edu/app/uploads/AY_2026_2027_Calendar.pdf"
  },
  "scheduleOfCalls": {             // regular period times, 24h local
    "periods": {
      "1": { "start": "07:30", "end": "08:23" },
      // ... periods 2–6
    },
    "modified": {                  // overrides applied on modifiedSoC days
      "5": { "start": "12:30", "end": "13:23" },
      "6": { "start": "13:30", "end": "14:23" }
    },
    "dfTime": { "start": "12:30", "end": "13:23" },  // Dean's block, T-days only
    "cwTime": { "start": "12:30", "end": "13:23" }   // Cadet Wing block, M-days (never on Modified SoC days)
  },
  "days": [                        // every class day, chronological
    {
      "date": "2026-08-06",        // ISO local date
      "dayType": "M",              // "M" | "T"
      "index": 1,                  // 1-based; label = dayType + index, e.g. "M1"
      "modifiedSoC": false,
      "note": "First day of class" // optional, informational only
    }
    // ...
  ]
}
```

### 4.2 Config invariants (all must be covered by automated tests)

1. Fall 2026: exactly 41 `M` days and 41 `T` days; Spring 2027: exactly 41 and 41.
2. Day indexes per type are 1..N, strictly increasing with date, no gaps/duplicates.
3. Every `date` parses, is unique, falls Mon–Fri, and lies within the semester span.
4. Every `modifiedSoC: true` day matches the "Modified SoC" markings on the PDF.
   AY26-27 expected sets —
   Fall 2026: **M4 (Aug 14), M9 (Aug 28), M13 (Sep 10), M15 (Sep 17), M20 (Oct 2), M34 (Nov 13)**.
   Spring 2027: **M2 (Jan 8), M23 (Mar 12), M30 (Apr 8), M34 (Apr 21), M39 (May 7)**.
5. Known no-class dates (holidays, training days, breaks) appear in **no** `days` entry:
   e.g. Fall: Sep 7 (Labor Day), Sep 11 (Commandant's Training Day), Sep 18 (Fall
   VALEX), Oct 12 (Columbus Day), Nov 11 (Veterans Day), Nov 25–30 (Thanksgiving),
   Dec 11+ (Study Day/Finals). Spring: Jan 18 (MLK), Feb 15 (Presidents' Day),
   Feb 19 (NCLS), Apr 9 (Commandant's Training Day), Apr 22–23 (Crucible),
   Mar 20–28 (Spring Break), May 15+ (Finals).
6. Period times: regular and modified sets exactly match §3.2 / §3.3.

## 5. Functional requirements

### FR-1 Selection (schedule builder)

*Wording note (v1.1.0): the interaction works like a shopping cart, but all
user-facing copy frames it as crafting a schedule — "Add to schedule", "Your
schedule", "Build a class" — never cart/shopping language.*
1. Visitor picks a **semester** (Fall 2026 / Spring 2027 at launch; list driven by
   discovered config files).
2. Visitor composes a **schedule entry**: day type (M-days, T-days, or — v1.8.0 —
   **Both**, meaning every class day: all 41 M-days + all 41 T-days) + one or
   more **periods** (1–6, multi-select; tiles read "M3/T3" while Both is
   selected).
3. Each entry has optional free-text **Title** (course name, e.g. "Comp Sci 110")
   and **Location** (e.g. "Fairchild 2G5"). Blank title falls back to a generic
   label of the form `Class — <dayType> Period(s) <list>` (`M/T-day` for Both
   entries).
   - **Per-entry day-label option** (v1.3.0): a checkbox appends each event's own
     class-day label to its title, e.g. "CS210 - M35" on day M35. Off by default;
     the server coerces the untrusted flag to a strict boolean.
   - **Calendar Add-ons** (v1.9.0; grew out of the v1.5.0 DF Time card): a
     section with its own semester picker and four one-click fixed entries —
     DF Time (T-days), CW Time (M-days, skips Modified SoC days), and All-Day
     M-Day / T-Day marker events (untimed, titled by day label, shown as
     Free). Nothing to configure, no Edit button, none can be added twice per
     semester. The add-ons' semester is independent of the class builder's.
4. Entries accumulate in a **cart**: add, edit, remove, clear. Multiple entries are
   allowed (a full course load), including entries on both day types and entries
   with multiple periods. Cart persists across page reloads (localStorage).
5. Cart may mix entries only within one semester per generated file (one .ics per
   semester; if both semesters are carted, UI generates one file per semester or
   prompts the user — implementer's choice, must be tested).
6. Selecting from the cart shows a live **preview**: number of events, first/last
   dates, and per-entry meeting times including Modified SoC exceptions.

### FR-2 Event generation
1. For each cart entry, emit **one standalone VEVENT per class day** of the matching
   day type. No RRULEs, no EXDATEs.
2. **Contiguous-period merge:** consecutive selected period numbers whose official
   time gap is only the passing period (≤ 10 minutes) merge into one event.
   Periods 4+5 never merge (lunch gap). Non-contiguous selections (e.g. 1 and 4)
   emit separate events per day.
   **All-six exception** (v1.8.0, owner decision 2026-07-31): selecting all six
   periods yields **one continuous event per class day** — period 1's start to
   period 6's start + 60 min (0730–1530 regular, 0730–1430 Modified SoC) —
   deliberately spanning lunch and CW/DF Time instead of two lunch-split blocks.
3. On `modifiedSoC` days, periods 5/6 use the modified times, including the merge
   rule.
   *Event end times for 2 and 3 follow the full-hour rule (§3.2): merged 3+4 event
   is 09:30–11:30; modified 5+6 event is 12:30–14:30.*
4. Event fields:
   - `SUMMARY`: user title (or generic fallback).
   - `LOCATION`: user location if given.
   - `DESCRIPTION`: day label (e.g. "Class day M35"), period list, and a Modified
     SoC note when applicable.
   - `DTSTART`/`DTEND` with `TZID=America/Denver`; file contains a valid `VTIMEZONE`.
     All-day marker events (v1.9.0) instead use `DTSTART;VALUE=DATE` with an
     exclusive next-day `DTEND`, plus `TRANSP:TRANSPARENT` and
     `X-MICROSOFT-CDO-BUSYSTATUS:FREE` so they never block time.
   - `UID`: deterministic (stable hash of semester + date + day label + period set +
     title), so re-importing an identical file updates rather than duplicates.
     Byte-identical meetings from overlapping entries (e.g. an M-days class
     shadowed by a same-titled Both class) are de-duplicated before
     serialization so UIDs stay unique within a file (v1.8.0).
   - `DTSTAMP`, `PRODID`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, and
     `X-WR-CALNAME` (e.g. "USAFA Fall 2026").
5. Output conforms to RFC 5545: CRLF line endings, 75-octet line folding, correct
   text escaping (commas, semicolons, newlines, backslashes).
6. Filename: `usafa-<semester-id>.ics` (e.g. `usafa-fall-2026.ics`).

### FR-3 Bot protection (captcha)
1. **Cloudflare Turnstile** (free) gates .ics generation.
2. The .ics is generated **server-side** in a Cloudflare Pages Function:
   `POST /api/generate` with `{ semesterId, entries[], turnstileToken }`.
3. The Function verifies the token against Turnstile `siteverify` before generating;
   invalid/missing token → HTTP 403 with a friendly JSON error the UI surfaces.
4. Site key/secret come from environment (`TURNSTILE_SITE_KEY` exposed to client,
   `TURNSTILE_SECRET_KEY` server-only). Local dev and CI use Cloudflare's published
   always-pass test keypair.
5. The server re-validates the cart payload against the semester config (unknown
   semester, bad periods, oversized titles → HTTP 400) and caps a generated file
   at 2,000 events (`MAX_EVENTS`, v1.8.0). Never trust client input.

### FR-4 Public, unauthenticated, private-by-design
- No accounts, no login, no cookies beyond what Turnstile requires, no analytics
  that collect PII, no storage of user schedules server-side. Titles/locations
  exist only in the request and the returned file.

### FR-5 User guidance (added post-launch)

1. **Import directions** (v1.2.0): a visible section walks through importing the
   .ics into each major calendar app, with Microsoft Outlook listed first and an
   explicit recommendation to use the **Import** option (not "Open as New") in
   classic Outlook. Since v1.7.2 the per-app steps are collapsible disclosures
   in the right rail beneath "Your schedule" and the bot check.
2. **Undo-an-import helper** (v1.4.0): a modal dialog, reachable from a callout in
   the import section and a link under every download button, gives per-app
   mass-delete directions for recovering from a wrong import, and teaches the
   import-into-its-own-calendar habit. Text-only by design (owner decision
   2026-07-31: embedded Outlook screenshots aren't needed).
3. **Versioning** (v1.6.0): the footer shows the app version, linked to
   `CHANGELOG.md`; every deployed change bumps it.
4. **Layout** (v1.7.0, refined v1.7.2): on wide screens (≥1100px) the page is
   two columns — "Build a class" and "Calendar Add-ons" (named "Add DF Time
   (optional)" before v1.9.0) in the main column; the sticky right rail
   (e-commerce-cart style) holds "Your schedule" with the bot check and import
   directions beneath it as subdued support blocks. Narrow screens stack one
   column in task order: build → add-ons → schedule → bot check → import.
   Section headings are unnumbered (the 1.6.0 step numbers were dropped).

## 6. Non-functional requirements

- **Hosting:** Cloudflare Pages + Pages Functions, free tier. Auto-deploy from the
  GitHub repo `main` branch. Custom domain optional later.
- **Cost:** $0 at launch (Pages, Functions, Turnstile all free tier).
- **Performance:** static assets CDN-served; generation < 1 s for a full cart.
- **Responsive:** usable on phones (cadets will use phones).
- **Accessibility:** semantic HTML, keyboard operability, labels on all controls.
- **Browser support:** current Chrome/Edge/Firefox/Safari.
- **Maintainability:** new semester = new config JSON only. Config schema validated
  at build/test time so a bad file fails CI, not production.

## 7. Architecture

- **Frontend:** Vite + React + TypeScript single-page app. Reads semester configs
  bundled at build time; renders selection UI, cart, preview, Turnstile widget.
- **Shared core (`src/lib/`):** config types + validator, schedule expansion
  (entry → dated meetings with Modified SoC applied), merge logic, and the RFC 5545
  serializer. Imported by both the SPA (preview) and the Pages Function
  (authoritative generation) so preview and download can never drift.
- **API (`functions/api/generate.ts`):** Cloudflare Pages Function — Turnstile
  verification, payload validation, .ics generation, returns
  `text/calendar` with `Content-Disposition: attachment`.

## 8. Testing requirements ("ample testing")

1. **Config validation tests** — every invariant in §4.2, run against both real
   config files (not fixtures), including the 41/41 day-count checks and the exact
   Modified SoC day sets.
2. **Unit tests (Vitest)** — period math, merge rule (contiguous, non-contiguous,
   across lunch, modified-day variants), text escaping, line folding, UID
   determinism, generic-title fallback.
3. **ICS round-trip tests** — parse generated output with an independent iCalendar
   parser (`node-ical`); assert event counts (e.g. one entry on M-days ⇒ exactly 41
   VEVENTs in Fall 2026), spot-check known dates/times (e.g. day M35 = 2026-11-17,
   period 3 ⇒ 09:30–10:23 local), and verify UTC instants across both DST
   transitions honor the VTIMEZONE.
4. **API tests** — Function handler: token accept/reject paths (Turnstile test
   keys), payload validation errors, response headers/filename.
5. **End-to-end tests (Playwright)** — real browser: pick semester → build a
   multi-entry, multi-period cart → pass Turnstile (test key) → **download the
   .ics → parse the downloaded file → assert the days and times make sense**
   (counts, first/last dates, modified-day times, merged blocks).
6. **Visual validation deliverable** — a generated HTML report that plots every
   emitted event onto month-grid calendars side-by-side-comparable with the
   official PDF, highlighting Modified SoC days, so a human can eyeball-verify the
   whole semester at a glance.
7. CI: all of the above runs on every push (GitHub Actions).

## 9. Deployment (as built — live since 2026-07-30)

- **Live URLs:** https://usafa-calendar.benslab.dev (custom domain; the requested
  `usafa_calendar` spelling was impossible — underscores are invalid in TLS
  hostnames) and https://usafa-academic-calendar.pages.dev.
- **Pipeline:** `bash scripts/deploy.sh` — idempotent, direct-upload via wrangler.
  Verifies the API token, creates/reuses the Turnstile widget and Pages project,
  stores `TURNSTILE_SECRET_KEY` as a Pages secret, builds with
  `VITE_TURNSTILE_SITE_KEY` baked in, deploys `dist/` + `functions/`, attaches the
  custom domain + proxied CNAME, then runs a purge-and-verify loop on the
  deploy's asset URLs (purge the edge cache, wait, compare a served asset's byte
  size against the local build; repeat up to 6 times — v1.7.1/`24370ae`) so a
  stale or fallback-poisoned edge cache shows up loudly in the deploy output
  instead of silently serving the old bundle.
- **Credentials:** gitignored `cloudflare.txt` holds two account-owned tokens
  (`cfat_` prefix; verify via `/accounts/{id}/tokens/verify`): `api_token_2` =
  Pages + Turnstile Edit, `api_token` = Zone DNS Edit + cache purge. **Both expire
  2026-08-29** — rotate before then.
- **Not set up:** GitHub push-to-deploy (requires one-time dashboard OAuth);
  redeploys run the script instead.

## 10. Explicitly out of scope (v1)

- Finals blocks 1–12, PHY ED blocks, milestone/holiday events (product decision
  2026-07-29: class periods only).
- Delayed-Start Schedule of Calls (weather-driven, not schedulable in advance).
- Recurring events, accounts, saved schedules, calendar subscription feeds (webcal),
  Summer academic periods, Prep School calendars.

## 11. Open questions — all resolved at go-live (2026-07-30)

1. Cloudflare account + custom domain: yes — `benslab.dev` zone; app lives at
   `usafa-calendar.benslab.dev`.
2. Deploy source of record: `0xc0c0/usafa_academic_calendar` (deploys are
   currently direct-upload from a checkout of `main`, not GitHub-triggered).
3. Branding: default "unofficial — verify against the official USAFA calendar"
   disclaimer stands.

No outstanding items. (The formerly-outstanding Outlook screenshots for the
undo-import helper were dropped by owner decision 2026-07-31 — see FR-5.2.)
