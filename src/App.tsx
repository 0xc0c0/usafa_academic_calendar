import { useEffect, useMemo, useRef, useState } from 'react';
import Turnstile from './components/Turnstile.tsx';
import UndoImportHelp from './components/UndoImportHelp.tsx';
import { dayLabel } from './lib/config.ts';
import { icsFilename } from './lib/ics.ts';
import { FIXED_ADDONS, expandEntries, expandEntry, fullHourEnd, genericTitle } from './lib/schedule.ts';
import { SEMESTERS, getSemester } from './lib/semesters.ts';
import { APP_VERSION, CHANGELOG_URL } from './lib/version.ts';
import type { EntryDayType, PeriodNumber, ScheduleEntry, SemesterConfig } from './lib/types.ts';
import { MAX_LOCATION_LENGTH, MAX_TITLE_LENGTH } from './lib/types.ts';

const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

/** FAQ content — rendered visibly AND emitted as FAQPage JSON-LD, from the
 * same strings so the structured data always matches the page (a Google
 * requirement). Keep answers plain text. */
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What are M-days and T-days at USAFA?',
    a: 'The Air Force Academy does not schedule classes by weekday. It alternates two class-day types — M-days and T-days (an A/B-day system) — and a course meets on every M-day or every T-day at one or more numbered periods. Holidays, training days, and breaks interrupt the alternation, so the sequence is irregular: in AY 2026-2027 each semester has exactly 41 M-days (M1–M41) and 41 T-days (T1–T41), mapped in the official Cadet Academic Calendar.',
  },
  {
    q: 'What are the USAFA class period times?',
    a: 'The regular Schedule of Calls is the same Monday through Friday: period 1 starts at 0730, period 2 at 0830, period 3 at 0930, period 4 at 1030, period 5 at 1330, and period 6 at 1430, each dismissing at 23 minutes past the following hour. Lunch and the CW/DF Time block sit between periods 4 and 5. This builder shows the official times and generates full-hour calendar events, so a 0930 class becomes a 0930–1030 event.',
  },
  {
    q: 'What is a Modified Schedule of Calls day?',
    a: 'Some class days are marked "Modified SoC — Afternoon Sections Start 1 Hr Early" on the academic calendar. On those days periods 5 and 6 start an hour earlier, at 1230 and 1330; morning periods are unchanged. This schedule generator applies the shift automatically — Fall 2026 has six Modified SoC days and Spring 2027 has five, all M-days.',
  },
  {
    q: 'How do I add my USAFA class schedule to Google Calendar, Outlook, or Apple Calendar?',
    a: 'Build your schedule above and download the .ics file, then import it: Google Calendar via Settings, then "Import & export"; Outlook for Windows via File, Open & Export, Import/Export (choose Import, not "Open as New"); Apple Calendar by double-clicking the file. Every class meeting is a standalone event with no recurrence rule, so you can move or delete a single meeting without affecting the rest of the semester.',
  },
  {
    q: 'What are DF Time and CW Time?',
    a: "The 1230–1323 block between lunch and 5th period: on T-days it is DF Time, the Dean's block for extra instruction, academic advising, majors' meetings, and Dean's calls; on M-days it is CW Time, the Cadet Wing's counterpart. Both are one-click Calendar Add-ons here, and like the all-day markers they import marked Free — visible on your calendar but never blocking time, so booking tools like Microsoft Bookings keep those slots open. CW Time never falls on Modified SoC days, because the shifted afternoon periods occupy that slot.",
  },
  {
    q: 'Is this an official USAFA site?',
    a: 'No — this is a free, unofficial tool. It is built from the published AY 2026-2027 Cadet Academic Calendar and Schedule of Calls, but always verify against the official USAFA academic calendar. No schedule data is stored server-side.',
  },
];

const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
  // Standard JSON-in-<script> guard: a future FAQ edit containing "</script"
  // or "<!--" must not terminate the raw-text script element mid-JSON.
}).replace(/</g, '\\u003c');
const CART_STORAGE_KEY = 'usafa-cal-cart-v1';
const ALL_PERIODS: PeriodNumber[] = [1, 2, 3, 4, 5, 6];

