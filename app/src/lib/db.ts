// SOP: architecture/02-indexeddb-persistence.md
// SOP: architecture/11-domain-invariants.md (INV-01 / 02 / 03 / 05 / 09 / 10 / 12)
// SOP: claude.md § Data Schemas (LAW)
//
// IndexedDB persistence layer. Source of truth for `Client` and `Event` records
// on Shon's machine. Wraps the `idb` library with:
//
//   • a single `DB_VERSION` constant (NOT a meta-store row — see SOP 02
//     § Migration Policy and § Object Stores);
//   • uuid v4 ids generated through the `uuid` package (never
//     `crypto.randomUUID`, which is unstable on older WebView2 builds);
//   • domain-invariant validators that backstop the context layer (INV-01,
//     INV-02, INV-03, INV-05, INV-09, INV-10);
//   • lib-owned timestamps via `Date.now()` (INV-12) — callers do not pass
//     `createdAt` / `updatedAt`.
//
// Side-effect-free at import time: `openDb()` is only called when the app
// shell boots (or when a test injects `fake-indexeddb`). All errors throw
// `LibError` with codes from `LibErrorCode`.
//
// This module imports ONLY from `idb`, `uuid`, and `'../types'`. No React,
// no framer-motion, no Tauri.

import {
  openDB,
  type IDBPDatabase,
  type DBSchema,
} from 'idb';
import { v4 as uuidv4 } from 'uuid';

import {
  type Client,
  type DayOfWeek,
  type Event,
  type EventStatus,
  type ImageCategory,
  type ImageSelection,
  type ImageTag,
  type Signature,
  IMAGE_CATEGORIES,
  LibError,
} from '../types';

// ===========================================================================
// Constants
// ===========================================================================

/**
 * IndexedDB schema version. Bump per SOP 02 § Migration Policy on every
 * breaking schema change, and add a corresponding `if (oldVersion < N)` block
 * inside the `upgrade` callback below. NEVER edit a previous block.
 *
 * Distinct from `BACKUP_SCHEMA_VERSION` (in `types/index.ts`): that constant
 * tags JSON envelopes for SOP 07; this one tags the on-disk IDB layout.
 */
export const DB_VERSION = 2 as const;

/** Stable database name. Same as POC L2; do not rename. */
export const DB_NAME = 'shon-blaish' as const;

const HEBREW_DAYS_OF_WEEK: readonly DayOfWeek[] = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
] as const;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const IMAGE_CATEGORY_SET: ReadonlySet<string> = new Set(IMAGE_CATEGORIES);

// ===========================================================================
// Types
// ===========================================================================

export type ThumbnailRecord = {
  path: string;
  category: ImageCategory;
  blob: Blob;
  generatedAt: number;
  /** mtime of the source image at thumb-time */
  sourceModifiedAt: number;
};

/**
 * Single-writer rule (SOP 02 § Object Stores):
 *   • `lastBackupAt`     — set ONLY by SOP 07 `exportBackup()`.
 *   • `lastScanAt`       — set ONLY by SOP 01 `scanAll()`.
 *   • `lastImportAt`     — set ONLY by `importAll()` inside its own transaction.
 *   • `taggingComplete`  — boolean. Set to `true` ONLY by SOP 12
 *     `completeTaggingPass()` in the same transaction as the final ImageTag
 *     write. Importers may set it to `false` when restoring a v1 backup
 *     (no `imageTags` field) — this re-opens the SOP 12 pass on next boot.
 *     Absence of the row is treated as `false` by `getMeta('taggingComplete')`.
 *
 * `schemaVersion` is intentionally NOT a `MetaKey` — it lives in `DB_VERSION`
 * and is read at runtime via `db.version`.
 */
export type MetaKey =
  | 'lastBackupAt'
  | 'lastScanAt'
  | 'lastImportAt'
  | 'taggingComplete'
  | 'theme';                       // SOP 14 — Light/Dark theme toggle

type MetaRow = {
  key: MetaKey;
  value: unknown;
};

interface ShonBlaishDB extends DBSchema {
  clients: {
    key: string;
    value: Client;
    indexes: {
      byPhone: string;
      byUpdatedAt: number;
    };
  };
  events: {
    key: string;
    value: Event;
    indexes: {
      byClientId: string;
      byDate: string;
      byStatus: EventStatus;
      byUpdatedAt: number;
    };
  };
  thumbnails: {
    key: string;
    value: ThumbnailRecord;
    indexes: {
      byCategory: ImageCategory;
      byGeneratedAt: number;
    };
  };
  imageTags: {
    key: string;
    value: ImageTag;
    indexes: {
      byUserCategory: ImageCategory;
      byTaggedAt: number;
    };
  };
  meta: {
    key: string;
    value: MetaRow;
  };
}

/** Runtime envelope returned by `exportAll()` (consumed by SOP 07). */
export type DbExport = {
  schemaVersion: number;
  exportedAt: number;
  clients: Client[];
  events: Event[];
  /**
   * SOP 12: user-supplied image tags captured during the one-time tagging
   * pass. Empty array if the pass has not yet completed on this machine.
   */
  imageTags: ImageTag[];
};

// ===========================================================================
// Module-scoped DB handle (singleton)
// ===========================================================================

let dbHandle: IDBPDatabase<ShonBlaishDB> | null = null;
let openPromise: Promise<IDBPDatabase<ShonBlaishDB>> | null = null;

// ===========================================================================
// Lifecycle
// ===========================================================================

