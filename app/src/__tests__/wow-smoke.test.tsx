// SOP: claude.md § Phase WOW
// SOP: architecture/13-app-shell-routing.md
//
// Smoke coverage of the App.tsx boot router for the daily-greeting flow:
//   1. taggingComplete=true + lastWelcomeDate unset → renders <WelcomeScreen />.
//   2. taggingComplete=true + lastWelcomeDate=today → skips welcome, renders Home.
//   3. Clicking "התחל" writes today's local-ISO date to meta.lastWelcomeDate.
//
// Heavy modules that pull in Tauri / canvas / DOCX are stubbed at module
// scope so the test runs entirely in happy-dom. We stay narrow on purpose —
// the exhaustive UI walk lives in the component-level test files.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Required for `act()` to work with React 19's concurrent renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Module stubs
// ---------------------------------------------------------------------------

// Backup writes to disk via Tauri; stub it out.
vi.mock('../lib/backup', () => ({
  exportBackup: vi.fn(async () => undefined),
}));

// react-signature-canvas crashes in happy-dom because <canvas>.getContext('2d')
// returns null. EventTabs/SummaryTab is not rendered by the smoke flow but the
// boot path indirectly exercises the contexts that import it elsewhere; this
// stub is defensive and matches the EventTabs.test.tsx pattern.
vi.mock('react-signature-canvas', async () => {
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

// Tagging pass and settings touch the filesystem scanner; stub them with
// trivial placeholders so the boot router can resolve them. Only TaggingPass
// is needed for the alternate-branch test (taggingComplete=false) — we keep
// the smoke focused on the post-tagging flow, but the import graph still
// resolves these modules at load.
vi.mock('../components/tagging/TaggingPass', () => ({
  TaggingPass: () => <div data-testid="tagging-pass-stub">tagging</div>,
}));

vi.mock('../components/settings/Settings', () => ({
  Settings: () => <div data-testid="settings-stub">settings</div>,
}));

// ClientList performs a db.listClients call on mount — fine, but we cap it to
// a tiny stub so we can sniff "Home is rendered" via a test-id without dragging
// in the full client form/grid.
vi.mock('../components/client', () => ({
  ClientList: () => <div data-testid="client-list-stub">home</div>,
}));

import App from '../App';
import { __resetDbForTests, getMeta, setMeta } from '../lib/db';

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

async function flushAsync(ticks = 30) {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function waitForSelector(selector: string, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (container.querySelector(selector)) return;
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 8));
    });
  }
  throw new Error(`waitForSelector timeout: ${selector}`);
}

function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function renderApp() {
  await act(async () => {
    root.render(<App />);
  });
  await flushAsync();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase WOW boot router smoke', () => {
  it('renders <WelcomeScreen /> when tagging is complete and lastWelcomeDate is unset', async () => {
    await setMeta('taggingComplete', true);
    // lastWelcomeDate intentionally NOT set.

    await renderApp();
    await waitForSelector('[data-testid="welcome-screen"]');

    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="client-list-stub"]')).toBeNull();
  });

  it('skips welcome and renders Home when lastWelcomeDate is today', async () => {
    await setMeta('taggingComplete', true);
    await setMeta('lastWelcomeDate', todayLocalIso());

    await renderApp();
    await waitForSelector('[data-testid="client-list-stub"]');

    expect(container.querySelector('[data-testid="client-list-stub"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull();
  });

  it('writes lastWelcomeDate=today to meta after the user clicks "התחל"', async () => {
    await setMeta('taggingComplete', true);

    await renderApp();
    await waitForSelector('[data-testid="welcome-start"]');

    // Sanity: meta is unset before the click.
    expect(await getMeta('lastWelcomeDate')).toBeUndefined();

    await act(async () => {
      const btn = container.querySelector<HTMLElement>('[data-testid="welcome-start"]');
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // setMeta + setView resolve over multiple microtasks.
    await flushAsync(20);

    expect(await getMeta('lastWelcomeDate')).toBe(todayLocalIso());
    // After the click, Home (stub) is on screen and welcome is gone.
    await waitForSelector('[data-testid="client-list-stub"]');
    expect(container.querySelector('[data-testid="welcome-screen"]')).toBeNull();
  });
});
