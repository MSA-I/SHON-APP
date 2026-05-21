# SOP 12 — Image Tagging Pass

> Authoritative spec for the **one-time** Image Tagging Pass that runs on first launch before any clients exist. Update *before* code changes. Companion to:
> - `claude.md § Behavioral Rules #11` (the gate rule)
> - `claude.md § Data Schemas — ImageTag` (the schema)
> - SOP 02 § Object Stores (`imageTags` store + `taggingComplete` MetaKey)
> - SOP 07 § Restore from v1 → v2 (backup compatibility)

## 1. Purpose

Shon's image library is **874 images + 10 videos across 8 categories**, scanned in place from `D:\משה פרוייקטים\שון בלאיש\` (SOP 01). The folder names are the canonical 8 `IMAGE_CATEGORIES`, but Shon thinks about his library in his own private taxonomy — color groups, mood notes, "this one is for the Resort", "this is the chuppah I built for the Bar Mitzvah at Gamos". Without a tagging pass he would have to re-derive that classification at every meeting.

The Image Tagging Pass is a **one-time gate** that:

1. Walks Shon through every `ImageMetadata` record once.
2. For each, lets him pick a `userCategory` (from the 8 existing categories), add free-text `customLabels` (chip-style, multi), and free-text `notes`.
3. Persists everything to the new `imageTags` IndexedDB store.
4. Sets `meta.taggingComplete = true` in the same transaction as the final tag write.
5. Closes the pass forever — no menu link, no settings affordance, no automatic retrigger.

After completion the app boots straight into the home screen. The pass's source code remains in the bundle (a minor cost) but is unreachable through any UI surface. Re-tagging is a v1.x feature (Settings → "התחל תיוג מחדש") — out of MVP scope.

## 2. Data model

### `ImageTag` (canonical schema lives in `claude.md § Data Schemas`)

```typescript
type ImageTag = {
  imagePath: string;        // FK -> ImageMetadata.path; primary key
  userCategory?: ImageCategory;   // Optional — Shon may use only customLabels
  customLabels: string[];   // Free-text Hebrew labels (chip-style)
  notes: string;            // Free-text Hebrew notes
  taggedAt: number;         // Epoch ms — set by db.ts at write time
};
```

### `meta.taggingComplete` flag

A new `MetaKey` value (SOP 02). Boolean. Absent = falsy = pass not yet run. Set to `true` exactly once when Shon clicks "סיים תיוג". Importable backups (SOP 07) may set it to `false` when restoring a v1 envelope.

### Why `userCategory` is optional

Two cases the spec must handle:

1. Shon types only `customLabels` and leaves the radio unselected — happens when his private taxonomy doesn't fit any of the 8 folder categories ("מטבח חיצוני", "תאורה דרמטית"). The schema accepts this; gallery filtering will fall back to `customLabels` matching.
2. Shon picks a `userCategory` AND types `customLabels` — both are stored, both are queryable.

We do **not** add a "אחר" sentinel value to `ImageCategory`. The 8 categories are the folder structure (immutable). User overrides live exclusively in `customLabels`.

## 3. Storage

### IndexedDB store `imageTags` (created at DB_VERSION 2 — SOP 02)

| Property | Value |
|---|---|
| Name | `imageTags` |
| Key path | `imagePath` (no auto-increment; the path is the natural primary key) |
| Indexes | `byUserCategory` (`userCategory`), `byTaggedAt` (`taggedAt`) |

The `byUserCategory` index supports gallery filters like "show me everything Shon tagged as `חופות ריזורט`". The `byTaggedAt` index supports any "last tagged" UI (deferred to v1.x re-tagging).

### MetaKey `'taggingComplete'`

Added to the `MetaKey` union in SOP 02. Single writer: SOP 12's `finishTaggingPass()` (sets `true`) and SOP 07's `importAll()` for v1 payloads (sets `false`). All other keys (`lastBackupAt`, `lastScanAt`, `lastImportAt`) are unaffected.

### Atomicity contract

The final tag write and the `taggingComplete = true` flip MUST happen in the same IndexedDB read-write transaction over `['imageTags', 'meta']`. If either fails, both roll back — the pass remains active, Shon can resume from where he left off (see § 4 Quit-and-resume).

## 4. UX flow

> **Routing context.** This entire flow only runs when `meta.taggingComplete === false` (or absent). On every other boot, the home screen renders directly. See § 6 for the routing rule.

### One-image card

The pass renders **one** `ImageMetadata` record at a time, full-screen. No pagination, no thumbnail grid — Shon focuses on a single image.

Layout (RTL, Luxury Editorial design language per SOP 09):

