// SOP: architecture/15-component-architecture.md §6 (locked test-IDs:
//      event-tab-details, event-tab-napkins, …, event-tab-summary)
// SOP: architecture/13-app-shell-routing.md §5 (EventContext + useEvent)
// SOP: architecture/06-signature-flow.md (summary tab → DOCX + signature)
// SOP: architecture/03-document-generation.md (buildEventDocx)
// SOP: claude.md § Verification (the 6 tabs Shon walks through with the couple)
// Stitch mockup: .tmp/stitch-mockups/.../event_tabs_dark/
//
// The Event tab system. A horizontal app-bar style tab strip + content area +
// bottom action row. Renders the active tab component. RTL throughout.
//
// Layer 2 only — no @tauri-apps, no idb. Mutations route through useEvent()
// (Layer 2 → Layer 3 boundary lives in the context provider, not here).

import { useState, type ReactNode } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '../ui/Button';
import { useEvent } from '../../contexts/EventContext';

import { EventDetailsTab } from './EventDetailsTab';
import { NapkinsTab } from './NapkinsTab';
import { TableDesignsTab } from './TableDesignsTab';
import { ChuppahTab } from './ChuppahTab';
import { UpgradesTab } from './UpgradesTab';
import { SummaryTab } from './SummaryTab';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TabKey =
  | 'details'
  | 'napkins'
  | 'tableDesigns'
  | 'chuppah'
  | 'upgrades'
  | 'summary';

type TabDef = { key: TabKey; label: string };

// Hebrew labels per Constitution § Verification step 4 + Stitch mockup
// (פרטי אירוע · מפיות · עיצובי שולחן · חופה · שדרוגים · סיכום).
const TABS: readonly TabDef[] = [
  { key: 'details', label: 'פרטי אירוע' },
  { key: 'napkins', label: 'מפיות' },
  { key: 'tableDesigns', label: 'עיצובי שולחן' },
  { key: 'chuppah', label: 'חופה' },
  { key: 'upgrades', label: 'שדרוגים' },
  { key: 'summary', label: 'סיכום' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventTabs(): ReactNode {
  const eventCtx = useEvent();
  const [active, setActive] = useState<TabKey>('details');

  // Empty-state: per task spec, show "טען אירוע" if no event is loaded.
  if (!eventCtx.currentEvent) {
    return (
      <section
        data-testid="event-tabs"
        className="min-h-[60vh] flex items-center justify-center"
      >
        <p className="font-serif text-h2 text-cream-muted">טען אירוע</p>
      </section>
    );
  }

  const isLastTab = active === 'summary';

  function advance() {
    const idx = TABS.findIndex((t) => t.key === active);
    if (idx === -1) return;
    const nextIdx = Math.min(idx + 1, TABS.length - 1);
    setActive(TABS[nextIdx].key);
  }

  return (
    <section data-testid="event-tabs" className="w-full">
      {/* ── Tab strip — app-bar style, hairline-separated ─────────────── */}
      <nav
        role="tablist"
        aria-label="ניווט בין שלבי תכנון האירוע"
        className="flex items-stretch border-b border-border-subtle bg-ink-raised"
      >
        {TABS.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            isActive={tab.key === active}
            onSelect={() => setActive(tab.key)}
          />
        ))}
      </nav>

      {/* ── Active panel ───────────────────────────────────────────────── */}
      <div
        role="tabpanel"
        data-testid={`event-panel-${active}`}
        className="px-16 py-24 max-w-5xl mx-auto"
      >
        {active === 'details' && <EventDetailsTab />}
        {active === 'napkins' && <NapkinsTab />}
        {active === 'tableDesigns' && <TableDesignsTab />}
        {active === 'chuppah' && <ChuppahTab />}
        {active === 'upgrades' && <UpgradesTab />}
        {active === 'summary' && <SummaryTab />}
      </div>

      {/* ── Bottom action row ──────────────────────────────────────────── */}
      <div className="border-t border-border-subtle px-16 py-6 flex justify-end gap-6">
        {!isLastTab && (
          <Button
            variant="primary"
            onClick={advance}
            testId="save-and-continue-button"
            icon={<ArrowLeft size={16} className="icon-rtl-mirror" aria-hidden="true" />}
          >
            שמור והמשך
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-component — single tab button
// ---------------------------------------------------------------------------

function TabButton({
  tab,
  isActive,
  onSelect,
}: {
  tab: TabDef;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-testid={`event-tab-${tab.key}`}
      onClick={onSelect}
      className={[
        'relative px-6 py-4 font-sans uppercase select-none cursor-pointer',
        'border-l border-border-subtle last:border-l-0',
        'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        isActive ? 'text-gold' : 'text-cream-muted hover:text-cream',
      ].join(' ')}
      style={{
        fontSize: '0.75rem',
        letterSpacing: '0.12em',
        fontWeight: 600,
      }}
    >
      <span>{tab.label}</span>
      {/* 2px gold underline for active — per Stitch mockup. */}
      {isActive && (
        <motion.span
          aria-hidden="true"
          layoutId="event-tab-underline"
          className="absolute inset-x-0 -bottom-px h-0.5 bg-gold"
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
    </button>
  );
}

// SummaryTab triggers the DOCX export internally (it owns the SignaturePad).
// EventTabs intentionally does NOT render its own "ייצוא Word" button — the
// summary tab is the sole owner of that action so the signature + export are
// adjacent and atomic.
void FileText; // silence unused-import; reserved for future header icon.
