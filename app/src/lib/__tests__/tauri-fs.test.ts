// SOP: architecture/08-tauri-filesystem.md § Security § Path-traversal test vectors
// SOP: .tmp/path-traversal-vectors.md
//
// Defense-in-depth tests for `tauri-fs.ts`. Every public method must reject
// (typed `LibError`) before delegating to Tauri for any path that escapes the
// project root. Accept-cases must NOT throw (we still mock Tauri so no real
// I/O happens — the goal is "the guard didn't reject this").
//
// `@tauri-apps/plugin-fs` and `@tauri-apps/api/core` are unavailable under
// happy-dom; we mock them via `vi.hoisted` so the shared call-recorder is
// readable in both the mock factory and the test bodies.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted shared state — `vi.mock` factories run before any non-hoisted
// `const`. Using `vi.hoisted` lets the test body and the factory share the
// same call recorder.
// ---------------------------------------------------------------------------

const { tauriCalls, makeMock } = vi.hoisted(() => {
  const tauriCalls: Array<{ fn: string; args: unknown[] }> = [];
  const makeMock = <T>(fn: string, defaultReturn: T) => {
    return (...args: unknown[]) => {
      tauriCalls.push({ fn, args });
      return defaultReturn;
    };
  };
  return { tauriCalls, makeMock };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: makeMock('readDir', Promise.resolve([])),
  readFile: makeMock('readFile', Promise.resolve(new Uint8Array())),
  readTextFile: makeMock('readTextFile', Promise.resolve('')),
  writeFile: makeMock('writeFile', Promise.resolve(undefined)),
  writeTextFile: makeMock('writeTextFile', Promise.resolve(undefined)),
  remove: makeMock('remove', Promise.resolve(undefined)),
  rename: makeMock('rename', Promise.resolve(undefined)),
  mkdir: makeMock('mkdir', Promise.resolve(undefined)),
  stat: makeMock('stat', Promise.resolve({ size: 0, mtime: new Date(0) })),
  exists: makeMock('exists', Promise.resolve(true)),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}));

// Now safe to import the SUT.
import { tauriFsProvider, tauriFsExtras } from '../tauri-fs';
import { __resetProjectRootForTests } from '../config';
import { vectors, type Vector } from './fixtures/path-traversal-vectors';