/**
 * Open (or return the cached handle to) the IndexedDB. Idempotent and
 * concurrency-safe: parallel callers share a single in-flight open.
 *
 * Tests should patch the global `indexedDB` to `fake-indexeddb` BEFORE
 * calling `openDb()` (SOP 02 § Test Hooks). The `factory` parameter is
 * accepted for API symmetry; the underlying `idb` v8 wrapper does not expose
 * a factory injection point on `openDB`, so callers who need a non-default
 * factory must patch the global.
 */
export async function openDb(
  _factory: IDBFactory = indexedDB,
): Promise<IDBPDatabase<ShonBlaishDB>> {
  if (dbHandle) return dbHandle;
  if (openPromise) return openPromise;

  openPromise = (async () => {
    try {
      const db = await openDB<ShonBlaishDB>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            const clients = db.createObjectStore('clients', { keyPath: 'id' });
            clients.createIndex('byPhone', 'phone');
            clients.createIndex('byUpdatedAt', 'updatedAt');

            const events = db.createObjectStore('events', { keyPath: 'id' });
            events.createIndex('byClientId', 'clientId');
            events.createIndex('byDate', 'date');
            events.createIndex('byStatus', 'status');
            events.createIndex('byUpdatedAt', 'updatedAt');

            const thumbs = db.createObjectStore('thumbnails', { keyPath: 'path' });
            thumbs.createIndex('byCategory', 'category');
            thumbs.createIndex('byGeneratedAt', 'generatedAt');

            db.createObjectStore('meta', { keyPath: 'key' });
          }
          if (oldVersion < 2) {
            // SOP 12 — Image Tagging Pass. Side-effect-free per .tmp/perf-
            // predictions § P-02: opens the store + creates two indexes, no
            // record iteration, no Date.now() inside the upgrade callback.
            // `meta.taggingComplete` is intentionally NOT seeded here —
            // absence is treated as `false` by `getMeta('taggingComplete')`,
            // which sends the user through the pass on next boot.
            const tags = db.createObjectStore('imageTags', {
              keyPath: 'imagePath',
            });
            tags.createIndex('byUserCategory', 'userCategory');
            tags.createIndex('byTaggedAt', 'taggedAt');
          }
          // Future: if (oldVersion < 3) { … } — never edit the blocks above.
        },
        blocked() {
          console.error(
            '[db] openDb blocked: another tab is holding an old version',
          );
        },
        blocking() {
          // A newer version is trying to open elsewhere — close so it can proceed.
          if (dbHandle) {
            try {
              dbHandle.close();
            } catch (cause) {
              console.error('[db] error closing on blocking', cause);
            }
            dbHandle = null;
          }
        },
        terminated() {
          console.error('[db] connection terminated unexpectedly');
          dbHandle = null;
        },
      });
      return db;
    } catch (cause) {
      throw new LibError('Failed to open IndexedDB', { code: 'DB_OPEN', cause });
    }
  })();

  try {
    dbHandle = await openPromise;
    return dbHandle;
  } finally {
    openPromise = null;
  }
}

/**
 * Release the cached handle. Used by:
 *   • app shutdown hooks;
 *   • `importAll(mode='overwrite')` (close → clear → re-open);
 *   • tests that need a clean slate.
 *
 * Safe to call when no DB is open (no-op).
 */
export async function closeDb(): Promise<void> {
  if (dbHandle) {
    try {
      dbHandle.close();
    } catch (cause) {
      console.error('[db] closeDb error', cause);
    }
    dbHandle = null;
  }
  openPromise = null;
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function nfc(s: string): string {
  return typeof s === 'string' ? s.normalize('NFC') : s;
}

function nowMs(): number {
  return Date.now();
}

function newUuidV4(): string {
  return uuidv4();
}

function assertUuidV4(id: string, code: 'DB_NOT_FOUND' | 'DB_CONFLICT' = 'DB_CONFLICT'): void {
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) {
    throw new LibError('Invalid uuid v4', { code, id });
  }
}

function assertIsoDate(date: string): void {
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) {
    throw new LibError('Invalid date; expected yyyy-mm-dd', {
      code: 'DB_CONFLICT',
    });
  }
  // Reject NaN dates like "2026-13-40".
  const t = Date.parse(date + 'T00:00:00Z');
  if (Number.isNaN(t)) {
    throw new LibError('Unparseable date', { code: 'DB_CONFLICT' });
  }
}

