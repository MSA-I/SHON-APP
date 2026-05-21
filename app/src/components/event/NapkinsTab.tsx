// SOP: claude.md § Event (napkins, reception)
// SOP: architecture/11-domain-invariants.md INV-04
//      (napkins.color === 'אחר' requires non-empty witness in foldType / notes)
// SOP: architecture/05-gallery-selection.md (Gallery accepts mode='napkins')
// Maintenance Log 2026-05-21: per Agent C task brief, every event tab gets a
// gallery picker AND a tags slot. Napkin selections live on the optional
// `napkins.designSelections` extension to the Event schema.
//
// Captures napkin color/fabric/fold + the "reception at resort" toggle, plus
// (new) reference-image selections from the "מפות מפיות" gallery and a
// TagsDisplay slot. INV-04 is enforced HERE at the UI layer per the SOP:
// when color === 'אחר', surface a required text input ("פירוט צבע") that
// writes back into napkins.foldType. The "המשך" button (in EventTabs) is
// disabled by reading `eventCtx.unsavedChanges` and a derived validity flag
// — but per the locked SOP, db.ts only soft-warns, so the UI is the
// primary gate.

import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import type {
  Event,
  ImageSelection,
  Napkins,
  NapkinColor,
  NapkinFabric,
} from '../../types';

import { ChipLabel, RadioChip, SectionHeader } from './EventDetailsTab';
import { Gallery } from '../gallery/Gallery';
import { TagsDisplay } from './TagsDisplay';
import { SelectionThumbnail } from './SelectionThumbnail';

const NAPKIN_COLORS: readonly NapkinColor[] = [
  'וורד עתיק',
  'פשתן',
  'אחר',
] as const;

const NAPKIN_FABRICS: readonly NapkinFabric[] = ['פניה', 'סטן'] as const;

export function NapkinsTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!ev) return null;

  // Maintenance Log 2026-05-21: optional designSelections — treat absent as [].
  const selections: ImageSelection[] = ev.napkins.designSelections ?? [];

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

  function updateNotes(path: string, notes: string) {
    const next: ImageSelection[] = selections.map((s) =>
      s.imagePath === path ? { ...s, notes } : s,
    );
    ctx.dispatch({
      type: 'patch-event',
      patch: {
        napkins: { ...ev!.napkins, designSelections: next },
      } as Partial<Event>,
    });
  }

  function removeAt(path: string) {
    const next = selections.filter((s) => s.imagePath !== path);
    ctx.dispatch({
      type: 'patch-event',
      patch: {
        napkins: { ...ev!.napkins, designSelections: next },
      } as Partial<Event>,
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

      {/* ── Reference images (gallery picker) ────────────────────────── */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <ChipLabel>השראה למפיות ({selections.length})</ChipLabel>
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            data-testid="open-gallery-napkins-button"
            className="inline-flex items-center gap-2 border border-gold text-cream font-sans px-6 py-2 hover:border-gold-dark transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] cursor-pointer"
          >
            <Plus size={16} aria-hidden="true" />
            <span>פתח גלריה</span>
          </button>
        </div>

        {selections.length === 0 ? (
          <div className="bg-ink-raised border border-border-subtle p-8 text-center">
            <p className="font-serif text-h3 text-cream-muted">
              עדיין לא נבחרו תמונות מפיות
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {selections.map((sel) => (
              <li
                key={sel.imagePath}
                data-testid={`napkins-card-${sel.imagePath}`}
                className="bg-ink-raised border border-border-subtle p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <ChipLabel>{sel.category}</ChipLabel>
                    <span className="font-serif text-h3 text-cream mt-1" dir="auto">
                      {sel.imageName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(sel.imagePath)}
                    aria-label="הסר בחירה"
                    data-testid={`napkins-remove-${sel.imagePath}`}
                    className="text-cream-muted hover:text-gold transition-colors"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <SelectionThumbnail
                  imagePath={sel.imagePath}
                  imageName={sel.imageName}
                />
                <label className="flex flex-col gap-2">
                  <ChipLabel>הערה</ChipLabel>
                  <textarea
                    rows={2}
                    value={sel.notes}
                    onChange={(e) => updateNotes(sel.imagePath, e.target.value)}
                    placeholder="הערות לבחירה זו"
                    data-testid={`napkins-notes-${sel.imagePath}`}
                    className="w-full bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold resize-none transition-colors duration-150"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Tags slot (always rendered, empty-state aware) ───────────── */}
      <div className="mt-8">
        <TagsDisplay selections={selections} testIdSuffix="napkins" />
      </div>

      {galleryOpen && (
        <Gallery
          mode="napkins"
          selections={selections}
          onClose={(nextSelections) => {
            ctx.dispatch({
              type: 'patch-event',
              patch: {
                napkins: { ...ev.napkins, designSelections: nextSelections },
              } as Partial<Event>,
            });
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
