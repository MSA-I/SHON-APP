// SOP: architecture/08-tauri-filesystem.md § Project Root Resolution (v2)
// claude.md Maintenance Log 2026-05-24 — runtime root discovery + manual fallback.
//
// The project root is no longer hardcoded. Resolution order:
//   1. `meta.projectRoot` in IndexedDB — once chosen, sticky across reloads.
//   2. Auto-discovery — probe a list of candidate paths for the canonical 8
//      image folders. First match wins and is persisted.
//   3. Manual dialog — caller (App boot UI) opens a directory picker via
//      `@tauri-apps/plugin-dialog` and calls `setProjectRootManually(path)`.
//
// Defense-in-depth: every fs call still goes through `assertInsideRoot`
// (`tauri-fs.ts`), so the resolved root is the security boundary at the lib
// layer regardless of how it was discovered.

import { exists as tauriExists } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import { DEFAULT_PROJECT_ROOT, LibError } from '../types';
import { getMeta, setMeta } from './db';

let cachedRoot: string | null = null;

// ---------------------------------------------------------------------------
// Canonical folders that identify a valid Shon Blaish library root. If at
// least 6 of these 8 are present at the candidate path, we accept it. The
// "≥ 6" threshold (not 8) tolerates the occasional missing folder — e.g. if
// Shon hasn't yet imported one batch of reference images.
// ---------------------------------------------------------------------------
const CANONICAL_FOLDERS: readonly string[] = [
  'אולם עיצוב בסיס 2026',
  'חופות אולם גדול גאמוס',
  'חופות ריזורט',
  'חופות שידרוג',
  'מפות מפיות',
  'עיצובים שידרוג',
  'ריזורט בסיס',
];
const FOLDER_MATCH_THRESHOLD = 6 as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nfc(s: string): string {
  return typeof s === 'string' ? s.normalize('NFC') : s;
}

