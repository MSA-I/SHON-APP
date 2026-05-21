# SOP 07 — Backup Strategy

> Authoritative spec for how the app exports, retains, and restores `Client` + `Event` data as on-disk JSON snapshots in `D:\משה פרוייקטים\שון בלאיש\backups\`. Update *before* code changes.

## Purpose

IndexedDB is durable but not portable. A WebView2 corruption, a Windows reinstall, or accidental "Clear browsing data" wipes everything. Backups give Shon a recoverable trail and a way to move the app to a new machine. Backups are **complete snapshots**, not incremental — restore is "replace state with this file" or "merge".

## Policy (from `claude.md` § Backup Policy)

| Property | Value |
|---|---|
| Path | `D:\משה פרוייקטים\שון בלאיש\backups\` |
| Filename | `backup_YYYY-MM-DD_HH-mm.json` (local clock; UTC in the JSON body) |
| Retention | rolling latest 30; older auto-pruned at write time |
| Schema version | `BACKUP_SCHEMA_VERSION = 2` (was `1`; bumped 2026-05-20 to add `imageTags[]` per SOP 12) |
| Format | single JSON file: `{ schemaVersion, exportedAt, clients[], events[], imageTags[] }` |
| Trigger 1 | `Event.status` transitions `draft → signed` (SOP 06 confirm) |
| Trigger 2 | `Event.status` transitions to `completed` |
| Trigger 3 | SOP 12 Image Tagging Pass completes (`meta.taggingComplete` flips to `true`) |
| Trigger 4 | Manual "ייצוא גיבוי" button in Settings (no rate limit) |

Backups carry **no thumbnails** and **no image binaries** — those live on disk and are recreated by re-scanning. A backup is small (estimated < 2 MB even with hundreds of events + the full `imageTags[]` array for the 884 media files) because it's only metadata + signatures + tag strings.

## API Surface (`app/src/lib/backup.ts`)

```typescript
export type BackupPayload = {
  schemaVersion: number;     // 2 for current; 1 still importable (see § Restore from v1 → v2)
  exportedAt: number;        // epoch ms, UTC
  clients: Client[];
  events: Event[];
  imageTags: ImageTag[];     // SOP 12 — empty array if the tagging pass has not completed
};

export type BackupFileInfo = {
  path: string;              // absolute path on disk
  filename: string;          // backup_YYYY-MM-DD_HH-mm.json
  exportedAt: number;
  sizeBytes: number;
};

export type BackupTrigger = 'signed' | 'completed' | 'tagging-complete' | 'manual' | 'pre-migration';

// --- Write ---
export async function exportBackup(trigger: BackupTrigger): Promise<BackupFileInfo>;

// --- Read / list ---
export async function listBackups(): Promise<BackupFileInfo[]>;  // sorted newest first
export async function readBackup(path: string): Promise<BackupPayload>;

// --- Restore ---
export async function importBackup(path: string, mode: 'merge' | 'overwrite'): Promise<{
  clientsWritten: number;
  eventsWritten: number;
  conflicts: { id: string; reason: string }[];
}>;

