# SOP 11 — Domain Invariants

> Authoritative list of business rules the code MUST enforce. Each invariant has (a) a one-line statement, (b) the schema field(s) it constrains, (c) where it must be enforced (lib / context / UI), (d) the failure mode it prevents, and (e) the test or runtime check that catches a violation.
>
> **Update rule.** A new invariant lands here only when it is also reflected in `claude.md` (Constitution) — either in the schema, in the Behavioral Rules, or in the canonical Verification flow. SOP 11 is the *enforcement layer* on top of those statements.

## How to read this SOP

For each invariant:
- **ID** — stable identifier (`INV-01`, `INV-02`, …) so PRs and tests can cite it.
- **Statement** — the rule, in plain English.
- **Source** — which line of `claude.md` (or which SOP) makes this rule normative.
- **Constrained fields** — the exact schema paths affected.
- **Enforcement layer** — where the check lives. Order of preference:
  1. **TypeScript types** (compile-time — best)
  2. **`db.ts` validators** (runtime, lib layer — second-best, catches direct DB writes)
  3. **`EventContext` reducer** (context layer — guards UI mutations)
  4. **UI guards** (component-level — last line of defense, e.g., disabled buttons)
- **Violation symptom** — what the user/dev would see if the invariant breaks.
- **Test / check** — where Task #18 will look to confirm it's enforced.

---

## §1. `tableDesignSelections.length ≤ 5`

**ID:** `INV-01`
**Statement:** An `Event` may carry **at most 5** `ImageSelection`s in `tableDesignSelections`. The 6th selection attempt is silently rejected at the context layer with a Hebrew toast (`ניתן לבחור עד 5 עיצובים`).
**Source:** `claude.md § Event` ("`tableDesignSelections: ImageSelection[]; // עד 5 בחירות`") + Verification step 4 ("Counter shows 3/5") + SOP 05 § Selection Semantics + SOP 05 § Failure Modes.
**Constrained field:** `Event.tableDesignSelections`
**Enforcement layer:**
- **EventContext reducer** — primary. The toggle handler returns `false` if `selections.length === 5 && !already-selected`.
- **`db.ts updateEvent` validator** — defensive backstop. Rejects writes with `tableDesignSelections.length > 5` with `LibError { code: 'DB_CONFLICT' }`.
- **UI** — counter pill `"{n}/5"` in the TableDesignsTab; on `n === 5`, unselected cards still render but the click handler short-circuits.
**Violation symptom:** Couple picks 6+ designs; DOCX renders an unbounded list; or — if `db.ts` lacks the backstop — IndexedDB silently accumulates an arbitrarily-long array.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for `tableDesignSelections.length` length-bound check.
- Unit test: write `Event` with 6-element array → expect `LibError DB_CONFLICT`.
- Integration test: simulate gallery toggle 6×; expect 5 selections + one rejection signal.

## §2. `Event.signature` ⇄ `Event.status` state machine

**ID:** `INV-02`
**Statement:** The `status` field is a state machine with **exactly three** allowed states and **constrained transitions**:

```
draft   ── (signature confirmed)        ──▶ signed
signed  ── (any field other than `status` itself is edited) ──▶ draft   (signature image is preserved)
signed  ── (Shon manually marks done)   ──▶ completed
draft   ── (cannot reach `completed` directly)
```

Two coupled constraints:
- **(a)** `status === 'signed'  ⇒  event.signature !== null` (the only way to set `signed` is via the signature handler — see SOP 06 § Status Transition).
- **(b)** Once `signature !== null`, that field is **never unset**. Reverting status to `draft` on edit preserves the captured PNG so the user doesn't lose work.

**Source:** `claude.md § Event` (`signature: { dataUrl, signedAt } | null`, `status: 'draft' | 'signed' | 'completed'`) + SOP 06 § Status Transition + SOP 02 mid-flight backup trigger.
**Constrained fields:** `Event.signature`, `Event.status`
**Enforcement layer:**
- **`db.ts updateEvent` validator** — primary:
  - If incoming `patch.status === 'signed'` and current `event.signature == null` and `patch.signature == null` → reject with `LibError DB_CONFLICT` ("חתימה חסרה").
  - If incoming `patch.signature === null` (attempting to unset) → reject (signature is write-once-not-erasable).
  - If incoming `patch.status === 'completed'` and current `event.status !== 'signed'` → reject (must pass through `signed`).
