// SOP: claude.md § Event (date, dayOfWeek, startTime, location, guestCount, isMixed, notes)
// SOP: architecture/11-domain-invariants.md INV-03 (relaxed 2026-05-21: date drives an
//      auto-snapped default for `dayOfWeek`, but Shon may override the weekday after the
//      date is entered. The override stays in EventContext and survives persistence
//      because `db.updateEvent` only overwrites `dayOfWeek` when `date` itself is in
//      the patch — a `dayOfWeek`-only patch is preserved as-authored.)
// SOP: architecture/15-component-architecture.md (event/ tab — tab-local primitives only)
//
// First tab in the EventTabs flow. Captures the static event metadata.
//
// UX notes (2026-05-21 rebuild — Agent A):
//  - Date: native <input type="date"> (OS calendar) PLUS a parallel free-typed
//    Hebrew text shadow in dd/MM/yyyy. Both edit the same source-of-truth ISO
//    string, so they stay in lockstep. Empty / partial dd/MM/yyyy text is
//    permitted (Shon may be mid-typing) — only fully-formed values are dispatched.
//  - Day-of-week: native <select> with the seven Hebrew weekdays. Default value
//    snaps to derive(date) every time the date changes; afterwards the select
//    is overridable.
//  - Guest count: <Input type="number"> primitive with min/max/step + a − / + button
//    pair flanking it. Keyboard ↑/↓ still work (browser-native).
//  - Start time: native <input type="time">.
//  - No inline icons inside any input chrome (per Agent A directive).

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useEvent } from '../../contexts/EventContext';
import { deriveDayOfWeek } from '../../lib/db';
import { Input } from '../ui/Input';
import type { DayOfWeek, Event, EventLocation } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEBREW_WEEKDAYS: readonly DayOfWeek[] = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
] as const;

const GUEST_MIN = 10;
const GUEST_MAX = 1000;
const GUEST_STEP = 10;

// ---------------------------------------------------------------------------
// Pure helpers (Layer 3-style — no side effects, no DOM)
// ---------------------------------------------------------------------------

