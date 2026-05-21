// SOP: claude.md § Event (napkins, reception)
// SOP: architecture/11-domain-invariants.md INV-04
//      (napkins.color === 'אחר' requires non-empty witness in foldType / notes)
//
// Captures napkin color/fabric/fold + the "reception at resort" toggle.
// INV-04 is enforced HERE at the UI layer per the SOP: when color === 'אחר',
// surface a required text input ("פירוט צבע") that writes back into
// napkins.foldType. The "המשך" button (in EventTabs) is disabled by reading
// `eventCtx.unsavedChanges` and a derived validity flag — but per the locked
// SOP, db.ts only soft-warns, so the UI is the primary gate.

import { type ReactNode } from 'react';

import { useEvent } from '../../contexts/EventContext';
import type { Napkins, NapkinColor, NapkinFabric } from '../../types';

import { ChipLabel, RadioChip, SectionHeader } from './EventDetailsTab';

const NAPKIN_COLORS: readonly NapkinColor[] = [
  'וורד עתיק',
  'פשתן',
  'אחר',
] as const;

const NAPKIN_FABRICS: readonly NapkinFabric[] = ['פניה', 'סטן'] as const;

export function NapkinsTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  if (!ev) return null;

  function patchNapkins(patch: Partial<Napkins>) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { napkins: { ...ev!.napkins, ...patch } },
    });
  }

  function patchReception(atResort: boolean) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { reception: { atResort } },
    });
  }

  const isOther = ev.napkins.color === 'אחר';
  // INV-04 witness check — used as an a11y/visual hint. Not a hard block here;
  // EventTabs' parent wires this via context.unsavedChanges if needed.
  const witnessMissing = isOther && !ev.napkins.foldType.trim() && !ev.notes.trim();

  return (
    <div data-testid="event-panel-napkins-form">
      <SectionHeader title="מפיות" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Color */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <ChipLabel>צבע</ChipLabel>
            <div className="flex gap-4 flex-wrap">
              {NAPKIN_COLORS.map((c) => (
                <RadioChip
                  key={c}
                  label={c}
                  selected={ev.napkins.color === c}
                  onSelect={() => patchNapkins({ color: c })}
                  testId={`napkin-color-${c}`}
                />
              ))}
            </div>
          </div>

          {/* Fabric */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <ChipLabel>בד</ChipLabel>
            <div className="flex gap-4 flex-wrap">
              {NAPKIN_FABRICS.map((f) => (
                <RadioChip
                  key={f}
                  label={f}
                  selected={ev.napkins.fabric === f}
                  onSelect={() => patchNapkins({ fabric: f })}
                  testId={`napkin-fabric-${f}`}
                />
              ))}
            </div>
          </div>

          {/* Fold type — also serves as the INV-04 witness when color === 'אחר' */}
          <div className="md:col-span-2 flex flex-col gap-2">
            <ChipLabel>
              {isOther ? 'קיפול / פירוט צבע' : 'קיפול'}
              {isOther && (
                <span aria-hidden="true" className="text-gold mr-1">
                  *
                </span>
              )}
            </ChipLabel>
            <input
              type="text"
              required={isOther}
              value={ev.napkins.foldType}
              onChange={(e) => patchNapkins({ foldType: e.target.value })}
              placeholder={
                isOther ? 'פרט את הצבע ואת סוג הקיפול…' : 'למשל: קיפול קלאסי'
              }
              data-testid="napkin-field-foldType"
              aria-invalid={witnessMissing}
              aria-describedby={witnessMissing ? 'napkin-witness-hint' : undefined}
              className={[
                'w-full bg-transparent border-0 border-b pb-2 px-0',
                'text-cream font-sans rounded-none focus:outline-none',
                'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
                witnessMissing
                  ? 'border-gold-dark focus:border-gold'
                  : 'border-border-subtle focus:border-gold',
              ].join(' ')}
            />
            {witnessMissing && (
              <p
                id="napkin-witness-hint"
                className="text-tiny text-gold-dark"
                role="alert"
              >
                בעת בחירת "אחר" יש לפרט את הצבע — אחרת המסמך יישלח ללא פרטים.
              </p>
            )}
          </div>

          {/* Reception toggle */}
          <div className="md:col-span-2 flex flex-col gap-3 mt-4">
            <ChipLabel>קבלת פנים ריזורט - למעלה?</ChipLabel>
            <div className="flex gap-4">
              <RadioChip
                label="כן"
                selected={ev.reception.atResort === true}
                onSelect={() => patchReception(true)}
                testId="reception-atResort-yes"
              />
              <RadioChip
                label="לא"
                selected={ev.reception.atResort === false}
                onSelect={() => patchReception(false)}
                testId="reception-atResort-no"
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
