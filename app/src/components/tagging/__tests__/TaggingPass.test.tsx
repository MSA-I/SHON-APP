// SOP: Plans/02-תוכנית-המשך-ל-MVP.md § 5
// SOP: architecture/12-image-tagging.md (one-time pass; cursor advances on save)
// SOP: claude.md § Behavioral Rules #11 (taggingComplete gate)
//
// Full-flow test for the Image Tagging Pass.
//
// What's mocked:
//   - lib/images       — scanAll() returns a deterministic 2-image library;
//                        toImageSrc() returns a stable URL. Filesystem is
//                        unavailable under happy-dom, so this is mandatory.
//   - lib/backup       — exportBackup() is a no-op so the auto-backup that
//                        fires on completion (SOP 07 trigger #3) doesn't try
//                        to hit the Tauri FS.
// What's REAL:
//   - lib/db (fake-indexeddb) — putImageTag, listImageTags, completeTaggingPass
//                               all run against the real IDB layer so the test
//                               exercises persistence end-to-end.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Required for `act()` to work with React 19's concurrent renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- Mocks (must be before importing the component under test) -------------

vi.mock('../../../lib/images', () => {
  const images = [
    {
      path: 'אולם עיצוב בסיס 2026/aaa.JPG',
      name: 'aaa',
      category: 'אולם עיצוב בסיס 2026',
      kind: 'image',
      fileType: 'jpg',
      sizeBytes: 1234,
      modifiedAt: 1_700_000_000_000,
    },
    {
      path: 'אולם עיצוב בסיס 2026/bbb.JPG',
      name: 'bbb',
      category: 'אולם עיצוב בסיס 2026',
      kind: 'image',
      fileType: 'jpg',
      sizeBytes: 5678,
      modifiedAt: 1_700_000_001_000,
    },
  ];
  return {
    scanAll: vi.fn(async () => {
      const byCategory = new Map<string, typeof images>();
      byCategory.set('אולם עיצוב בסיס 2026', images);
      return { byCategory, failed: [] };
    }),
    toImageSrc: vi.fn(
      (img: { path: string }) => `mock://image/${encodeURIComponent(img.path)}`,
    ),
    // Background thumbnail bake — TaggingPass kicks this off in a fire-and-
    // forget effect. Stub it as a no-op so the test environment doesn't try
    // to decode bytes from a non-existent filesystem.
    bakeThumbnailsBatch: vi.fn(async () => undefined),
  };
});

vi.mock('../../../lib/backup', () => ({
  exportBackup: vi.fn(async () => undefined),
}));

import { TaggingPass } from '../TaggingPass';
import {
  __resetDbForTests,
  getMeta,
  listImageTags,
} from '../../../lib/db';
import * as backup from '../../../lib/backup';

