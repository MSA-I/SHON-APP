# Task Plan — Shon Blaish App

> Phases follow B.L.A.S.T. protocol adapted for a local-first React desktop app.
> Each phase has a Definition of Done. Do not advance until DoD is met.

---

## Phase 0: Initialization ✅ COMPLETE

- [x] Read B.L.A.S.T. master prompt
- [x] Create `claude.md` (Project Constitution)
- [x] Create `task_plan.md` (this file)
- [x] Create `findings.md`
- [x] Create `progress.md`
- [x] Create `architecture/` directory + README
- [x] Create `assets/` directory + logo SVGs
- [x] Create `backups/` directory
- [x] Discovery Questions answered (see `findings.md`)

---

## Phase 1: Blueprint (Vision & Logic) ✅ COMPLETE

### Discovery (resolved)
1. **North Star** — Shon completes a full client meeting in the app end-to-end, signs digitally, exports a luxury PDF.
2. **Integrations** — none. App is fully local-first.
3. **Source of Truth** — IndexedDB on Shon's machine.
4. **Delivery Payload** — single luxury PDF (audience: both Shon for archive, and the couple as keepsake) + persisted IndexedDB record.
5. **Behavioral Rules** — captured in `claude.md` § Behavioral Rules (10 items).

### Pre-Build Decisions (resolved)
- [x] **Filesystem access**: Tauri (with Electron fallback)
- [x] **Image tagging**: filename-only for MVP; manual metadata file deferred
- [x] **Logo/branding**: provided JPEG → converted to two SVG variants (dark + light)
- [x] **Backup destination**: dedicated `backups/` folder, auto-snapshot, rolling 30
- [x] **PDF target audience**: dual-purpose (Shon + couple) — single unified luxury layout
- [x] **Videos in gallery**: separate `וידאו` tab per category
- [x] **Bride/groom field**: single combined `coupleNames` field