// --- Pruning ---
export async function pruneOldBackups(keep: number = 30): Promise<{ removed: BackupFileInfo[] }>;
```

`exportBackup` orchestrates: `db.exportAll()` → JSON.stringify → write file via Tauri FS → `pruneOldBackups()` → `db.setMeta('lastBackupAt', exportedAt)` → return info. The caller awaits the whole thing.

## Filesystem Interaction

Backup writes use the Tauri FS provider documented in SOP 08. Specifically:
- `writeTextFile(absolutePath, json)` for export
- `readTextFile(absolutePath)` for restore
- `readDir(backupsDir)` for `listBackups`
- `removeFile(absolutePath)` for prune

The `backupsDir` is resolved once at app boot:

```typescript
// In app shell init
const projectRoot = 'D:\\\\משה פרוייקטים\\\\שון בלאיש';  // configurable via Tauri config
const backupsDir = join(projectRoot, 'backups');
```

If `backupsDir` does not exist, the app creates it on first export. This lets a fresh-machine restore work even if the user copies only the app, not the folder structure.

## File Format

```jsonc
{
  "schemaVersion": 2,
  "exportedAt": 1747740120000,
  "clients": [
    {
      "id": "f9b1...uuid",
      "coupleNames": "ליאב ודן",
      "phone": "0501234567",
      "email": null,
      "createdAt": 1747700000000,
      "updatedAt": 1747740100000
    }
  ],
  "events": [
    {
      "id": "8e3c...uuid",
      "clientId": "f9b1...uuid",
      "date": "2026-06-14",
      "...": "all fields per claude.md Event schema",
      "signature": {
        "dataUrl": "data:image/png;base64,iVBORw0K...",
        "signedAt": 1747740100000
      },
      "status": "signed"
    }
  ],
  "imageTags": [
    {
      "imagePath": "אולם עיצוב בסיס 2026/שנדליר ורסאצה.JPG",
      "userCategory": "אולם עיצוב בסיס 2026",
      "customLabels": ["זהב", "מרכזי"],
      "notes": "מועדף לאולם הגדול",
      "taggedAt": 1747700001234
    },
    {
      "imagePath": "כסא כלה בתוך האולם.jpg",
      "customLabels": ["קלאסי"],
      "notes": "",
      "taggedAt": 1747700002345
    }
  ]
}
```

The format mirrors the IndexedDB shape exactly. Restore is a near-direct write back into the stores.

## Filename Generation

```typescript
function formatBackupFilename(d: Date): string {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `backup_${Y}-${M}-${D}_${h}-${m}.json`;
}
```

Same-minute collisions (two saves within 60 s) overwrite. This is acceptable: a second save in the same minute represents the same logical state.

## Restore Modes

Both modes route through `db.importAll(payload, mode)` (SOP 02). That function owns the transaction; this section describes the *intent* the user picks in the UI. The two SOPs must agree on `meta`-store behavior — see the rule below.

### `meta`-store rule (canonical, applies to both modes)

The transaction is `['clients', 'events', 'imageTags', 'meta']`. Within it:
- `lastBackupAt` — **preserved**. It tracks "when did THIS machine last back up" and must not be overwritten by a source machine's value.
- `lastScanAt` — **preserved**. The local image library is unchanged by an import; SOP 01's mtime-based incremental scanner remains valid.
- `lastImportAt` — **set** to `Date.now()` inside the same transaction (both modes). The Settings panel reads `lastImportAt` to surface "שוחזר לאחרונה" separately from "גובה לאחרונה".
- `taggingComplete` — **set** based on payload (see § `imageTags` rule below).

`schemaVersion` from the payload is consumed for migration decisions (see SOP 02 § Migration Policy) and is never written into the meta store.

### `imageTags` rule (canonical, applies to both modes)

- v2 payload (has `imageTags` field): merge or overwrite the `imageTags` store per the mode's normal semantics. If `imageTags.length > 0` at export time, the importer SETS `meta.taggingComplete = true` inside the same transaction — the user lands on the home screen, not the SOP 12 pass.
- v1 payload (no `imageTags` field): the importer fills `imageTags = []` and SETS `meta.taggingComplete = false`. The user is sent back through the SOP 12 pass on next boot. See § Restore from v1 → v2 below.

### `merge`
- For each client in the backup: if `id` exists in DB, **keep newer `updatedAt`** (LWW); else insert.
- Same rule for events.
- For each `ImageTag`: keyed by `imagePath`; LWW by `taggedAt`. If the local DB already has a more-recent tag for that path, the local tag wins.
- `conflicts[]` collects records where DB had a newer version (skipped in favor of DB).
- Used when Shon imports a backup from another machine into a populated DB.
- `meta`: per the rules above — `lastImportAt` is set; `taggingComplete` is set per payload.

### `overwrite`
- Truncate `clients`, `events`, and `imageTags` stores.
- Write all records from backup.
- `thumbnails` is **left untouched** — they're keyed by image path and remain valid against the local image library; SOP 01's mtime check will refresh any that need it.
- `meta` follows the canonical rules above: `lastBackupAt` and `lastScanAt` preserved, `lastImportAt` set, `taggingComplete` set per payload.
- The DB version is checked against the backup's `schemaVersion`. If they differ, the migration policy from SOP 02 runs first.
- Used for "this is my canonical state" recovery.

### Restore from v1 → v2

A v1 backup file (one written before 2026-05-20) lacks the `imageTags` field. The importer accepts it and runs this normalization before handing the payload to `db.importAll`:

```typescript
function normalizeV1ToV2(raw: unknown): BackupPayload {
  const p = raw as Partial<BackupPayload> & { schemaVersion: number };
  if (p.schemaVersion === 1) {
    return {
      schemaVersion: 2,
      exportedAt: p.exportedAt!,
      clients: p.clients ?? [],
      events: p.events ?? [],
      imageTags: [],  // v1 had no tagging pass — start empty
    };
  }
  return p as BackupPayload;
}
```

The importer then SETS `meta.taggingComplete = false` inside the import transaction, regardless of the local DB's prior state. Rationale: the source machine never ran the SOP 12 pass (or ran it but exported before v2), so the only safe assumption is that this user must do the pass on the destination machine. After the pass completes, a fresh v2 backup is written by the SOP 12 trigger.

`schemaVersion` newer than the local app build still refuses import (existing rule — see § Failure Modes).

The Settings panel asks the user explicitly: "ביצוע אוחה (merge) או החלפה מלאה (overwrite)?" with merge as default.

## Pruning Algorithm

```typescript
export async function pruneOldBackups(keep = 30): Promise<{ removed: BackupFileInfo[] }> {
  const all = await listBackups();        // sorted newest first
  const toRemove = all.slice(keep);       // everything beyond the first `keep`
  for (const file of toRemove) {
    await fs.removeFile(file.path);
  }
  return { removed: toRemove };
}
```

Pruning runs synchronously after every successful `exportBackup` (and also on app boot, defensively). Failure to prune one file does not fail the export — the pruner logs and continues.

## Trigger Implementation

The triggers are wired in Layer 2, not in `backup.ts` itself. `backup.ts` only knows how to do an export; it does not subscribe to events.

```typescript
// In SummaryTab — signature confirm handler
async function handleSign(dataUrl: string) {
  await db.updateEvent(eventId, {
    signature: { dataUrl, signedAt: Date.now() },
    status: 'signed',
  });
  await backup.exportBackup('signed').catch((err) => {
    notify.warn('הגיבוי האוטומטי נכשל — ייצא ידנית מהגדרות');
    log.error('auto-backup failed', err);
  });
}
```

A failed auto-backup **never** rolls back the signature. Backup failure is non-blocking: the user's data is already safe in IndexedDB, and they can manually export later.

## Pre-migration Backup

Before opening the DB at a new schema version, `openDb` calls `backup.exportBackup('pre-migration')` first. This guarantees that if the migration corrupts data, the user can roll back. Filename includes `_pre-migration` suffix to make the snapshot easy to spot:

```typescript
function formatBackupFilename(d: Date, suffix?: string): string {
  // ... base name ...
  return suffix ? `${baseName}_${suffix}.json` : `${baseName}.json`;
}
```

These pre-migration snapshots are exempt from the rolling-30 prune (filtered out before slice). They accumulate but are rare.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| `backups/` dir creation fails (permissions) | `mkdir` rejects | Show error toast: "לא ניתן ליצור תיקיית גיבויים — בדוק הרשאות"; user can manually export elsewhere |
| Disk full during write | `writeTextFile` rejects | Toast + log; data still safe in DB; manual export remains an option |
| Backup file corrupted | JSON.parse fails on read | Show "קובץ הגיבוי פגום" in restore dialog; do not import partial; user picks a different file |
| `schemaVersion` newer than DB version | `importBackup` checks first | Refuse import; tell user to update the app first |
| `schemaVersion` older than DB | check first | Run migration on the imported records before writing |
| Auto-backup fails on signature trigger | promise rejection | Sign succeeds anyway; failure surfaces in Settings as "גיבוי אחרון נכשל ב…" |
| Concurrent `exportBackup` calls | rare but possible | Use a mutex; second call awaits first; same-minute filename overwrites |
| Pruning removes a file user wanted | user error | Document: "Pre-migration snapshots are kept indefinitely; rolling backups are 30 newest" |

## Settings Panel Surface

The Settings panel (Layer 2) exposes:
1. **List of backups** — newest first, with `exportedAt` formatted in Hebrew + size + trigger source.
2. **Last auto-backup status** — green checkmark or red warning.
3. **Manual export** button — calls `exportBackup('manual')`.
4. **Restore from file…** — opens a Tauri file picker scoped to `backups/`, asks merge vs overwrite, runs `importBackup`.
5. **Open backups folder** — `tauri-shell-open` of `backupsDir`.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft locks rolling-30 retention with `_pre-migration` exempt; merge-vs-overwrite explicit at restore | Initial spec |
| 2026-05-20 | Pre-review item #4: SOP 07 'overwrite' said "meta is left untouched" but SOP 02 `importAll` covered `meta` in its tx. Aligned both: import transaction now writes ONLY `lastImportAt`; `lastBackupAt` and `lastScanAt` are explicitly preserved. `lastImportAt` is a new MetaKey added in SOP 02 (Settings reads it as "שוחזר לאחרונה") | Rewrote § Restore Modes with a "canonical `meta`-store rule" that both modes route through |
| 2026-05-20 | Pre-review item #3: `ImageCategory` ratification of synthetic 8th category (`כיסא כלה`) had not propagated to all SOPs | Updated SOPs 01, 05, 08; this SOP unaffected (treats `clients`/`events` only) |
| 2026-05-20 | `BACKUP_SCHEMA_VERSION` bumped 1 → 2 for SOP 12 Image Tagging Pass. Envelope now carries `imageTags: ImageTag[]`. New `BackupTrigger` value `'tagging-complete'` added (auto-snapshot when the pass finishes). v1 → v2 restore path documented: empty `imageTags` + `meta.taggingComplete = false` so the user re-runs the pass. | New schema field requires backward-compatible importer. v1 backups remain importable so existing field machines aren't stranded. |
| 2026-05-20 | `BackupExportReason` union extended with `'tagging-complete'` in `app/src/lib/backup.ts`. The `as never` cast that `TaggingPass.tsx` used as a temporary bridge is now removable. | Phase 3A must-fix M-1..M-4 close (review #19). |
| 2026-05-20 | Phase 3A must-fix bug surfaced 4 ways: `backup.ts` was wired against the pre-SOP-12 `db.ts` shape; `parseBackup` hard-rejected v1 envelopes; `exportBackup` carried an obsolete `as unknown as` cast; `BackupImportResult` did not surface `imageTagsWritten`. | M-1..M-4 landed in a single ~30-line `backup.ts` commit; canonical 13-step + SOP 12 §11 A–G verification both passed afterwards. 22/22 backup tests green. |
| 2026-05-20 | F-2 (informational, from #15): `console.info('[backup] exportBackup ok', …)` always fires inside `exportBackup`. The current test setup wraps `error`/`warn` (throws), but if a future PR upgrades the wrapper to also throw on `info`, every `exportBackup` test would fail. | Note in this SOP so the next test-harness change considers it. |
| 2026-05-21 | Phase 4: real Tauri-side roundtrip (export → file on disk → import → IndexedDB compare) is still pending and gated behind `npm run tauri:dev`. The unit-test layer covers shape + retention + v1→v2 migration. | Tracked in `task_plan.md` Phase 5 § Tauri integration testing. |

## Verification (planned)

Phase 3 step 14 (`backup.ts`) + step 35 (SummaryTab) + step 37 (Settings panel). Local acceptance gates:
- Sign an event → file `backup_<ts>.json` appears in `backups/` within 1s
- Run 31 sign cycles → only the latest 30 remain
- Bump `DB_VERSION` and re-open → a `_pre-migration` snapshot appears, exempted from prune
- Restore in `merge` mode preserves a newer-DB record over an older-backup record
- Restore in `overwrite` mode replaces all clients + events

End-to-end acceptance is gated by the **canonical 13-step flow** in `claude.md § Verification`. This SOP underwrites step 7 (auto-snapshot on signature → file in `backups/`) and the full backup-roundtrip block (steps 8-10): manual `ייצוא גיבוי` produces a < 2MB JSON, clearing IndexedDB then `ייבוא גיבוי` restores Client + Event with all selections + signature intact.