- **EventContext** — when *any* field other than `status` itself is updated and `event.status === 'signed'`, the context auto-patches `status: 'draft'` in the same `updateEvent` call (preserves invariant atomicity).
- **UI** — the "סטטוס: חתום" pill renders read-only; there is no UI affordance to set `signed` other than the signature confirm handler.
**Violation symptom:** A `signed` event with no embedded signature in the DOCX; or a couple's signature silently disappearing because some screen reset `signature: null`.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for the three rejection branches above.
- Unit test: `updateEvent(id, { status: 'signed' })` on an event with `signature == null` → expect rejection.
- Unit test: `updateEvent(id, { signature: null })` → expect rejection.
- Unit test: edit `coupleNames` on a `signed` event via context → expect resulting status === `'draft'`, signature unchanged.

## §3. `dayOfWeek` derived from `date` (never user-edited)

**ID:** `INV-03`
**Statement:** `Event.dayOfWeek` is **always** the Hebrew weekday computed from `Event.date`. It is never a user input, never edited independently, and any drift (a stored `dayOfWeek` that disagrees with `date`) is a data corruption bug.
**Source:** Verification step 4 ("תאריך 14.06.2026 (יום: ראשון auto-derived)") + `claude.md § Event` (`dayOfWeek: 'ראשון' | … | 'שבת'`).
**Constrained fields:** `Event.date`, `Event.dayOfWeek`
**Enforcement layer:**
- **`db.ts createEvent`/`updateEvent`** — primary. On every write that touches `date`, the validator recomputes `dayOfWeek` from `date` and overwrites whatever `dayOfWeek` value was passed in. This collapses the two fields into "date is the source; dayOfWeek is a cache."
- A small helper `deriveDayOfWeek(isoDate: string): DayOfWeek` lives in `app/src/lib/date.ts` (or inside `db.ts` if no other consumer exists). The helper is the single source.
- **UI** — EventDetailsTab renders `dayOfWeek` read-only beside the date input; there is no `<select>` or `<input>` for it.
**Violation symptom:** A user opens the DOCX and the heading says "יום: שני" but the date is a Sunday (or vice-versa). Embarrassing in a luxury document.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for `deriveDayOfWeek` (or equivalent) being called inside both `createEvent` and `updateEvent`.
- Unit test: `createEvent({ date: '2026-06-14', dayOfWeek: 'שבת', … })` → stored `dayOfWeek === 'ראשון'` (the bogus value was overwritten).
- Unit test: `updateEvent(id, { date: '2026-06-15' })` (no `dayOfWeek`) → stored `dayOfWeek === 'שני'`.
- UI audit: confirm `dayOfWeek` is rendered as text/badge, never as a control.

## §4. `napkins.color === 'אחר'` requires a free-text witness