/** INV-03: derive Hebrew weekday from an ISO yyyy-mm-dd string. */
export function deriveDayOfWeek(isoDate: string): DayOfWeek {
  assertIsoDate(isoDate);
  // Anchor at UTC noon to avoid DST/locale drift on the weekday boundary.
  const d = new Date(isoDate + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  return HEBREW_DAYS_OF_WEEK[dow]!;
}

/** INV-05 / INV-08: every selection's `category` must be a known Hebrew literal. */
function assertSelectionsValid(
  selections: ImageSelection[] | undefined,
  field: string,
): void {
  if (!selections) return;
  if (!Array.isArray(selections)) {
    throw new LibError(`${field} must be an array`, { code: 'DB_CONFLICT' });
  }
  for (const sel of selections) {
    if (!sel || typeof sel !== 'object') {
      throw new LibError(`${field} contains a non-object`, { code: 'DB_CONFLICT' });
    }
    if (!IMAGE_CATEGORY_SET.has(sel.category)) {
      throw new LibError(
        `${field} contains unknown ImageCategory: ${String(sel.category)}`,
        { code: 'DB_CONFLICT' },
      );
    }
  }
}

/** INV-04 (soft warn): napkins.color === 'אחר' should carry a free-text witness. */
function warnNapkinsAcher(event: Event): void {
  if (
    event.napkins?.color === 'אחר' &&
    !event.napkins.foldType?.trim() &&
    !event.notes?.trim()
  ) {
    console.warn(
      '[db] INV-04: napkins.color === "אחר" without foldType or notes witness',
      { eventId: event.id },
    );
  }
}

/** Normalize free-text Hebrew strings on write (NFC) to keep equality stable. */
function normalizeClient(c: Client): Client {
  return {
    ...c,
    coupleNames: nfc(c.coupleNames),
    phone: nfc(c.phone),
    email: c.email !== undefined ? nfc(c.email) : c.email,
  };
}

function normalizeSelection(s: ImageSelection): ImageSelection {
  return {
    imagePath: nfc(s.imagePath),
    category: s.category, // already a literal; no NFC needed but harmless
    imageName: nfc(s.imageName),
    notes: nfc(s.notes ?? ''),
    selectedAt: typeof s.selectedAt === 'number' ? s.selectedAt : nowMs(),
  };
}

/**
 * SOP 12 ImageTag normalizer. Always overwrites `taggedAt` with `Date.now()`
 * (INV-12: lib owns timestamps). Validates structural shape. NFC-normalizes
 * Hebrew strings (`imagePath`, every `customLabels[i]`, `notes`).
 *
 * `userCategory` is optional. When present, it must be one of the 8 known
 * `IMAGE_CATEGORIES`; otherwise a `LibError DB_CONFLICT` is thrown.
 *
 * Importers (see `importAll`) call this in the merge path after retrieving
 * the existing record but before the LWW comparison — `taggedAt` is
 * therefore preserved from the payload only if the caller pre-stamps it.
 * In practice all in-app writes go through `putImageTag` /
 * `completeTaggingPass`, both of which re-stamp.
 */
function normalizeImageTag(t: ImageTag): ImageTag {
  if (!t || typeof t !== 'object') {
    throw new LibError('imageTag: must be an object', { code: 'DB_CONFLICT' });
  }
  if (typeof t.imagePath !== 'string' || t.imagePath.length === 0) {
    throw new LibError('imageTag.imagePath: must be a non-empty string', {
      code: 'DB_CONFLICT',
    });
  }
  if (!Array.isArray(t.customLabels)) {
    throw new LibError('imageTag.customLabels: must be a string[]', {
      code: 'DB_CONFLICT',
      path: t.imagePath,
    });
  }
  for (const label of t.customLabels) {
    if (typeof label !== 'string') {
      throw new LibError('imageTag.customLabels: all items must be strings', {
        code: 'DB_CONFLICT',
        path: t.imagePath,
      });
    }
  }
  if (typeof t.notes !== 'string') {
    throw new LibError('imageTag.notes: must be a string', {
      code: 'DB_CONFLICT',
      path: t.imagePath,
    });
  }
  if (t.userCategory !== undefined && !IMAGE_CATEGORY_SET.has(t.userCategory)) {
    throw new LibError(
      `imageTag.userCategory: unknown ImageCategory: ${String(t.userCategory)}`,
      { code: 'DB_CONFLICT', path: t.imagePath },
    );
  }
  const out: ImageTag = {
    imagePath: nfc(t.imagePath),
    customLabels: t.customLabels.map((s) => nfc(s)),
    notes: nfc(t.notes),
    // INV-12: lib owns timestamps. Always re-stamp on write.
    taggedAt: nowMs(),
  };
  if (t.userCategory !== undefined) {
    out.userCategory = t.userCategory;
  }
  return out;
}

function normalizeEvent(e: Event): Event {
  return {
    ...e,
    notes: nfc(e.notes ?? ''),
    napkins: {
      color: nfc(e.napkins.color) as Event['napkins']['color'],
      fabric: nfc(e.napkins.fabric) as Event['napkins']['fabric'],
      foldType: nfc(e.napkins.foldType ?? ''),
    },
    chairs: {
      type: nfc(e.chairs.type) as Event['chairs']['type'],
      bridalChair: nfc(e.chairs.bridalChair ?? ''),
    },
    chuppah: {
      ...e.chuppah,
      fabricDetails: nfc(e.chuppah.fabricDetails ?? ''),
      aisleDetails: nfc(e.chuppah.aisleDetails ?? ''),
      designSelections: (e.chuppah.designSelections ?? []).map(normalizeSelection),
    },
    upgrades: {
      description: nfc(e.upgrades.description ?? ''),
      items: (e.upgrades.items ?? []).map((s) => nfc(s)),
    },
    tableDesignSelections: (e.tableDesignSelections ?? []).map(normalizeSelection),
  };
}

// ===========================================================================
// Client CRUD
// ===========================================================================

export async function createClient(
  input: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Client> {
  if (!input || typeof input !== 'object') {
    throw new LibError('createClient: input is required', { code: 'DB_CONFLICT' });
  }
  const ts = nowMs();
  const client: Client = normalizeClient({
    id: newUuidV4(),
    coupleNames: input.coupleNames ?? '',
    phone: input.phone ?? '',
    email: input.email,
    createdAt: ts,
    updatedAt: ts,
  });
  const db = await openDb();
  try {
    await db.add('clients', client);
  } catch (cause) {
    throw new LibError('createClient failed', {
      code: 'DB_TX',
      id: client.id,
      cause,
    });
  }
  return client;
}

export async function getClient(id: string): Promise<Client | undefined> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    return await db.get('clients', id);
  } catch (cause) {
    throw new LibError('getClient failed', { code: 'DB_TX', id, cause });
  }
}

/**
 * O(N) cursor walk over the `clients` store. Per SOP 02 § Performance Notes,
 * Shon's volume keeps this well under 50ms.
 */
