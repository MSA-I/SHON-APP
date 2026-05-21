// SOP: architecture/07-backup-strategy.md
// SOP: architecture/11-domain-invariants.md (INV-05, INV-08, INV-11)
// SOP: claude.md § Backup Policy
// Perf: .tmp/perf-predictions.md § P-05
//
// JSON backup export / import + retention. Wraps `db.exportAll()` and
// `db.importAll()` with:
//   • schemaVersion exact-match (INV-11) as the very first line of import;
//   • size asserts (P-05): per-signature ≤ 200 KB, full envelope ≤ 5 MB;
//   • Blob/File rejection at the export boundary (P-05);
//   • prototype-pollution defense via a JSON.parse reviver that strips
//     `__proto__`, `constructor`, `prototype` keys;
//   • path traversal / category / uuid v4 validation on every record;
//   • atomic writes via `tauriFsExtras.atomicWriteFile`;
//   • retention pruning via `tauriFsExtras.safeRemoveFile` (scoped to
//     `<root>/backups/` by `assertInsideBackups` in `tauri-fs.ts`).
//
// This module imports ONLY from `'../types'`, `'./config'`, `'./paths'`,
// `'./tauri-fs'`, and `'./db'`. No React, no framer-motion, no Tauri direct.

import {
  BACKUP_SCHEMA_VERSION,
  type BackupEnvelope,
  type Client,
  type Event,
  type ImageCategory,
  type ImageTag,
  IMAGE_CATEGORIES,
  LibError,
} from '../types';
import {
  getBackupPath,
  getBackupsDir,
} from './paths';
import {
  tauriFsExtras,
  tauriFsProvider,
} from './tauri-fs';
import {
  exportAll as dbExportAll,
  importAll as dbImportAll,
  setMeta as dbSetMeta,
} from './db';

// ===========================================================================
// Constants
// ===========================================================================

/** P-05: full envelope JSON byte-length cap. */
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

/** P-05: per-signature dataUrl character cap. */
const MAX_SIGNATURE_CHARS = 200 * 1024;

/** Soft sanity caps so a malformed file cannot OOM the parser. */
const MAX_CLIENTS = 10_000;
const MAX_EVENTS = 10_000;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BACKUP_FILENAME_RE =
  /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(_pre-migration)?\.json$/;

const IMAGE_CATEGORY_SET: ReadonlySet<string> = new Set<ImageCategory>(
  IMAGE_CATEGORIES,
);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

// ===========================================================================
// Public types
// ===========================================================================

export type BackupExportReason = 'signed' | 'completed' | 'manual' | 'tagging-complete';

export type BackupExportResult = {
  /** Absolute path of the file just written (POSIX form). */
  path: string;
  /** Byte length of the JSON payload written to disk (UTF-8 surrogate-safe). */
  bytes: number;
};

export type BackupImportResult = {
  /** Number of clients written by `db.importAll`. */
  clients: number;
  /** Number of events written by `db.importAll`. */
  events: number;
  /** Number of image tags written by `db.importAll` (SOP 12). */
  imageTags: number;
};

export type BackupFileInfo = {
  filename: string;
  /** Absolute path (POSIX form) inside `<root>/backups/`. */
  path: string;
  sizeBytes: number;
  /** Epoch ms — file mtime. */
  mtimeMs: number;
};

export type PruneResult = {
  removed: string[];
};

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * SOP 07 § Filename Generation: `backup_YYYY-MM-DD_HH-mm.json` from the
 * machine's local clock. Pure helper — no side effects.
 */
export function buildBackupFilename(now: Date = new Date()): string {
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const D = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `backup_${Y}-${M}-${D}_${h}-${m}.json`;
}

function utf8ByteLength(s: string): number {
  // TextEncoder is available in WebView2 + jsdom.
  return new TextEncoder().encode(s).length;
}

/**
 * P-05 #4: refuse Blob / File / DataView at the exportAll boundary. Walks the
 * payload once; throws `LibError BACKUP_WRITE` on the first hit. Functions and
 * symbols are also refused (JSON would silently strip them).
 */
