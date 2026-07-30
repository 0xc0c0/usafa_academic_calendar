import { useEffect, useMemo, useState } from 'react';
import Turnstile from './components/Turnstile.tsx';
import UndoImportHelp from './components/UndoImportHelp.tsx';
import { dayLabel } from './lib/config.ts';
import { icsFilename } from './lib/ics.ts';
import { expandEntries, expandEntry, genericTitle } from './lib/schedule.ts';
import { SEMESTERS, getSemester } from './lib/semesters.ts';
import type { DayType, PeriodNumber, ScheduleEntry, SemesterConfig } from './lib/types.ts';
import { MAX_LOCATION_LENGTH, MAX_TITLE_LENGTH } from './lib/types.ts';

const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const CART_STORAGE_KEY = 'usafa-cal-cart-v1';
const ALL_PERIODS: PeriodNumber[] = [1, 2, 3, 4, 5, 6];

const military = (t: string) => t.replace(':', '');

function loadCart(): ScheduleEntry[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScheduleEntry[];
    return Array.isArray(parsed) ? parsed.filter((e) => getSemester(e.semesterId)) : [];
  } catch {
    return [];
  }
}

function describeEntry(config: SemesterConfig, entry: ScheduleEntry): string {
  const meetings = expandEntry(config, entry);
  const days = new Set(meetings.map((m) => m.date)).size;
  return `${days} class days · ${meetings.length} calendar events`;
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
              <div className="muted small">
                {entry.dayType}-days, period{entry.periods.length > 1 ? 's' : ''} {entry.periods.join(', ')} —{' '}
                {describeEntry(config, entry)}
                {entry.includeDayLabel && ' · class day in titles'}
              </div>
            </div>
            <div className="cart-actions">
              <button type="button" className="link" onClick={() => onEdit(entry)}>
                Edit
              </button>
              <button type="button" className="link danger" onClick={() => onRemove(entry.id)}>
                Remove
              </button>
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
      {!captchaReady && <p className="muted small">Complete the bot check below to enable downloads.</p>}
      <p className="muted small">
        Import mistakes are easy to fix —{' '}
        <button type="button" className="link" onClick={onUndoHelp}>
          see how to undo an import
        </button>
        .
      </p>
    </section>
  );
}

export default function App() {
  const [semesterId, setSemesterId] = useState(SEMESTERS[0].id);
  const [dayType, setDayType] = useState<DayType>('M');
  const [periods, setPeriods] = useState<PeriodNumber[]>([]);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [includeDayLabel, setIncludeDayLabel] = useState(false);
  const [cart, setCart] = useState<ScheduleEntry[]>(loadCart);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formNote, setFormNote] = useState('');
  const [undoHelpOpen, setUndoHelpOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  const formConfig = getSemester(semesterId)!;
  const sampleDay = formConfig.days.find((d) => d.dayType === dayType)!;

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
        <h1>USAFA Class Schedule → Calendar</h1>
        <p>
          Pick your semester, M-days or T-days, and class periods. Build your schedule one class at a time, then
          download a standard <code>.ics</code> file for Google Calendar, Outlook, or Apple Calendar. Every class meeting is a
          standalone event with Modified Schedule of Calls days handled automatically.
        </p>
        <p className="disclaimer">
          Unofficial tool — always verify against the{' '}
          <a href="https://www.usafa.edu/academics/academic-calendar/" target="_blank" rel="noreferrer">
            official USAFA academic calendar
          </a>
          .
        </p>
      </header>

      <section className="card" aria-label="Build a class">
        <h2>1. Build a class</h2>
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
            {(['M', 'T'] as DayType[]).map((t) => (
              <label key={t} className="radio">
                <input type="radio" name="daytype" checked={dayType === t} onChange={() => setDayType(t)} />
                {t}-days
              </label>
            ))}
          </fieldset>
        </div>

        <fieldset className="periods">
          <legend>Periods (times shown are the regular Schedule of Calls)</legend>
          <div className="period-grid">
            {ALL_PERIODS.map((p) => {
              const t = formConfig.scheduleOfCalls.periods[String(p)];
              return (
                <label key={p} className={`period ${periods.includes(p) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={periods.includes(p)} onChange={() => togglePeriod(p)} />
                  <span className="period-name">
                    {dayType}
                    {p}
                  </span>
                  <span className="period-time">
                    {military(t.start)}–{military(t.end)}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="muted small">
            On days marked “Modified SoC” on the academic calendar, periods 5–6 start one hour earlier (1230 and
            1330). That’s applied automatically to the affected dates. Back-to-back periods (like {dayType}3 +{' '}
            {dayType}4) become one continuous event.
          </p>
        </fieldset>

        <div className="field-row">
          <label>
            Course name <span className="muted small">(optional)</span>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="e.g. Comp Sci 110"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Location <span className="muted small">(optional)</span>
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
          Include the class day in each event title — e.g. “{title.trim() || 'CS210'} - {dayType}35” on class day{' '}
          {dayType}35
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
          Example: on class day {dayLabel(sampleDay)} ({sampleDay.date}), period {dayType}3 runs{' '}
          {military(formConfig.scheduleOfCalls.periods['3'].start)}–
          {military(formConfig.scheduleOfCalls.periods['3'].end)}.
        </p>
      </section>

      <section aria-label="Your schedule">
        <h2>2. Your schedule</h2>
        {groups.length === 0 ? (
          <p className="muted">Nothing on your schedule yet — build a class above. Multi-period classes welcome.</p>
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

      <section className="card" aria-label="Bot check">
        <h2>3. Quick bot check</h2>
        <Turnstile siteKey={SITE_KEY} onToken={setToken} resetKey={resetKey} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-label="Import into your calendar app">
        <h2>4. Import into your calendar app</h2>
        <ul className="import-tips">
          <li>
            <strong>Microsoft Outlook</strong> — use the <strong>Import</strong> option. In Outlook for Windows:
            File → Open &amp; Export → Import/Export → “Import an iCalendar (.ics) file”, then choose{' '}
            <strong>Import</strong> (not “Open as New”) so your classes land in your own calendar instead of a
            separate temporary one. In new Outlook or Outlook on the web: Add calendar → “Upload from file”.
          </li>
          <li>
            <strong>Google Calendar</strong> — Settings (gear icon) → “Import &amp; export” → select the file →
            Import.
          </li>
          <li>
            <strong>Apple Calendar</strong> — double-click the file, or File → Import.
          </li>
        </ul>
        <p className="muted small">
          Every class meeting is a standalone event (no recurrence rule), so you can delete or move a single
          meeting without affecting the rest of the semester.
        </p>
        <button type="button" className="help-callout" onClick={() => setUndoHelpOpen(true)}>
          <strong>Imported the wrong thing?</strong> See how to mass-delete the events and undo an import →
        </button>
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
      </footer>
    </main>
  );
}