const military = (t: string) => t.replace(':', '');

function loadCart(): ScheduleEntry[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScheduleEntry[];
    if (!Array.isArray(parsed)) return [];
    // Normalize defensively: a stale or hand-edited cart must never crash the
    // app at startup (expandEntry calls .trim() on title/location and looks
    // period numbers up in the Schedule of Calls, so values must be 1-6).
    const seenIds = new Set<string>();
    return parsed
      .filter((e): e is ScheduleEntry => !!e && typeof e === 'object' && !!getSemester(e.semesterId))
      .map((e) => {
        // Ids drive Remove/Edit targeting — regenerate missing or duplicated ones.
        let id = typeof e.id === 'string' ? e.id.slice(0, 40) : '';
        if (!id || seenIds.has(id)) id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        seenIds.add(id);
        return {
          ...e,
          id,
          title: typeof e.title === 'string' ? e.title : '',
          location: typeof e.location === 'string' ? e.location : '',
          includeDayLabel: e.includeDayLabel === true, // match the server's strict coercion
          periods: Array.isArray(e.periods)
            ? [...new Set((e.periods as unknown[]).filter((p): p is PeriodNumber => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 6))].sort((a, b) => a - b)
            : [],
        };
      })
      .filter((e) =>
        e.kind !== undefined && e.kind !== 'class'
          ? typeof e.kind === 'string' && Object.hasOwn(FIXED_ADDONS, e.kind)
          : ['M', 'T', 'both'].includes(e.dayType) && e.periods.length > 0,
      );
  } catch {
    return [];
  }
}

function describeEntry(config: SemesterConfig, entry: ScheduleEntry): string {
  const meetings = expandEntry(config, entry);
  const days = new Set(meetings.map((m) => m.date)).size;
  return `${days} class days · ${meetings.length} calendar events`;
}

/** Meta line for fixed add-on entries; null for normal class entries. */
function addonMeta(config: SemesterConfig, entry: ScheduleEntry): string | null {
  const soc = config.scheduleOfCalls;
  const slot = (block: { start: string }) => `${military(block.start)}–${military(fullHourEnd(block.start))}`;
  switch (entry.kind) {
    case 'dfTime':
      return `T-days, ${slot(soc.dfTime)} · shown as Free — ${describeEntry(config, entry)}`;
    case 'cwTime':
      return `M-days, ${slot(soc.cwTime)}, skips Modified SoC days · shown as Free — ${describeEntry(config, entry)}`;
    case 'allDayM':
      return `M-days, all day · shown as Free — ${describeEntry(config, entry)}`;
    case 'allDayT':
      return `T-days, all day · shown as Free — ${describeEntry(config, entry)}`;
    default:
      return null;
  }
}

interface SemesterGroupProps {
  config: SemesterConfig;
  entries: ScheduleEntry[];
  editingId: string | null;
  onEdit: (entry: ScheduleEntry) => void;
  onRemove: (id: string) => void;
  onDownload: (config: SemesterConfig, entries: ScheduleEntry[]) => void;
  downloading: boolean;
  /** True while ANY semester's download is in flight — Turnstile tokens are
   * single-use, so a second concurrent request would 403 in production. */
  anyDownloadInFlight: boolean;
  captchaReady: boolean;
  onUndoHelp: () => void;
}