function assertJsonSafe(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return;
  if (t === 'undefined') return; // JSON.stringify drops these — fine
  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new LibError(
      `Backup payload contains a ${t} at ${path} (not JSON-safe)`,
      { code: 'BACKUP_WRITE', path },
    );
  }
  if (t !== 'object') {
    throw new LibError(`Backup payload has unexpected type ${t} at ${path}`, {
      code: 'BACKUP_WRITE',
      path,
    });
  }
  // Reject DOM/binary types that JSON.stringify would silently emit as `{}`.
  // Use globalThis-guarded checks so this still works under jsdom / Node.
  const g = globalThis as unknown as {
    Blob?: { new (...args: unknown[]): unknown };
    File?: { new (...args: unknown[]): unknown };
    ArrayBuffer?: { isView?: (v: unknown) => boolean };
  };
  if (g.Blob && value instanceof (g.Blob as unknown as { prototype: object }).constructor) {
    throw new LibError(`Backup payload contains a Blob at ${path}`, {
      code: 'BACKUP_WRITE',
      path,
    });
  }
  if (g.File && value instanceof (g.File as unknown as { prototype: object }).constructor) {
    throw new LibError(`Backup payload contains a File at ${path}`, {
      code: 'BACKUP_WRITE',
      path,
    });
  }
  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer) {
      throw new LibError(`Backup payload contains an ArrayBuffer at ${path}`, {
        code: 'BACKUP_WRITE',
        path,
      });
    }
    if (ArrayBuffer.isView && ArrayBuffer.isView(value as ArrayBufferView)) {
      throw new LibError(
        `Backup payload contains a typed-array view at ${path}`,
        { code: 'BACKUP_WRITE', path },
      );
    }
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertJsonSafe(value[i], `${path}[${i}]`);
    }
    return;
  }
  // Plain object: walk own enumerable keys.
  for (const key of Object.keys(value as object)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new LibError(
        `Backup payload contains forbidden key "${key}" at ${path}`,
        { code: 'BACKUP_WRITE', path },
      );
    }
    assertJsonSafe(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
}

/**
 * INV-11 + P-05 §1: schemaVersion exact-match against the live constant OR
 * against any version the importer can normalize forward (currently `1` per
 * SOP 07 § Restore from v1 → v2). Anything else is rejected as the FIRST
 * line of `parseBackup`. Returns the parsed numeric version.
 */
const ACCEPTED_SCHEMA_VERSIONS = new Set<number>([
  1, // v1: pre-SOP-12 envelopes — normalized by parseBackup (imageTags = [])
  BACKUP_SCHEMA_VERSION,
]);

function assertSchemaVersion(version: unknown): number {
  if (typeof version !== 'number' || !ACCEPTED_SCHEMA_VERSIONS.has(version)) {
    throw new LibError(
      `schemaVersion mismatch: expected ${BACKUP_SCHEMA_VERSION} (or 1 for forward-migration), got ${String(version)}`,
      { code: 'BACKUP_SCHEMA_MISMATCH' },
    );
  }
  return version;
}

/**
 * Prototype-pollution defense (P-05 + general hardening). Returns `undefined`
 * for `__proto__` / `constructor` / `prototype` keys, which causes JSON.parse
 * to drop them rather than reify them on the resulting object.
 */
function safeJsonReviver(key: string, value: unknown): unknown {
  if (FORBIDDEN_KEYS.has(key)) return undefined;
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertNonEmptyString(v: unknown, field: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new LibError(`${field} must be a non-empty string`, {
      code: 'BACKUP_PARSE',
    });
  }
}

function assertUuidV4Field(v: unknown, field: string): asserts v is string {
  if (typeof v !== 'string' || !UUID_V4_RE.test(v)) {
    throw new LibError(`${field} is not a uuid v4`, {
      code: 'BACKUP_PARSE',
    });
  }
}