- **Top row:** progress counter `תויגו 47 / 884` (gold tabular figures, see SOP 09 § Numerics rule). Counter increments only when the user advances via "שמור והבא"; clicking "סיים תיוג" mid-pass also commits the in-progress card.
- **Center:** the image itself, large preview (~1000px wide on a 1440 viewport), via `asset://` URL from the FsProvider's `toFileSrc()`. Videos render as a `<video controls>` element with the same sizing.
- **Below image:** the file's display name (from `ImageMetadata.name`) and its current folder category (from `ImageMetadata.category`) — informational only, not a default for `userCategory`.
- **Right column (RTL):**
  - Radio group titled "קטגוריה (אופציונלי)" — 8 radios, one per `IMAGE_CATEGORIES` entry, plus an explicit "ללא קטגוריה" option that maps to `userCategory = undefined`.
  - Chip-style labels input titled "תוויות". Free-text. Comma-separated input creates chips; each chip has an X to remove. Hebrew NFC normalization applied at write time (db.ts owns this, per SOP 11 INV-12).
  - Notes textarea titled "הערות" (4 rows, free-text Hebrew).
- **Bottom row:** two buttons.
  - Primary "שמור והבא" — writes the in-progress `ImageTag`, advances the cursor.
  - Secondary "סיים תיוג" — see § 5 Completion.

### Per-card write semantics

"שמור והבא" calls a hypothetical `db.upsertImageTag(tag)`:

1. Opens a `readwrite` transaction over `['imageTags']`.
2. Stamps `taggedAt = Date.now()` (the lib owns timestamps per SOP 11 INV-12).
3. NFC-normalizes `customLabels[]` and `notes`.
4. Validates `userCategory` (if set) is in `IMAGE_CATEGORIES` (per SOP 11 INV-05).
5. `put`s the record (key=`imagePath`).
6. Commits.

A failed write surfaces as a toast (`"שמירת התיוג נכשלה — נסה שוב"`) and the card stays put. Network is not a factor — the only failure modes are local quota exhaustion or storage corruption.

### Skipping a card

If Shon clicks "שמור והבא" with all three inputs empty (no `userCategory`, no labels, no notes), we still **persist an empty record**: `{ imagePath, customLabels: [], notes: '', taggedAt: Date.now() }`. Rationale: the presence of the row is the contract that "this image was reviewed". Future re-tagging UI can distinguish "never seen" from "seen-and-skipped".

### Quit-and-resume

The pass is interruptible. Closing the app mid-pass does NOT set `taggingComplete`. On the next boot:

1. The router re-checks `meta.taggingComplete` (still false → render `<TaggingPass />`).
2. The pass component reads `imageTags` (already-tagged paths) and the full `ImageMetadata[]` cache (built by SOP 01 scan on boot).
3. The cursor resumes at the **first untagged image** in scan order — for the predictable order, the pass iterates `ImageMetadata[]` in the same deterministic order SOP 01 emits (category lex order, then file lex order within each category). The synthetic `כיסא כלה` category sits last per the SOP 01 ratification.
4. The progress counter shows `<tagged-count> / <total>` accurately.

This means closing the app counts as an implicit "save current and pause".

### Acceptance scope

The pass MUST be uninterruptible by any other navigation:

- No global navigation chrome rendered (no Settings link, no client list).
- The browser/Tauri window's close button still works — that's the quit-and-resume path.
- Keyboard shortcuts: `Enter` triggers "שמור והבא" only when the focus is in the notes textarea or the labels input has no pending text. Otherwise no app-level shortcuts.

## 5. Completion

The "סיים תיוג" button:

1. Opens a `readwrite` transaction over `['imageTags', 'meta']`.
2. If the current card has any input, persists it (same write semantics as "שמור והבא").
3. Sets `meta.taggingComplete = true`.
4. Commits.
5. Triggers `backup.exportBackup('tagging-complete')` per SOP 07 (new `BackupTrigger` value). Failure is non-blocking — `taggingComplete` is already true; the user reaches the home screen even if disk-write fails. A toast surfaces the backup failure.
6. The router observes `taggingComplete = true` and replaces `<TaggingPass />` with `<HomeScreen />` (no animation other than a fade — the pass is over).

Edge case: clicking "סיים תיוג" on the very first card with zero progress. Allowed. The pass is gone, `imageTags.length === 1` (the empty record) or `0` if even the empty save failed. We do **not** require Shon to tag any minimum number of images — Behavioral Rule #11 says "before the home screen renders", not "after he tags 100".

Once `taggingComplete = true`, the pass is permanently closed. There is no "undo" affordance. v1.x re-tagging will explicitly flip the flag back to `false` from Settings.

## 6. Routing rule

In `app/src/App.tsx` (or wherever the top-level shell lives):

