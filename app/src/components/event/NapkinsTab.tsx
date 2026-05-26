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
import {
  FOLD_TYPES,
  type FoldType,
  type ImageSelection,
  type Napkins,
  type NapkinFabric,
} from '../../types';

import { ChipLabel, RadioChip, SectionHeader } from './EventDetailsTab';
import { Gallery } from '../gallery/Gallery';
import { TagsDisplay } from './TagsDisplay';
import { SelectionThumbnail } from './SelectionThumbnail';

const NAPKIN_FABRICS: readonly NapkinFabric[] = ['פניה', 'סטן'] as const;

/**
 * Maintenance Log 2026-05-24: derive the RadioChip selection from persisted
 * state. If `foldKind` is present we trust it (new-style writes). Otherwise
 * we infer from `foldType`: an exact match against the canonical 5 picks
 * that chip; any non-empty free-text falls back to "אחר"; an empty string
 * picks nothing (so the user can choose deliberately on first edit).
 */
function deriveFoldKind(napkins: Napkins): FoldType | null {
  if (napkins.foldKind) return napkins.foldKind;
  const text = napkins.foldType?.trim() ?? '';
  if (!text) return null;
  if ((FOLD_TYPES as readonly string[]).includes(text)) return text as FoldType;
  return 'אחר';
}

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
    ctx.setNapkinsSelections(next);
  }

  function removeAt(path: string) {
    ctx.dispatch({
      type: 'remove-napkins-selection',
      imagePath: path,
    });
  }

  // INV-04 no longer enforced (color picker removed 2026-05-24).

  // Maintenance Log 2026-05-24: chip group state for the canonical fold types.
  const activeFoldKind = deriveFoldKind(ev.napkins);
  const foldOtherText = activeFoldKind === 'אחר' ? ev.napkins.foldType : '';

  function pickFoldKind(kind: FoldType) {
    if (kind === 'אחר') {
      // Switching to "אחר" — keep any existing free-text witness if it isn't
      // one of the canonical labels; otherwise clear so the user starts fresh.
      const keep = (FOLD_TYPES as readonly string[]).includes(
        ev!.napkins.foldType.trim(),
      )
        ? ''
        : ev!.napkins.foldType;
      patchNapkins({ foldKind: 'אחר', foldType: keep });
    } else {
      // Canonical pick — mirror the chip label into foldType so DOCX export
      // and backups continue to read the human-readable string.
      patchNapkins({ foldKind: kind, foldType: kind });
    }
  }

  function setFoldOtherText(text: string) {
    patchNapkins({ foldKind: 'אחר', foldType: text });
  }

  return (
    <div data-testid="event-panel-napkins-form">
      <SectionHeader title="מפיות" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10"
          onSubmit={(e) => e.preventDefault()}
        >
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

          {/* Fold type — Maintenance Log 2026-05-24: replaced free-text input
              with a 5-chip RadioChip group + "אחר" escape that re-opens a
              free-text field. The free-text branch also serves as the INV-04
              witness when color === 'אחר'. */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <ChipLabel>סוג קיפול</ChipLabel>
            <div
              role="radiogroup"
              aria-label="סוג קיפול"
              data-testid="napkin-field-foldType"
              className="flex gap-4 flex-wrap"
            >
              {FOLD_TYPES.map((k) => (
                <RadioChip
                  key={k}
                  label={k}
                  selected={activeFoldKind === k}
                  onSelect={() => pickFoldKind(k)}
                  testId={`napkin-fold-${k}`}
                />
              ))}
            </div>
            {activeFoldKind === 'אחר' && (
              <div className="flex flex-col gap-2 mt-1">
                <ChipLabel>פירוט קיפול</ChipLabel>
                <input
                  type="text"
                  value={foldOtherText}
                  onChange={(e) => setFoldOtherText(e.target.value)}
                  placeholder="תאר את סוג הקיפול…"
                  data-testid="napkin-fold-other-input"
                  className="w-full bg-transparent border-0 border-b pb-2 px-0 text-cream font-sans rounded-none focus:outline-none transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] border-border-subtle focus:border-gold"
                />
              </div>
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
            ctx.setNapkinsSelections(nextSelections);
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