**ID:** `INV-04`
**Statement:** When the user picks `'אחר'` (Other) for napkin color, the code must require a non-empty free-text description. The witness lives either in `napkins.foldType` (preferred — same block) or in `Event.notes` (fallback). An empty `'אחר'` produces a DOCX line that says "צבע: אחר" with no detail — useless to a venue ordering napkins.
**Source:** `claude.md § Event` (`napkins.color: 'וורד עתיק' | 'פשתן' | 'אחר'`) + SOP 10 §4 (definition of `'אחר'` as "escape hatch with required free-text").
**Constrained fields:** `Event.napkins.color`, `Event.napkins.foldType`, `Event.notes`
**Enforcement layer:**
- **UI** — primary. NapkinsTab: when `color === 'אחר'`, surface a required text input labeled "פירוט צבע" that writes back into `napkins.foldType` (or into `Event.notes` with a prefix `[צבע מותאם]`). The "המשך" button is disabled while this field is empty.
- **`db.ts updateEvent` validator** — soft-warn (not reject — allow legacy import). On write, if `napkins.color === 'אחר' && !napkins.foldType.trim() && !notes.trim()`, emit a `console.warn` tagged `INV-04`. Not a hard block (would break backup-restore of legacy data).
**Violation symptom:** DOCX shows "צבע: אחר" with a blank fabric and a blank fold — Shon has to call the couple back to ask what they meant.
**Test / check (#18):**
- UI audit: confirm the conditional required input exists in `NapkinsTab`.
- Grep `app/src/lib/db.ts` for the `INV-04` warn tag.

## §5. `tableDesignSelections[i].imagePath` must reference a known `ImageCategory`

**ID:** `INV-05`
**Statement:** Every `ImageSelection` (in `tableDesignSelections` *and* `chuppah.designSelections`) carries a `category` field that **must** be one of the 8 literals in `IMAGE_CATEGORIES`. If a selection arrives with a foreign category (e.g., from a stale backup), the import path either rejects it or quarantines it — it never silently slips into the runtime.
**Source:** `claude.md § ImageCategory` (frozen 8-literal union) + SOP 02 § Importing backups + SOP 10 §10.
**Constrained fields:** `Event.tableDesignSelections[*].category`, `Event.chuppah.designSelections[*].category`
**Enforcement layer:**
- **`backup.ts importBackup`** — primary. On restore, every selection's `category` is checked against `IMAGE_CATEGORIES`. Foreign categories produce a `conflicts[]` row in the import result with `reason: 'unknown ImageCategory: <value>'`; the selection is dropped.
- **`db.ts updateEvent` validator** — defensive. Reject writes containing unknown categories (returns `LibError DB_CONFLICT`).
- **TypeScript** — the `ImageCategory` union catches most cases at compile time; the runtime check exists for backup-restore (where data is `unknown`).
**Violation symptom:** Gallery filter "all" shows a phantom 9th category from a stale backup; or DOCX section ordering breaks because the renderer doesn't know how to group the selection.
**Test / check (#18):**
- Grep `app/src/lib/backup.ts` for an `IMAGE_CATEGORIES.includes` (or equivalent set membership) check inside `importBackup`.
- Unit test: import a JSON envelope with `category: 'fakeCategory'` → expect 1 conflict row, 0 selections written.

## §6. `IMAGE_CATEGORIES` must remain exhaustive over `ImageCategory`

**ID:** `INV-06`
**Statement:** The `IMAGE_CATEGORIES` runtime constant in `app/src/types/index.ts` must be a **complete enumeration** of the `ImageCategory` union. If the union grows by one literal, `IMAGE_CATEGORIES` must grow by one literal in the same commit.
**Source:** SOP 05 § Filtering Rules (8 fixed categories) + reviewer pre-review item #11 (`IMAGE_CATEGORIES` exhaustiveness check) + `claude.md` Maintenance Log entry for `'כיסא כלה'` ratification.
**Constrained:** the relationship between `ImageCategory` (type) and `IMAGE_CATEGORIES` (value).
**Enforcement layer:**
- **TypeScript exhaustiveness assertion** — the canonical pattern is a never-narrowing helper at the bottom of `types/index.ts`:
  ```ts
  // Compile-time guarantee that IMAGE_CATEGORIES covers every ImageCategory.
  type _AssertImageCategoriesExhaustive =
    Exclude<ImageCategory, typeof IMAGE_CATEGORIES[number]> extends never
      ? true
      : never;
  const _IMAGE_CATEGORIES_EXHAUSTIVE: _AssertImageCategoriesExhaustive = true;
  ```
  If a new union member is added without updating the array, `tsc` errors on the assignment line.
- **#18 audit** — confirms the assertion exists and that `IMAGE_CATEGORIES.length === 8` (or whatever the current cardinality of the union is).
**Violation symptom:** A new category is added to the type but the gallery's category-chip list silently misses it; users can never browse it.
**Test / check (#18):**
- Inspect `app/src/types/index.ts` for the exhaustiveness assertion.
- Confirm `IMAGE_CATEGORIES.length` equals the count of literals in `ImageCategory`.

## §7. Image source files are read-only

**ID:** `INV-07`
**Statement:** No code path in the app may write, rename, move, or delete files inside the 7 category folders or the 2 loose root JPGs. The only writable subtrees on disk are `events/**` and `backups/**`. This is also enforced at the OS level by Tauri capability scoping (see SOP 08), but a code-level rule prevents accidental dev-time blunders.
**Source:** `claude.md` Behavioral Rule #2 + SOP 01 § Source of Truth + SOP 08 capabilities split.
**Constrained:** `FsProvider.writeFile`, `FsProvider.ensureDir` callers.
**Enforcement layer:**
- **`app/src/lib/paths.ts`** — primary. The path helpers (`getEventDir`, `getEventDocxPath`, `getBackupsDir`, `getBackupPath`) are the **only** producers of write paths. Calling `fs.writeFile(arbitraryPath)` is forbidden — every call site routes through these helpers.
- **`app/src/lib/tauri-fs.ts`** — defensive. The `writeFile` wrapper calls `assertInsideRoot(path)` which checks that `path` starts with `getEventDir(...)` or `getBackupsDir()`; otherwise throws `LibError FS_WRITE_FILE`.
- **Tauri capability** (`app-writable.json`) — OS-level. Even if the JS layer somehow tries, Tauri rejects.
**Violation symptom:** A scan operation accidentally deletes a source image (catastrophic — no undo).
**Test / check (#18):**
- Grep `app/src/lib/**.ts` for direct `writeFile`/`writeTextFile`/`removeFile` calls. Every call must trace to a path produced by `paths.ts`.
- Confirm `assertInsideRoot` exists and is called from `tauri-fs.ts writeFile`.

## §8. Hebrew literal values stay Hebrew (no English translation in storage)

**ID:** `INV-08`
**Statement:** Schema literal values (`'וורד עתיק'`, `'פניה'`, `'מרובעת'`, `'בריכה'`, `'גאמוס'`, the 8 `ImageCategory` strings, etc.) are **persisted in Hebrew**. No layer translates them to English on the way in or out. The DOCX rendering, the IndexedDB, and the JSON backup all carry the same Hebrew strings.
**Source:** `claude.md` Behavioral Rule #3 (Hebrew RTL throughout) + the schema definitions themselves (Hebrew unions) + SOP 10's "Forbidden synonyms" lists.
**Constrained:** every Hebrew-typed field.
**Enforcement layer:**
- **TypeScript** — primary. The unions *are* Hebrew, so any English code value is a type error.
- **`backup.ts importBackup`** — defensive. On import, validate that union-typed fields contain Hebrew literals (or, for unions with `(string & {})` fallback, accept anything but log unknown values).
- **Code review** — see SOP 10's "quick-reject list."
**Violation symptom:** A `Client.coupleNames` written through `import-from-csv` ends up with English placeholders; or `chuppah.type === 'square'` slips in via a poorly-typed migration.
**Test / check (#18):**
- Grep `app/src/**` for any of the forbidden synonyms in SOP 10.
- Verify `BackupEnvelope.events[*].chuppah.type` round-trips through export/import unchanged.

## §9. Status `'completed'` is reachable only from `'signed'`

**ID:** `INV-09`
**Statement:** An event cannot transition `draft → completed` directly. Reaching `completed` requires the couple's signature first (passing through `signed`). This protects the auto-snapshot semantics — every `completed` event has a `signed`-time snapshot and a `completed`-time snapshot in `backups/`.
**Source:** SOP 06 § Status Transition diagram + SOP 07 backup triggers (#1 `signed`, #2 `completed`).
**Constrained fields:** `Event.status`
**Enforcement layer:**
- **`db.ts updateEvent` validator** — primary. Rejects `patch.status === 'completed'` when current `event.status !== 'signed'`.
- **UI** — Settings or Event detail screen: the "סמן כהושלם" button is enabled only when `event.status === 'signed'`.
**Violation symptom:** A draft event is marked `completed` and skips the signature flow entirely; the legal terms in the DOCX were never acknowledged.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for the `'completed'` transition guard.
- Unit test: `updateEvent(id, { status: 'completed' })` on a `draft` event → expect rejection.

## §10. `Event.clientId` references an existing `Client`

**ID:** `INV-10`
**Statement:** Every `Event` carries a `clientId` that **must** exist in the `clients` store at the time of write. Likewise, `deleteClient(id)` cascades — it transactionally deletes the client and all its events (per SOP 02's `deleteClient` contract).
**Source:** `claude.md § Event` (`clientId: string; // FK -> Client.id`) + SOP 02 (transactional cascade in `deleteClient`).
**Constrained fields:** `Event.clientId`
**Enforcement layer:**
- **`db.ts createEvent`** — primary. Inside the same transaction, fetch the client; if absent, reject with `LibError DB_NOT_FOUND`.
- **`db.ts deleteClient`** — primary. Use a `readwrite` transaction over `['clients', 'events']`, walk the `byClientId` index, delete all matching events, then delete the client.
- **`backup.ts importBackup`** — defensive. On `merge` mode, events whose `clientId` is unknown after the import become a `conflicts[]` row.
**Violation symptom:** Orphan `Event` records that the client list never shows; or a "ghost" event whose details DOCX has nothing in the header block.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for the existence check inside `createEvent`.
- Verify `deleteClient` uses a multi-store transaction (`tx.objectStoreNames` includes both `clients` and `events`).
- Unit test: `createEvent({ clientId: 'nonexistent', … })` → expect rejection.

## §11. Backup envelope schema match on import

**ID:** `INV-11`
**Statement:** `importBackup` rejects any envelope whose top-level `schemaVersion` does not match the current `BACKUP_SCHEMA_VERSION` (currently `1`). Forward-migration of older envelopes is a future concern; for now, mismatch is a hard error with a clear message.
**Source:** `claude.md § Backup Policy` + SOP 07 § File Format + `app/src/types/index.ts` (`BACKUP_SCHEMA_VERSION = 1 as const`).
**Constrained fields:** `BackupEnvelope.schemaVersion`, `BackupEnvelope.exportedAt`
**Enforcement layer:**
- **`backup.ts importBackup`** — primary. First check is `payload.schemaVersion === BACKUP_SCHEMA_VERSION`; if not, throw `LibError BACKUP_SCHEMA_MISMATCH`.
- The Settings UI surfaces this error verbatim ("גרסת גיבוי לא תואמת — לא ניתן לייבא") and does not fall back to any partial import.
**Violation symptom:** Restoring a v2 backup into a v1 app silently writes garbage records and corrupts state.
**Test / check (#18):**
- Grep `app/src/lib/backup.ts` for `BACKUP_SCHEMA_VERSION` import + comparison.
- Unit test: feed `{ schemaVersion: 99, … }` → expect `LibError BACKUP_SCHEMA_MISMATCH`.

## §12. `selectedAt` and `signedAt` are server-of-record times

**ID:** `INV-12`
**Statement:** Timestamps `ImageSelection.selectedAt` and `Signature.signedAt` are populated by the **lib layer** at the moment of write (`Date.now()`), not by callers. This prevents drift between the moment the user clicked and the moment the record landed.
**Source:** SOP 05 § Selection Semantics ("`{ imagePath, category, imageName, notes: '', selectedAt: Date.now() }`") + SOP 06 § Capture Pipeline ("Computes `signedAt = Date.now()`").
**Constrained fields:** `ImageSelection.selectedAt`, `Signature.signedAt`, `Client.createdAt`/`updatedAt`, `Event.createdAt`/`updatedAt`.
**Enforcement layer:**
- **EventContext** for `selectedAt` (selection happens in context, not in lib).
- **`db.ts createEvent`/`updateEvent`** for `createdAt`/`updatedAt`.
- **Signature confirm handler** (component layer, calling `db.updateEvent`) for `signedAt`.
**Violation symptom:** A clock skew on Shon's machine sends a future-dated signature; or a pristine event with `createdAt: 0`.
**Test / check (#18):**
- Grep `app/src/lib/db.ts` for `Date.now()` inside `createEvent`/`updateEvent`.
- Confirm no UI component passes a `selectedAt` value directly into `db.updateEvent`.

---

## Summary table — invariants vs enforcement layer

| ID | Invariant | TS | db.ts | Context | UI | #18 grep target |
|---|---|:-:|:-:|:-:|:-:|---|
| INV-01 | tableDesignSelections ≤ 5 | — | ✓ | ✓ | ✓ | `tableDesignSelections.length` in db.ts |
| INV-02 | signature ⇄ status state machine | — | ✓ | ✓ | — | three rejection branches in db.ts updateEvent |
| INV-03 | dayOfWeek = derive(date) | — | ✓ | — | ✓ | `deriveDayOfWeek` call in db.ts |
| INV-04 | napkins.color === 'אחר' needs witness | — | warn | — | ✓ | NapkinsTab conditional input + `INV-04` warn tag |
| INV-05 | selection.category ∈ IMAGE_CATEGORIES | partial | ✓ | — | — | `IMAGE_CATEGORIES.includes` in backup.ts importBackup |
| INV-06 | IMAGE_CATEGORIES exhaustive over ImageCategory | ✓ | — | — | — | `_AssertImageCategoriesExhaustive` in types/index.ts |
| INV-07 | image source files read-only | — | via paths.ts | — | — | `assertInsideRoot` in tauri-fs.ts |
| INV-08 | Hebrew literals stay Hebrew | ✓ | warn on import | — | — | forbidden-synonyms grep across `app/src/**` |
| INV-09 | completed reachable only from signed | — | ✓ | — | ✓ | `'completed'` transition guard in db.ts |
| INV-10 | Event.clientId references existing Client | — | ✓ | — | — | client-existence check in createEvent; cascade tx in deleteClient |
| INV-11 | backup schemaVersion match | — | ✓ (backup.ts) | — | — | `BACKUP_SCHEMA_VERSION` comparison in importBackup |
| INV-12 | selectedAt / signedAt set by lib | — | ✓ | ✓ (selectedAt) | — | `Date.now()` in db.ts createEvent/updateEvent |

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. 12 invariants extracted from `claude.md` + Verification flow + sibling SOPs. Each invariant lists its enforcement layer + the #18 audit query that catches a violation. | Initial spec |
| 2026-05-20 | INV-02 deviation discovered while wiring `EventContext`: the original brief said "edit-after-sign reverts `signature: null` + `status: 'draft'`", but SOP 11 INV-02(b) is explicit that "Once `signature !== null`, that field is **never unset** … reverting status to `draft` on edit preserves the captured PNG so the user doesn't lose work." `db.ts updateEvent` enforces this at the lib layer (`patch.signature === null` is rejected). The reducer therefore only reverts `status`; the PNG is preserved. | EventContext implementation follows SOP 11; brief amended in the progress entry. |
| 2026-05-20 | INV-01 enforced at THREE layers: (1) `db.ts:536-541` create/update guard; (2) `backup.ts:418-423` parse-time guard; (3) `docx.ts:208-211` render-time slice. Plus the EventContext reducer rejects toggling past 5. Quadruple defense; canonical Hebrew error `ניתן לבחור עד 5 עיצובים`. | #18 drift audit confirmed all 4 layers in place. |
| 2026-05-20 | INV-12 (`selectedAt`/`signedAt` lib-owned): db.ts re-stamps via `Date.now()` in createEvent/updateEvent regardless of caller-supplied values. `putImageTag` likewise re-stamps `taggedAt`. EventContext mirrors this — the UI layer never has to think about timestamps. | Phase 3A close. |
| 2026-05-20 | F1 finding from #18 (`_AssertImageCategoriesExhaustive` missing in `types/index.ts`) — without it, a future PR adding a 9th `ImageCategory` literal without growing `IMAGE_CATEGORIES` slips silently past `tsc`. | Land the canonical 6-line pattern from SOP 11 §6 after `IMAGE_CATEGORIES`. Marked W-3 in the #19 review backlog. |
| 2026-05-21 | Phase 4: 121/121 tests cover the lib-layer enforcement of every INV-* (clients/events CRUD, deleteClient cascade, `'completed'` rejection, `'signed'` w/o signature rejection, INV-01 `>5`, INV-05 unknown category, INV-04 napkins.color='אחר' soft warn, etc.). Component-layer + canonical 13-step E2E tests are the next coverage target. | Refinement-pass entry; tracked in `task_plan.md` Phase 4 § Tests. |

## Verification

This SOP is verified by **drift-watch checklist** `.tmp/domain-audit-18-checklist.md` (run as Task #18 after the lib track lands). The checklist is a literal walk through INV-01 to INV-12 with grep/test assertions for each enforcement-layer cell in the summary table.