// ---------------------------------------------------------------------------
// Render harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetDbForTests();
  vi.mocked(backup.exportBackup).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function $(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function $req(selector: string): HTMLElement {
  const el = $(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

async function flush() {
  // The boot effect chains scanAll + listImageTags (both async, IDB-backed),
  // then dispatches multiple setStates inside an `await Promise.all(…)`. Real
  // fake-indexeddb resolves over many microtasks; drain liberally.
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function clickByTestId(testId: string) {
  const el = $req(`[data-testid="${testId}"]`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function renderPass(opts: {
  onComplete?: () => void;
  onProgress?: (n: number, total: number) => void;
} = {}) {
  await act(async () => {
    root.render(
      <TaggingPass
        onComplete={opts.onComplete ?? (() => {})}
        onProgress={opts.onProgress}
      />,
    );
  });
  await flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaggingPass — boot', () => {
  it('shows the loading state before scanAll() resolves', async () => {
    await act(async () => {
      root.render(<TaggingPass onComplete={() => {}} />);
    });
    // Synchronously after render, before microtasks flush — should be loading.
    expect(container.textContent).toContain('טוען ספריית תמונות');
    await flush();
  });

  it('renders the first card, counter "0 / 2 תויגו", and the disabled finish button', async () => {
    await renderPass();

    const counter = $req('[data-testid="tagging-counter"]');
    expect(counter.textContent).toMatch(/0\s*\/\s*2/);
    expect(counter.textContent).toContain('תויגו');

    // Image src derived from toImageSrc() mock.
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      `mock://image/${encodeURIComponent('אולם עיצוב בסיס 2026/aaa.JPG')}`,
    );

    // "סיים תיוג" is disabled until at least one image has been saved.
    const finish = $req('[data-testid="tagging-finish"]') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
  });
});

describe('TaggingPass — full save+advance flow', () => {
  it('persists a tag, advances the cursor, and calls onProgress', async () => {
    const onProgress = vi.fn();
    await renderPass({ onProgress });

    // Save the first card with no input — semantics per SOP 12 § 4 allow
    // empty tags as a valid "skipped" record.
    await clickByTestId('tagging-save-next');

    // Cursor advanced — second image now showing.
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      `mock://image/${encodeURIComponent('אולם עיצוב בסיס 2026/bbb.JPG')}`,
    );

    // Counter ticked.
    expect($req('[data-testid="tagging-counter"]').textContent).toMatch(
      /1\s*\/\s*2/,
    );

    // Finish button enabled once we have a saved image.
    const finish = $req('[data-testid="tagging-finish"]') as HTMLButtonElement;
    expect(finish.disabled).toBe(false);

    // onProgress fired with (taggedCount, total).
    expect(onProgress).toHaveBeenCalledWith(1, 2);

    // The tag is in IDB (real fake-indexeddb).
    const tags = await listImageTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].imagePath).toBe('אולם עיצוב בסיס 2026/aaa.JPG');
  });

  it('saving the last untagged image auto-completes the pass and writes meta.taggingComplete', async () => {
    const onComplete = vi.fn();
    await renderPass({ onComplete });

    // Save card 1 → cursor advances to card 2.
    await clickByTestId('tagging-save-next');
    // Save card 2 → no more untagged images → completeTaggingPass + onComplete.
    await clickByTestId('tagging-save-next');

    expect(onComplete).toHaveBeenCalledTimes(1);

    // meta flag flipped + auto-backup attempted.
    expect(await getMeta('taggingComplete')).toBe(true);
    expect(backup.exportBackup).toHaveBeenCalled();

    // Both tags persisted.
    const tags = await listImageTags();
    expect(tags.map((t) => t.imagePath).sort()).toEqual([
      'אולם עיצוב בסיס 2026/aaa.JPG',
      'אולם עיצוב בסיס 2026/bbb.JPG',
    ]);
  });
});

describe('TaggingPass — custom-label chips', () => {
  it('commits a custom label on Enter and renders a chip', async () => {
    await renderPass();

    const input = $req('[data-testid="tagging-custom-input"]') as HTMLInputElement;
    // Type "זהב" then press Enter.
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, 'זהב');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    const labelsList = $req('[data-testid="tagging-custom-labels"]');
    expect(labelsList.textContent).toContain('זהב');

    // Input was cleared after commit.
    expect(input.value).toBe('');
  });
});

describe('TaggingPass — finish via "סיים תיוג"', () => {
  it('calls completeTaggingPass and triggers the auto-backup on confirm', async () => {
    // Mock confirm to auto-accept (SOP 12 § 5 confirm dialog).
    // happy-dom does not implement `window.confirm`, so vi.spyOn fails with
    // "can only spy on a function". Define a default implementation first
    // (vi.restoreAllMocks in setup.ts cleans it up between tests).
    if (typeof window.confirm !== 'function') {
      (window as unknown as { confirm: () => boolean }).confirm = () => true;
    }
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const onComplete = vi.fn();
    await renderPass({ onComplete });

    // Save one image first so "סיים תיוג" is enabled.
    await clickByTestId('tagging-save-next');

    const finish = $req('[data-testid="tagging-finish"]') as HTMLButtonElement;
    expect(finish.disabled).toBe(false);

    await clickByTestId('tagging-finish');

    expect(confirmSpy).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(await getMeta('taggingComplete')).toBe(true);
    expect(backup.exportBackup).toHaveBeenCalled();
  });

  it('aborts the finish flow when confirm is cancelled', async () => {
    // happy-dom does not implement `window.confirm`; install a default first.
    if (typeof window.confirm !== 'function') {
      (window as unknown as { confirm: () => boolean }).confirm = () => false;
    }
    vi.spyOn(window, 'confirm').mockImplementation(() => false);

    const onComplete = vi.fn();
    await renderPass({ onComplete });

    // Save one image first so "סיים תיוג" is enabled.
    await clickByTestId('tagging-save-next');
    await clickByTestId('tagging-finish');

    expect(onComplete).not.toHaveBeenCalled();
    expect(await getMeta('taggingComplete')).toBeUndefined();
  });
});