export async function listClients(
  opts?: { sortBy?: 'updatedAt' | 'coupleNames' },
): Promise<Client[]> {
  const db = await openDb();
  const out: Client[] = [];
  try {
    const tx = db.transaction('clients', 'readonly');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (cause) {
    throw new LibError('listClients failed', { code: 'DB_TX', cause });
  }
  const sortBy = opts?.sortBy ?? 'updatedAt';
  if (sortBy === 'updatedAt') {
    // Newest first.
    out.sort((a, b) => b.updatedAt - a.updatedAt);
  } else {
    // Locale-aware Hebrew sort.
    out.sort((a, b) => a.coupleNames.localeCompare(b.coupleNames, 'he'));
  }
  return out;
}

export async function findClientByPhone(phone: string): Promise<Client | undefined> {
  if (typeof phone !== 'string' || phone.length === 0) {
    return undefined;
  }
  const db = await openDb();
  try {
    return await db.getFromIndex('clients', 'byPhone', nfc(phone));
  } catch (cause) {
    throw new LibError('findClientByPhone failed', { code: 'DB_TX', cause });
  }
}

export async function updateClient(
  id: string,
  patch: Partial<Omit<Client, 'id' | 'createdAt'>>,
): Promise<Client> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    const tx = db.transaction('clients', 'readwrite');
    const existing = await tx.store.get(id);
    if (!existing) {
      throw new LibError('Client not found', { code: 'DB_NOT_FOUND', id });
    }
    const merged: Client = normalizeClient({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowMs(),
    });
    await tx.store.put(merged);
    await tx.done;
    return merged;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('updateClient failed', { code: 'DB_TX', id, cause });
  }
}

/**
 * INV-10: cascade-delete every event whose `clientId === id` in the SAME
 * transaction so a partial delete is impossible.
 */
export async function deleteClient(id: string): Promise<void> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    const tx = db.transaction(['clients', 'events'], 'readwrite');
    const eventsStore = tx.objectStore('events');
    const idx = eventsStore.index('byClientId');
    let cursor = await idx.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.objectStore('clients').delete(id);
    await tx.done;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('deleteClient failed', { code: 'DB_TX', id, cause });
  }
}

// ===========================================================================
// Event CRUD
// ===========================================================================

/**
 * Validate an Event candidate against domain invariants:
 *   • INV-01 — tableDesignSelections.length ≤ 5
 *   • INV-05 — every selection.category ∈ IMAGE_CATEGORIES
 *   • INV-12 — selectedAt is a number (lib re-stamps if missing/invalid via normalizeSelection)
 *
 * Status-machine and dayOfWeek invariants are checked by the caller paths
 * (`createEvent` / `updateEvent`) where we have access to the previous record.
 */
function assertEventBodyValid(event: Event): void {
  if (!Array.isArray(event.tableDesignSelections)) {
    throw new LibError('tableDesignSelections must be an array', {
      code: 'DB_CONFLICT',
      id: event.id,
    });
  }
  if (event.tableDesignSelections.length > 5) {
    throw new LibError('tableDesignSelections.length > 5 (INV-01)', {
      code: 'DB_CONFLICT',
      id: event.id,
    });
  }
  assertSelectionsValid(event.tableDesignSelections, 'tableDesignSelections');
  assertSelectionsValid(event.chuppah?.designSelections, 'chuppah.designSelections');
}

export async function createEvent(
  input: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Event> {
  if (!input || typeof input !== 'object') {
    throw new LibError('createEvent: input is required', { code: 'DB_CONFLICT' });
  }
  assertUuidV4(input.clientId, 'DB_NOT_FOUND');
  assertIsoDate(input.date);

  const ts = nowMs();
  const candidate: Event = normalizeEvent({
    ...input,
    id: newUuidV4(),
    // INV-03: dayOfWeek is ALWAYS derived from date — caller value is overwritten.
    dayOfWeek: deriveDayOfWeek(input.date),
    // INV-12: createdAt / updatedAt are lib-owned.
    createdAt: ts,
    updatedAt: ts,
  } as Event);

  // Status machine sanity (INV-02 / INV-09):
  //   • a brand-new event must NOT arrive in 'completed' (must pass through 'signed').
  //   • if `status === 'signed'`, signature must already be present.
  if (candidate.status === 'completed') {
    throw new LibError(
      "createEvent: status='completed' requires prior 'signed' transition (INV-09)",
      { code: 'DB_CONFLICT' },
    );
  }
  if (candidate.status === 'signed' && candidate.signature == null) {
    throw new LibError(
      "createEvent: status='signed' requires non-null signature (INV-02)",
      { code: 'DB_CONFLICT' },
    );
  }

  assertEventBodyValid(candidate);

  const db = await openDb();
  try {
    const tx = db.transaction(['clients', 'events'], 'readwrite');
    // INV-10: clientId must resolve to an existing client inside the tx.
    const client = await tx.objectStore('clients').get(candidate.clientId);
    if (!client) {
      throw new LibError('Client not found for new event (INV-10)', {
        code: 'DB_NOT_FOUND',
        id: candidate.clientId,
      });
    }
    await tx.objectStore('events').add(candidate);
    await tx.done;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('createEvent failed', {
      code: 'DB_TX',
      id: candidate.id,
      cause,
    });
  }
  warnNapkinsAcher(candidate);
  return candidate;
}

export async function getEvent(id: string): Promise<Event | undefined> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    return await db.get('events', id);
  } catch (cause) {
    throw new LibError('getEvent failed', { code: 'DB_TX', id, cause });
  }
}