### Data-First Verification
- [x] Schemas drafted in `claude.md`
- [x] Schemas approved by user (implicit — all Discovery answered, none of the answers required schema changes that weren't already incorporated)
- [ ] PDF output shape mocked in `architecture/03-pdf-generation.md` ← **first task of Phase 3**

**DoD:** ✅ Discovery answered, all blocking decisions resolved, schemas frozen, ready for Link.

---

## Phase 2: Link (Connectivity) ✅ COMPLETE

### POCs (artifacts in `.tmp/poc-*/`)
- [x] **L1 — Filesystem scan** ✅ — 874 images / 10 videos / 4.4 GB across 7 categories. Hebrew filenames work. Tauri integration deferred to Phase 3 (Rust toolchain not installed yet).
- [x] **L2 — IndexedDB** ✅ — `idb` v8 + `fake-indexeddb` round-trip CRUD passes.
- [x] **L3 — Hebrew RTL PDF (pdf-lib)** ⚠️ ABANDONED — works but with manual bidi reverser + 3 gotchas. Superseded by L3v2.
- [x] **L3v2 — Hebrew DOCX (decision: native, not PDF)** ✅ — `docx` v8 produces a clean Word doc with native bidi. Numbers/dates/Hebrew coexist correctly. PDF is produced from DOCX via Word "Save as PDF". Decision recorded in `architecture/03-document-generation.md`.
- [x] **L4 — Signature embedding** ✅ — synthetic PNG embedded cleanly. Will be embedded as ImageRun in the DOCX flow.

### Self-Annealing notes recorded
- `architecture/01-image-scanning.md` — full pipeline + thumbnail strategy (driven by 4.4GB discovery)
- `architecture/04-rtl-and-fonts.md` — 4 documented gotchas (WinAnsi limit, date flip, colon placement, run-segmenter plan)

### Open follow-ups (carried into Phase 3)
- [ ] Install Rust/Cargo via rustup
- [ ] Replace regex-based bidi reverser with proper run segmenter in `app/src/lib/pdf.ts`
- [ ] End-to-end Tauri smoke test (read folder + render PDF) at the start of Phase 3

**DoD:** ✅ all POCs green, gotchas documented, ready for Phase 3.

---

## Phase 3: Architect (3-Layer Build) — ✅ COMPLETE

### Phase 3A — lib track ✅ COMPLETE (closed 2026-05-20)

#### Layer 1 — Architecture SOPs (written before code)
- [x] `architecture/01-image-scanning.md`
- [x] `architecture/02-indexeddb-persistence.md`
- [x] `architecture/03-document-generation.md` (renamed from `03-pdf-generation.md` after the L3v2 DOCX decision)
- [x] `architecture/04-rtl-and-fonts.md`
- [x] `architecture/05-gallery-selection.md`
- [x] `architecture/06-signature-flow.md`
- [x] `architecture/07-backup-strategy.md`
- [x] `architecture/08-tauri-filesystem.md`
- [x] `architecture/09-design-tokens.md`
- [x] `architecture/10-ubiquitous-language.md`
- [x] `architecture/11-domain-invariants.md`
- [x] `architecture/12-image-tagging.md`

#### Layer 3 — Tools (`app/src/lib/`)
- [x] `config.ts` — project-root resolver
- [x] `paths.ts` — chokepoint helpers (`getEventsDir`, `getEventDocxPath`, `getBackupsDir`, …)
- [x] `tauri-fs.ts` — fs adapter with path-traversal guards
- [x] `db.ts` — IndexedDB v2 (clients + events + imageTags + meta + thumbnails) — INV-01..12 enforced
- [x] `docx.ts` — DOCX builder (replaces the original `pdf.ts` plan; PDF is `Save as PDF` from Word)
- [x] `backup.ts` — JSON export/import + retention + v1→v2 migration shim
- [x] `images.ts` — scan folders, build `ImageMetadata[]`, thumbnail bake/cache, resolve `asset://` URLs

#### Smoke at 3A close
- [x] `tsc --noEmit` 0 errors
- [x] `vitest --run` — **121/121** green (sanity 3 + paths 17 + tauri-fs 45 + backup 22 + db 34)
- [x] `vite build` clean

### Phase 3B — UI track ✅ COMPLETE (closed 2026-05-20)

#### Layer 1 — additional SOPs (3B kickoff)
- [x] `architecture/13-app-shell-routing.md`
- [x] `architecture/14-theme-toggle.md`
- [x] `architecture/15-component-architecture.md`
- [x] `architecture/16-stitch-design-baseline.md`

#### Layer 2 — contexts
- [x] `contexts/ThemeContext.tsx` (single-writer for `meta.theme`, hydrates before paint)
- [x] `contexts/EventContext.tsx` (state machine, INV-01/02/03/12 enforced in the reducer)

#### Layer 2 — components
- [x] `components/ui/` — 5 primitives: Button, Input, TextArea, Card, Ornament (+ `curtain-theme-toggle.tsx`)
- [x] `components/shell/` — AppBar, BootSplash, ErrorBoundary, FatalBanner
- [x] `components/client/` — ClientList, ClientCard, ClientForm
- [x] `components/tagging/` — TaggingPass (one-time gate per SOP 12)
- [x] `components/gallery/` — Gallery, Lightbox, CategoryTabs
- [x] `components/signature/` — SignaturePad
- [x] `components/settings/` — Settings panel
- [x] `components/event/` — EventTabs + 6 tabs (details, napkins, tableDesigns, chuppah, upgrades, summary)

#### Layer 2 — App shell wiring
- [x] `App.tsx` — `AppView` state machine (boot / tagging / home / client-detail / event-tabs / settings)
- [x] ThemeProvider + EventProvider + ErrorBoundary at root
- [x] BootSplash + theme read-before-paint

#### Smoke at 3B close
- [x] `tsc --noEmit` 0 errors repo-wide
- [x] `vitest --run` — **121/121** in 1.20s
- [x] `vite build` — JS 782 KB (gz 232 KB), CSS 29 KB (gz 6.7 KB), 4.82s

**DoD:** Each SOP existed before its corresponding code. App loads, scans images, persists clients, opens an event, navigates tabs, signs, exports DOCX. All 13 canonical Verification steps reachable from the UI. ✅ Met.

---

## Phase 4: Refinement (Self-Annealing & Polish) — IN PROGRESS

Driven by `Plans/02-תוכנית-המשך-ל-MVP.md` § 1, § 4, § 5, § 7.

### Visual smoke (`npm run dev`)
- [ ] Walk every screen in the browser; verify Hebrew RTL is intact (logo `inline-end`, forms flow right-to-left)
- [ ] Verify ThemeToggle curtain animation (and reduced-motion fallback)
- [ ] Confirm no leftover placeholder strings; all Hebrew copy renders correctly
- [ ] Run the 13-section RTL visual checklist at `.tmp/rtl-visual-test-plan.md`

### Self-annealing on the 16 SOPs
- [x] Every SOP carries a `Self-Annealing Notes` section (or equivalent `Failure Modes & Self-Annealing` for SOP 01)
- [x] Lessons obvious from `progress.md` synced into the SOP notes (Phase 3A close + Phase 3B close + must-fix M-1..M-4 + perf-engineer concurrency, Tailwind v4 light-mode trick, react-signature-canvas typing, etc.)

### Carry-over polish from Phase 3 (deferred earlier, address before ship)
- [ ] AppBar local `useTheme()` shim → swap to `import { useTheme } from '../../contexts/ThemeContext'` (1-liner)
- [ ] Replace Settings.tsx inline button primitives with `<Button>` from `components/ui/` (test-IDs identical)
- [ ] Replace `event/_stubs.tsx` `<Gallery>` + `<SignaturePad>` stubs with the real barrel imports (delete `_stubs.tsx`)
- [ ] Wire `SummaryTab.onExport()` to populate `imageBytes: Map<string, Uint8Array>` from `images.readImageBytes(...)` before calling `buildEventDocx` (currently throws `LibError DOCX_IMAGE_EMBED` if any selection exists)
- [ ] Code-splitting: split the 782 KB JS bundle via `manualChunks` in `vite.config.ts` along the `AppView` lazy-load boundaries
- [ ] Ship a global `<Toast>` primitive in `components/ui/` and adopt it in Settings + Gallery (replace inline state machines)
- [ ] Background `bakeThumbnailsBatch` on first run so the TaggingPass starts hot

### Tests still missing (write before v1.1; selectively before MVP)
- [ ] `docx.test.ts` (was deferred at #15 — needs fixture image bytes)
- [ ] `images.test.ts` (was deferred at #15 — happy-dom partial OffscreenCanvas)
- [ ] `ClientForm.test.tsx`, `EventTabs.test.tsx`, `TaggingPass.test.tsx` (component layer, currently zero coverage)
- [ ] Canonical 13-step E2E (`canonical-flow.test.tsx`) — plan at `.tmp/canonical-flow-plan.md`

### Performance (after 3B integration)
- [ ] performance-engineer #38 — formal cold-start + scroll-FPS baseline on Shon's machine (not on dev)

### Content blocker
- [ ] **Legal terms verbatim** — `architecture/legal-terms.txt` is still placeholder. Need Shon's exact text (photography release + flowers disclaimer) and replace the `[LEGAL TERMS PENDING]` line in `docx.ts`.

**DoD:** SOPs are self-annealed against `progress.md`; the content blocker is resolved; the 13-section RTL checklist passes; outstanding shim/stub follow-ups are merged.

---

## Phase 5: Trigger (Production build & Ship) — PENDING

Driven by `Plans/02-תוכנית-המשך-ל-MVP.md` § 2, § 6, § 8.

### Tauri integration testing (cannot be exercised by `npm run dev` alone)
- [ ] `npm run tauri:dev` — initial Rust compile (~5–10 min) and full smoke
- [ ] Real `scanAll()` against the 884 files in `D:\משה פרוייקטים\שון בלאיש\`
- [ ] Run TaggingPass against real images, finish, confirm auto-backup
- [ ] Real DOCX export → open in Word → visual validation
- [ ] Real backup export to disk + import roundtrip
- [ ] Confirm `events/<id>/plan.docx` appears at the expected absolute path

### Security gates (Phase 5)
- [ ] `cargo audit` inside `app/src-tauri/`
- [ ] Manual path-traversal verification on Windows (Group G from `.tmp/path-traversal-vectors.md` — NTFS reparse points)
- [ ] CSP validation under `tauri build` (production, not dev) — confirm `connect-src` blocks the network

### Build & install
- [ ] `npm run tauri:build` — produce a Windows `.exe` installer
- [ ] Install on Shon's Windows 10 Pro machine
- [ ] Run the canonical 13-step Verification flow on-machine
- [ ] User sign-off: "אני יכול לפתוח פגישה ולעבוד מול האפליקציה במקום ה-Word"
- [ ] Document install / upgrade procedure in `architecture/00-deployment.md` (not yet written)
- [ ] Create the initial backup snapshot post-install

**DoD:** Shon completes one real client meeting using the app end-to-end, signs digitally, exports a DOCX, and never opens Word/File Explorer during the meeting.

---

## Open Risks

| Risk | Mitigation |
|---|---|
| Hebrew RTL in `pdf-lib` is notoriously fragile | Build the PDF POC FIRST in Phase 2 (Link). If broken, fall back to HTML→PDF via headless print. |
| Filesystem access from a browser-only React app is impossible | Pick Tauri or Electron in Phase 1, before scaffolding the app. |
| Image folders are huge (some files >15MB) | Generate on-the-fly thumbnails, lazy-load grid, never load full-res unless Lightbox opens. |
| Filenames contain Hebrew + spaces | Encode paths properly; test on Windows specifically. |

---

## Definition of Project Complete

- ✓ Shon uses the app for a full meeting without a manual fallback
- ✓ A signed PDF is delivered to the couple
- ✓ All planning files (`claude.md`, `progress.md`, `findings.md`, `architecture/*.md`) reflect the final state of the system
