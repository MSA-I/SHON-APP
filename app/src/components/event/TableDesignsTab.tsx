// SOP: claude.md § Event (tableDesignSelections — עד 5 בחירות)
// SOP: architecture/05-gallery-selection.md § Selection Semantics
// SOP: architecture/11-domain-invariants.md INV-01 (≤ 5 selections),
//      INV-12 (selectedAt set by lib/context, not by callers)
//
// "עיצובי שולחן" tab — counter pill (X/5), grid of selected images with
// per-image notes, and a "פתח גלריה" button that opens <Gallery mode="tableDesigns">.
// Selection state lives in EventContext (so the gallery and the tab share it).

import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import type { Event, ImageSelection } from '../../types';

import { ChipLabel, SectionHeader } from './EventDetailsTab';
import { Gallery } from '../gallery/Gallery';

const SELECTION_CAP = 5;

export function TableDesignsTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!ev) return null;

  const selections = ev.tableDesignSelections;
  const count = selections.length;

  function updateNotes(path: string, notes: string) {
    // EventContext exposes `dispatch({type: 'patch-event'})` only — we patch
    // the whole array so the SOP 11 INV-01 cap and INV-02 status revert (in
    // the reducer) run on every notes edit.
    const next: ImageSelection[] = selections.map((s) =>
      s.imagePath === path ? { ...s, notes } : s,
    );
    ctx.dispatch({
      type: 'patch-event',
      patch: { tableDesignSelections: next } as Partial<Event>,
    });
  }

  function removeAt(path: string) {
    // SOP 05 § Selection Semantics — toggling an already-selected image
    // removes it. EventContext.toggleTableSelection enforces INV-01 / INV-12.
    const sel = selections.find((s) => s.imagePath === path);
    if (!sel) return;
    ctx.toggleTableSelection(sel);
  }

  return (
    <div data-testid="event-panel-tableDesigns-form">
      <SectionHeader title="עיצובי שולחן" />

      {/* ── Counter + Open Gallery row ────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <span
          data-testid="selection-counter"
          className="text-label uppercase text-gold-dark"
          style={{ letterSpacing: '0.12em' }}
        >
          {count}/{SELECTION_CAP} נבחרו
        </span>

        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          data-testid="open-gallery-tableDesigns-button"
          disabled={count >= SELECTION_CAP}
          className={[
            'inline-flex items-center gap-2 border px-6 py-2',
            'text-cream font-sans transition-colors duration-150',
            'ease-[cubic-bezier(0.4,0,0.2,1)]',
            count >= SELECTION_CAP
              ? 'border-border-subtle text-cream-muted cursor-not-allowed opacity-60'
              : 'border-gold hover:border-gold-dark cursor-pointer',
          ].join(' ')}
        >
          <Plus size={16} aria-hidden="true" />
          <span>פתח גלריה</span>
        </button>
      </div>

      {/* ── Selected images grid ──────────────────────────────────────── */}
      {count === 0 ? (
        <div className="bg-ink-raised border border-border-subtle p-12 text-center">
          <p className="font-serif text-h3 text-cream-muted mb-2">
            עדיין לא נבחרו עיצובי שולחן
          </p>
          <p className="text-small text-cream-muted">
            פתחי את הגלריה לבחירת עד {SELECTION_CAP} עיצובים.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {selections.map((sel) => (
            <SelectedCard
              key={sel.imagePath}
              selection={sel}
              onChangeNotes={(n) => updateNotes(sel.imagePath, n)}
              onRemove={() => removeAt(sel.imagePath)}
            />
          ))}
        </ul>
      )}

      {/* ── Gallery modal ─────────────────────────────────────────────── */}
      {galleryOpen && (
        <Gallery
          mode="tableDesigns"
          selections={selections}
          maxSelections={SELECTION_CAP}
          onClose={(nextSelections) => {
            // Flush the gallery's working copy back into the canonical event
            // record. We patch the whole array so SOP 11 INV-01 (≤ 5) and
            // INV-02 (status revert) run inside the reducer.
            ctx.dispatch({
              type: 'patch-event',
              patch: { tableDesignSelections: nextSelections } as Partial<Event>,
            });
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal — single selected image card
// ---------------------------------------------------------------------------

function SelectedCard({
  selection,
  onChangeNotes,
  onRemove,
}: {
  selection: ImageSelection;
  onChangeNotes: (notes: string) => void;
  onRemove: () => void;
}) {
  return (
    <li
      data-testid={`tableDesign-card-${selection.imagePath}`}
      className="bg-ink-raised border border-border-subtle p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <ChipLabel>{selection.category}</ChipLabel>
          <span
            className="font-serif text-h3 text-cream mt-1"
            dir="auto"
          >
            {selection.imageName}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="הסר בחירה"
          data-testid={`tableDesign-remove-${selection.imagePath}`}
          className="text-cream-muted hover:text-gold transition-colors"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Tiny thumbnail placeholder — real thumbnails arrive via images.ts in 3C */}
      <div className="aspect-[4/3] bg-ink border border-border-subtle flex items-center justify-center">
        <span className="text-tiny text-cream-muted">תמונה</span>
      </div>

      <label className="flex flex-col gap-2">
        <ChipLabel>הערה</ChipLabel>
        <textarea
          rows={2}
          value={selection.notes}
          onChange={(e) => onChangeNotes(e.target.value)}
          placeholder="למשל: בצבע זהב"
          data-testid={`tableDesign-notes-${selection.imagePath}`}
          className="w-full bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold resize-none transition-colors duration-150"
        />
      </label>
    </li>
  );
}

