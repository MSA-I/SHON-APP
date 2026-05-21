// SOP: claude.md § Event (upgrades — description + items)
// Behavioral Rule #4: upgrades are descriptive text only — no pricing logic.
// SOP: architecture/05-gallery-selection.md (Gallery accepts mode='upgrades')
// Maintenance Log 2026-05-21: per Agent C task brief, every event tab gets a
// gallery picker AND a tags slot. Upgrade selections live on the optional
// `upgrades.designSelections` extension to the Event schema.
//
// "שדרוגים" tab — a free-text description plus a chip-style bullet list, plus
// (new) reference-image selections from the "עיצובים שידרוג" gallery and a
// TagsDisplay slot. User types a line, presses Enter to add a bullet; clicks
// the X chip to remove.

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import type { Event, ImageSelection, Upgrades } from '../../types';

import { ChipLabel, SectionHeader } from './EventDetailsTab';
import { Gallery } from '../gallery/Gallery';
import { TagsDisplay } from './TagsDisplay';
import { SelectionThumbnail } from './SelectionThumbnail';

export function UpgradesTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  const [draft, setDraft] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);

  if (!ev) return null;

  // Maintenance Log 2026-05-21: optional designSelections — treat absent as [].
  const selections: ImageSelection[] = ev.upgrades.designSelections ?? [];

  function patchUpgrades(patch: Partial<Upgrades>) {
    ctx.dispatch({
      type: 'patch-event',
      patch: { upgrades: { ...ev!.upgrades, ...patch } } as Partial<Event>,
    });
  }

  function addItem() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (ev!.upgrades.items.includes(trimmed)) {
      // Silently ignore exact duplicates — no toast wiring at this layer yet.
      setDraft('');
      return;
    }
    patchUpgrades({ items: [...ev!.upgrades.items, trimmed] });
    setDraft('');
  }

  function removeItem(idx: number) {
    const next = ev!.upgrades.items.filter((_, i) => i !== idx);
    patchUpgrades({ items: next });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }

  function updateSelectionNotes(path: string, notes: string) {
    const next: ImageSelection[] = selections.map((s) =>
      s.imagePath === path ? { ...s, notes } : s,
    );
    patchUpgrades({ designSelections: next });
  }

  function removeSelection(path: string) {
    const next = selections.filter((s) => s.imagePath !== path);
    patchUpgrades({ designSelections: next });
  }

  return (
    <div data-testid="event-panel-upgrades-form">
      <SectionHeader title="שדרוגים" />

      <div className="bg-ink-raised border border-border-subtle p-8">
        <form
          className="flex flex-col gap-10"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Description */}
          <div className="flex flex-col gap-2">
            <ChipLabel>תיאור כללי</ChipLabel>
            <textarea
              rows={4}
              value={ev.upgrades.description}
              onChange={(e) => patchUpgrades({ description: e.target.value })}
              placeholder="תיאור חופשי של השדרוגים…"
              data-testid="upgrades-field-description"
              className="w-full bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold resize-none transition-colors duration-150"
            />
          </div>

          {/* Items — chip-style add */}
          <div className="flex flex-col gap-3">
            <ChipLabel>פריטי שדרוג</ChipLabel>
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder="הוסף פריט ולחץ Enter"
                data-testid="upgrades-field-items-input"
                className="flex-1 bg-transparent border-0 border-b border-border-subtle pb-2 px-0 text-cream font-sans rounded-none focus:outline-none focus:border-gold transition-colors duration-150"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={!draft.trim()}
                aria-label="הוסף פריט"
                data-testid="upgrades-add-item-button"
                className={[
                  'inline-flex items-center gap-2 border px-4 py-2 self-end',
                  'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
                  draft.trim()
                    ? 'border-gold text-cream hover:border-gold-dark cursor-pointer'
                    : 'border-border-subtle text-cream-muted opacity-60 cursor-not-allowed',
                ].join(' ')}
              >
                <Plus size={16} aria-hidden="true" />
                <span>הוסף</span>
              </button>
            </div>

            {/* Items list */}
            {ev.upgrades.items.length > 0 && (
              <ul
                data-testid="upgrades-items-list"
                className="flex flex-wrap gap-2 mt-4"
              >
                {ev.upgrades.items.map((item, idx) => (
                  <li
                    key={`${item}-${idx}`}
                    className="inline-flex items-center gap-2 border border-border-subtle px-4 py-2 text-cream font-sans"
                    data-testid={`upgrades-item-${idx}`}
                  >
                    <span dir="auto">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label={`הסר את ${item}`}
                      data-testid={`upgrades-remove-${idx}`}
                      className="text-cream-muted hover:text-gold transition-colors"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </div>

      {/* ── Reference images (gallery picker) ────────────────────────── */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <ChipLabel>השראה לשדרוגים ({selections.length})</ChipLabel>
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            data-testid="open-gallery-upgrades-button"
            className="inline-flex items-center gap-2 border border-gold text-cream font-sans px-6 py-2 hover:border-gold-dark transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] cursor-pointer"
          >
            <Plus size={16} aria-hidden="true" />
            <span>פתח גלריה</span>
          </button>
        </div>

        {selections.length === 0 ? (
          <div className="bg-ink-raised border border-border-subtle p-8 text-center">
            <p className="font-serif text-h3 text-cream-muted">
              עדיין לא נבחרו תמונות שדרוג
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {selections.map((sel) => (
              <li
                key={sel.imagePath}
                data-testid={`upgrades-card-${sel.imagePath}`}
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
                    onClick={() => removeSelection(sel.imagePath)}
                    aria-label="הסר בחירה"
                    data-testid={`upgrades-remove-image-${sel.imagePath}`}
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
                    onChange={(e) => updateSelectionNotes(sel.imagePath, e.target.value)}
                    placeholder="הערות לבחירה זו"
                    data-testid={`upgrades-image-notes-${sel.imagePath}`}
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
        <TagsDisplay selections={selections} testIdSuffix="upgrades" />
      </div>

      {galleryOpen && (
        <Gallery
          mode="upgrades"
          selections={selections}
          onClose={(nextSelections) => {
            patchUpgrades({ designSelections: nextSelections });
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}