/** ISO yyyy-mm-dd → dd/MM/yyyy. Returns '' for empty/invalid input. */
function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * dd/MM/yyyy → ISO yyyy-mm-dd. Returns null if the user is mid-typing
 * (anything that isn't a fully-formed dd/MM/yyyy string is rejected). The
 * caller leaves the source-of-truth alone until parsing succeeds.
 */
function displayToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  // Cheap range gate; full calendar validity is enforced downstream by
  // db.assertIsoDate / deriveDayOfWeek.
  const day = Number(dd);
  const month = Number(mm);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function safeDeriveDay(iso: string): DayOfWeek | '' {
  if (!iso) return '';
  try {
    return deriveDayOfWeek(iso);
  } catch {
    return '';
  }
}

function clampGuestCount(n: number): number {
  if (!Number.isFinite(n)) return GUEST_MIN;
  return Math.min(GUEST_MAX, Math.max(GUEST_MIN, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventDetailsTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;

  // Local mirror of the dd/MM/yyyy shadow. We keep it as local state so the
  // user can type partial values (e.g. "14/") without us blowing the canonical
  // ISO away. The mirror reconciles with `ev.date` whenever the canonical
  // value changes from elsewhere (date input or context reset).
  const [dateText, setDateText] = useState<string>(() => isoToDisplay(ev?.date ?? ''));

  useEffect(() => {
    // Reconcile mirror when canonical date changes (and only then).
    setDateText(isoToDisplay(ev?.date ?? ''));
  }, [ev?.date]);

  const derivedDay = useMemo(() => safeDeriveDay(ev?.date ?? ''), [ev?.date]);

  if (!ev) return null;
  // Re-bind to a non-nullable local so closures below see a narrowed type.
  const event: Event = ev;

  function patch<K extends keyof Event>(key: K, value: Event[K]) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { [key]: value } as Partial<Event>,
    });
  }

  // -- Date handlers --------------------------------------------------------

  function commitIsoDate(iso: string): void {
    // Reducer auto-snaps dayOfWeek when `date` is in the patch (INV-03 path).
    patch('date', iso);
  }

  function onNativeDateChange(next: string): void {
    setDateText(isoToDisplay(next));
    commitIsoDate(next);
  }

  function onTextDateChange(next: string): void {
    setDateText(next);
    const iso = displayToIso(next);
    if (iso !== null && iso !== event.date) {
      commitIsoDate(iso);
    }
  }

  function onTextDateBlur(): void {
    // On blur, if the text is unparseable, snap back to the canonical ISO so
    // we never leave the field looking authoritative while the underlying
    // value is something else.
    if (displayToIso(dateText) === null) {
      setDateText(isoToDisplay(event.date));
    }
  }

  // -- Guest-count stepper --------------------------------------------------

  function bumpGuests(delta: number): void {
    const current = Number.isFinite(event.guestCount)
      ? event.guestCount
      : GUEST_MIN;
    patch('guestCount', clampGuestCount(current + delta));
  }

  // -------------------------------------------------------------------------

  return (
    <div data-testid="event-panel-details-form">
      <SectionHeader title="פרטי אירוע" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Date — native picker */}
          <FieldShell label="תאריך אירוע (לוח שנה)">
            <input
              type="date"
              dir="ltr"
              value={ev.date}
              onChange={(e) => onNativeDateChange(e.target.value)}
              data-testid="event-field-date"
              className={inputClass}
            />
          </FieldShell>

          {/* Date — free-typed Hebrew shadow */}
          <FieldShell label="תאריך אירוע (הקלדה)">
            <input
              type="text"
              inputMode="numeric"
              dir="ltr"
              placeholder="dd/MM/yyyy"
              value={dateText}
              onChange={(e) => onTextDateChange(e.target.value)}
              onBlur={onTextDateBlur}
              data-testid="event-field-date-text"
              className={`${inputClass} font-tabular`}
              aria-label="תאריך בפורמט dd/MM/yyyy"
            />
          </FieldShell>

          {/* Day of week — Hebrew weekday select, default = derived */}
          <FieldShell label="יום בשבוע">
            <select
              value={ev.dayOfWeek}
              onChange={(e) => patch('dayOfWeek', e.target.value as DayOfWeek)}
              data-testid="event-field-dayOfWeek"
              className={selectClass}
              aria-describedby="event-field-dayOfWeek-hint"
            >
              {HEBREW_WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {derivedDay && derivedDay !== ev.dayOfWeek ? (
              <span
                id="event-field-dayOfWeek-hint"
                className="text-cream-muted text-label"
              >
                ברירת מחדל מהתאריך: {derivedDay}
              </span>
            ) : null}
          </FieldShell>

          {/* Start time */}
          <FieldShell label="שעת קבלת פנים">
            <input
              type="time"
              dir="ltr"
              value={ev.startTime}
              onChange={(e) => patch('startTime', e.target.value)}
              data-testid="event-field-startTime"
              className={`${inputClass} font-tabular`}
            />
          </FieldShell>

          {/* Guest count — Input primitive flanked by stepper buttons */}
          <div className="md:col-span-2 flex flex-col gap-3 mt-2">
            <ChipLabel>כמות מוזמנים</ChipLabel>
            <div
              className="flex items-end gap-3"
              dir="ltr"
              data-testid="event-field-guestCount-row"
            >
              <StepperButton
                label="הפחתה"
                glyph="−"
                onClick={() => bumpGuests(-GUEST_STEP)}
                disabled={ev.guestCount <= GUEST_MIN}
                testId="event-field-guestCount-dec"
              />
              <div className="flex-1">
                <Input
                  label=""
                  type="number"
                  dir="ltr"
                  value={String(
                    Number.isFinite(ev.guestCount) ? ev.guestCount : GUEST_MIN,
                  )}
                  onChange={(next) => {
                    const n = Number(next);
                    if (!Number.isFinite(n)) return;
                    patch('guestCount', clampGuestCount(n));
                  }}
                  testId="event-field-guestCount"
                />
              </div>
              <StepperButton
                label="הוספה"
                glyph="+"
                onClick={() => bumpGuests(GUEST_STEP)}
                disabled={ev.guestCount >= GUEST_MAX}
                testId="event-field-guestCount-inc"
              />
            </div>
            <span className="text-cream-muted text-label">
              טווח: {GUEST_MIN}–{GUEST_MAX} (קפיצות של {GUEST_STEP})
            </span>
          </div>

          {/* Location */}
          <div className="md:col-span-2 flex flex-col gap-3 mt-4">
            <ChipLabel>מתחם (לוקיישן)</ChipLabel>
            <div className="flex gap-4">
              {(['גאמוס', 'ריזורט'] as const).map((loc) => (
                <RadioChip
                  key={loc}
                  label={loc}
                  selected={ev.location === loc}
                  onSelect={() => patch('location', loc as EventLocation)}
                  testId={`event-location-${loc}`}
                />
              ))}
            </div>
          </div>

          {/* Mixed event toggle */}
          <div className="md:col-span-2 flex flex-col gap-3 mt-2">
            <ChipLabel>אירוע מעורב (גברים ונשים יחד)</ChipLabel>
            <div className="flex gap-4">
              <RadioChip
                label="כן"
                selected={ev.isMixed === true}
                onSelect={() => patch('isMixed', true)}
                testId="event-isMixed-yes"
              />
              <RadioChip
                label="לא"
                selected={ev.isMixed === false}
                onSelect={() => patch('isMixed', false)}
                testId="event-isMixed-no"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="md:col-span-2 flex flex-col gap-2 mt-4">
            <ChipLabel>הערות כלליות לאירוע</ChipLabel>
            <textarea
              rows={3}
              value={ev.notes}
              onChange={(e) => patch('notes', e.target.value)}
              placeholder="הכנס הערות מיוחדות..."
              data-testid="event-field-notes"
              className={`${inputClass} resize-none`}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab-local primitives (kept private — barrel does NOT export these)
// ---------------------------------------------------------------------------

const inputClass = [
  'w-full bg-transparent border-0 border-b border-border-subtle',
  'pb-2 px-0 text-cream font-sans',
  'rounded-none focus:outline-none focus:border-gold',
  'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
].join(' ');

const selectClass = [
  inputClass,
  // Native <select> styling — strip the default OS chrome so it matches the
  // editorial-flat aesthetic. Keep the caret rendered by the OS for a11y.
  'appearance-none bg-ink-raised cursor-pointer',
  'text-cream pr-2',
].join(' ');

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-12 text-center">
      <h1 className="font-serif text-h1 text-cream mb-4">{title}</h1>
      <div className="text-gold text-h3" aria-hidden="true">
        ❖
      </div>
    </div>
  );
}

export function ChipLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-label uppercase text-gold-dark"
      style={{ letterSpacing: '0.12em' }}
    >
      {children}
    </span>
  );
}

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <ChipLabel>{label}</ChipLabel>
      {children}
    </label>
  );
}

function StepperButton({
  label,
  glyph,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  glyph: '+' | '−';
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={[
        'h-10 w-10 shrink-0',
        'border border-border-subtle text-cream font-sans text-h3 leading-none',
        'flex items-center justify-center select-none',
        'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'cursor-pointer hover:border-gold hover:text-gold',
      ].join(' ')}
    >
      {glyph}
    </button>
  );
}

export function RadioChip({
  label,
  selected,
  onSelect,
  testId,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className={[
        'px-6 py-2 border font-sans text-body select-none cursor-pointer',
        'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        selected
          ? 'border-gold text-gold'
          : 'border-border-subtle text-cream-muted hover:text-cream',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