beforeEach(() => {
  __resetProjectRootForTests();
  tauriCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Vector-driven tests
// ---------------------------------------------------------------------------

async function runVector(v: Vector): Promise<void> {
  const input = v.input('F:/MyFiles/העסק שלי/שון בלאיש');
  switch (v.op) {
    case 'readFile':
      await tauriFsProvider.readFile(input);
      return;
    case 'readDir':
      await tauriFsProvider.readDir(input);
      return;
    case 'writeFile':
      await tauriFsProvider.writeFile(input, new Uint8Array([1, 2, 3]));
      return;
    case 'safeRemoveFile':
      await tauriFsExtras.safeRemoveFile(input);
      return;
  }
}

describe('SOP 08 § path-traversal guards (vector-driven)', () => {
  for (const v of vectors) {
    if (v.outcome === 'reject') {
      it(`[${v.id}] rejects (${v.reason})`, async () => {
        await expect(runVector(v)).rejects.toMatchObject({
          name: 'LibError',
          code: v.expectedCode,
        });
      });
    } else {
      it(`[${v.id}] accepts (${v.reason})`, async () => {
        await expect(runVector(v)).resolves.not.toThrow();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Direct surface checks (independent of vector loop)
// ---------------------------------------------------------------------------

describe('tauriFsProvider.readDir', () => {
  it('delegates a legit path to Tauri', async () => {
    await tauriFsProvider.readDir('F:/MyFiles/העסק שלי/שון בלאיש/אולם עיצוב בסיס 2026');
    expect(tauriCalls.find((c) => c.fn === 'readDir')).toBeTruthy();
  });

  it('rejects "../" without calling Tauri', async () => {
    await expect(
      tauriFsProvider.readDir('../../etc/passwd'),
    ).rejects.toBeDefined();
    expect(tauriCalls.find((c) => c.fn === 'readDir')).toBeUndefined();
  });
});

describe('tauriFsProvider.readFile', () => {
  it('returns Uint8Array for legit path', async () => {
    const got = await tauriFsProvider.readFile(
      'F:/MyFiles/העסק שלי/שון בלאיש/אולם עיצוב בסיס 2026/foo.jpg',
    );
    expect(got).toBeInstanceOf(Uint8Array);
  });
});

describe('tauriFsProvider.stat', () => {
  it('returns size + mtimeMs', async () => {
    const got = await tauriFsProvider.stat(
      'F:/MyFiles/העסק שלי/שון בלאיש/events',
    );
    expect(typeof got.size).toBe('number');
    expect(typeof got.mtimeMs).toBe('number');
  });

  it('rejects path outside root with FS_STAT', async () => {
    await expect(tauriFsProvider.stat('C:/Windows')).rejects.toMatchObject({
      name: 'LibError',
      code: 'FS_STAT',
    });
  });
});

describe('tauriFsProvider.ensureDir', () => {
  it('calls mkdir for legit path', async () => {
    await tauriFsProvider.ensureDir(
      'F:/MyFiles/העסק שלי/שון בלאיש/events/11111111-1111-4111-8111-111111111111',
    );
    expect(tauriCalls.find((c) => c.fn === 'mkdir')).toBeTruthy();
  });

  it('rejects outside root', async () => {
    await expect(tauriFsProvider.ensureDir('C:/foo')).rejects.toMatchObject({
      code: 'FS_ENSURE_DIR',
    });
  });
});

describe('tauriFsProvider.toFileSrc', () => {
  it('returns a string (asset-protocol URL)', () => {
    const url = tauriFsProvider.toFileSrc(
      'F:/MyFiles/העסק שלי/שון בלאיש/foo.jpg',
    );
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });
});

describe('tauriFsExtras.safeRemoveFile', () => {
  it('rejects file inside events/ (only backups/ allowed)', async () => {
    const eventsFile =
      'F:/MyFiles/העסק שלי/שון בלאיש/events/11111111-1111-4111-8111-111111111111/plan.docx';
    await expect(tauriFsExtras.safeRemoveFile(eventsFile)).rejects.toMatchObject({
      code: 'FS_WRITE_FILE',
    });
    // Crucially, Tauri.remove must NOT have been called.
    expect(tauriCalls.find((c) => c.fn === 'remove')).toBeUndefined();
  });

  it('accepts file inside backups/', async () => {
    const backupFile =
      'F:/MyFiles/העסק שלי/שון בלאיש/backups/backup_2026-05-20_12-00.json';
    await expect(tauriFsExtras.safeRemoveFile(backupFile)).resolves.toBeUndefined();
    expect(tauriCalls.find((c) => c.fn === 'remove')).toBeTruthy();
  });

  it('rejects path outside both root and backups/', async () => {
    await expect(
      tauriFsExtras.safeRemoveFile('C:/Windows/System32/notepad.exe'),
    ).rejects.toMatchObject({ code: 'FS_WRITE_FILE' });
  });
});

describe('tauriFsExtras.atomicWriteFile', () => {
  it('writes to .tmp then renames', async () => {
    const target =
      'F:/MyFiles/העסק שלי/שון בלאיש/events/11111111-1111-4111-8111-111111111111/plan.docx';
    await tauriFsExtras.atomicWriteFile(target, new Uint8Array([1, 2, 3]));
    const writeCalls = tauriCalls.filter((c) => c.fn === 'writeFile');
    const renameCalls = tauriCalls.filter((c) => c.fn === 'rename');
    expect(writeCalls.length).toBe(1);
    expect(renameCalls.length).toBe(1);
    // First arg of write should be `<target>.tmp` (in native form).
    const writeArg = writeCalls[0]?.args[0] as string;
    expect(writeArg.endsWith('.tmp')).toBe(true);
  });

  it('rejects path outside root', async () => {
    await expect(
      tauriFsExtras.atomicWriteFile('C:/Windows/foo.dat', new Uint8Array()),
    ).rejects.toMatchObject({ code: 'FS_WRITE_FILE' });
  });
});

describe('tauriFsExtras.exists', () => {
  it('returns true for default mock', async () => {
    const got = await tauriFsExtras.exists(
      'F:/MyFiles/העסק שלי/שון בלאיש/backups',
    );
    expect(got).toBe(true);
  });

  it('rejects outside root with FS_STAT', async () => {
    await expect(tauriFsExtras.exists('C:/Windows')).rejects.toMatchObject({
      code: 'FS_STAT',
    });
  });
});
