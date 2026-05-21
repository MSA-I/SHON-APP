// SOP: Plans/02-תוכנית-המשך-ל-MVP.md § 5
// SOP: claude.md § Verification (the 6 tabs)
// SOP: architecture/11-domain-invariants.md INV-01 (≤ 5 table-design selections)
// SOP: architecture/15-component-architecture.md §6 (locked test-IDs)
//
// Two scopes:
//   1. Tab navigation — clicking each event-tab-* button activates the matching
//      panel and toggles aria-selected.
//   2. INV-01 cap-counter — TableDesignsTab's "X/5 נבחרו" counter reflects
//      EventContext state and the "פתח גלריה" button is disabled at 5/5.
//
// Uses real EventContext + real lib/db (fake-indexeddb). The lib/backup module
// is stubbed at module scope because EventContext.signEvent calls
// backup.exportBackup, which would otherwise hit the Tauri filesystem.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Required for `act()` to work with React 19's concurrent renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../lib/backup', () => ({
  exportBackup: vi.fn(async () => undefined),
}));

// happy-dom's <canvas>.getContext('2d') returns null, which crashes the real
// `react-signature-canvas` constructor as soon as the SummaryTab renders.
// The EventTabs test is scoped to tab-navigation + INV-01 cap-counter; it
// never exercises signature capture. We replace the dependency with a tiny
// presentational stub so the SummaryTab can mount without a working canvas.
// The real SignaturePad capture-pipeline is covered by the standalone
// SignaturePad component test file.
vi.mock('react-signature-canvas', async () => {
  // The real default export is a React class component whose instance exposes
  // `clear`, `isEmpty`, `toDataURL`, `off`, etc. The component under test
  // only reads these via a ref on user interaction — none of the navigation
  // tests trigger that path — so a minimal stub instance is sufficient.
  const React = await import('react');
  class SignatureCanvas extends React.Component {
    clear() {}
    isEmpty() {
      return true;
    }
    toDataURL() {
      return '';
    }
    off() {}
    on() {}
    render() {
      return null;
    }
  }
  return { default: SignatureCanvas };
});

import { EventTabs } from '../EventTabs';
import {
  EventProvider,
  useEvent,
} from '../../../contexts/EventContext';
import {
  __resetDbForTests,
  createClient,
  createEvent,
} from '../../../lib/db';
import type { Event, ImageSelection } from '../../../types';

// ---------------------------------------------------------------------------
// Render harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetDbForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function $(selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