/**
 * INV-07 / general path-traversal defense. ImageSelection.imagePath is meant
 * to be a POSIX-style path RELATIVE to the project root (e.g.
 * `מפות מפיות/דגם 1.jpg`). Reject anything that smells like an absolute or
 * traversal-laden path.
 */
function assertSafeRelativePosix(p: unknown, field: string): asserts p is string {
  if (typeof p !== 'string' || p.length === 0) {
    throw new LibError(`${field} must be a non-empty string`, {
      code: 'BACKUP_PARSE',
      path: typeof p === 'string' ? p : undefined,
    });
  }
  if (p.includes('\0')) {
    throw new LibError(`${field} contains a null byte`, {
      code: 'BACKUP_PARSE',
      path: p,
    });
  }
  if (p.includes('\\')) {
    throw new LibError(`${field} must use POSIX separators (no backslash)`, {
      code: 'BACKUP_PARSE',
      path: p,
    });
  }
  if (p.startsWith('/')) {
    throw new LibError(`${field} must be relative (no leading slash)`, {
      code: 'BACKUP_PARSE',
      path: p,
    });
  }
  // Drive letter (Windows absolute), e.g. "D:/...".
  if (/^[a-zA-Z]:/.test(p)) {
    throw new LibError(`${field} must be relative (no drive letter)`, {
      code: 'BACKUP_PARSE',
      path: p,
    });
  }
  for (const seg of p.split('/')) {
    if (seg === '..') {
      throw new LibError(`${field} contains a traversal segment (..)`, {
        code: 'BACKUP_PARSE',
        path: p,
      });
    }
  }
}

function assertImageCategory(
  cat: unknown,
  field: string,
): asserts cat is ImageCategory {
  if (typeof cat !== 'string' || !IMAGE_CATEGORY_SET.has(cat)) {
    throw new LibError(
      `${field} is not a known ImageCategory: ${String(cat)}`,
      { code: 'BACKUP_PARSE' },
    );
  }
}

