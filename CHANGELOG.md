# Change Log

The version shown in the site footer links here; every deployed change bumps the
version (`x.yy.zzz`) and adds an entry at the **top** of this file. History begins
at the first Cloudflare Pages deployment. Commit hashes refer to
[this repository](https://github.com/0xc0c0/usafa_academic_calendar).

---

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
