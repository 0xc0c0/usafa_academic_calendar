# Change Log

The version shown in the site footer links here; every deployed change bumps the
version (`x.yy.zzz`) and adds an entry at the **top** of this file. History begins
at the first Cloudflare Pages deployment. Commit hashes refer to
[this repository](https://github.com/0xc0c0/usafa_academic_calendar).

---

## 1.10.0 — 2026-08-02

- **The page is prerendered to static HTML at build time** (SEO tier 2):
  crawlers and AI assistants that don't execute JavaScript now see the full
  ~1,100 words of real content instead of six. React hydrates the prerendered
  markup; saved schedules now load in an effect right after mount (needed for
  clean hydration — no behavior change).
- **New FAQ section** — "M-days, T-days, and how this works": what M/T-days
  are, class period times, Modified SoC days, per-app import steps, DF/CW
  Time, and the unofficial-tool disclaimer, with matching FAQPage structured
  data. Also added: WebApplication schema, Open Graph/Twitter tags, a
  favicon, and a social-preview image.
- **Title and intro retuned** around the vocabulary people actually search:
  "schedule builder", the calendar platforms, and "AY 2026-2027".
- **DF Time and CW Time now import as Free**, like the all-day markers —
  visible on your calendar but never blocking time, so booking tools such as
  Microsoft Bookings keep those slots available. Classes still import as
  Busy. Add-on notes, rail meta lines, and the FAQ say so.

## 1.9.2 — 2026-08-02

- Fixed the Google Search Console verification file returning an empty 308:
  Cloudflare Pages' pretty-URL normalization redirects `*.html` assets to
  their extensionless path, but Google's verifier requires HTTP 200 at the
  exact `.html` URL. A `_redirects` 200 rewrite now serves the token there.
  Infrastructure only.

## 1.9.1 — 2026-08-02

- **Search-engine groundwork (Tier 1)**: real `robots.txt` and single-URL
  `sitemap.xml` (both previously returned the SPA HTML fallback with a
  misleading 200), `rel=canonical` on the custom domain, a host-based 301
  in `_redirects` consolidating the `usafa-academic-calendar.pages.dev`
  mirror onto usafa-calendar.benslab.dev (with an `X-Robots-Tag: noindex`
  `_headers` fallback), and the owner's Google Search Console HTML
  verification file. Infrastructure only; no user-facing change.

## 1.9.0 — 2026-08-02

- **"Add DF Time" grew into a "Calendar Add-ons" section** with four one-click
  extras and its own semester picker (the add-ons no longer follow the class
  builder's semester):
  - **DF Time** — unchanged: every T-day, 1230–1330.
  - **CW Time** (new) — the Cadet Wing's matching M-day block, 1230–1330,
    **except Modified SoC days** where the shifted periods 5–6 occupy that
    slot (35 events in Fall 2026, 36 in Spring 2027). DF Time carries the
    same guard for symmetry; it changes nothing in AY26-27, which has no
    modified T-days.
  - **All-Day M-Day / T-Day Events** (new) — an untimed banner event on each
    class day, titled by its day label ("M12"), **marked Free** (both
    `TRANSP:TRANSPARENT` and Outlook's `X-MICROSOFT-CDO-BUSYSTATUS:FREE`) so
    it never blocks time — a glance at the calendar shows which class day it
    is. Modified SoC days keep their marker, with a note in the description.
- Semester configs now carry `scheduleOfCalls.cwTime` (official 1230–1323)
  as ground truth, schema-validated like `dfTime`.

## 1.8.0 — 2026-07-31

- **New "Both" option under "Class meets on"**: a class can now meet on every
  class day — all 41 M-days and all 41 T-days, 82 events per period. Period
  tiles read M1/T1 … M6/T6 while Both is selected, untitled classes fall back
  to "Class — M/T-day Period N", and Modified SoC shifts still apply on the
  affected days.
- **All six periods = one full-day block**: selecting every period now makes
  one continuous event per class day — 0730–1530 on regular days, 0730–1430
  on Modified SoC days — spanning lunch and CW/DF Time, instead of two
  lunch-split blocks (M1–M4 and M5–M6). Any smaller selection still follows
  the usual merge rule.
- The two compose: Both + all six periods = 82 full-day blocks per semester.
- **Robustness fixes from the adversarial review**: saved carts are now fully
  normalized at load (junk period values, missing/duplicate ids, non-boolean
  flags — a corrupt cart used to white-screen the app); byte-identical events
  from overlapping entries (an M-days class shadowed by a same-titled "Both"
  class) are de-duplicated so .ics UIDs stay unique and calendar imports match
  the promised event count; the server now caps a file at 2,000 events; the
  intro sentence mentions the third day-type option.

## 1.7.2 — 2026-07-31

- **Import directions moved into the schedule rail**: instead of a full-width
  card at the bottom of the builder column, the per-app steps (Outlook /
  Google / Apple) now sit under "Your schedule" and the bot check as quiet
  reference — each app a collapsible disclosure, closed by default.
- **Bot check subdued to match**: both rail support blocks get smaller muted
  headings and tighter padding, so the schedule itself stays the rail's
  headline content. The "Imported the wrong thing?" callout stays, restyled
  quieter.
- Phones keep the same order (build → DF Time → schedule → bot check →
  import) and full-size card styling — the subdued treatment is rail-only,
  since in the single-column flow the bot check is a required step; the
  collapsible import steps apply everywhere. The CSS re-ordering rules
  became redundant — the DOM now reads in task order everywhere — and were
  removed.

## 1.7.1 — 2026-07-31

- Deploy pipeline hardening: after deploying, the script now purges the
  edge cache and polls an asset until the edge provably serves this deploy's
  bytes, re-purging on each mismatch (up to 6 attempts) — a request landing
  in the propagation window could re-poison a fresh asset URL with the SPA
  fallback *after* a one-shot purge (observed twice in production).
  Infrastructure only; no user-facing change.

## 1.7.0 — 2026-07-31

- **Two-column layout on wide screens**: the class builder, DF Time, and
  import directions sit on the left; **"Your schedule" is now a sticky right
  rail** with the bot check, so the schedule stays in view while you build.
  Mobile keeps a single column in task order (build → schedule → bot check →
  import). Step numbers dropped from headings — the sequence no longer reads
  top-to-bottom on desktop.
- **Periods strip redesigned**: all six periods on one row (three per row on
  phones — no more 5+1 orphan), centered name/time tiles, a proper circular
  check indicator instead of a floating native checkbox, single-ring selected
  state, and a tightened explainer note.
- **Cleanliness pass from a three-lens design review** (hierarchy, mobile +
  dark parity, first-visit UX): "Class meets on" radios now sit in a row under
  their label (a CSS specificity bug stacked the dots on top of the text),
  "(optional)" stays inline with field labels, schedule-entry meta lines span
  the full card width instead of wrapping in a squeezed column, Edit/Remove
  are quiet until hovered with larger touch targets, disabled buttons use
  explicit readable colors instead of 50% opacity (the .ics filename was
  ~2:1 contrast), the bot check card explains itself and never renders as an
  empty box, the empty schedule state is carded, the rail's inner scrollbar
  is always visible, and arrow/label orphan-wrapping is fixed.
- Nested fieldset borders removed — the card is the frame.
- New `scripts/screenshot.mjs`: Playwright harness that captures the states
  used for this visual review (light/dark, desktop/mobile, closeups).

## 1.6.0 — 2026-07-30

- **Version number now visible in the site footer**, linking to this change log.
- **"Add DF Time" moved to its own step** ("2. Add DF Time (optional)") above
  "Your schedule" — it previously sat awkwardly inside the schedule section next
  to the empty state. Later sections renumbered (Your schedule 3, bot check 4,
  import directions 5).
- `requirements.md` brought up to date with everything shipped since approval:
  DF Time, full-hour events, the day-label option, wording, guidance features,
  and the as-built deployment record.

## 1.5.1 — 2026-07-30 · `10dbfd2`

- Fixed the visual validation report's four spot checks that still expected the
  official `:23` end times after the full-hour change (report is 19/19 again).
  Internal tooling only; no user-facing change.

## 1.5.0 — 2026-07-30 · `1ae3e65`

- **DF Time**: one-click entry adding the Dean's extra-instruction/advising block
  (official SoC 1230–1323, T-days only) to your schedule — 41 events per
  semester, nothing to configure, can't be added twice. Verified against the
  official AY26-27 Schedule of Calls; both semester configs now carry the block.
- **Full-hour events**: calendar events now end 60 minutes after their start
  (period 3 → 0930–1030, merged 3+4 → 0930–1130, modified 5+6 → 1230–1430,
  DF Time → 1230–1330) instead of the official `:23` dismissal, so they line up
  with surrounding meeting invites. Configs keep the official times as ground
  truth; period-merge logic is unchanged.

## 1.4.0 — 2026-07-30 · `e9bbc61`

- **"Undo an import" help dialog**: per-app directions for mass-deleting a bad
  import (Outlook classic List-view technique, new Outlook/web, Google Calendar,
  Apple Calendar), leading with the import-into-its-own-calendar habit that makes
  any mistake a ten-second fix. Reachable from a callout in the import-directions
  card and a link under every download button.

## 1.3.1 — 2026-07-30 · `6aeb3c5`

- Deploy pipeline now purges each deploy's exact asset URLs from the Cloudflare
  edge cache — a brand-new bundle URL requested during the propagation window
  could get the SPA fallback cached over it, breaking the site on the custom
  domain until manual purge. Infrastructure only.

## 1.3.0 — 2026-07-30 · `d05305e`

- **Per-class "include the class day in event titles" option**: a checkbox with a
  live example (e.g. "CS210 - M35") appends each event's own day label to its
  title. Off by default, per class, preserved through edits; server validates the
  flag strictly.

## 1.2.0 — 2026-07-30 · `ea020fe`

- **Calendar import directions** section, with Microsoft Outlook listed first and
  an explicit recommendation to use the **Import** option (not "Open as New") in
  classic Outlook, plus new Outlook/web, Google Calendar, and Apple Calendar
  steps, and a note that standalone events make single-meeting deletion safe.

## 1.1.0 — 2026-07-30 · `bc894fe`

- **Reworded the UI from shopping language to schedule-crafting language**:
  "Add to schedule" / "Your schedule" / "Build a class" / "Clear schedule"
  replace the cart vocabulary throughout, including status messages and
  screen-reader labels. Saved-schedule storage stayed compatible.

## 1.0.0 — 2026-07-30 · `a841ce5`

- **First public deployment to Cloudflare Pages**: live at
  https://usafa-calendar.benslab.dev (and usafa-academic-calendar.pages.dev).
  The app as approved in `requirements.md`: M/T-day × period schedule builder
  for Fall 2026 and Spring 2027, standalone-VEVENT `.ics` downloads with a
  correct America/Denver VTIMEZONE, contiguous-period merging, Modified SoC
  handling, real Turnstile bot protection verified server-side, and the
  idempotent `scripts/deploy.sh` pipeline (Turnstile widget, Pages project,
  secret, build, deploy, custom domain, DNS).