function $$(selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

function clickButton(testId: string) {
  const btn = $(`[data-testid="${testId}"]`);
  return act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Test scaffolding — bootstraps EventContext with a real client + event so
// EventTabs has something to render. We use a tiny "Boot" child that calls
// loadClient on mount; the test awaits a microtask for the dispatch to land.
// ---------------------------------------------------------------------------

async function seedClientWithEvent(
  selections: ImageSelection[] = [],
): Promise<{ clientId: string; event: Event }> {
  const client = await createClient({
    coupleNames: 'ליאור ודן',
    phone: '050-1234567',
  });
  const event = await createEvent({
    clientId: client.id,
    date: '2026-06-14',
    dayOfWeek: 'ראשון',
    startTime: '20:00',
    location: 'גאמוס',
    guestCount: 350,
    isMixed: true,
    notes: '',
    napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
    reception: { atResort: false },
    tableDesignSelections: selections,
    chairs: { type: 'אבירים', bridalChair: '' },
    chuppah: {
      location: 'אולם',
      type: 'מרובעת',
      fabricDetails: '',
      designSelections: [],
      aisleDetails: '',
    },
    upgrades: { description: '', items: [] },
    signature: null,
    status: 'draft',
  });
  return { clientId: client.id, event };
}

function Boot({ clientId }: { clientId: string }) {
  const ctx = useEvent();
  useEffect(() => {
    void ctx.loadClient(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  return <EventTabs />;
}

async function renderWithEvent(clientId: string) {
  await act(async () => {
    root.render(
      <EventProvider>
        <Boot clientId={clientId} />
      </EventProvider>,
    );
  });
  // loadClient → db.getClient + db.listEventsByClient resolve over many
  // microtasks under fake-indexeddb; drain liberally so the EventTabs render
  // has the loaded event by the time the test asserts.
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function makeSelection(i: number): ImageSelection {
  return {
    imagePath: `אולם עיצוב בסיס 2026/design-${i}.JPG`,
    category: 'אולם עיצוב בסיס 2026',
    imageName: `design-${i}`,
    notes: '',
    selectedAt: 1_700_000_000_000 + i,
  };
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

describe('EventTabs — empty state', () => {
  it('renders "טען אירוע" when no event is loaded', async () => {
    await act(async () => {
      root.render(
        <EventProvider>
          <EventTabs />
        </EventProvider>,
      );
    });
    expect(container.textContent).toContain('טען אירוע');
    // The tab strip should NOT be rendered yet.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe('EventTabs — navigation', () => {
  it('renders all 6 Hebrew tab labels with details active by default', async () => {
    const { clientId } = await seedClientWithEvent();
    await renderWithEvent(clientId);

    const labels = $$('[role="tab"]').map((b) => b.textContent?.trim() ?? '');
    expect(labels).toEqual([
      'פרטי אירוע',
      'מפיות',
      'עיצובי שולחן',
      'חופה',
      'שדרוגים',
      'סיכום',
    ]);

    expect($('[data-testid="event-tab-details"]').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect($('[data-testid="event-panel-details"]')).toBeTruthy();
  });

  it('switches active panel when each tab is clicked', async () => {
    const { clientId } = await seedClientWithEvent();
    await renderWithEvent(clientId);

    const tabKeys: ReadonlyArray<{ key: string; selector: string }> = [
      { key: 'napkins', selector: '[data-testid="event-panel-napkins"]' },
      { key: 'tableDesigns', selector: '[data-testid="event-panel-tableDesigns"]' },
      { key: 'chuppah', selector: '[data-testid="event-panel-chuppah"]' },
      { key: 'upgrades', selector: '[data-testid="event-panel-upgrades"]' },
      { key: 'summary', selector: '[data-testid="event-panel-summary"]' },
    ];

    for (const { key, selector } of tabKeys) {
      await clickButton(`event-tab-${key}`);
      expect($(`[data-testid="event-tab-${key}"]`).getAttribute('aria-selected')).toBe(
        'true',
      );
      expect(container.querySelector(selector)).toBeTruthy();
    }
  });

  it('hides "שמור והמשך" on the summary tab and shows it elsewhere', async () => {
    const { clientId } = await seedClientWithEvent();
    await renderWithEvent(clientId);

    expect(container.querySelector('[data-testid="save-and-continue-button"]')).not.toBeNull();

    await clickButton('event-tab-summary');
    expect(container.querySelector('[data-testid="save-and-continue-button"]')).toBeNull();
  });

  it('"שמור והמשך" advances to the next tab', async () => {
    const { clientId } = await seedClientWithEvent();
    await renderWithEvent(clientId);

    await clickButton('save-and-continue-button');
    expect($('[data-testid="event-tab-napkins"]').getAttribute('aria-selected')).toBe(
      'true',
    );

    await clickButton('save-and-continue-button');
    expect(
      $('[data-testid="event-tab-tableDesigns"]').getAttribute('aria-selected'),
    ).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// INV-01 — cap counter
// ---------------------------------------------------------------------------

describe('EventTabs — INV-01 table-design selection cap (≤ 5)', () => {
  it('shows "0/5 נבחרו" when no selections are present', async () => {
    const { clientId } = await seedClientWithEvent();
    await renderWithEvent(clientId);

    await clickButton('event-tab-tableDesigns');

    const counter = $('[data-testid="selection-counter"]');
    expect(counter.textContent).toContain('0/5');
    expect(counter.textContent).toContain('נבחרו');

    // Open-gallery button is enabled at 0/5.
    const openBtn = $(
      '[data-testid="open-gallery-tableDesigns-button"]',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);
  });

  it('reflects partial selections (3/5) and keeps the gallery button enabled', async () => {
    const seeded = [makeSelection(1), makeSelection(2), makeSelection(3)];
    const { clientId } = await seedClientWithEvent(seeded);
    await renderWithEvent(clientId);

    await clickButton('event-tab-tableDesigns');

    expect($('[data-testid="selection-counter"]').textContent).toContain('3/5');
    const openBtn = $(
      '[data-testid="open-gallery-tableDesigns-button"]',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);

    // All 3 selected cards rendered.
    expect($$('[data-testid^="tableDesign-card-"]').length).toBe(3);
  });

  it('caps at 5/5 and disables the "פתח גלריה" button (INV-01)', async () => {
    const seeded = [
      makeSelection(1),
      makeSelection(2),
      makeSelection(3),
      makeSelection(4),
      makeSelection(5),
    ];
    const { clientId } = await seedClientWithEvent(seeded);
    await renderWithEvent(clientId);

    await clickButton('event-tab-tableDesigns');

    expect($('[data-testid="selection-counter"]').textContent).toContain('5/5');
    const openBtn = $(
      '[data-testid="open-gallery-tableDesigns-button"]',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);

    // 5 cards rendered (no overflow).
    expect($$('[data-testid^="tableDesign-card-"]').length).toBe(5);
  });

  it('removing a selection re-enables the gallery button (5 → 4)', async () => {
    const seeded = [
      makeSelection(1),
      makeSelection(2),
      makeSelection(3),
      makeSelection(4),
      makeSelection(5),
    ];
    const { clientId } = await seedClientWithEvent(seeded);
    await renderWithEvent(clientId);

    await clickButton('event-tab-tableDesigns');
    await clickButton(`tableDesign-remove-${seeded[0].imagePath}`);

    expect($('[data-testid="selection-counter"]').textContent).toContain('4/5');
    const openBtn = $(
      '[data-testid="open-gallery-tableDesigns-button"]',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);
  });
});
