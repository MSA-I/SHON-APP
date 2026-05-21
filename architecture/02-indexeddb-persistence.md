# SOP 02 — IndexedDB Persistence

> Authoritative spec for how `Client` and `Event` records persist on Shon's machine. Update *before* code changes. POC L2 (`.tmp/poc-l2-indexeddb/`) proved the API; this SOP locks the schema, indexes, transactional rules, and migration policy.

## Purpose

Provide the single durable store of business records (clients, events, signatures) on Shon's PC, with no cloud dependency. IndexedDB is the **source of truth**; the `backups/` folder is a recovery mechanism, not a primary store. The image filesystem is read-only and never persisted into IndexedDB except for derived thumbnails.

## Stack

- **Library:** `idb` v8 (typed Promise wrapper around IndexedDB)
- **Database name:** `shon-blaish`
- **Schema version:** `2` (was `1`; bumped 2026-05-20 to add the `imageTags` store + `taggingComplete` meta flag for SOP 12). Bump on every breaking change; see § Migration Policy.
- **Backing store:** WebView2 (Tauri) IndexedDB → on-disk under the Tauri app's WebView profile

## Object Stores

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `clients` | `id` (uuid v4) | `byPhone` (phone, unique=false), `byUpdatedAt` (updatedAt) | `Client` records |
| `events` | `id` (uuid v4) | `byClientId` (clientId), `byDate` (date), `byStatus` (status), `byUpdatedAt` (updatedAt) | `Event` records |
| `thumbnails` | `path` (string) | `byCategory` (category), `byGeneratedAt` (generatedAt) | WebP `Blob` thumbnails (see SOP 01) |
| `imageTags` | `imagePath` (string) | `byUserCategory` (userCategory), `byTaggedAt` (taggedAt) | `ImageTag` records — user-supplied tags captured once during the SOP 12 Image Tagging Pass. Created at DB version 2. |
| `meta` | `key` (string) | — | Singleton config rows: `lastBackupAt`, `lastScanAt`, `lastImportAt`, `taggingComplete`. **Note:** `schemaVersion` is **not** a meta row — it is the compile-time `DB_VERSION` constant (see § Migration Policy) and is read at runtime via `db.version`. Each meta key has a single writer (see `MetaKey` doc comment in API surface). |

`thumbnails` is documented here (not in SOP 01) because it lives in the same DB. SOP 01 owns *what* goes in; this SOP owns *how* the store is created and migrated.

## API Surface (`app/src/lib/db.ts`)

