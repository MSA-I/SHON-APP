// SOP: claude.md § Event (chuppah)
// SOP: architecture/05-gallery-selection.md (chuppah selections share the
//      same selection contract as table designs)
// Stitch mockup: event_tabs_dark — חופה screen
//
// Captures the chuppah type, location, fabric details, aisle details, and
// the chuppah image selections. There is no cap on chuppah selections in
// the schema (only `tableDesignSelections` carries INV-01); but we still
// render them through the same compact card grid for visual consistency.

import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import type {
  Chuppah,
  ChuppahLocation,
  ChuppahType,
  Event,
  ImageSelection,
} from '../../types';

import { ChipLabel, RadioChip, SectionHeader } from './EventDetailsTab';
import { Gallery } from '../gallery/Gallery';
import { TagsDisplay } from './TagsDisplay';
import { SelectionThumbnail } from './SelectionThumbnail';

const CHUPPAH_TYPES: readonly ChuppahType[] = [
  'מרובעת',
  'עגולה',
  'שקופה',
  'אובלית',
] as const;

const CHUPPAH_LOCATIONS: readonly ChuppahLocation[] = ['בריכה', 'אולם'] as const;

export function ChuppahTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!ev) return null;

  function patchChuppah(patch: Partial<Chuppah>) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { chuppah: { ...ev!.chuppah, ...patch } } as Partial<Event>,
    });
  }

  function updateNotes(path: string, notes: string) {
    if (!ev) return;
    const nextSelections: ImageSelection[] = ev.chuppah.designSelections.map(
      (s) => (s.imagePath === path ? { ...s, notes } : s),
    );
    ctx.dispatch({
      type: 'patch-event',
      patch: {
        chuppah: { ...ev.chuppah, designSelections: nextSelections },
      } as Partial<Event>,
    });
  }

  function removeAt(sel: ImageSelection) {
    // EventContext.toggleChuppahSelection toggles by imagePath; calling it
    // when the selection is already present removes it (SOP 05 contract).
    ctx.toggleChuppahSelection(sel);
  }

  const selections = ev.chuppah.designSelections;

  return (
    <div data-testid="event-panel-chuppah-form">
      <SectionHeader title="חופה" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Type */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <ChipLabel>סוג החופה</ChipLabel>
            <div className="flex gap-4 flex-wrap">
              {CHUPPAH_TYPES.map((t) => (
                <RadioChip
                  key={t}
                  label={t}
                  selected={ev.chuppah.type === t}
                  onSelect={() => patchChuppah({ type: t })}
                  testId={`chuppah-type-${t}`}
                />
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <ChipLabel>מיקום</ChipLabel>
            <div className="flex gap-4 flex-wrap">
              {CHUPPAH_LOCATIONS.map((l) => (
                <RadioChip
                  key={l}
                  label={l}
                  selected={ev.chuppah.location === l}
                  onSelect={() => patchChuppah({ location: l })}
                  testId={`chuppah-location-${l}`}
                />
              ))}
            </div>
          </div>

          {/* Fabric details */}
          <div className="md:col-span-2 flex flex-col gap-2">
            <ChipLabel>פירוט בדים</ChipLabel>
            <textarea
              rows={2}
              value={ev.chuppah.fabricDetails}
              onChange={(e) => patchChuppah({ fabricDetails: e.target.value })}
              placeholder="למשל: וילון לבן נשפך"
              data-testid="chuppah-field-fabricDetails"
              className="w-full bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold resize-none transition-colors duration-150"
            />
          </div>

          {/* Aisle details */}
          <div className="md:col-span-2 flex flex-col gap-2">
            <ChipLabel>שדרה לחופה</ChipLabel>
            <textarea
              rows={2}
              value={ev.chuppah.aisleDetails}
              onChange={(e) => patchChuppah({ aisleDetails: e.target.value })}
              placeholder="למשל: אבני חצץ לבנות"
              data-testid="chuppah-field-aisleDetails"
              className="w-full bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold resize-none transition-colors duration-150"
            />
          </div>
        </form>
      </div>

      {/* ── Image selections ──────────────────────────────────────────── */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <ChipLabel>תמונות חופה נבחרות ({selections.length})</ChipLabel>
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            data-testid="open-gallery-chuppah-button"
            className="inline-flex items-center gap-2 border border-gold text-cream font-sans px-6 py-2 hover:border-gold-dark transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] cursor-pointer"
          >
            <Plus size={16} aria-hidden="true" />
            <span>פתח גלריה</span>
          </button>
        </div>

        {selections.length === 0 ? (
          <div className="bg-ink-raised border border-border-subtle p-8 text-center">
            <p className="font-serif text-h3 text-cream-muted">
              עדיין לא נבחרו תמונות חופה
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {selections.map((sel) => (
              <li
                key={sel.imagePath}
                data-testid={`chuppah-card-${sel.imagePath}`}
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
                    onClick={() => removeAt(sel)}
                    aria-label="הסר בחירה"
                    data-testid={`chuppah-remove-${sel.imagePath}`}
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
                    placeholder="הערות לחופה זו"
                    data-testid={`chuppah-notes-${sel.imagePath}`}
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
        <TagsDisplay selections={selections} testIdSuffix="chuppah" />
      </div>

      {galleryOpen && (
        <Gallery
          mode="chuppah"
          selections={selections}
          onClose={(nextSelections) => {
            // Persist the gallery's working copy into the canonical event
            // record. We patch the whole chuppah object so the reducer's
            // SOP 11 INV-02 status revert fires consistently.
            ctx.dispatch({
              type: 'patch-event',
              patch: {
                chuppah: { ...ev.chuppah, designSelections: nextSelections },
              } as Partial<Event>,
            });
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