```typescript
function App() {
  const { taggingComplete, isLoaded } = useTaggingGate();  // reads meta.taggingComplete on mount

  if (!isLoaded) {
    return <BootSplash />;  // brand mark while we read meta
  }
  if (!taggingComplete) {
    return <TaggingPass />;  // SOP 12
  }
  return <HomeScreen />;  // normal app
}
```

Constraints:

- The check happens **once** at app boot. The component re-renders only on `taggingComplete` flipping from false → true (live, in-process). Subsequent boots short-circuit at `isLoaded && taggingComplete`.
- No `<TaggingPass />` is mounted from any other surface. There is no `/tagging` route, no Settings link, no shortcut. It is gated exclusively by the boot router.
- The home screen does not check `taggingComplete` — its parent does. Internally the home screen assumes the gate has been satisfied.

## 7. Backup integration

### Export

Per SOP 07 § File Format, the v2 envelope is:

```typescript
{
  schemaVersion: 2,
  exportedAt: number,
  clients: Client[],
  events: Event[],
  imageTags: ImageTag[],   // SOP 12 — the full tags array
}
```

Every `exportBackup()` call dumps the **full** `imageTags` array. There is no incremental/delta backup.

### Trigger on completion

Adding `'tagging-complete'` to `BackupTrigger` in SOP 07 means the SOP 12 completion handler auto-snapshots a backup as part of completion. Filename follows the standard SOP 07 pattern (`backup_YYYY-MM-DD_HH-mm.json`) — no special suffix. The trigger string is logged for diagnostics only; it is not persisted in the envelope.

### Restore behavior

- v2 backup → `imageTags` restored verbatim. `meta.taggingComplete` is set to `true` if `imageTags.length > 0` at export, false otherwise. (See SOP 07 § `imageTags` rule.)
- v1 backup (no `imageTags` field) → empty array, `meta.taggingComplete = false`. The user is sent through the SOP 12 pass on next boot. (See SOP 07 § Restore from v1 → v2.)

### Round-trip acceptance

A v2 backup produced after the SOP 12 pass completes, when re-imported on a fresh DB, MUST produce: home screen renders, `imageTags.length` matches export, no SOP 12 pass shown. This is the "Backup roundtrip" extension to the canonical 13-step verification flow.

## 8. Re-tagging (deferred — v1.x)

Out of MVP scope, but shape locked here so v1.x doesn't have to re-litigate:

- Settings → "התחל תיוג מחדש" button. Confirmation dialog: "כל התיוגים הנוכחיים יישמרו, אבל המסך יחזור. להמשיך?".
- Click flips `meta.taggingComplete = false`. Existing `imageTags` are preserved (the user is amending, not starting from zero).
- The pass component, on resume, prefills each card from the existing `ImageTag` row if one exists.
- A second "סיים תיוג" click flips the flag back to `true` and re-snapshots a backup.

This deferred feature does **not** alter the v1.0 invariant: the pass renders exactly once on first launch, never again, until v1.x ships.

## 9. Migration from BACKUP_SCHEMA_VERSION 1

Already covered in SOP 07 § Restore from v1 → v2. Mirrored here for SOP 12 self-containment:

- v1 envelopes lack the `imageTags` field. The importer normalizes them to `imageTags = []` and sets `meta.taggingComplete = false`.
- After import, the user lands on the home screen if and only if their LOCAL DB already had `taggingComplete === true` from a previous SOP 12 run (because `meta` overwrite-mode preserves nothing in this case — the importer always sets `taggingComplete = false` for v1 payloads).
- TL;DR: importing a v1 backup always re-opens the SOP 12 pass on next boot, regardless of local state. The user re-runs it once; the next backup they take is v2.

## 10. Performance

The performance-engineer's `bench.mjs` (`.tmp/perf-bench/bench.mjs`) covered scan budgets. The SOP 12 pass adds zero new perf concerns:

- Renders one image at a time → no virtualization, no thumbnail grid pressure.
- One `put` write per "שמור והבא" click → < 5ms per write (SOP 02 § Performance Notes).
- The full `ImageMetadata[]` is already in memory by the time the pass mounts (SOP 01 boots before the router decides what to render).
- The `byUserCategory` and `byTaggedAt` indexes are populated during the pass; their build cost is amortized one-write-at-a-time and not visible to the user.
- Total pass duration is gated by Shon's typing speed. At ~30 seconds per image (a generous estimate for the slowest cards), 884 images = ~7.4 hours of human time. He can do it across multiple sessions (quit-and-resume, § 4).

No P-01..P-05 prediction in `.tmp/perf-predictions.md` is invalidated. The pass does not interact with the gallery rendering pipeline.