```typescript
import type { Client, Event, ImageCategory, ImageTag } from '../types';

export type ThumbnailRecord = {
  path: string;
  category: ImageCategory;
  blob: Blob;
  generatedAt: number;
  sourceModifiedAt: number;   // mtime of the source image at thumb-time
};

export type MetaKey = 'lastBackupAt' | 'lastScanAt' | 'lastImportAt' | 'taggingComplete';
// schemaVersion is NOT a meta-store row. It's the compile-time `DB_VERSION` constant
// (see § Migration Policy) and is read at runtime via `db.version`. Backups carry it
// as a top-level field literal (see exportAll below).
//
// Meta keys are write-scoped to make import/export observable in Settings:
//   - lastBackupAt     — set ONLY by SOP 07 exportBackup() after a successful write
//   - lastScanAt       — set ONLY by SOP 01 scanAll() after a successful scan completes
//   - lastImportAt     — set ONLY by importAll() inside its transaction (both modes).
//                        Distinct from lastBackupAt so that a restore doesn't masquerade
//                        as a backup in the Settings "last backup" indicator.
//   - taggingComplete  — boolean. Set to `true` ONLY by SOP 12 finishTaggingPass() in
//                        the same transaction as the final ImageTag write. Once true,
//                        the Image Tagging Pass is gone forever (Behavioral Rule #11).
//                        Importers may set it to `false` when restoring a v1 backup
//                        (no imageTags field) — this re-opens the pass on next boot.

// --- Lifecycle ---
export async function openDb(): Promise<IDBPDatabase<Schema>>;
// closeDb() releases the singleton IDBDatabase handle held by openDb. Used by app
// shutdown hooks and by `importAll(mode='overwrite')` (which closes → deletes →
// re-opens). Safe to call when no DB is open (no-op). After resolution, the next
// openDb() call re-opens cleanly.
export async function closeDb(): Promise<void>;

// --- Client CRUD ---
export async function createClient(input: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client>;
export async function getClient(id: string): Promise<Client | undefined>;
export async function listClients(opts?: { sortBy?: 'updatedAt' | 'coupleNames' }): Promise<Client[]>;
export async function findClientByPhone(phone: string): Promise<Client | undefined>;
export async function updateClient(id: string, patch: Partial<Omit<Client, 'id' | 'createdAt'>>): Promise<Client>;
export async function deleteClient(id: string): Promise<void>;  // also deletes events for that client (transactional)

// --- Event CRUD ---
export async function createEvent(input: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): Promise<Event>;
export async function getEvent(id: string): Promise<Event | undefined>;
export async function listEventsByClient(clientId: string): Promise<Event[]>;
export async function listEventsByStatus(status: Event['status']): Promise<Event[]>;
export async function updateEvent(id: string, patch: Partial<Omit<Event, 'id' | 'createdAt'>>): Promise<Event>;
export async function deleteEvent(id: string): Promise<void>;

// --- Thumbnails ---
export async function getThumbnail(path: string): Promise<ThumbnailRecord | undefined>;
export async function putThumbnail(rec: ThumbnailRecord): Promise<void>;
export async function deleteThumbnailsByCategory(category: ImageCategory): Promise<number>;

// --- Meta ---
export async function getMeta<T = unknown>(key: MetaKey): Promise<T | undefined>;
export async function setMeta<T = unknown>(key: MetaKey, value: T): Promise<void>;

// --- Bulk export/import (consumed by SOP 07 Backup) ---
//
// exportAll().schemaVersion is the live `DB_VERSION` constant from this module —
// read at call time, not from the meta store. Backups always carry the source DB's
// version so the importer can decide whether to migrate.
//
// imageTags are included from DB_VERSION 2 onward (SOP 12). Empty array if the
// SOP 12 pass has not yet completed on this machine.
export async function exportAll(): Promise<{ schemaVersion: number; clients: Client[]; events: Event[]; imageTags: ImageTag[]; exportedAt: number }>;

// importAll runs in ONE transaction over ['clients', 'events', 'imageTags', 'meta'].
// The `meta` store inclusion is deliberate — but tightly scoped:
//
//   - mode='overwrite': clear `clients` + `events` + `imageTags`, then write all
//     incoming records. `lastBackupAt` is PRESERVED (it tracks "when did THIS machine
//     last back up", not source-machine state). `lastScanAt` is PRESERVED (the local
//     image library hasn't changed; the next app boot still validates via SOP 01
//     mtime checks). `lastImportAt` is SET to Date.now() inside the same transaction.
//   - mode='merge': last-writer-wins per record by `updatedAt` (clients/events) or
//     by `taggedAt` (imageTags). `lastBackupAt` and `lastScanAt` are PRESERVED.
//     `lastImportAt` is SET to Date.now().
//
// `taggingComplete` rule (both modes):
//   - If payload schemaVersion >= 2 AND the source had taggingComplete === true at
//     export time (encoded as `imageTags.length > 0` for v2 payloads), the importer
//     SETS `meta.taggingComplete = true` inside the same transaction.
//   - If payload schemaVersion === 1 (no `imageTags` field), the importer fills
//     `imageTags = []` and SETS `meta.taggingComplete = false` — the user is sent
//     back through the SOP 12 pass on next boot.
//
// The `meta` store is in the transaction so `lastImportAt` and `taggingComplete`
// write atomically with the records. `schemaVersion` from the payload is consumed
// only for migration — it is never written into the meta store.
export async function importAll(
  payload: { schemaVersion: number; clients: Client[]; events: Event[]; imageTags?: ImageTag[] },
  mode: 'merge' | 'overwrite'
): Promise<{ clientsWritten: number; eventsWritten: number; imageTagsWritten: number }>;
```

The lib is **side-effect-free at import time** — `openDb()` is called explicitly by the app shell on boot. Tests import the same module against `fake-indexeddb`.

## Transactional Rules

1. **Every write goes through `updatedAt = Date.now()`.** Callers do not set `updatedAt` manually; the lib always overwrites it. `createdAt` is set once on `create*`, never touched again.
2. **Cascading deletes for clients** (`deleteClient`) run inside a single read-write transaction over `['clients', 'events']` so a partial delete is impossible.
3. **`importAll` runs in one transaction** over `['clients', 'events', 'meta']`. On any error, the entire import rolls back.
4. **`updateEvent` is read-modify-write**: the function reads current event, applies the patch, and writes it back inside one transaction. Concurrent updaters lose the race deterministically (the last writer wins) — acceptable because there's only one user per machine.
5. **No write-on-read.** `listClients`, `getEvent`, etc. open a `readonly` transaction.

## ID Generation

