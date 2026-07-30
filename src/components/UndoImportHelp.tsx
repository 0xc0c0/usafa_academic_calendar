import { useEffect, useRef } from 'react';

interface UndoImportHelpProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal reference for recovering from a bad import: how to mass-delete the
 * events in each calendar app, and how to make the next import trivially
 * undoable by giving it a calendar of its own.
 */
export default function UndoImportHelp({ open, onClose }: UndoImportHelpProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="help-dialog"
      aria-labelledby="undo-import-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, not its children) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="help-dialog-body">
        <header className="help-dialog-header">
          <h2 id="undo-import-title">Imported the wrong thing? How to undo it</h2>
          <button type="button" className="link" onClick={onClose} aria-label="Close help">
            ✕ Close
          </button>
        </header>

        <p>
          A semester import adds 40+ standalone events, so deleting them one at a time is miserable. Here is the
          fast way out in each app — and a habit that makes any future mistake a ten-second fix.
        </p>

        <div className="help-tip">
          <strong>Best insurance: give the import its own calendar.</strong> Every app below lets you create a new
          calendar (e.g. “USAFA Fall 2026”) and import into it instead of your main calendar. Undoing a mistake —
          or clearing out last semester — is then just deleting that one calendar. Your other events are never at
          risk.
        </div>

        <details open>
          <summary>Microsoft Outlook (classic, Windows)</summary>
          <p>Classic Outlook imports into your default calendar, but its List view makes mass-delete easy:</p>
          <ol>
            <li>Open the Calendar, then on the ribbon choose <strong>View → Change View → List</strong>.</li>
            <li>
              Click the <strong>Subject</strong> column to sort, or type the course name (e.g. “CS210”) in the
              search box so only the imported events show.
            </li>
            <li>
              Click the first imported event, hold <strong>Shift</strong> and click the last (or press{' '}
              <strong>Ctrl+A</strong> if the search shows only imported events), then press <strong>Delete</strong>.
            </li>
            <li>Switch back with View → Change View → Calendar.</li>
          </ol>
        </details>

        <details>
          <summary>Microsoft Outlook (new Outlook or web)</summary>
          <p>
            New Outlook has no List view, so the separate-calendar habit matters most here. When you use{' '}
            <strong>Add calendar → Upload from file</strong>, the dialog lets you pick which calendar receives the
            events — create a blank one first (<strong>Add calendar → Create blank calendar</strong>) and upload
            into it.
          </p>
          <ul>
            <li>
              <strong>To undo:</strong> right-click that calendar in the left sidebar → <strong>Remove</strong> /{' '}
              <strong>Delete calendar</strong>. All of its events go with it.
            </li>
            <li>
              If the events already landed in your main calendar: new Outlook has no multi-select, so either
              delete them one at a time (search the course name to find them), or open the same account in classic
              Outlook and use the List view steps above.
            </li>
          </ul>
        </details>

        <details>
          <summary>Google Calendar</summary>
          <p>
            Google Calendar’s import screen (<strong>Settings → Import &amp; export</strong>) has an{' '}
            <strong>“Add to calendar”</strong> picker. Create a new calendar first (Settings →{' '}
            <strong>Add calendar → Create new calendar</strong>) and import into it.
          </p>
          <ul>
            <li>
              <strong>To undo:</strong> Settings → click that calendar in the left list →{' '}
              <strong>Remove calendar → Delete</strong>.
            </li>
            <li>
              If you imported into your main calendar: Google offers no multi-select, so events must be deleted
              individually (use search to find them). One-by-one is the only route — a strong reason to use a
              separate calendar.
            </li>
          </ul>
        </details>

        <details>
          <summary>Apple Calendar (Mac)</summary>
          <p>
            When you open or import an .ics file, Apple Calendar asks which calendar to add the events to — choose{' '}
            <strong>New Calendar</strong> in that dropdown.
          </p>
          <ul>
            <li>
              <strong>To undo:</strong> right-click (Control-click) the calendar in the sidebar →{' '}
              <strong>Delete</strong>.
            </li>
            <li>
              If the events merged into an existing calendar: search for the course name, click the results list,
              select all with <strong>⌘A</strong>, and press Delete.
            </li>
          </ul>
        </details>

        <p className="muted small">
          Deleting events from a downloaded .ics never affects this site — you can always rebuild your schedule
          here and download a fresh file.
        </p>
      </div>
    </dialog>
  );
}