function validateSelection(sel: unknown, field: string): void {
  if (!isPlainObject(sel)) {
    throw new LibError(`${field} must be an object`, { code: 'BACKUP_PARSE' });
  }
  assertSafeRelativePosix(sel.imagePath, `${field}.imagePath`);
  assertImageCategory(sel.category, `${field}.category`);
  if (typeof sel.imageName !== 'string') {
    throw new LibError(`${field}.imageName must be a string`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (typeof sel.notes !== 'string') {
    throw new LibError(`${field}.notes must be a string`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (typeof sel.selectedAt !== 'number' || !Number.isFinite(sel.selectedAt)) {
    throw new LibError(`${field}.selectedAt must be a finite number`, {
      code: 'BACKUP_PARSE',
    });
  }
}

function validateClient(c: unknown, idx: number): void {
  if (!isPlainObject(c)) {
    throw new LibError(`clients[${idx}] must be an object`, {
      code: 'BACKUP_PARSE',
    });
  }
  assertUuidV4Field(c.id, `clients[${idx}].id`);
  if (typeof c.coupleNames !== 'string') {
    throw new LibError(`clients[${idx}].coupleNames must be a string`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (typeof c.phone !== 'string') {
    throw new LibError(`clients[${idx}].phone must be a string`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (c.email !== undefined && typeof c.email !== 'string') {
    throw new LibError(`clients[${idx}].email must be a string when present`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (typeof c.createdAt !== 'number' || typeof c.updatedAt !== 'number') {
    throw new LibError(`clients[${idx}] timestamps must be numbers`, {
      code: 'BACKUP_PARSE',
    });
  }
}

/**
 * Validate a single `ImageTag` per SOP 12. Rejects unknown `userCategory`
 * values (INV-05); enforces basic shape on `customLabels` and `notes`.
 */
function validateImageTag(t: unknown, idx: number): void {
  if (!isPlainObject(t)) {
    throw new LibError(`imageTags[${idx}] must be an object`, {
      code: 'BACKUP_PARSE',
    });
  }
  assertSafeRelativePosix(t.imagePath, `imageTags[${idx}].imagePath`);
  if (t.userCategory !== undefined && t.userCategory !== null) {
    assertImageCategory(t.userCategory, `imageTags[${idx}].userCategory`);
  }
  if (!Array.isArray(t.customLabels)) {
    throw new LibError(`imageTags[${idx}].customLabels must be an array`, {
      code: 'BACKUP_PARSE',
    });
  }
  for (let i = 0; i < t.customLabels.length; i++) {
    if (typeof t.customLabels[i] !== 'string') {
      throw new LibError(
        `imageTags[${idx}].customLabels[${i}] must be a string`,
        { code: 'BACKUP_PARSE' },
      );
    }
  }
  if (typeof t.notes !== 'string') {
    throw new LibError(`imageTags[${idx}].notes must be a string`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (typeof t.taggedAt !== 'number' || !Number.isFinite(t.taggedAt)) {
    throw new LibError(`imageTags[${idx}].taggedAt must be a finite number`, {
      code: 'BACKUP_PARSE',
    });
  }
}

function validateEvent(e: unknown, idx: number): void {
  if (!isPlainObject(e)) {
    throw new LibError(`events[${idx}] must be an object`, {
      code: 'BACKUP_PARSE',
    });
  }
  assertUuidV4Field(e.id, `events[${idx}].id`);
  assertUuidV4Field(e.clientId, `events[${idx}].clientId`);
  assertNonEmptyString(e.date, `events[${idx}].date`);

  // tableDesignSelections: array of valid selections, length ≤ 5 (INV-01).
  const tds = (e as { tableDesignSelections?: unknown }).tableDesignSelections;
  if (!Array.isArray(tds)) {
    throw new LibError(`events[${idx}].tableDesignSelections must be an array`, {
      code: 'BACKUP_PARSE',
    });
  }
  if (tds.length > 5) {
    throw new LibError(
      `events[${idx}].tableDesignSelections.length > 5 (INV-01)`,
      { code: 'BACKUP_PARSE' },
    );
  }
  for (let i = 0; i < tds.length; i++) {
    validateSelection(tds[i], `events[${idx}].tableDesignSelections[${i}]`);
  }

  // chuppah.designSelections.
  const chuppah = (e as { chuppah?: unknown }).chuppah;
  if (!isPlainObject(chuppah)) {
    throw new LibError(`events[${idx}].chuppah must be an object`, {
      code: 'BACKUP_PARSE',
    });
  }
  const cds = (chuppah as { designSelections?: unknown }).designSelections;
  if (!Array.isArray(cds)) {
    throw new LibError(
      `events[${idx}].chuppah.designSelections must be an array`,
      { code: 'BACKUP_PARSE' },
    );
  }
  for (let i = 0; i < cds.length; i++) {
    validateSelection(cds[i], `events[${idx}].chuppah.designSelections[${i}]`);
  }

  // P-05 §2: signature size cap (≤ 200 KB).
  // Maintenance Log 2026-05-21: dual-shape — `kind: 'png'` keeps the prior
  // dataUrl shape; `kind: 'vector'` carries a strokes array. Legacy backups
  // (no `kind` field) are accepted as PNG.
  const sig = (e as { signature?: unknown }).signature;
  if (sig !== null && sig !== undefined) {
    if (!isPlainObject(sig)) {
      throw new LibError(`events[${idx}].signature must be an object or null`, {
        code: 'BACKUP_PARSE',
      });
    }
    const sigObj = sig as Record<string, unknown>;
    const kind = sigObj.kind;
    const signedAt = sigObj.signedAt;
    if (typeof signedAt !== 'number' || !Number.isFinite(signedAt)) {
      throw new LibError(
        `events[${idx}].signature.signedAt must be a finite number`,
        { code: 'BACKUP_PARSE' },
      );
    }
    if (kind === 'vector') {
      if (!Array.isArray(sigObj.strokes)) {
        throw new LibError(
          `events[${idx}].signature.strokes must be an array`,
          { code: 'BACKUP_PARSE' },
        );
      }
      const measured = JSON.stringify(sigObj.strokes).length;
      if (measured > MAX_SIGNATURE_CHARS) {
        throw new LibError(
          `events[${idx}].signature.strokes exceeds ${MAX_SIGNATURE_CHARS} chars (P-05)`,
          { code: 'BACKUP_PARSE', id: e.id as string },
        );
      }
    } else {
      // PNG (with explicit `kind: 'png'`) or legacy (no `kind` field).
      const dataUrl = sigObj.dataUrl;
      if (typeof dataUrl !== 'string') {
        throw new LibError(
          `events[${idx}].signature.dataUrl must be a string`,
          { code: 'BACKUP_PARSE' },
        );
      }
      if (dataUrl.length > MAX_SIGNATURE_CHARS) {
        throw new LibError(
          `events[${idx}].signature.dataUrl exceeds ${MAX_SIGNATURE_CHARS} chars (P-05)`,
          { code: 'BACKUP_PARSE', id: e.id as string },
        );
      }
    }
  }

  if (typeof e.createdAt !== 'number' || typeof e.updatedAt !== 'number') {
    throw new LibError(`events[${idx}] timestamps must be numbers`, {
      code: 'BACKUP_PARSE',
    });
  }
}

// ===========================================================================
// Export
// ===========================================================================

/**
 * Snapshot the DB to a JSON file in `<root>/backups/`. Steps:
 *   1. `db.exportAll()` — pull clients + events.
 *   2. Wrap in a `BackupEnvelope` (schemaVersion = `BACKUP_SCHEMA_VERSION`).
 *   3. P-05: assert JSON-safe (rejects Blob/File/typed-arrays); per-signature
 *      size cap; envelope byte-length cap.
 *   4. JSON.stringify (with no replacer — `assertJsonSafe` already walked).
 *   5. Round-trip JSON.parse(stringified, reviver) to strip any forbidden
 *      keys that may have hitched a ride.
 *   6. Atomic-write via `tauriFsExtras.atomicWriteFile`.
 *   7. `db.setMeta('lastBackupAt', Date.now())`.
 *   8. Prune to retention 30 (best-effort — failures here do not fail the
 *      export).
 *
 * The `reason` is logged but not embedded — the filename + mtime are the
 * audit trail per SOP 07.
 */
export async function exportBackup(
  reason: BackupExportReason,
): Promise<BackupExportResult> {
  // 1. Pull from DB.
  const dbExport = await dbExportAll();

  // 2. Build the envelope. `db.exportAll()` returns `imageTags` natively
  // since the SOP 12 migration (db.ts v2). `schemaVersion` is overwritten with
  // `BACKUP_SCHEMA_VERSION` per SOP 07.
  const envelope: BackupEnvelope = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: dbExport.exportedAt,
    clients: dbExport.clients,
    events: dbExport.events,
    imageTags: dbExport.imageTags,
  };

  // 3a. P-05 #4: refuse Blob/File at the boundary before stringify.
  assertJsonSafe(envelope, 'envelope');

  // 3b. P-05 #2: per-signature size assert.
  // Maintenance Log 2026-05-21: signature is dual-shape (png|vector). For PNG
  // we measure the dataUrl; for vector we serialize the strokes payload and
  // measure that instead. Either way, the cap is per-signature.
  for (let i = 0; i < envelope.events.length; i++) {
    const sig = envelope.events[i]?.signature;
    if (!sig) continue;
    let measuredLen = 0;
    if (sig.kind === 'png') {
      measuredLen = sig.dataUrl.length;
    } else if (sig.kind === 'vector') {
      // Estimate the on-wire footprint via JSON.stringify — the same value
      // that lands in the envelope.
      measuredLen = JSON.stringify(sig.strokes).length;
    }
    if (measuredLen > MAX_SIGNATURE_CHARS) {
      throw new LibError(
        `Signature on events[${i}] exceeds ${MAX_SIGNATURE_CHARS} chars (P-05)`,
        { code: 'BACKUP_WRITE', id: envelope.events[i]?.id },
      );
    }
  }

  // 4. Stringify.
  let json: string;
  try {
    json = JSON.stringify(envelope);
  } catch (cause) {
    throw new LibError('exportBackup: JSON.stringify failed', {
      code: 'BACKUP_WRITE',
      cause,
    });
  }

  // 5. Round-trip parse with the prototype-pollution reviver. The output is
  // discarded (we only needed the side effect of validating / sanitizing).
  // If a forbidden key somehow survived `assertJsonSafe`, this strips it.
  try {
    JSON.parse(json, safeJsonReviver);
  } catch (cause) {
    throw new LibError('exportBackup: round-trip JSON.parse failed', {
      code: 'BACKUP_WRITE',
      cause,
    });
  }

  // 3c. P-05 #3: full envelope byte-length cap.
  const bytes = utf8ByteLength(json);
  if (bytes > MAX_BACKUP_BYTES) {
    throw new LibError(
      `Backup JSON ${bytes} bytes exceeds ${MAX_BACKUP_BYTES} (P-05)`,
      { code: 'BACKUP_WRITE' },
    );
  }

  // 6. Atomic write.
  const filename = buildBackupFilename(new Date());
  const absPath = await getBackupPath(filename);

  // Best-effort ensure the backups dir exists. `atomicWriteFile`'s
  // `assertInsideRoot` does not auto-create.
  try {
    const dir = await getBackupsDir();
    await tauriFsProvider.ensureDir(dir);
  } catch (cause) {
    throw new LibError('exportBackup: failed to ensure backups dir', {
      code: 'BACKUP_WRITE',
      path: absPath,
      cause,
    });
  }

  try {
    await tauriFsExtras.atomicWriteFile(absPath, new TextEncoder().encode(json));
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('exportBackup: atomicWriteFile failed', {
      code: 'BACKUP_WRITE',
      path: absPath,
      cause,
    });
  }

  // 7. Stamp lastBackupAt. Failures here are non-fatal — the file is on disk
  // already; surface as a console.error rather than rolling back the write.
  try {
    await dbSetMeta('lastBackupAt', Date.now());
  } catch (cause) {
    console.error('[backup] setMeta(lastBackupAt) failed', cause);
  }

  // Reason is part of the API surface but not embedded in the file. Logged
  // for diagnostics (parents can grep this).
  console.info('[backup] exportBackup ok', { reason, filename, bytes });

  // 8. Prune. Failures here are non-fatal.
  try {
    await pruneOldBackups(30);
  } catch (cause) {
    console.error('[backup] pruneOldBackups failed (non-fatal)', cause);
  }

  return { path: absPath, bytes };
}

// ===========================================================================
// Parse / Import
// ===========================================================================

/**
 * Parse a backup JSON string, defending against:
 *   • prototype pollution (`__proto__` / `constructor` / `prototype` keys);
 *   • schemaVersion drift (INV-11 — first check, before any data parse);
 *   • path traversal in `ImageSelection.imagePath`;
 *   • foreign `ImageCategory` values (INV-05);
 *   • non-uuid-v4 ids;
 *   • oversize envelopes / impossible counts;
 *   • non-string `signature.dataUrl` or oversize signatures (P-05).
 *
 * Returns a `BackupEnvelope` whose shape matches `app/src/types/index.ts`.
 * Does NOT mutate the IDB — caller hands the result to `importBackup`.
 */
export function parseBackup(text: string): BackupEnvelope {
  if (typeof text !== 'string') {
    throw new LibError('parseBackup: input must be a string', {
      code: 'BACKUP_PARSE',
    });
  }
  if (text.length > MAX_BACKUP_BYTES) {
    // P-05: reject oversize envelopes BEFORE handing to JSON.parse so a
    // malicious 100 MB blob cannot OOM the parser.
    throw new LibError(
      `Backup text exceeds ${MAX_BACKUP_BYTES} bytes (P-05)`,
      { code: 'BACKUP_PARSE' },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text, safeJsonReviver);
  } catch (cause) {
    throw new LibError('parseBackup: invalid JSON', {
      code: 'BACKUP_PARSE',
      cause,
    });
  }

  if (!isPlainObject(parsed)) {
    throw new LibError('parseBackup: top-level must be an object', {
      code: 'BACKUP_PARSE',
    });
  }

  // INV-11 + P-05 §1 — FIRST data check, before any field parse.
  // SOP 07 § Restore from v1 → v2: v1 envelopes are accepted; their missing
  // `imageTags` field is normalized to `[]` below (forces `taggingComplete`
  // back to false in db.importAll, per SOP 07).
  const sourceVersion = assertSchemaVersion(parsed.schemaVersion);

  if (typeof parsed.exportedAt !== 'number' || !Number.isFinite(parsed.exportedAt)) {
    throw new LibError('parseBackup: exportedAt must be a finite number', {
      code: 'BACKUP_PARSE',
    });
  }

  if (!Array.isArray(parsed.clients)) {
    throw new LibError('parseBackup: clients must be an array', {
      code: 'BACKUP_PARSE',
    });
  }
  if (!Array.isArray(parsed.events)) {
    throw new LibError('parseBackup: events must be an array', {
      code: 'BACKUP_PARSE',
    });
  }
  if (parsed.clients.length > MAX_CLIENTS) {
    throw new LibError(
      `parseBackup: clients.length ${parsed.clients.length} > ${MAX_CLIENTS}`,
      { code: 'BACKUP_PARSE' },
    );
  }
  if (parsed.events.length > MAX_EVENTS) {
    throw new LibError(
      `parseBackup: events.length ${parsed.events.length} > ${MAX_EVENTS}`,
      { code: 'BACKUP_PARSE' },
    );
  }

  for (let i = 0; i < parsed.clients.length; i++) {
    validateClient(parsed.clients[i], i);
  }
  for (let i = 0; i < parsed.events.length; i++) {
    validateEvent(parsed.events[i], i);
  }

  // SOP 12 / v2: `imageTags` is required on v2 envelopes. v1 envelopes
  // (pre-SOP-12) don't have the field — we normalize to `[]` and let
  // db.importAll force `taggingComplete = false` per SOP 07 § Restore from
  // v1 → v2. If the field IS present (any version), it must be well-formed.
  let imageTags: ImageTag[] = [];
  const rawTags = (parsed as { imageTags?: unknown }).imageTags;
  if (rawTags !== undefined) {
    if (!Array.isArray(rawTags)) {
      throw new LibError('parseBackup: imageTags must be an array', {
        code: 'BACKUP_PARSE',
      });
    }
    for (let i = 0; i < rawTags.length; i++) {
      validateImageTag(rawTags[i], i);
    }
    imageTags = rawTags as ImageTag[];
  } else if (sourceVersion === BACKUP_SCHEMA_VERSION) {
    // v2 envelope MUST carry imageTags (even as []).
    throw new LibError('parseBackup: imageTags is required on v2 envelopes', {
      code: 'BACKUP_PARSE',
    });
  }

  // After all validators have passed, the shape matches BackupEnvelope.
  // Always emit BACKUP_SCHEMA_VERSION on the way out — v1 inputs are
  // forward-migrated by this function.
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    clients: parsed.clients as Client[],
    events: parsed.events as Event[],
    imageTags,
  };
}

/**
 * Validate + restore. `db.importAll` handles transaction semantics, the
 * `meta.lastImportAt` write, and the merge/overwrite branch.
 *
 * Per SOP 02 / SOP 07 alignment, `db.importAll` requires
 * `payload.schemaVersion === DB_VERSION`. We pass the `BackupEnvelope`'s
 * `schemaVersion` through after the INV-11 exact-match check has already
 * run inside `parseBackup`.
 */
export async function importBackup(
  text: string,
  mode: 'overwrite' | 'merge',
): Promise<BackupImportResult> {
  if (mode !== 'overwrite' && mode !== 'merge') {
    throw new LibError(`importBackup: unknown mode ${String(mode)}`, {
      code: 'BACKUP_RESTORE',
    });
  }
  const envelope = parseBackup(text);
  try {
    const result = await dbImportAll(
      {
        schemaVersion: envelope.schemaVersion,
        clients: envelope.clients,
        events: envelope.events,
        imageTags: envelope.imageTags,
      },
      mode,
    );
    return {
      clients: result.clientsWritten,
      events: result.eventsWritten,
      imageTags: result.imageTagsWritten,
    };
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('importBackup: db.importAll failed', {
      code: 'BACKUP_RESTORE',
      cause,
    });
  }
}

// ===========================================================================
// Listing + retention
// ===========================================================================

/**
 * Enumerate `<root>/backups/`, keeping only files whose name matches the SOP
 * 07 regex (`backup_YYYY-MM-DD_HH-mm.json` with optional `_pre-migration`).
 * Returns sorted by mtime descending (newest first). If the directory does
 * not exist, returns an empty array — first-run on a fresh machine is fine.
 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  const dir = await getBackupsDir();

  // If the dir doesn't exist yet, nothing to list.
  let dirExists = false;
  try {
    dirExists = await tauriFsExtras.exists(dir);
  } catch (cause) {
    throw new LibError('listBackups: exists check failed', {
      code: 'BACKUP_RESTORE',
      path: dir,
      cause,
    });
  }
  if (!dirExists) return [];

  let entries: { name: string; isFile: boolean }[];
  try {
    entries = await tauriFsProvider.readDir(dir);
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('listBackups: readDir failed', {
      code: 'BACKUP_RESTORE',
      path: dir,
      cause,
    });
  }

  const out: BackupFileInfo[] = [];
  for (const e of entries) {
    if (!e.isFile) continue;
    if (!BACKUP_FILENAME_RE.test(e.name)) continue;
    const abs = `${dir}/${e.name}`;
    let stat: { size: number; mtimeMs: number };
    try {
      stat = await tauriFsProvider.stat(abs);
    } catch (cause) {
      // Skip files that disappeared between readDir and stat.
      console.warn('[backup] listBackups: stat skipped', { abs, cause });
      continue;
    }
    out.push({
      filename: e.name,
      path: abs,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Retention: keep the `keepCount` newest files (by mtime) under `<root>/
 * backups/`; remove the rest via `tauriFsExtras.safeRemoveFile` (which is
 * scoped to the backups subtree by `assertInsideBackups`). Per SOP 07,
 * `_pre-migration`-suffixed snapshots are exempt from rolling prune.
 */
export async function pruneOldBackups(
  keepCount = 30,
): Promise<PruneResult> {
  if (!Number.isFinite(keepCount) || keepCount < 0) {
    throw new LibError('pruneOldBackups: keepCount must be a non-negative number', {
      code: 'BACKUP_WRITE',
    });
  }
  const all = await listBackups();

  // Partition: rolling backups vs. pre-migration snapshots (always kept).
  const rolling: BackupFileInfo[] = [];
  for (const f of all) {
    if (f.filename.endsWith('_pre-migration.json')) continue;
    rolling.push(f);
  }

  // `listBackups` already sorts newest first.
  const toRemove = rolling.slice(keepCount);
  const removed: string[] = [];
  for (const f of toRemove) {
    try {
      await tauriFsExtras.safeRemoveFile(f.path);
      removed.push(f.filename);
    } catch (cause) {
      // Non-fatal per SOP 07 § Pruning Algorithm: log and continue.
      console.error('[backup] pruneOldBackups: remove failed (non-fatal)', {
        filename: f.filename,
        cause,
      });
    }
  }
  return { removed };
}