## 11. Verification

Add this acceptance script to the canonical 13-step flow (it runs **before** step 1 if `taggingComplete` is absent on boot):

**Pre-step 0 — SOP 12 Tagging Pass (only on first launch)**

A. Boot the app from a cold start. Confirm: tagging pass screen renders (NOT home screen). Counter shows `0 / 884`. The first card in scan order is visible (category `אולם עיצוב בסיס 2026`, alphabetical first filename).

B. Tag 3 images:
   - Card 1: pick `userCategory = 'אולם עיצוב בסיס 2026'`, add labels `["זהב", "פרחוני"]`, notes `"מועדף לאירועי ערב"`. Click "שמור והבא". Counter shows `1 / 884`.
   - Card 2: leave `userCategory` unset, add labels `["נופי"]`, notes empty. Click "שמור והבא". Counter shows `2 / 884`.
   - Card 3: pick `userCategory = 'חופות ריזורט'`, no labels, no notes. Click "שמור והבא". Counter shows `3 / 884`.

C. Close the app window (quit-and-resume). Reopen. Tagging pass renders again (NOT home screen). Counter shows `3 / 884`. Cursor sits on card 4 (the next untagged image in scan order).

D. Click "סיים תיוג" without tagging card 4. Confirm:
   - DevTools → IndexedDB → `imageTags` has 3 records (the 3 from step B). Card 4 was NOT persisted.
   - DevTools → IndexedDB → `meta` → `taggingComplete = true`.
   - A backup file appears in `D:\משה פרוייקטים\שון בלאיש\backups\` within 1s. Open it: `schemaVersion: 2`, `imageTags.length === 3`, content matches the 3 cards from step B.
   - The home screen now renders (empty client list with "לקוח חדש" CTA, per canonical step 2).

E. Restart the app. Confirm: home screen renders directly. The tagging pass NEVER reappears. There is no menu link, no Settings affordance, no shortcut to it.

F. **Backup roundtrip extension to canonical step 9.** After step 9 (clear IndexedDB) and step 10 (`ייבוא גיבוי` with the v2 backup from step D), confirm: the home screen renders, NOT the tagging pass. `imageTags` has the 3 records from step B intact.

G. **v1 backup compatibility.** Manually craft a v1 envelope `{schemaVersion: 1, exportedAt, clients: [...], events: [...]}` (no `imageTags` field). Settings → `ייבוא גיבוי` → choose this file. Confirm: import succeeds; on next boot the tagging pass renders again (counter `0 / 884`); after a single "סיים תיוג", the next backup is v2 with the user's clients/events preserved.

**Acceptance:** all 7 steps pass on Shon's Windows 10 machine. Failure of any step blocks shipping.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. Defines the one-time gate, schema, store, MetaKey, UX flow, completion contract, routing rule, backup integration, v1→v2 migration, deferred re-tagging, perf, and verification. | Initial spec |
| 2026-05-20 | `db.ts` v2 migration shipped (`DB_VERSION` 1→2). `imageTags` store created with `keyPath: 'imagePath'` + indexes `byUserCategory` + `byTaggedAt`. ImageTag CRUD landed (`putImageTag`, `getImageTag`, `listImageTags`, `deleteImageTag`, `countImageTags`). `completeTaggingPass(finalTag)` is atomic over `['imageTags','meta']` — single `readwrite` tx writes the normalized final tag AND `meta.taggingComplete=true`; both succeed or both roll back. NFC normalization at every write. INV-12 honored — db.ts re-stamps `taggedAt`. | Phase 3A close; `db.ts` 1057 → 1392 lines (+335). |
| 2026-05-20 | `<TaggingPass />` component shipped per § 4 UX flow. On mount: `Promise.all([images.scanAll(), db.listImageTags()])`; flatten `byCategory` to one array sorted by `(IMAGE_CATEGORIES order, Hebrew localeCompare)`; synthetic `כיסא כלה` lands last. Cursor parks at first untagged index; finishing auto-triggers `db.completeTaggingPass` + `backup.exportBackup('tagging-complete')`. Reduced-motion respected. | Phase 3B implementation; matches SOP 12 § 4 + § 5. |
| 2026-05-20 | `BackupExportReason` extended with `'tagging-complete'`. The `as never` casts that `TaggingPass.tsx` used as a temporary bridge during the parallel-agent swarm are no longer required. | Phase 3A must-fix close. |
| 2026-05-21 | The "deferred re-tagging" path (SOP 12 §8) lands in v1.x — Settings will expose a button that flips `meta.taggingComplete` back to `false`. For MVP, the pass is unreachable from any UI surface once complete, per Behavioral Rule #11. | Confirmed during Phase 4 SOP sync. |
