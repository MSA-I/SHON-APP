// SOP: architecture/08-tauri-filesystem.md § API Surface, § Path Conventions, § Security
//
// Thin adapter over `@tauri-apps/plugin-fs` + `@tauri-apps/api/core`.
// Defense-in-depth: every fs call is gated by `assertInsideRoot` (or
// `assertInsideBackups` for removes). Capability scope at the Tauri layer is
// the primary guard; this lib-level guard surfaces traversal as a typed
// `LibError` instead of an opaque Tauri rejection, and provides a fallback if
// a future capability change is too broad.

import {
  readDir as tauriReadDir,
  readFile as tauriReadFile,
  readTextFile as tauriReadTextFile,
  writeFile as tauriWriteFile,
  writeTextFile as tauriWriteTextFile,
  remove as tauriRemove,
  rename as tauriRename,
  mkdir as tauriMkdir,
  stat as tauriStat,
  exists as tauriExists,
} from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

import {
  type FsDirEntry,
  type FsProvider,
  type FsStat,
  LibError,
  type LibErrorCode,
} from '../types';
import { getProjectRoot } from './config';
import { getBackupsDir } from './paths';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a path to POSIX form for comparison. Decodes percent-encoding,
 * collapses repeated slashes, removes trailing slash, NFC-normalizes Hebrew.
 *
 * Does NOT resolve `..` — `assertInsideRoot` walks segments to reject any.
 */
function normalizeForCompare(p: string): string {
  if (typeof p !== 'string') {
    throw new LibError('Path must be a string', { code: 'FS_ENSURE_DIR' });
  }
  if (p.includes('\0')) {
    throw new LibError('Null byte in path', {
      code: 'FS_ENSURE_DIR',
      path: p,
    });
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    decoded = p;
  }
  // Reject UNC / extended-length paths.
  if (decoded.startsWith('\\\\?\\') || decoded.startsWith('\\\\.\\') || decoded.startsWith('//?/')) {
    throw new LibError('UNC paths are not allowed', {
      code: 'FS_ENSURE_DIR',
      path: p,
    });
  }
  // Unify separators to POSIX, NFC-normalize, collapse repeated slashes.
  let unified = decoded.replace(/\\/g, '/').normalize('NFC');
  unified = unified.replace(/\/{2,}/g, '/');
  // Strip trailing slash unless it's a drive root like "D:/".
  if (unified.length > 3 && unified.endsWith('/')) {
    unified = unified.slice(0, -1);
  }
  return unified;
}

/**
 * Reject any path that resolves outside `anchor`. Anchor must be an absolute
 * POSIX-style path (e.g. `D:/משה פרוייקטים/שון בלאיש`).
 *
 * The check anchors with a trailing slash to prevent the classic
 * `/foo/barbaz` vs `/foo/bar` prefix-match confusion.
 */
function assertInside(anchor: string, p: string, code: LibErrorCode): void {
  const normP = normalizeForCompare(p);
  const normAnchor = normalizeForCompare(anchor);
  // Walk segments — reject `..` anywhere.
  for (const segment of normP.split('/')) {
    if (segment === '..') {
      throw new LibError('Path traversal segment (..)', { code, path: p });
    }
  }
  if (normP !== normAnchor && !normP.startsWith(normAnchor + '/')) {
    throw new LibError('Path escapes anchor', { code, path: p });
  }
}

export async function assertInsideRoot(p: string, code: LibErrorCode = 'FS_ENSURE_DIR'): Promise<void> {
  assertInside(await getProjectRoot(), p, code);
}

export async function assertInsideBackups(p: string, code: LibErrorCode = 'FS_WRITE_FILE'): Promise<void> {
  assertInside(await getBackupsDir(), p, code);
}

