// SOP: claude.md § Event (upgrades — description + items)
// Behavioral Rule #4: upgrades are descriptive text only — no pricing logic.
//
// "שדרוגים" tab — a free-text description plus a chip-style bullet list.
// User types a line, presses Enter to add it; clicks the X chip to remove.

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

import { useEvent } from '../../contexts/EventContext';
import type { Event, Upgrades } from '../../types';

import { ChipLabel, SectionHeader } from './EventDetailsTab';

export function UpgradesTab(): ReactNode {
  const ctx = useEvent();
  const ev = ctx.currentEvent;
  const [draft, setDraft] = useState('');

  if (!ev) return null;

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
    </div>
  );
}