function SemesterGroup({
  config,
  entries,
  editingId,
  onEdit,
  onRemove,
  onDownload,
  downloading,
  anyDownloadInFlight,
  captchaReady,
  onUndoHelp,
}: SemesterGroupProps) {
  const meetings = useMemo(() => expandEntries(config, entries), [config, entries]);
  const modifiedCount = meetings.filter((m) => m.modifiedSoC).length;
  const first = meetings[0];
  const last = meetings[meetings.length - 1];
  return (
    <section className="card cart-group" aria-label={`${config.name} schedule`}>
      <h3>{config.name}</h3>
      <ul className="cart-list">
        {entries.map((entry) => (
          <li key={entry.id} className="cart-item">
            <div>
              <strong>{entry.title.trim() || genericTitle(entry)}</strong>
              {entry.id === editingId && <span className="editing-badge"> editing…</span>}
              {entry.location.trim() && <span className="muted"> · {entry.location}</span>}
            </div>
            <div className="cart-actions">
              {(entry.kind === undefined || entry.kind === 'class') && (
                <button type="button" className="link" onClick={() => onEdit(entry)}>
                  Edit
                </button>
              )}
              <button type="button" className="link danger" onClick={() => onRemove(entry.id)}>
                Remove
              </button>
            </div>
            <div className="cart-meta muted small">
              {addonMeta(config, entry) ??
                `${entry.dayType === 'both' ? 'M/T' : entry.dayType}-days, period${entry.periods.length > 1 ? 's' : ''} ${entry.periods.join(', ')} — ${describeEntry(config, entry)}`}
              {entry.includeDayLabel && ' · class day in titles'}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {meetings.length} events from {first?.date} ({first?.dayLabel}) through {last?.date} ({last?.dayLabel}).{' '}
        {modifiedCount > 0 && `${modifiedCount} fall on Modified SoC days (afternoon periods one hour early).`}
      </p>
      <button
        type="button"
        className="primary"
        disabled={anyDownloadInFlight || !captchaReady}
        onClick={() => onDownload(config, entries)}
      >
        {downloading ? 'Generating…' : `Download ${icsFilename(config)}`}
      </button>
      {!captchaReady && <p className="muted small">Complete the bot check to enable downloads.</p>}
      <p className="muted small">
        Import mistakes are easy to fix —{' '}
        <button type="button" className="link" onClick={onUndoHelp}>
          see how to undo an import
        </button>
      </p>
    </section>
  );
}

export default function App() {
  const [semesterId, setSemesterId] = useState(SEMESTERS[0].id);
  const [dayType, setDayType] = useState<EntryDayType>('M');
  const [periods, setPeriods] = useState<PeriodNumber[]>([]);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [includeDayLabel, setIncludeDayLabel] = useState(false);
  // Two-pass cart load: the first render must match the prerendered
  // (empty-cart) HTML for clean hydration, so localStorage is read in an
  // effect right after mount instead of during the initial render.
  const [cart, setCart] = useState<ScheduleEntry[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formNote, setFormNote] = useState('');
  const [undoHelpOpen, setUndoHelpOpen] = useState(false);

  const skipNextSave = useRef(false);

  useEffect(() => {
    skipNextSave.current = true;
    setCart(loadCart());
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    // Persist USER changes only. Never write before the load effect has run
    // (the initial empty render must not clobber a saved schedule), and skip
    // the one run triggered by the load itself — writing back what was just
    // read would race anything else that touched storage in between.
    if (!cartLoaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, cartLoaded]);

  const formConfig = getSemester(semesterId)!;
  const sampleDay = formConfig.days.find((d) => dayType === 'both' || d.dayType === dayType)!;
  /** Period label under the current day-type choice: "M3", "T3", or "M3/T3". */
  const pLabel = (p: number) => (dayType === 'both' ? `M${p}/T${p}` : `${dayType}${p}`);
  /** Day-label example for copy; 'both' shows an M-day (labels are per-event anyway). */
  const exampleDayLabel = dayType === 'T' ? 'T35' : 'M35';

  const togglePeriod = (p: PeriodNumber) => {
    setPeriods((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)));
  };

  const clearForm = () => {
    setPeriods([]);
    setTitle('');
    setLocation('');
    setIncludeDayLabel(false);
  };

  const addToCart = () => {
    if (periods.length === 0) {
      setFormNote('Pick at least one period.');
      return;
    }
    const values = {
      semesterId,
      dayType,
      periods,
      title: title.slice(0, MAX_TITLE_LENGTH),
      location: location.slice(0, MAX_LOCATION_LENGTH),
      includeDayLabel,
    };
    const label = values.title.trim() || genericTitle(values);
    if (editingId && cart.some((e) => e.id === editingId)) {
      // Replace in place — the entry stays in the cart the whole time it is
      // being edited, so a reload or a second Edit click never loses data.
      setCart((prev) => prev.map((e) => (e.id === editingId ? { ...values, id: editingId } : e)));
      setFormNote(`Updated ${label}.`);
    } else {
      setCart((prev) => [...prev, { ...values, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
      setFormNote(`Added ${label} to your schedule.`);
    }
    setEditingId(null);
    clearForm();
  };

  const editEntry = (entry: ScheduleEntry) => {
    setEditingId(entry.id);
    setSemesterId(entry.semesterId);
    setDayType(entry.dayType);
    setPeriods(entry.periods);
    setTitle(entry.title);
    setLocation(entry.location);
    setIncludeDayLabel(entry.includeDayLabel === true);
    setFormNote('Editing this class — "Save class" updates it in place.');
  };

  const cancelEdit = () => {
    setEditingId(null);
    clearForm();
    setFormNote('Edit cancelled; the class is unchanged.');
  };

  const [addonSemesterId, setAddonSemesterId] = useState(SEMESTERS[0].id);
  const addonConfig = getSemester(addonSemesterId)!;

  type AddonKind = keyof typeof FIXED_ADDONS;
  const addonAdded = (kind: AddonKind) =>
    cart.some((e) => e.kind === kind && e.semesterId === addonSemesterId);

  const addAddon = (kind: AddonKind) => {
    if (addonAdded(kind)) return;
    setCart((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        semesterId: addonSemesterId,
        dayType: FIXED_ADDONS[kind].dayType,
        periods: [],
        title: FIXED_ADDONS[kind].title,
        location: '',
        kind,
      },
    ]);
  };

  const lunchSlot = (block: { start: string }) => `${military(block.start)}–${military(fullHourEnd(block.start))}`;

  const ADDONS: { kind: AddonKind; name: string; desc: string }[] = [
    {
      kind: 'dfTime',
      name: 'DF Time',
      desc: `The Dean's extra-instruction and advising block between lunch and 5th period — every T-day, ${lunchSlot(addonConfig.scheduleOfCalls.dfTime)}.`,
    },
    {
      kind: 'cwTime',
      name: 'CW Time',
      desc: `The Cadet Wing's matching block — every M-day, ${lunchSlot(addonConfig.scheduleOfCalls.cwTime)}, except Modified SoC days (the shifted afternoon classes take that slot).`,
    },
    {
      kind: 'allDayM',
      name: 'All-Day M-Day Events',
      desc: 'An all-day banner event on each M-day, titled by its class day (“M12”), so a glance at your calendar tells you which day it is.',
    },
    {
      kind: 'allDayT',
      name: 'All-Day T-Day Events',
      desc: 'The same for T-days (“T12”).',
    },
  ];

  const removeEntry = (id: string) => {
    setCart((prev) => prev.filter((e) => e.id !== id));
    if (id === editingId) setEditingId(null);
  };

  const download = async (config: SemesterConfig, entries: ScheduleEntry[]) => {
    if (!token) return;
    setDownloadingId(config.id);
    setError('');
    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semesterId: config.id, entries, turnstileToken: token }),
      });
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || `Download failed (HTTP ${resp.status}).`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = icsFilename(config);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
      setResetKey((k) => k + 1); // Turnstile tokens are single-use
    }
  };

  const groups = SEMESTERS.map((config) => ({
    config,
    entries: cart.filter((e) => e.semesterId === config.id),
  })).filter((g) => g.entries.length > 0);

  return (
    <main className="page">
      <header className="hero">
        <h1>
          USAFA Class Schedule <span className="nowrap">→ Calendar</span>
        </h1>
        <p>
          A free USAFA schedule builder for AY 2026-2027: pick your semester, M-days, T-days, or both, and class
          periods. Build your schedule one class at a time, then download a standard <code>.ics</code> file for
          Google Calendar, Outlook, or Apple Calendar. Every class meeting is a standalone event with Modified
          Schedule of Calls days handled automatically.
        </p>
        <p className="disclaimer">
          Unofficial tool — always verify against the{' '}
          <a href="https://www.usafa.edu/academics/academic-calendar/" target="_blank" rel="noreferrer">
            official USAFA academic calendar
          </a>
          .
        </p>
      </header>

      <div className="layout">
        <div className="col-main">
      <section className="card" aria-label="Build a class">
        <h2>Build a class</h2>
        <div className="field-row">
          <label>
            Semester
            <select value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
              {SEMESTERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.academicYear})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="daytype">
            <legend>Class meets on</legend>
            {(
              [
                { value: 'M', label: 'M-days' },
                { value: 'T', label: 'T-days' },
                { value: 'both', label: 'Both' },
              ] as { value: EntryDayType; label: string }[]
            ).map(({ value, label }) => (
              <label key={value} className="radio">
                <input type="radio" name="daytype" checked={dayType === value} onChange={() => setDayType(value)} />
                {label}
              </label>
            ))}
          </fieldset>
        </div>

        <fieldset className="periods">
          <legend>Periods</legend>
          <div className="period-grid">
            {ALL_PERIODS.map((p) => {
              const t = formConfig.scheduleOfCalls.periods[String(p)];
              return (
                <label key={p} className={`period ${periods.includes(p) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={periods.includes(p)} onChange={() => togglePeriod(p)} />
                  <span className="period-name">{pLabel(p)}</span>
                  <span className="period-time">
                    {military(t.start)}–{military(t.end)}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="muted small">
            Times shown are the official Schedule of Calls; calendar events run a full hour from each start (a
            0930 class becomes a 0930–1030 event) so they line up with other meeting invites. Back-to-back
            periods like {pLabel(3)} + {pLabel(4)} merge into one event, selecting all six makes one continuous
            full-day event, and on “Modified SoC” days periods 5–6 automatically shift an hour earlier.
          </p>
        </fieldset>

        <div className="field-row">
          <label>
            <span>
              Course name <span className="muted small">(optional)</span>
            </span>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="e.g. Comp Sci 110"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            <span>
              Location <span className="muted small">(optional)</span>
            </span>
            <input
              type="text"
              value={location}
              maxLength={MAX_LOCATION_LENGTH}
              placeholder="e.g. Fairchild 2G5"
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
        </div>

        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={includeDayLabel}
            onChange={(e) => setIncludeDayLabel(e.target.checked)}
          />
          Include the class day in each event title — e.g. “{title.trim() || 'CS210'} - {exampleDayLabel}” on
          class day {exampleDayLabel}
        </label>

        <button type="button" className="primary" onClick={addToCart}>
          {editingId ? 'Save class' : 'Add to schedule'}
        </button>
        {editingId && (
          <button type="button" className="link" onClick={cancelEdit}>
            Cancel edit
          </button>
        )}
        {formNote && (
          <p className="muted small" role="status">
            {formNote}
          </p>
        )}
        <p className="muted small">
          Example: on class day {dayLabel(sampleDay)} ({sampleDay.date}), period {sampleDay.dayType}3 meets{' '}
          {military(formConfig.scheduleOfCalls.periods['3'].start)}–
          {military(formConfig.scheduleOfCalls.periods['3'].end)} and appears on your calendar as{' '}
          {military(formConfig.scheduleOfCalls.periods['3'].start)}–
          {military(fullHourEnd(formConfig.scheduleOfCalls.periods['3'].start))}.
        </p>
      </section>

      <section className="card" aria-label="Calendar Add-ons">
        <h2>Calendar Add-ons</h2>
        <p className="muted small">
          Optional one-click extras, separate from your classes. Nothing to configure — just pick which
          semester they apply to.
        </p>
        <div className="field-row">
          <label>
            Add to semester
            <select value={addonSemesterId} onChange={(e) => setAddonSemesterId(e.target.value)}>
              {SEMESTERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.academicYear})
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="addon-list">
          {ADDONS.map(({ kind, name, desc }) => (
            <li key={kind} className="addon-row">
              <div className="muted small">
                <strong className="addon-name">{name}</strong> — {desc}
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => addAddon(kind)}
                disabled={!cartLoaded || addonAdded(kind)}
              >
                {addonAdded(kind) ? `${name} added to ${addonConfig.name}` : `Add ${name} (${addonConfig.name})`}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Every add-on imports marked <strong>Free</strong>, so it never blocks time — booking tools like
          Microsoft Bookings keep those slots available. (Classes you build above import as Busy.) The all-day
          M- and T-day events sit in the calendar's banner strip.
        </p>
      </section>

        </div>

        <aside className="col-rail">
      <section aria-label="Your schedule">
        <h2>Your schedule</h2>
        {!cartLoaded && groups.length === 0 ? null : groups.length === 0 ? (
          // Only assert emptiness once the saved cart has actually been read —
          // the prerendered HTML must not tell a returning user their schedule
          // is gone while the bundle loads (both prerender and the first
          // client render take the null branch, so hydration matches).
          <div className="card">
            <p className="muted">
              Nothing here yet — add a class from the builder, or a Calendar Add-on, and it will appear here,
              grouped by semester.
            </p>
          </div>
        ) : (
          <>
            {groups.map(({ config, entries }) => (
              <SemesterGroup
                key={config.id}
                config={config}
                entries={entries}
                editingId={editingId}
                onEdit={editEntry}
                onRemove={removeEntry}
                onDownload={download}
                downloading={downloadingId === config.id}
                anyDownloadInFlight={downloadingId !== null}
                captchaReady={token !== null}
                onUndoHelp={() => setUndoHelpOpen(true)}
              />
            ))}
            <button
              type="button"
              className="link danger"
              onClick={() => {
                setCart([]);
                setEditingId(null);
              }}
            >
              Clear schedule
            </button>
          </>
        )}
      </section>

      <section className="card rail-aside" aria-label="Bot check">
        <h2>Bot check</h2>
        <p className="muted small">A quick automatic check — downloads unlock once it passes.</p>
        <div className="turnstile-slot">
          <Turnstile siteKey={SITE_KEY} onToken={setToken} resetKey={resetKey} />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card rail-aside" aria-label="Import into your calendar app">
        <h2>Import into your calendar app</h2>
        <details className="import-app">
          <summary>Microsoft Outlook</summary>
          <p className="small">
            Use the <strong>Import</strong> option. In Outlook for Windows: File → Open &amp; Export →
            Import/Export → “Import an iCalendar (.ics) file”, then choose <strong>Import</strong> (not “Open as
            New”) so your classes land in your own calendar instead of a separate temporary one. In new Outlook
            or Outlook on the web: Add calendar → “Upload from file”.
          </p>
        </details>
        <details className="import-app">
          <summary>Google Calendar</summary>
          <p className="small">Settings (gear icon) → “Import &amp; export” → select the file → Import.</p>
        </details>
        <details className="import-app">
          <summary>Apple Calendar</summary>
          <p className="small">Double-click the file, or File → Import.</p>
        </details>
        <p className="muted small">
          Every class meeting is a standalone event (no recurrence rule), so you can delete or move a single
          meeting without affecting the rest of the semester.
        </p>
        <button type="button" className="help-callout" onClick={() => setUndoHelpOpen(true)}>
          <strong>Imported the wrong thing?</strong> See how to mass-delete the events and{' '}
          <span className="nowrap">undo an import →</span>
        </button>
      </section>
        </aside>
      </div>

      <section className="card faq" aria-label="FAQ">
        <h2>M-days, T-days, and how this works</h2>
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      </section>

      <UndoImportHelp open={undoHelpOpen} onClose={() => setUndoHelpOpen(false)} />

      <footer className="footer muted small">
        <p>
          Built from the official{' '}
          <a href="https://www.usafa.edu/app/uploads/AY_2026_2027_Calendar.pdf" target="_blank" rel="noreferrer">
            AY 2026–2027 Cadet Academic Calendar
          </a>{' '}
          and{' '}
          <a href="https://www.usafa.edu/app/uploads/26_27_Schedule_of_Calls.pdf" target="_blank" rel="noreferrer">
            Schedule of Calls
          </a>
          . Not affiliated with or endorsed by USAFA or the U.S. Air Force. No schedule data is stored server-side.
        </p>
        <p>
          v{APP_VERSION} ·{' '}
          <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
            change log
          </a>
        </p>
      </footer>
    </main>
  );
}