- All ids are **uuid v4**, generated client-side via the `uuid` v9 package (`import { v4 as uuidv4 } from 'uuid'`). `uuid` is a locked dependency in `app/package.json` (added per reviewer's SOP-02 directive 2026-05-20).
- We do **not** rely on `crypto.randomUUID()` directly: it is unavailable in older WebView2 builds Shon's machine may run, and threading a runtime fallback through every call site is noisier than depending on a single ~6KB library.
- Never derive ids from `coupleNames` or phone numbers (PII; also collisions for a couple booking two events).

## Validation Boundary

The lib accepts already-typed objects. It does **not** sanitize free-text fields (`Event.notes`, `Event.napkins.foldType`, `Event.upgrades.description`). Sanitization, length limits, and trimming are the form layer's job (Layer 2). The DB layer trusts its inputs.

Exception: the lib **does** verify referential integrity on `createEvent` — it asserts that `clientId` resolves to an existing client, throwing `ClientNotFoundError` if not. This is cheap and prevents orphans.

## Migration Policy

`onupgradeneeded` callback (in `openDb`) handles every breaking schema change. Migrations are forward-only and idempotent.

```typescript
const DB_VERSION = 2;
openDB<Schema>('shon-blaish', DB_VERSION, {
  upgrade(db, oldVersion, newVersion, tx) {
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
      // SOP 12 — Image Tagging Pass. Idempotent, side-effect-free: opens the
      // store and creates two indexes. No record iteration; no Date.now() use
      // inside the upgrade callback (per P-02 perf budget).
      const tags = db.createObjectStore('imageTags', { keyPath: 'imagePath' });
      tags.createIndex('byUserCategory', 'userCategory');
      tags.createIndex('byTaggedAt', 'taggedAt');
      // Note: `meta.taggingComplete` is NOT seeded here. It is absent (treated
      // as `false` by getMeta) until SOP 12 finishTaggingPass() writes it.
    }
    // Future: if (oldVersion < 3) { … }
  },
});
```

### Migration v1 → v2 (2026-05-20)

This migration is forward-only and side-effect-free per the policy above. It:

1. Creates the `imageTags` object store (key=`imagePath`) with two indexes:
   - `byUserCategory` (`userCategory`) — for "show me everything Shon tagged as `חופות ריזורט`" lookups in galleries.
   - `byTaggedAt` (`taggedAt`) — for ordering during the Settings "last tagged" surface (deferred to v1.x).
2. Does **not** seed `meta.taggingComplete`. Absence of the row is treated as `false` by `getMeta('taggingComplete')`. The flag is written exactly once when the user clicks "סיים תיוג" in the SOP 12 pass.
3. Does **not** iterate any existing `ImageMetadata` (which is in-memory only and rebuilt on boot per SOP 01).
4. Triggers a `pre-migration` backup via SOP 07 before opening the DB at version 2 — same rule as every prior version bump.

After upgrade, the app boots into the SOP 12 Image Tagging Pass (because `meta.taggingComplete` is absent → falsy). For an existing user upgrading from v1, this is the first and only time they will see the pass.

When schema changes are required:
1. Bump `DB_VERSION` in the same commit as the `claude.md` schema change.
2. Add an `if (oldVersion < N) { … }` block — **never** edit an earlier block.
3. **Auto-snapshot a backup before opening** the DB at the new version (see SOP 07). If the migration throws, the user can restore from that snapshot.
4. Append a row to `claude.md § Maintenance Log` describing the change.

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---|---|---|
| `openDb` rejects (storage corruption) | promise rejection at app boot | Show full-screen error with "Restore from backup…" CTA → SOP 07 import flow |
| Quota exceeded (thumbnails too large) | `QuotaExceededError` on `putThumbnail` | Drop oldest thumbnails by `byGeneratedAt` until under quota; emit a structured warning to the app's log channel (`console.warn` + the in-memory `LibError` ring buffer surfaced in Settings → Diagnostics). The lib never writes to `progress.md` itself — that file is owned by the agent/team workflow. |
| `createEvent` with unknown clientId | `ClientNotFoundError` | UI shows "Client missing — please re-select"; never write the orphan |
| Concurrent tab opens DB at higher version | `versionchange` event | Force-close and prompt user to restart the app — only one writer at a time |
| `importAll` rejects mid-transaction | thrown error | Whole transaction rolls back; UI shows "Restore failed — your existing data is intact" |

## Test Hooks

The lib accepts an injectable `IDBFactory`:

```typescript
export async function openDb(factory: IDBFactory = indexedDB): Promise<IDBPDatabase<Schema>>;
```

In tests, pass `fake-indexeddb`. In production, pass the global `indexedDB`. This was already proven in POC L2.

## Performance Notes

- A typical client meeting writes ~3-5 events worth of data; size per event is < 5KB JSON without thumbnails. Quota is not a concern for the client/event stores.
- `getEvent(id)` and `findClientByPhone(phone)` are **O(log N)** IndexedDB primary-key / index lookups; expected < 5ms each on Shon's hardware.
- `listClients()` is **O(N)** — it cursor-walks the `clients` store (or the `byUpdatedAt` / `byCoupleNames`-derived ordering) and materializes the full array. At Shon's volume (tens of clients per year, low hundreds over the app's lifetime) this is well under 50ms. If the store ever grows past ~10k records, page the list via `IDBCursor.advance(n)` instead of materializing.
- `listEventsByClient(clientId)` and `listEventsByStatus(status)` are also O(N) cursor walks scoped to the matching index range — bounded by events-per-client (small) or events-per-status (small).
- Thumbnails dominate storage (~22MB by SOP 01's estimate). The `byCategory` index lets us evict an entire category cheaply if image library structure changes.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | POC L2 confirmed `idb` v8 + `fake-indexeddb` round-trip; locked store names/indexes here | Initial spec |
| 2026-05-20 | Reviewer audit: `listClients()` is O(N) cursor walk, not O(1); `schemaVersion` lives in `DB_VERSION` not the `meta` store; `crypto.randomUUID` polyfill fallback was un-stacked, replaced by hard `uuid` v9 dep; `closeDb()` semantics undocumented; `importAll`/`meta` interaction unclear; lib must not write `progress.md` directly | Edited Performance Notes, Object Stores table, ID Generation, lifecycle docstring, exportAll/importAll docstrings, and Failure Modes accordingly |
| 2026-05-20 | Pre-review item #4: SOP 02 `importAll` and SOP 07 'overwrite' contradicted on `meta` store behavior. Aligned: introduced `lastImportAt` MetaKey; both modes preserve `lastBackupAt` and `lastScanAt` and write `lastImportAt = Date.now()` inside the import transaction. Each meta key now has a single named writer | Extended `MetaKey` union; rewrote `importAll` docstring; updated `meta` table row; SOP 07 § Restore Modes now points back to this rule |
| 2026-05-20 | DB_VERSION bumped 1 → 2 for SOP 12 Image Tagging Pass. New `imageTags` store (key=`imagePath`, indexes `byUserCategory` + `byTaggedAt`); new `MetaKey` `'taggingComplete'`. Migration v1→v2 documented; side-effect-free, no record iteration, P-02 perf budget honored. | User: one-time tagging pass that gates the home screen on first launch. Single source of truth for the new schema lives in `claude.md § Data Schemas` (`ImageTag`); SOP 12 owns the UX flow and routing. |
| 2026-05-20 | DB_VERSION 2 migration shipped (`db.ts` 1057 → 1392 lines). `exportAll`/`importAll` now span `['clients','events','imageTags','meta']`. ImageTag CRUD + `completeTaggingPass` atomic over `['imageTags','meta']`. v1 import payloads accepted (`imageTags = []`, `meta.taggingComplete = false`). | Phase 3A landed end-to-end; 121/121 tests green including INV-01..12 + meta key allowlist. |
| 2026-05-20 | `MetaKey` extended to include `'theme'` (single-writer is `<ThemeToggle />` via `ThemeContext`). `setMeta('theme', value)` validates `'light' \| 'dark'` BEFORE `openDb()` so a bad call costs no IO. Absent row stays absent — readers default to `'dark'` without persisting. | SOP 14 wiring; defense-in-depth against a future migration corrupting the value. |
| 2026-05-21 | Phase 4 sync: confirmed 121/121 vitest baseline preserved across the v2 migration + theme MetaKey extension; `lastImportAt`/`lastBackupAt`/`lastScanAt`/`theme` are the four meta keys never demoted by `importAll`. | Refinement-pass cross-check against `progress.md` Phase 3A close. |

## Verification

POC `.tmp/poc-l2-indexeddb/indexeddb-poc.mjs` proved:
- Two object stores (clients + events) created at version 1
- `createClient` + `getClient` round-trip with Hebrew `coupleNames`
- `byClientId` index returns events for a couple
- `byStatus = 'signed'` query returns only signed events
- Transactional update preserves `createdAt`, advances `updatedAt`

Final acceptance is gated by the **canonical 13-step end-to-end flow** in `claude.md § Verification`. Specifically, this SOP underwrites steps 3-4 (client+event create), step 7 (backup auto-write on signature), and steps 8-10 (backup roundtrip clears + restores all `clients` and `events` records).