/** POSIX-style join without coercing path separator (we keep `/` everywhere). */
function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) =>
      i === 0
        ? p.replace(/[\\/]+$/, '')
        : p.replace(/^[\\/]+|[\\/]+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

/**
 * Convert a Tauri-returned home dir (which may use backslashes on Windows)
 * into POSIX form. We never call the Tauri fs plugin with backslashes
 * directly (`tauri-fs.ts:toNativePath` does that conversion at the FFI
 * boundary), so internal storage is always POSIX.
 */
function toPosix(p: string): string {
  return nfc(p.replace(/\\/g, '/').replace(/\/+$/, ''));
}

/**
 * Check if `dir` looks like a Shon Blaish library root by counting how many
 * of the canonical folders exist inside it. Returns true if ≥ threshold are
 * present. Single-folder failures are silently ignored — `tauriExists`
 * resolves to false on permission error, missing path, etc.
 */
async function looksLikeRoot(dir: string): Promise<boolean> {
  let hits = 0;
  for (const folder of CANONICAL_FOLDERS) {
    const probe = joinPosix(dir, folder).replace(/\//g, '\\');
    try {
      const ok = await tauriExists(probe);
      if (ok) hits += 1;
      // Early-exit optimization — once we've cleared the threshold, stop probing.
      if (hits >= FOLDER_MATCH_THRESHOLD) return true;
    } catch {
      // exists() can reject if the path is outside the capability scope
      // (e.g. on a drive we don't have permission for). Treat as miss.
      continue;
    }
  }
  return hits >= FOLDER_MATCH_THRESHOLD;
}

/**
 * Build the candidate list. The order matters — the first match wins, so
 * put the most likely locations first (Desktop on the user's home dir).
 *
 * Many candidates rely on `homeDir()` from `@tauri-apps/api/path`, which
 * resolves to e.g. `C:\Users\sara\` on Shon's machine.
 */
async function buildCandidates(): Promise<string[]> {
  const out: string[] = [];

  // Home-relative candidates (cover Desktop / Documents / OneDrive variants).
  try {
    const home = toPosix(await homeDir());
    out.push(
      joinPosix(home, 'Desktop', 'שון בלאיש'),
      joinPosix(home, 'OneDrive', 'Desktop', 'שון בלאיש'),
      joinPosix(home, 'Documents', 'שון בלאיש'),
      joinPosix(home, 'OneDrive', 'Documents', 'שון בלאיש'),
      joinPosix(home, 'שון בלאיש'),
    );
  } catch (cause) {
    // homeDir() shouldn't fail in Tauri but guard anyway — we still have the
    // drive-rooted fallbacks below.
    console.error('[config] homeDir failed during discovery', cause);
  }

  // Drive-root candidates — covers the dev machine + common manual install
  // locations on Shon's PC.
  out.push(
    'C:/שון בלאיש',
    'D:/שון בלאיש',
    'E:/שון בלאיש',
    'F:/שון בלאיש',
    // Historical paths used during the project's lifetime — kept for
    // resilience on the dev machine.
    'D:/משה פרוייקטים/שון בלאיש',
    'F:/MyFiles/העסק שלי/שון בלאיש',
  );

  // De-dupe while preserving order.
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The result of a discovery attempt. The caller (boot UI) uses this to decide
 * whether to mount the manual-pick dialog.
 */
export type DiscoveryResult =
  | { kind: 'persisted'; root: string }
  | { kind: 'discovered'; root: string }
  | { kind: 'not-found'; tried: string[] };

/**
 * Run the full discovery flow without throwing. Persists the discovered root
 * to `meta.projectRoot` so subsequent boots are instant. Does NOT prompt the
 * user — that's the caller's job when `kind === 'not-found'`.
 */
export async function discoverProjectRoot(): Promise<DiscoveryResult> {
  // Step 1 — persisted value wins.
  try {
    const persisted = await getMeta<string>('projectRoot');
    if (typeof persisted === 'string' && persisted.length > 0) {
      // Re-validate so a stale value (folder renamed / drive unmounted) falls
      // through to discovery instead of breaking the app silently.
      if (await looksLikeRoot(persisted)) {
        cachedRoot = persisted;
        return { kind: 'persisted', root: persisted };
      }
      console.warn('[config] persisted projectRoot no longer valid:', persisted);
    }
  } catch (cause) {
    console.error('[config] reading meta.projectRoot failed', cause);
  }

  // Step 2 — probe candidates.
  const candidates = await buildCandidates();
  for (const cand of candidates) {
    try {
      if (await looksLikeRoot(cand)) {
        cachedRoot = cand;
        try {
          await setMeta('projectRoot', cand);
        } catch (writeErr) {
          // Discovery still succeeds even if persistence fails — next boot
          // just rediscovers. Logged so the failure isn't silent.
          console.error('[config] persisting discovered root failed', writeErr);
        }
        return { kind: 'discovered', root: cand };
      }
    } catch (cause) {
      console.error('[config] candidate probe failed for', cand, cause);
    }
  }

  return { kind: 'not-found', tried: candidates };
}

/**
 * Caller (boot UI) invokes this after the user picks a folder via the
 * `@tauri-apps/plugin-dialog` directory picker. Validates the choice, persists
 * it, and primes the cache. Throws `LibError('IMG_CATEGORY_MISSING')` when
 * the chosen folder doesn't look like a valid library root — the caller
 * surfaces the error in the UI.
 */
export async function setProjectRootManually(absPath: string): Promise<void> {
  const normalized = toPosix(absPath);
  if (!normalized) {
    throw new LibError('Empty path', { code: 'FS_ENSURE_DIR' });
  }
  if (!(await looksLikeRoot(normalized))) {
    throw new LibError(
      'התיקייה שנבחרה אינה תיקיית "שון בלאיש" — חסרות תיקיות התמונות הצפויות',
      { code: 'IMG_CATEGORY_MISSING', path: normalized },
    );
  }
  cachedRoot = normalized;
  try {
    await setMeta('projectRoot', normalized);
  } catch (cause) {
    throw new LibError('Failed to persist projectRoot', {
      code: 'DB_TX',
      path: normalized,
      cause,
    });
  }
}

/**
 * Synchronous-friendly accessor for the resolved root. The caller MUST have
 * already run `discoverProjectRoot()` (and possibly `setProjectRootManually`)
 * during boot. Returns `DEFAULT_PROJECT_ROOT` only as a last-ditch fallback
 * for tests / dev — production boot UI gates the app behind discovery so a
 * fallback should never be observed at runtime.
 */
export async function getProjectRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot;
  // Try one more time in case discovery wasn't called explicitly (mostly
  // matters for tests and direct lib consumers).
  try {
    const persisted = await getMeta<string>('projectRoot');
    if (typeof persisted === 'string' && persisted.length > 0) {
      cachedRoot = persisted;
      return cachedRoot;
    }
  } catch {
    /* fall through to default */
  }
  // Last-ditch — keeps tests green and dev machine working before the user
  // ever opens the app. Production users will hit the boot UI before this.
  cachedRoot = DEFAULT_PROJECT_ROOT;
  return cachedRoot;
}

/** Test-only hook. Never call from app code. */
export function __resetProjectRootForTests(): void {
  cachedRoot = null;
}