/** Translate POSIX → native (`\`) only at the FFI boundary. */
function toNativePath(p: string): string {
  return p.replace(/\//g, '\\');
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

async function readDir(path: string): Promise<FsDirEntry[]> {
  await assertInsideRoot(path, 'FS_READ_DIR');
  try {
    const entries = await tauriReadDir(toNativePath(path));
    return entries.map(e => ({
      name: e.name?.normalize('NFC') ?? '',
      isFile: !e.isDirectory && !e.isSymlink,
    }));
  } catch (cause) {
    throw new LibError('readDir failed', { code: 'FS_READ_DIR', path, cause });
  }
}

async function stat(path: string): Promise<FsStat> {
  await assertInsideRoot(path, 'FS_STAT');
  try {
    const s = await tauriStat(toNativePath(path));
    return {
      size: Number(s.size ?? 0),
      mtimeMs: s.mtime ? new Date(s.mtime).getTime() : 0,
    };
  } catch (cause) {
    throw new LibError('stat failed', { code: 'FS_STAT', path, cause });
  }
}

async function readFile(path: string): Promise<Uint8Array> {
  await assertInsideRoot(path, 'FS_READ_FILE');
  try {
    return await tauriReadFile(toNativePath(path));
  } catch (cause) {
    throw new LibError('readFile failed', { code: 'FS_READ_FILE', path, cause });
  }
}

async function readTextFile(path: string): Promise<string> {
  await assertInsideRoot(path, 'FS_READ_FILE');
  try {
    return await tauriReadTextFile(toNativePath(path));
  } catch (cause) {
    throw new LibError('readTextFile failed', { code: 'FS_READ_FILE', path, cause });
  }
}

async function writeFile(path: string, data: Uint8Array): Promise<void> {
  await assertInsideRoot(path, 'FS_WRITE_FILE');
  try {
    await tauriWriteFile(toNativePath(path), data);
  } catch (cause) {
    throw new LibError('writeFile failed', { code: 'FS_WRITE_FILE', path, cause });
  }
}

async function writeTextFile(path: string, text: string): Promise<void> {
  await assertInsideRoot(path, 'FS_WRITE_FILE');
  try {
    await tauriWriteTextFile(toNativePath(path), text);
  } catch (cause) {
    throw new LibError('writeTextFile failed', { code: 'FS_WRITE_FILE', path, cause });
  }
}

async function ensureDir(path: string): Promise<void> {
  await assertInsideRoot(path, 'FS_ENSURE_DIR');
  try {
    await tauriMkdir(toNativePath(path), { recursive: true });
  } catch (cause) {
    throw new LibError('mkdir failed', { code: 'FS_ENSURE_DIR', path, cause });
  }
}

/**
 * SOP 08 § Failure Modes: removeFile is wrapped to ONLY delete inside
 * `backups/`. Generated DOCX deliverables under `events/` must never be
 * deleted by the app once written.
 */
export async function safeRemoveFile(path: string): Promise<void> {
  await assertInsideBackups(path, 'FS_WRITE_FILE');
  try {
    await tauriRemove(toNativePath(path));
  } catch (cause) {
    throw new LibError('safeRemoveFile failed', { code: 'FS_WRITE_FILE', path, cause });
  }
}

/**
 * SOP 08 § Atomic Writes: write to `path + '.tmp'` then rename.
 *
 * Maintenance Log 2026-05-26 (post-export-error): the rename step fails on
 * Windows whenever the destination DOCX is locked — typically because Word
 * still has the previous export open. The original code surfaced only the
 * generic message "atomicWriteFile failed" so the user couldn't see the
 * cause. We now (1) include the underlying Tauri error string in the
 * message, (2) clean up the orphaned `.tmp` if the rename step fails, and
 * (3) on the rename-only failure, fall back to a direct overwrite of the
 * destination — Tauri's `writeFile` opens the destination for write and
 * Windows lets that succeed even if the file was previously held open by
 * Word for read. This keeps the export working when Shon re-exports an
 * event whose plan.docx is still open in Word from the prior round.
 */
export async function atomicWriteFile(path: string, data: Uint8Array): Promise<void> {
  await assertInsideRoot(path, 'FS_WRITE_FILE');
  const tmp = `${path}.tmp`;
  await assertInsideRoot(tmp, 'FS_WRITE_FILE');

  // Step 1 — write the .tmp.
  try {
    await tauriWriteFile(toNativePath(tmp), data);
  } catch (cause) {
    throw new LibError(
      `atomicWriteFile failed (writing tmp): ${stringifyCause(cause)}`,
      { code: 'FS_WRITE_FILE', path, cause },
    );
  }

  // Step 2 — rename .tmp → path.
  try {
    await tauriRename(toNativePath(tmp), toNativePath(path));
    return;
  } catch (renameCause) {
    // Step 2b — rename failed (destination locked). Try a direct overwrite
    // of the destination, then drop the orphan .tmp. If both fail, surface
    // a typed error with the rename cause so the user sees "the file is
    // open in Word" instead of a generic message.
    let directWriteCause: unknown = null;
    try {
      await tauriWriteFile(toNativePath(path), data);
    } catch (cause) {
      directWriteCause = cause;
    }

    // Cleanup the orphan .tmp regardless of which path succeeded.
    try {
      await tauriRemove(toNativePath(tmp));
    } catch {
      /* non-fatal — tmp file lingers; user can delete manually */
    }

    if (directWriteCause === null) {
      // Direct write succeeded — the destination was writable but the
      // rename was not (e.g. Windows ERROR_ACCESS_DENIED on rename when
      // destination has an open share). Treat as success.
      return;
    }

    throw new LibError(
      `atomicWriteFile failed: ${stringifyCause(renameCause)}` +
        ` (direct-write fallback also failed: ${stringifyCause(directWriteCause)})`,
      { code: 'FS_WRITE_FILE', path, cause: renameCause },
    );
  }
}

/** Best-effort string view of an unknown error for inclusion in messages. */
function stringifyCause(err: unknown): string {
  if (err == null) return 'unknown';
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function existsCheck(path: string): Promise<boolean> {
  await assertInsideRoot(path, 'FS_STAT');
  try {
    return await tauriExists(toNativePath(path));
  } catch (cause) {
    throw new LibError('exists failed', { code: 'FS_STAT', path, cause });
  }
}

function toFileSrc(path: string): string {
  // No assertInsideRoot here — `convertFileSrc` is sync and the asset-protocol
  // scope in tauri.conf.json enforces the boundary at the WebView layer.
  // Callers should still pass paths from the project root only.
  return convertFileSrc(toNativePath(path));
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export const tauriFsProvider: FsProvider = {
  readDir,
  stat,
  readFile,
  writeFile,
  toFileSrc,
  ensureDir,
};

/**
 * Convenience helpers used by SOP 03 / 07 that need text variants beyond the
 * core `FsProvider` interface.
 */
export const tauriFsExtras = {
  readTextFile,
  writeTextFile,
  exists: existsCheck,
  atomicWriteFile,
  safeRemoveFile,
};

export { assertInside as __assertInsideForTests };