export async function listEventsByClient(clientId: string): Promise<Event[]> {
  assertUuidV4(clientId, 'DB_NOT_FOUND');
  const db = await openDb();
  const out: Event[] = [];
  try {
    const tx = db.transaction('events', 'readonly');
    const idx = tx.store.index('byClientId');
    let cursor = await idx.openCursor(IDBKeyRange.only(clientId));
    while (cursor) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (cause) {
    throw new LibError('listEventsByClient failed', {
      code: 'DB_TX',
      id: clientId,
      cause,
    });
  }
  // Newest first by updatedAt.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function listEventsByStatus(status: EventStatus): Promise<Event[]> {
  if (status !== 'draft' && status !== 'signed' && status !== 'completed') {
    throw new LibError('listEventsByStatus: invalid status', { code: 'DB_CONFLICT' });
  }
  const db = await openDb();
  const out: Event[] = [];
  try {
    const tx = db.transaction('events', 'readonly');
    const idx = tx.store.index('byStatus');
    let cursor = await idx.openCursor(IDBKeyRange.only(status));
    while (cursor) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (cause) {
    throw new LibError('listEventsByStatus failed', { code: 'DB_TX', cause });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Read-modify-write inside a single transaction. Enforces the full INV-02 /
 * INV-03 / INV-09 / INV-10 set against the previous record.
 */
export async function updateEvent(
  id: string,
  patch: Partial<Omit<Event, 'id' | 'createdAt'>>,
): Promise<Event> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    const tx = db.transaction(['clients', 'events'], 'readwrite');
    const eventsStore = tx.objectStore('events');
    const existing = await eventsStore.get(id);
    if (!existing) {
      throw new LibError('Event not found', { code: 'DB_NOT_FOUND', id });
    }

    // INV-02 (b): signature is write-once-not-erasable.
    if (patch.signature === null && existing.signature !== null) {
      throw new LibError(
        'updateEvent: signature is write-once and cannot be unset (INV-02)',
        { code: 'DB_CONFLICT', id },
      );
    }

    const nextSignature: Signature | null =
      patch.signature !== undefined ? patch.signature : existing.signature;

    // Resolve the next status, then validate the transition.
    const nextStatus: EventStatus =
      patch.status !== undefined ? patch.status : existing.status;

    if (nextStatus !== 'draft' && nextStatus !== 'signed' && nextStatus !== 'completed') {
      throw new LibError('updateEvent: invalid status', {
        code: 'DB_CONFLICT',
        id,
      });
    }

    // INV-02 (a): signed requires non-null signature.
    if (nextStatus === 'signed' && nextSignature == null) {
      throw new LibError(
        "updateEvent: status='signed' requires non-null signature (INV-02)",
        { code: 'DB_CONFLICT', id },
      );
    }

    // INV-09: completed reachable only from signed.
    if (
      nextStatus === 'completed' &&
      patch.status === 'completed' &&
      existing.status !== 'signed'
    ) {
      throw new LibError(
        "updateEvent: 'completed' requires prior 'signed' (INV-09)",
        { code: 'DB_CONFLICT', id },
      );
    }

    // INV-10: if clientId is patched, target client must exist.
    if (patch.clientId !== undefined && patch.clientId !== existing.clientId) {
      assertUuidV4(patch.clientId, 'DB_NOT_FOUND');
      const targetClient = await tx.objectStore('clients').get(patch.clientId);
      if (!targetClient) {
        throw new LibError('Patched clientId references unknown client (INV-10)', {
          code: 'DB_NOT_FOUND',
          id: patch.clientId,
        });
      }
    }

    // INV-03: if date is patched, recompute dayOfWeek (overwrite caller's value).
    let nextDate = existing.date;
    let nextDayOfWeek = existing.dayOfWeek;
    if (patch.date !== undefined) {
      assertIsoDate(patch.date);
      nextDate = patch.date;
      nextDayOfWeek = deriveDayOfWeek(patch.date);
    }

    const merged: Event = normalizeEvent({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      clientId: patch.clientId ?? existing.clientId,
      date: nextDate,
      dayOfWeek: nextDayOfWeek,
      signature: nextSignature,
      status: nextStatus,
      updatedAt: nowMs(),
    });

    assertEventBodyValid(merged);

    await eventsStore.put(merged);
    await tx.done;
    warnNapkinsAcher(merged);
    return merged;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('updateEvent failed', { code: 'DB_TX', id, cause });
  }
}

export async function deleteEvent(id: string): Promise<void> {
  assertUuidV4(id, 'DB_NOT_FOUND');
  const db = await openDb();
  try {
    await db.delete('events', id);
  } catch (cause) {
    throw new LibError('deleteEvent failed', { code: 'DB_TX', id, cause });
  }
}

// ===========================================================================
// Thumbnails
// ===========================================================================

export async function getThumbnail(path: string): Promise<ThumbnailRecord | undefined> {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  const db = await openDb();
  try {
    return await db.get('thumbnails', nfc(path));
  } catch (cause) {
    throw new LibError('getThumbnail failed', { code: 'DB_TX', path, cause });
  }
}

export async function putThumbnail(rec: ThumbnailRecord): Promise<void> {
  if (!rec || typeof rec !== 'object') {
    throw new LibError('putThumbnail: record is required', { code: 'DB_CONFLICT' });
  }
  if (!IMAGE_CATEGORY_SET.has(rec.category)) {
    throw new LibError('putThumbnail: unknown ImageCategory', {
      code: 'DB_CONFLICT',
      path: rec.path,
    });
  }
  const normalized: ThumbnailRecord = {
    path: nfc(rec.path),
    category: rec.category,
    blob: rec.blob,
    generatedAt: typeof rec.generatedAt === 'number' ? rec.generatedAt : nowMs(),
    sourceModifiedAt:
      typeof rec.sourceModifiedAt === 'number' ? rec.sourceModifiedAt : 0,
  };
  const db = await openDb();
  try {
    await db.put('thumbnails', normalized);
  } catch (cause) {
    throw new LibError('putThumbnail failed', {
      code: 'DB_TX',
      path: normalized.path,
      cause,
    });
  }
}

export async function deleteThumbnailsByCategory(
  category: ImageCategory,
): Promise<number> {
  if (!IMAGE_CATEGORY_SET.has(category)) {
    throw new LibError('deleteThumbnailsByCategory: unknown ImageCategory', {
      code: 'DB_CONFLICT',
    });
  }
  const db = await openDb();
  let removed = 0;
  try {
    const tx = db.transaction('thumbnails', 'readwrite');
    const idx = tx.store.index('byCategory');
    let cursor = await idx.openCursor(IDBKeyRange.only(category));
    while (cursor) {
      await cursor.delete();
      removed += 1;
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (cause) {
    throw new LibError('deleteThumbnailsByCategory failed', {
      code: 'DB_TX',
      cause,
    });
  }
  return removed;
}

// ===========================================================================
// ImageTag CRUD (SOP 12 — Image Tagging Pass)
// ===========================================================================
//
// `imageTags` is keyed by `imagePath`. Writes go through `normalizeImageTag`
// which validates shape, NFC-normalizes Hebrew strings, and re-stamps
// `taggedAt = Date.now()` (INV-12). Callers do NOT pass `taggedAt`; any
// caller-supplied value is overwritten.
//
// `completeTaggingPass()` is the only writer of `meta.taggingComplete = true`,
// and it does it atomically with the final tag write inside one transaction
// over `['imageTags', 'meta']` (SOP 12 § Completion).

/**
 * Upsert one ImageTag. Re-stamps `taggedAt = Date.now()`. Used by the SOP 12
 * "שמור והבא" handler on every card save.
 */
export async function putImageTag(tag: ImageTag): Promise<void> {
  const normalized = normalizeImageTag(tag);
  const db = await openDb();
  try {
    await db.put('imageTags', normalized);
  } catch (cause) {
    throw new LibError('putImageTag failed', {
      code: 'DB_TX',
      path: normalized.imagePath,
      cause,
    });
  }
}

export async function getImageTag(
  imagePath: string,
): Promise<ImageTag | undefined> {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    return undefined;
  }
  const db = await openDb();
  try {
    return await db.get('imageTags', nfc(imagePath));
  } catch (cause) {
    throw new LibError('getImageTag failed', {
      code: 'DB_TX',
      path: imagePath,
      cause,
    });
  }
}

/**
 * O(N) cursor walk over the `imageTags` store (mirrors `listClients`). Used by
 * the SOP 12 progress UI ("47 / 884") on resume + by `exportAll`. Order is
 * IndexedDB primary-key (`imagePath`) ascending — callers that need a
 * different order should sort the returned array themselves.
 */
export async function listImageTags(): Promise<ImageTag[]> {
  const db = await openDb();
  const out: ImageTag[] = [];
  try {
    const tx = db.transaction('imageTags', 'readonly');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (cause) {
    throw new LibError('listImageTags failed', { code: 'DB_TX', cause });
  }
  return out;
}

/**
 * Remove one ImageTag by path. Present for completeness; v1.0 has no UI
 * surface that calls it (re-tagging is a v1.x feature per SOP 12 § 8).
 */
export async function deleteImageTag(imagePath: string): Promise<void> {
  if (typeof imagePath !== 'string' || imagePath.length === 0) {
    throw new LibError('deleteImageTag: imagePath required', {
      code: 'DB_CONFLICT',
    });
  }
  const db = await openDb();
  try {
    await db.delete('imageTags', nfc(imagePath));
  } catch (cause) {
    throw new LibError('deleteImageTag failed', {
      code: 'DB_TX',
      path: imagePath,
      cause,
    });
  }
}

/**
 * Count of tagged images. Used by the SOP 12 progress UI on resume to show
 * `<count> / <total>` without materializing the full array. O(1) per IDB
 * primary-store metadata.
 */
export async function countImageTags(): Promise<number> {
  const db = await openDb();
  try {
    return await db.count('imageTags');
  } catch (cause) {
    throw new LibError('countImageTags failed', { code: 'DB_TX', cause });
  }
}

/**
 * SOP 12 § Completion: atomically write the final ImageTag and flip
 * `meta.taggingComplete = true` in a SINGLE transaction over
 * `['imageTags', 'meta']`. Both succeed together or both roll back; on
 * failure the SOP 12 pass remains active and the user can resume.
 *
 * Re-stamps `finalTag.taggedAt = Date.now()` (INV-12). The caller is the
 * "סיים תיוג" handler.
 */
export async function completeTaggingPass(finalTag: ImageTag): Promise<void> {
  const normalized = normalizeImageTag(finalTag);
  const db = await openDb();
  try {
    const tx = db.transaction(['imageTags', 'meta'], 'readwrite');
    await tx.objectStore('imageTags').put(normalized);
    await tx.objectStore('meta').put({
      key: 'taggingComplete',
      value: true,
    } as MetaRow);
    await tx.done;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('completeTaggingPass failed', {
      code: 'DB_TX',
      path: normalized.imagePath,
      cause,
    });
  }
}

// ===========================================================================
// Meta
// ===========================================================================

const META_KEYS: ReadonlySet<MetaKey> = new Set<MetaKey>([
  'lastBackupAt',
  'lastScanAt',
  'lastImportAt',
  'taggingComplete',
  'theme',
]);

function assertMetaKey(key: string): asserts key is MetaKey {
  if (!META_KEYS.has(key as MetaKey)) {
    throw new LibError('Unknown meta key', { code: 'DB_CONFLICT', path: key });
  }
}

/**
 * SOP 14 § 2 — defense-in-depth validator for `meta.theme`. The single writer
 * is the `<ThemeToggle />` `onClick` handler, which only ever passes
 * `'light' | 'dark'`. We still re-validate at the lib boundary so a corrupt
 * value coming from a future migration / backup-import path can never silently
 * land in the meta store.
 *
 * Absence of the row (no setMeta('theme', …) call yet) is the canonical
 * "default = dark" state per SOP 14 § 2 Default semantics — readers treat
 * undefined as `'dark'` and MUST NOT auto-write a default.
 */
function assertThemeValue(value: unknown): asserts value is 'light' | 'dark' {
  if (value !== 'light' && value !== 'dark') {
    throw new LibError(
      "setMeta('theme'): value must be 'light' or 'dark'",
      { code: 'DB_CONFLICT', path: 'theme' },
    );
  }
}

export async function getMeta<T = unknown>(key: MetaKey): Promise<T | undefined> {
  assertMetaKey(key);
  const db = await openDb();
  try {
    const row = await db.get('meta', key);
    return row ? (row.value as T) : undefined;
  } catch (cause) {
    throw new LibError('getMeta failed', { code: 'DB_TX', path: key, cause });
  }
}

export async function setMeta<T = unknown>(key: MetaKey, value: T): Promise<void> {
  assertMetaKey(key);
  // SOP 14 § 2 — only 'light' | 'dark' are persistable for the theme key.
  // Throws BEFORE opening the DB so a bad call costs nothing.
  if (key === 'theme') {
    assertThemeValue(value);
  }
  const db = await openDb();
  try {
    await db.put('meta', { key, value });
  } catch (cause) {
    throw new LibError('setMeta failed', { code: 'DB_TX', path: key, cause });
  }
}

// ===========================================================================
// Bulk export / import (consumed by SOP 07 Backup)
// ===========================================================================

/**
 * Snapshot the entire `clients` + `events` + `imageTags` payload. The
 * `schemaVersion` field carries the *live* `DB_VERSION` constant (read at call
 * time, not from the meta store). SOP 07 wraps this in a `BackupEnvelope`;
 * the backup envelope's `schemaVersion` field uses `BACKUP_SCHEMA_VERSION`
 * from `types/index.ts`.
 *
 * Note: this function returns the on-disk DB layout's version, NOT the
 * `BACKUP_SCHEMA_VERSION` envelope tag. SOP 07 is responsible for swapping in
 * `BACKUP_SCHEMA_VERSION` when serializing to JSON for disk.
 *
 * From DB_VERSION 2 onward (SOP 12), `imageTags` is populated. Empty array if
 * the SOP 12 pass has not yet completed on this machine.
 */
export async function exportAll(): Promise<DbExport> {
  const db = await openDb();
  try {
    const tx = db.transaction(
      ['clients', 'events', 'imageTags'],
      'readonly',
    );

    const clients: Client[] = [];
    let cc = await tx.objectStore('clients').openCursor();
    while (cc) {
      clients.push(cc.value);
      cc = await cc.continue();
    }

    const events: Event[] = [];
    let ec = await tx.objectStore('events').openCursor();
    while (ec) {
      events.push(ec.value);
      ec = await ec.continue();
    }

    const imageTags: ImageTag[] = [];
    let tc = await tx.objectStore('imageTags').openCursor();
    while (tc) {
      imageTags.push(tc.value);
      tc = await tc.continue();
    }
    await tx.done;

    return {
      schemaVersion: DB_VERSION,
      exportedAt: nowMs(),
      clients,
      events,
      imageTags,
    };
  } catch (cause) {
    throw new LibError('exportAll failed', { code: 'DB_TX', cause });
  }
}

export type ImportPayload = {
  schemaVersion: number;
  clients: Client[];
  events: Event[];
  /**
   * SOP 12 imageTags. Optional on the wire so a v1 envelope (no field) is
   * still importable; when absent, the importer treats it as an empty array
   * and forces `meta.taggingComplete = false` per SOP 07 § Restore from v1
   * → v2.
   */
  imageTags?: ImageTag[];
};

export type ImportResult = {
  clientsWritten: number;
  eventsWritten: number;
  imageTagsWritten: number;
};

/**
 * Apply an import payload in a SINGLE transaction over
 * `['clients', 'events', 'imageTags', 'meta']`.
 *
 *   • `mode === 'overwrite'` — clear `clients` + `events` + `imageTags`,
 *     then write all incoming records. `lastBackupAt` and `lastScanAt` are
 *     PRESERVED; `lastImportAt` is set to `Date.now()` inside the same tx.
 *   • `mode === 'merge'`     — last-writer-wins per record by `updatedAt`
 *     (clients/events) or `taggedAt` (imageTags). `lastBackupAt` and
 *     `lastScanAt` are PRESERVED; `lastImportAt` is set.
 *
 * `meta.taggingComplete` rule (both modes, per SOP 02 / SOP 07 / SOP 12):
 *   • payload.schemaVersion >= 2 with non-empty imageTags → SET to `true`.
 *   • payload.schemaVersion >= 2 with empty imageTags     → unchanged
 *     (preserves prior local state — never demotes `true` to `false`).
 *   • payload.schemaVersion === 1 (no imageTags field)    → SET to `false`.
 *     The user is sent back through the SOP 12 pass on next boot.
 *
 * Schema-version match is the caller's job (SOP 07 `importBackup` checks
 * `BACKUP_SCHEMA_VERSION`); we additionally guard against `payload.schemaVersion`
 * disagreeing with our `DB_VERSION` so a stale backup never silently lands —
 * with one carve-out: v1 payloads are accepted (SOP 07 § Restore from v1 →
 * v2) and normalized to imageTags = [].
 */
export async function importAll(
  payload: ImportPayload,
  mode: 'merge' | 'overwrite',
): Promise<ImportResult> {
  if (!payload || typeof payload !== 'object') {
    throw new LibError('importAll: payload is required', { code: 'DB_CONFLICT' });
  }
  // Accept the live DB_VERSION OR a v1 payload (SOP 07 v1→v2 compat).
  // Anything else is a stale or future-version backup — refuse.
  if (
    payload.schemaVersion !== DB_VERSION &&
    payload.schemaVersion !== 1
  ) {
    throw new LibError(
      `importAll: schemaVersion mismatch (got ${payload.schemaVersion}, expected ${DB_VERSION} or 1)`,
      { code: 'DB_CONFLICT' },
    );
  }
  if (!Array.isArray(payload.clients) || !Array.isArray(payload.events)) {
    throw new LibError('importAll: clients/events must be arrays', {
      code: 'DB_CONFLICT',
    });
  }
  if (payload.imageTags !== undefined && !Array.isArray(payload.imageTags)) {
    throw new LibError('importAll: imageTags must be an array when present', {
      code: 'DB_CONFLICT',
    });
  }
  if (mode !== 'merge' && mode !== 'overwrite') {
    throw new LibError('importAll: invalid mode', { code: 'DB_CONFLICT' });
  }

  // SOP 07 § Restore from v1 → v2: v1 payloads have no imageTags field; treat
  // as empty + force taggingComplete = false. v2 payloads with non-empty
  // imageTags imply the source had completed the pass; force taggingComplete
  // = true. v2 with empty imageTags leaves the local flag untouched (don't
  // demote a local `true` to `false`).
  const isV1 = payload.schemaVersion === 1;
  const incomingTags: ImageTag[] = isV1
    ? []
    : (payload.imageTags ?? []);

  const db = await openDb();
  let clientsWritten = 0;
  let eventsWritten = 0;
  let imageTagsWritten = 0;

  try {
    const tx = db.transaction(
      ['clients', 'events', 'imageTags', 'meta'],
      'readwrite',
    );
    const clientsStore = tx.objectStore('clients');
    const eventsStore = tx.objectStore('events');
    const imageTagsStore = tx.objectStore('imageTags');
    const metaStore = tx.objectStore('meta');

    if (mode === 'overwrite') {
      await clientsStore.clear();
      await eventsStore.clear();
      await imageTagsStore.clear();
      for (const c of payload.clients) {
        await clientsStore.put(normalizeClient(c));
        clientsWritten += 1;
      }
      for (const e of payload.events) {
        await eventsStore.put(normalizeEvent(e));
        eventsWritten += 1;
      }
      for (const t of incomingTags) {
        await imageTagsStore.put(normalizeImageTag(t));
        imageTagsWritten += 1;
      }
    } else {
      // merge: last-writer-wins by updatedAt (clients/events) or taggedAt
      // (imageTags).
      for (const c of payload.clients) {
        const existing = await clientsStore.get(c.id);
        if (!existing || (c.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
          await clientsStore.put(normalizeClient(c));
          clientsWritten += 1;
        }
      }
      for (const e of payload.events) {
        const existing = await eventsStore.get(e.id);
        if (!existing || (e.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
          await eventsStore.put(normalizeEvent(e));
          eventsWritten += 1;
        }
      }
      for (const t of incomingTags) {
        const normalized = normalizeImageTag(t);
        const existing = await imageTagsStore.get(normalized.imagePath);
        if (
          !existing ||
          (normalized.taggedAt ?? 0) >= (existing.taggedAt ?? 0)
        ) {
          await imageTagsStore.put(normalized);
          imageTagsWritten += 1;
        }
      }
    }

    // Single-writer-of-lastImportAt rule (SOP 02 § Object Stores). Note we
    // touch ONLY this key — `lastBackupAt` and `lastScanAt` are preserved.
    await metaStore.put({ key: 'lastImportAt', value: nowMs() } as MetaRow);

    // SOP 07 § `imageTags` rule + § Restore from v1 → v2:
    //   v1 payload          → SET taggingComplete = false (re-open SOP 12).
    //   v2 with tags > 0    → SET taggingComplete = true  (skip SOP 12).
    //   v2 with tags === 0  → leave the row untouched (don't demote).
    if (isV1) {
      await metaStore.put({
        key: 'taggingComplete',
        value: false,
      } as MetaRow);
    } else if (incomingTags.length > 0) {
      await metaStore.put({
        key: 'taggingComplete',
        value: true,
      } as MetaRow);
    }

    await tx.done;
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError('importAll failed', { code: 'DB_TX', cause });
  }

  return { clientsWritten, eventsWritten, imageTagsWritten };
}

// ===========================================================================
// Test hooks
// ===========================================================================

/**
 * Test-only: closes the cached handle and deletes the entire database. Tests
 * call this between cases to start from a clean slate. NEVER call from app
 * code — there is no recovery from a deleted DB other than a backup restore.
 */
export async function __resetDbForTests(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort: tests should ensure no open handles
  });
}

// Type-only re-exports so consumers in Layer 2 don't have to dual-import
// `'./db'` and `'../types'` for the same domain types.
export type {
  Client,
  Event,
  EventStatus,
  ImageCategory,
  ImageSelection,
  ImageTag,
} from '../types';
