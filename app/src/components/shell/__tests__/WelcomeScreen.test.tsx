// SOP: claude.md § Phase WOW
// SOP: architecture/15-component-architecture.md (test-id convention)
//
// Coverage for the daily-greeting interstitial. Targets:
//   1. Greeting copy picks the right Hebrew phrase by local hour.
//   2. Three stat cards reflect values returned by the lib/db helpers.
//   3. "התחל" CTA invokes the onStart handler.
//   4. Reduced-motion path still renders the same content.
//   5. Locked test-IDs `welcome-screen` and `welcome-start` are present.
//
// `lib/db` is mocked at module scope so the test does not depend on
// IndexedDB seed data. `framer-motion`'s `useReducedMotion` is mocked
// per-suite so we can flip the reduced-motion branch on demand.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Required for `act()` to work with React 19's concurrent renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock the three db helpers WelcomeScreen reads. Variables are mutated
// per-test inside the `vi.mock` factory closure.
const mockCounts = {
  active: 0,
  monthly: 0,
  upcoming: undefined as
    | { event: { date: string; clientId: string }; coupleNames: string }
    | undefined,
};

vi.mock('../../../lib/db', () => ({
  countActiveClients: vi.fn(async () => mockCounts.active),
  countEventsThisMonth: vi.fn(async () => mockCounts.monthly),
  getNextUpcomingEvent: vi.fn(async () => mockCounts.upcoming),
}));

// Provide an overridable mock for framer-motion's useReducedMotion. We re-use
// the real module for everything else (motion.h1, AnimatePresence, etc.) so
// the WelcomeScreen + Stagger + useEntrance code paths are exercised.
let reducedMotion = false;
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>(
    'framer-motion',
  );
  return {
    ...actual,
    useReducedMotion: () => reducedMotion,
  };
});

import { WelcomeScreen } from '../WelcomeScreen';

// ---------------------------------------------------------------------------
// Render harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reducedMotion = false;
  mockCounts.active = 0;
  mockCounts.monthly = 0;
  mockCounts.upcoming = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function $(selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

async function flushAsync(ticks = 10) {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderWelcome(onStart: () => void = () => undefined) {
  await act(async () => {
    root.render(<WelcomeScreen onStart={onStart} />);
  });
  // Drain the microtask queue so the stats useEffect resolves.
  await flushAsync();
}

/**
 * Stub `Date` so `new Date().getHours()` returns the requested hour. We only
 * fake Date — fake-indexeddb is not in play here but vitest's standard
 * setSystemTime also pulls in setTimeout etc.; safer to constrain.
 */
function setHour(hour: number) {
  const fixed = new Date(2026, 5, 14, hour, 0, 0).getTime(); // 2026-06-14 local
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixed);
}

// ---------------------------------------------------------------------------
// Greeting by hour
// ---------------------------------------------------------------------------

describe('WelcomeScreen — greeting by hour', () => {
  it('renders "בוקר טוב, שון" at 09:00', async () => {
    setHour(9);
    await renderWelcome();
    expect(container.textContent).toContain('בוקר טוב, שון');
    expect(container.textContent).not.toContain('צהריים טובים');
    expect(container.textContent).not.toContain('ערב טוב');
  });

  it('renders "צהריים טובים, שון" at 14:00', async () => {
    setHour(14);
    await renderWelcome();
    expect(container.textContent).toContain('צהריים טובים, שון');
  });

  it('renders "ערב טוב, שון" at 20:00', async () => {
    setHour(20);
    await renderWelcome();
    expect(container.textContent).toContain('ערב טוב, שון');
  });

  it('renders "ערב טוב, שון" at 03:00 (late-night branch)', async () => {
    setHour(3);
    await renderWelcome();
    expect(container.textContent).toContain('ערב טוב, שון');
  });
});

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

describe('WelcomeScreen — stat cards', () => {
  it('renders the locked welcome-screen testId', async () => {
    setHour(9);
    await renderWelcome();
    expect($('[data-testid="welcome-screen"]')).toBeTruthy();
  });

  it('renders 3 stat labels', async () => {
    setHour(9);
    await renderWelcome();
    expect(container.textContent).toContain('לקוחות פעילים');
    expect(container.textContent).toContain('אירועים החודש');
    expect(container.textContent).toContain('האירוע הקרוב');
  });

  it('renders zero state when db is empty', async () => {
    setHour(9);
    mockCounts.active = 0;
    mockCounts.monthly = 0;
    mockCounts.upcoming = undefined;
    await renderWelcome();
    // Numeric figures appear as strings.
    expect(container.textContent).toContain('אין אירועים קרובים');
    // Both 0/— values must be present somewhere in the card grid.
    // (Exact "0" can clash with other text — we assert the empty-state subtext.)
  });

  it('reflects values returned by the db helpers', async () => {
    setHour(9);
    mockCounts.active = 7;
    mockCounts.monthly = 3;
    mockCounts.upcoming = {
      event: { date: '2026-06-20', clientId: 'cid' },
      coupleNames: 'מיכל ויובל',
    };

    await renderWelcome();

    // Numeric stat cards.
    expect(container.textContent).toContain('7');
    expect(container.textContent).toContain('3');
    // Couple name from upcoming event.
    expect(container.textContent).toContain('מיכל ויובל');
    // Pretty-formatted date with Hebrew weekday.
    expect(container.textContent).toContain('20.06.2026');
  });
});

// ---------------------------------------------------------------------------
// onStart handler + locked CTA testId
// ---------------------------------------------------------------------------

describe('WelcomeScreen — CTA', () => {
  it('renders the locked welcome-start testId', async () => {
    setHour(9);
    await renderWelcome();
    expect($('[data-testid="welcome-start"]')).toBeTruthy();
  });

  it('calls onStart when the CTA is clicked', async () => {
    setHour(9);
    const onStart = vi.fn();
    await renderWelcome(onStart);

    await act(async () => {
      $('[data-testid="welcome-start"]').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

describe('WelcomeScreen — reduced motion', () => {
  it('still renders the greeting + stats + CTA when prefers-reduced-motion is set', async () => {
    reducedMotion = true;
    setHour(14);
    mockCounts.active = 5;
    mockCounts.monthly = 2;

    await renderWelcome();

    expect(container.textContent).toContain('צהריים טובים, שון');
    expect(container.textContent).toContain('לקוחות פעילים');
    expect(container.textContent).toContain('אירועים החודש');
    expect($('[data-testid="welcome-start"]')).toBeTruthy();
  });
});
