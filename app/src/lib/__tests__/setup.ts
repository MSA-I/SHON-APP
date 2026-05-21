// SOP: .tmp/test-harness-staging.json
// SOP: architecture/02-indexeddb-persistence.md § Test Hooks
//
// Global vitest setup. Loaded BEFORE any test file. Three jobs:
//   1. Install `fake-indexeddb` so `globalThis.indexedDB` is wired before
//      `db.ts` reads it.
//   2. Wrap `console.error` / `console.warn` so an unexpected log fails the
//      test loud (forces `vi.spyOn` for any expected error path).
//   3. Wipe every fake-indexeddb database between tests for isolation.

import 'fake-indexeddb/auto';
import { beforeEach, afterEach, vi } from 'vitest';

let originalError: typeof console.error;
let originalWarn: typeof console.warn;

beforeEach(() => {
  originalError = console.error;
  originalWarn = console.warn;
  console.error = ((...args: unknown[]) => {
    throw new Error(
      `Unexpected console.error: ${args
        .map((a) => (a instanceof Error ? a.message : String(a)))
        .join(' ')}`,
    );
  }) as typeof console.error;
  console.warn = ((...args: unknown[]) => {
    throw new Error(
      `Unexpected console.warn: ${args
        .map((a) => (a instanceof Error ? a.message : String(a)))
        .join(' ')}`,
    );
  }) as typeof console.warn;
});

afterEach(async () => {
  console.error = originalError;
  console.warn = originalWarn;
  vi.restoreAllMocks();

  // Wipe every fake-indexeddb database so tests start cold.
  // `indexedDB.databases()` is supported by fake-indexeddb v6.
  try {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (info) =>
          new Promise<void>((resolve) => {
            if (!info.name) return resolve();
            const req = indexedDB.deleteDatabase(info.name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
  } catch {
    // best-effort
  }
});
