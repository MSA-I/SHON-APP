// SOP: claude.md § Event (date, dayOfWeek, startTime, location, guestCount, isMixed, notes)
// SOP: architecture/11-domain-invariants.md INV-03 (dayOfWeek derived from date, read-only)
// Stitch mockup: event_tabs_dark — first screen
//
// First tab in the EventTabs flow. Captures the static event metadata.
// `dayOfWeek` is rendered read-only; the writeback to the DB will recompute
// from `date` per INV-03.

import { type ReactNode } from 'react';
import { Calendar, Clock } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import { deriveDayOfWeek } from '../../lib/db';
import type { Event, EventLocation } from '../../types';

export function EventDetailsTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  if (!ev) return null;

  // INV-03: day-of-week is a read-only cache of `date`. Recomputed on every
  // render so even if a stale value lives in the in-memory event, the user
  // sees the truth. db.updateEvent will overwrite the persisted field.
  const day = ev.date ? safeDeriveDay(ev.date) : '';

  function patch<K extends keyof Event>(key: K, value: Event[K]) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { [key]: value } as Partial<Event>,
    });
  }

  return (
    <div data-testid="event-panel-details-form">
      <SectionHeader title="פרטי אירוע" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Date */}
          <FieldShell label="תאריך אירוע">
            <div className="relative">
              <input
                type="date"
                dir="ltr"
                value={ev.date}
                onChange={(e) => patch('date', e.target.value)}
                data-testid="event-field-date"
                className={inputClass}
              />
              <Calendar
                size={18}
                aria-hidden="true"
                className="absolute left-0 bottom-2 text-cream-muted pointer-events-none"
              />
            </div>
          </FieldShell>

          {/* Day of week — derived, read-only (INV-03) */}
          <FieldShell label="יום בשבוע">
            <input
              type="text"
              readOnly
              value={day}
              data-testid="event-field-dayOfWeek"
              className={`${inputClass} cursor-default`}
              aria-readonly="true"
            />
          </FieldShell>

          {/* Start time */}
          <FieldShell label="שעת קבלת פנים">
            <div className="relative">
              <input
                type="time"
                dir="ltr"
                value={ev.startTime}
                onChange={(e) => patch('startTime', e.target.value)}
                data-testid="event-field-startTime"
                className={`${inputClass} font-tabular`}
              />
              <Clock
                size={18}
                aria-hidden="true"
                className="absolute left-0 bottom-2 text-cream-muted pointer-events-none"
              />
            </div>
          </FieldShell>

          {/* Guest count */}
          <FieldShell label="כמות מוזמנים">
            <input
              type="number"
              min={0}
              dir="ltr"
              value={Number.isFinite(ev.guestCount) ? ev.guestCount : 0}
              onChange={(e) =>
                patch('guestCount', Number(e.target.value) || 0)
              }
              data-testid="event-field-guestCount"
              className={`${inputClass} text-end font-tabular`}
            />
          </FieldShell>

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

function safeDeriveDay(iso: string): string {
  // INV-03 helper. `deriveDayOfWeek` throws on malformed input — silently
  // degrade to empty so a blank-date input doesn't crash the form.
  try {
    return deriveDayOfWeek(iso);
  } catch {
    return '';
  }
}

const inputClass = [
  'w-full bg-transparent border-0 border-b border-border-subtle',
  'pb-2 px-0 text-cream font-sans',
  'rounded-none focus:outline-none focus:border-gold',
  'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
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
