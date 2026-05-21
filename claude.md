# Project Constitution: Shon Blaish Event Designer App

> **gemini.md / claude.md is law.** Update this only when: a schema changes, a rule is added, or architecture is modified.

---

## Identity

**Project Name:** Shon Blaish Event Designer Management App
**Type:** Desktop, Local-First React App
**Adapted Protocol:** B.L.A.S.T. Master System Prompt (adapted for client-side React app instead of Python automation tools)
**Owner:** Shon Blaish — Premium event designer for weddings/Bar Mitzvahs in Israel

---

## North Star (What "Done" looks like)

A premium-feeling, fully-local React desktop application that replaces Shon's manual paper-based client planning workflow. The designer and the couple sit together at a meeting; instead of flipping through filesystem folders and a Word template, they use one polished app that:

1. Stores all clients/events permanently
2. Lets them browse all reference image categories with filtering, search, and selection
3. Captures every detail of the planning sheet (event info, napkins, table designs, chuppah, upgrades, signature)
4. Exports a luxury PDF with embedded chosen images and a digital signature

**Success metric:** Shon completes a full client meeting end-to-end using only the app, signs digitally, exports a PDF, and never opens Word/File Explorer during the meeting.

---

## Behavioral Rules (DO NOTs and MUSTs)

1. **MUST be Local-First.** No cloud, no auth, no logins. Data persists in IndexedDB on Shon's machine.
2. **MUST keep images in their existing folders.** Do not copy/upload/relocate the image files in `D:\משה פרוייקטים\שון בלאיש\` — the app reads them in place. (Generated event documents under `events/<id>/` and JSON snapshots under `backups/` are the only files the app writes to disk.)
3. **MUST be Hebrew RTL.** Every screen, every form, every PDF must render correctly RTL.
4. **MUST NOT include pricing logic.** Upgrades are descriptive text only.
5. **MUST be desktop-only.** No responsive mobile breakpoints. Optimize for laptop/desktop screens only.
6. **MUST follow the Luxury Editorial design language** (deep black + cream + antique gold, serif headlines).
7. **MUST NOT introduce backend/server code, authentication, or any external API calls** — this is a fully offline app.
8. **MUST preserve the legal terms verbatim** from the original DOCX in the final PDF (the photography release + flower-availability disclaimer).
9. **MUST update `progress.md` after every meaningful task** — not after every line of code, but after every completed sub-feature.
10. **MUST NOT begin coding any tool/component until** the relevant Data Schema (in this file) is approved.
11. **MUST run the one-time Image Tagging Pass on first launch** before the home screen renders. The pass walks Shon through every `ImageMetadata` record once (SOP 12). Once `meta.taggingComplete === true`, the pass is gone forever and unreachable from any UI surface. There is no menu link, no settings affordance, and no automatic retrigger. Future re-tagging is a v1.x feature that will re-open the pass via Settings — out of MVP scope.
12. **MUST persist theme choice in `meta.theme`** (SOP 14). The default on a fresh install is `'dark'` (Luxury Editorial). User-toggled values (`'light' | 'dark'`) persist via `db.setMeta('theme', value)` in the same single-writer `<ThemeToggle />` handler — no implicit migration: an absent row stays absent until the user toggles. Backup envelopes carry the theme; restore preserves it. The boot sequence reads `meta.theme` BEFORE first paint (SOP 13 §6) to avoid flash-of-wrong-theme.
13. **DOCX output is ALWAYS light-theme.** The `meta.theme` flip is an **app-only** concern (the React UI Shon and the couple see during the meeting). Generated DOCX files are deliverables for print and PDF export — they MUST always render with the white-page / dark-text light palette per SOP 03. `buildEventDocx()` ignores `meta.theme` entirely. The same rule applies to any future PDF output produced from the DOCX. Logo selection inside DOCX always uses `assets/logo.svg` (the dark-on-white variant), never `assets/logo-light.svg`.

---

## Architectural Invariants (immutable)

1. **3-Layer Architecture (adapted for React):**
   - **Layer 1 — Architecture (`architecture/*.md`):** SOP markdown files describing how each major feature works. Update SOP *before* code.
   - **Layer 2 — Navigation (React components/contexts):** Routing, state, and orchestration. Components do not contain business logic — they call the Layer 3 lib functions.
   - **Layer 3 — Tools (`src/lib/`):** Pure deterministic TypeScript modules: `db.ts`, `images.ts`, `pdf.ts`, `backup.ts`. Each is atomic, side-effect-free where possible, and individually testable.

2. **Data-First Rule:** No component renders before the schema is defined here.

3. **Self-Annealing (Repair Loop):** When a bug is fixed, update the corresponding `architecture/*.md` SOP with the learning so it never recurs.

4. **Deliverables vs Intermediates:**
   - **Deliverable:** the signed PDF + persisted IndexedDB record. This is the project payload.
   - **Intermediate (`.tmp/`):** any scratch files, image conversion artifacts, dev test data.

---

## Data Schemas (LAW — change only via deliberate update)

### `Client`
```typescript
type Client = {
  id: string;                    // uuid v4
  coupleNames: string;           // "שמות בני הזוג" — single combined field, matches original DOCX
  phone: string;                 // נייד
  email?: string;                // אימייל (אופציונלי, לעתיד)
  createdAt: number;             // epoch ms
  updatedAt: number;
};
```

### `Event`
```typescript
type Event = {
  id: string;                              // uuid v4
  clientId: string;                        // FK -> Client.id
  date: string;                            // ISO yyyy-mm-dd
  dayOfWeek: string;                       // "ראשון" | "שני" | … | "שבת"
  startTime: string;                       // "20:00"
  location: 'גאמוס' | 'ריזורט' | string;
  guestCount: number;
  isMixed: boolean;                        // אירוע מעורב
  notes: string;

  napkins: {
    color: 'וורד עתיק' | 'פשתן' | 'אחר';
    fabric: 'פניה' | 'סטן';
    foldType: string;                      // טקסט חופשי
  };

  reception: {
    atResort: boolean;                     // קבלת פנים ריזורט - למעלה?
  };

  tableDesignSelections: ImageSelection[]; // עד 5 בחירות

  chairs: {
    type: 'אבירים' | string;                // סוג כיסאות
    bridalChair: string;                   // פירוט כיסא כלה
  };

  chuppah: {
    location: 'בריכה' | 'אולם';
    type: 'מרובעת' | 'עגולה' | 'שקופה' | 'אובלית';
    fabricDetails: string;                 // "עם בדי וילון לבנים נשפכים"
    designSelections: ImageSelection[];    // תמונות חופה נבחרות
    aisleDetails: string;                  // שדרה לחופה
  };

  upgrades: {
    description: string;                   // טקסט חופשי
    items: string[];                       // רשימת bullet points
  };

  // Dual-shape signature (Maintenance Log 2026-05-21). Legacy rows in
  // IndexedDB lack a `kind` field — `lib/signature.normalizeSignature` adapts
  // them to `kind: 'png'` on read. New captures always use `kind: 'vector'`
  // so the ink follows `meta.theme`. DOCX export rasterizes vector to
  // black-on-white per Behavioral Rule #13.
  signature:
    | { kind: 'png';    dataUrl: string;                              signedAt: number }
    | { kind: 'vector'; strokes: SignatureStroke[]; width: number; height: number; signedAt: number }
    | null;
  // type SignatureStroke = { points: { x: number; y: number }[]; width: number };

  status: 'draft' | 'signed' | 'completed';
  createdAt: number;
  updatedAt: number;
};
```

### `ImageSelection`
```typescript
type ImageSelection = {
  imagePath: string;                       // path relative to image root, e.g. "אולם עיצוב בסיס 2026/שנדליר ורסאצה.JPG"
  category: ImageCategory;
  imageName: string;                       // displayable filename
  notes: string;                           // free-text, e.g. "בצבע זהב"
  selectedAt: number;
};

type ImageCategory =
  | 'אולם עיצוב בסיס 2026'
  | 'חופות אולם גדול גאמוס'
  | 'חופות ריזורט'
  | 'חופות שידרוג'
  | 'מפות מפיות'
  | 'עיצובים שידרוג'
  | 'ריזורט בסיס'
  | 'כיסא כלה';      // synthetic — absorbs the 2 loose JPGs in the project root (כסא כלה בחוץ בסיס.jpg, כסא כלה בתוך האולם.jpg). Ratified 2026-05-20.
```

### `ImageMetadata` (filesystem index, scanned on app load)
```typescript
type MediaKind = 'image' | 'video';

type ImageMetadata = {
  path: string;                            // relative to root
  name: string;                            // filename without extension
  category: ImageCategory;
  kind: MediaKind;                         // images and videos are scanned together but rendered in separate tabs
  fileType: 'jpg' | 'jpeg' | 'png' | 'webp' | 'mp4' | 'mov';
  sizeBytes: number;
  modifiedAt: number;
};
```

> **Rendering rule:** Each gallery view exposes two tabs — `תמונות` (kind === 'image') and `וידאו` (kind === 'video'). They are never interleaved.

### `ImageTag` (user-supplied tagging pass — SOP 12)
```typescript
type ImageTag = {
  imagePath: string;        // FK -> ImageMetadata.path; primary key in the imageTags store
  userCategory?: ImageCategory;   // Picked from existing 8; optional — Shon may use only customLabels
  customLabels: string[];   // Free-text labels Shon typed (Hebrew); chip-style multi-label
  notes: string;            // Free-text notes (Hebrew)
  taggedAt: number;         // Epoch ms — set by db.ts at write time, never by callers
};
```

> **Lifecycle rule:** `ImageTag[]` is captured exactly once via the **Image Tagging Pass** (SOP 12) on first launch. The pass is gated by the `meta.taggingComplete` flag (`MetaKey`). When `taggingComplete === true`, the pass is unreachable and the home screen renders directly. Future re-tagging (deferred to v1.x) re-opens the pass via Settings.

### Persistence Boundary
- `Client` and `Event` → **IndexedDB** (browser-local, durable across reloads)
- `ImageMetadata[]` → **in-memory cache** rebuilt on app open (or cached in IndexedDB if scan is slow)
- `ImageTag[]` → **IndexedDB** (`imageTags` store, key=`imagePath`); written once during the SOP 12 tagging pass and read at app boot for use in gallery filtering
- Image binaries → **stay in original folders, never copied**

---

## Tech Stack (locked)

| Concern | Choice |
|---|---|
| Framework | React 19 + TypeScript |
| Bundler | Vite 6 |
| Styling | Tailwind v4 via `@tailwindcss/vite` plugin (compiled at build time, no CDN) |
| Animation | Framer Motion 12 |
| Icons | Lucide React |
| State | React Context + useReducer |
| Persistence | IndexedDB via `idb` |
| UUIDs | `uuid` v9 (`uuid.v4()`) — primary ID generator. Replaces any `crypto.randomUUID` usage for compatibility across Tauri WebView2 versions. |
| Document | `docx` v8 — generates `.docx` natively (decision 2026-05-20). Word/LibreOffice handles RTL bidi. PDF produced via "Save as PDF" from Word. |
| Signature | `react-signature-canvas` |
| Filesystem access | **Tauri** (Rust backend, `@tauri-apps/api/fs`). Fallback to Electron if blocked in Phase 2. |
| Desktop runtime | Tauri 2.x — packages a single `.exe` for Shon's Windows PC |
| Fonts | Frank Ruhl Libre + Heebo (local in `public/fonts/`) |

---

## File Structure (canonical)

```
shon-blaish/
├── claude.md                     # this file (Project Constitution)
├── task_plan.md                  # phases, goals, checklists
├── findings.md                   # research, discoveries, constraints
├── progress.md                   # what was done, errors, results
├── architecture/                 # Layer 1 SOPs
│   ├── 01-image-scanning.md
│   ├── 02-indexeddb-persistence.md
│   ├── 03-pdf-generation.md
│   ├── 04-rtl-and-fonts.md
│   ├── 05-gallery-selection.md
│   ├── 06-signature-flow.md
│   ├── 07-backup-strategy.md
│   └── 08-tauri-filesystem.md
├── assets/
│   ├── logo.svg                  # SB monogram + crown, dark on light (PDF)
│   └── logo-light.svg            # cream + gold variant (dark UI)
├── Plans/                        # human-readable planning docs
│   └── 01-תוכנית-ראשונית.md
├── backups/                      # auto-rotated JSON snapshots (last 30)
├── .tmp/                         # ephemeral workbench
├── app/                          # the Tauri + React app (created in Phase 3)
│   ├── src/
│   │   ├── components/
│   │   ├── lib/                  # Layer 3 — deterministic tools
│   │   ├── contexts/
│   │   ├── types/
│   │   └── ...
│   ├── src-tauri/                # Rust backend (filesystem APIs)
│   ├── public/fonts/
│   ├── package.json
│   └── vite.config.ts
└── [existing image folders, untouched]
```

---

## Branding

- **Logo source (canonical)**: `לוגו.png` — SB monogram with 5-point crown, double ring medallion, flanking scroll ornaments, "שון בלאיש" + decorated "· הפקות ·" tagline.
- **Vector versions** (matching the canonical PNG):
  - `assets/logo.svg` — black ink on white (used in the DOCX and printed materials)
  - `assets/logo-light.svg` — cream + antique-gold accent (used on the dark in-app UI)
- **Rule:** Always use the SVG, never the PNG, in the rendered app or DOCX.
- **History:** the original WhatsApp draft (`WhatsApp Image 2026-05-20 at 19.27.42.jpeg`) was superseded on 2026-05-20 by `לוגו.png`. SVGs were re-cut to match the new artwork (5-point crown, scroll flourishes, dotted tagline rule).

## Backup Policy

- **Location**: `D:\משה פרוייקטים\שון בלאיש\backups\`
- **Filename**: `backup_YYYY-MM-DD_HH-mm.json` (UTC of the local clock)
- **Auto-snapshot triggers**:
  1. On every signature event (status `draft` → `signed`)
  2. On every status transition to `completed`
  3. On completion of the SOP 12 Image Tagging Pass (`meta.taggingComplete` flips to `true`)
  4. Manual export from Settings (no rate limit)
- **Retention**: rolling last 30; auto-prune older
- **Schema version**: `BACKUP_SCHEMA_VERSION = 2` (was 1; bumped 2026-05-20 with the introduction of `ImageTag[]`)
- **Format**: single JSON file containing `{ schemaVersion, exportedAt, clients[], events[], imageTags[] }`
- **Restore**: dedicated import button in Settings; warns before overwrite; offers merge option
- **v1 → v2 migration on import**: a v1 backup (no `imageTags` field) imports successfully; the importer fills in `imageTags = []` and forces `meta.taggingComplete = false`, sending the user back through the SOP 12 pass on next boot.

## Verification (canonical end-to-end flow)

This is the script every Phase-3 / Phase-5 acceptance test follows. If any step fails, the project is NOT shippable.

**Setup**
1. Open the app from a cold start (no prior IndexedDB state, no prior thumbnails).
2. Confirm the home screen shows: empty client list with "לקוח חדש" CTA, brand mark top-right, RTL layout.

**Create client + event**
3. Click "לקוח חדש" → fill form: `שמות בני הזוג: ליאור ודן`, `נייד: 050-1234567`. Save.
4. Open the new client → "אירוע חדש" → fill the 6 tabs:
   - **פרטי אירוע**: תאריך 14.06.2026 (יום: ראשון auto-derived), שעת תחילה 20:00, לוקיישן: גאמוס, כמות מוזמנים: 350, אירוע מעורב: כן, הערות: "דגש על פרחים לבנים".
   - **מפות ומפיות**: צבע וורד עתיק, סטן, קיפול קלאסי. קבלת פנים ריזורט: לא.
   - **עיצובי שולחן**: open gallery → select 3 images from "אולם עיצוב בסיס 2026" with notes ("בצבע זהב", "", "במרכז כל שולחן"). Counter shows 3/5.
   - **חופה**: סוג מרובעת, מיקום בריכה, בדים "וילון לבן נשפך", select 1 image from "חופות ריזורט", שדרה: "אבני חצץ לבנות".
   - **שדרוגים**: free text + 2 bullet items.
   - **סיכום**: review summary, sign on canvas, click "ייצוא Word".

**Outputs to verify**
5. File `D:\משה פרוייקטים\שון בלאיש\events\<event-id>\plan.docx` exists.
6. Open it in Word/LibreOffice — verify:
   - Hebrew renders correctly RTL (no flipped digits, no boxes)
   - Date `14.06.2026`, time `20:00`, count `350` read in natural order
   - All 4 selected images embedded with their notes
   - Signature image rendered above signature line
   - Legal terms text intact (verbatim from original DOCX)
   - Logo SB monogram visible at top
7. File `D:\משה פרוייקטים\שון בלאיש\backups\backup_<timestamp>.json` was auto-created on signature.

**Backup roundtrip**
8. Settings → "ייצוא גיבוי" → produces a JSON file ~< 2MB.
9. Clear IndexedDB (DevTools or Settings → "אפס נתונים מקומיים").
10. Settings → "ייבוא גיבוי" → choose the file → Client + Event reappear with all selections + signature intact.

**Performance gates**
11. Cold-start (app icon click → interactive home screen) ≤ 3 seconds.
12. Gallery opens with `מפות מפיות` (520 images) — first thumbnails visible ≤ 1 second; scroll stays at 60 fps.
13. DOCX generation with 4 embedded images ≤ 2 seconds.

**Acceptance**: all 13 steps pass on Shon's Windows 10 machine. Deviations get a fix-up task; the SOP for the affected area is updated under § Self-Annealing before the fix is merged.

## Maintenance Log

| Date | Change | Why |
|---|---|---|
| 2026-05-20 | Created Constitution, defined initial schemas | Protocol 0 initialization |
| 2026-05-20 | Discovery answered; chose Tauri; merged bride/groom into single field; added video tab; created logo SVGs; defined backup policy | End of Phase 0 → readiness for Phase 1 Blueprint |
| 2026-05-20 | Replaced `pdf-lib` with `docx` (v8) for document generation. Word handles RTL bidi natively. PDF is produced from DOCX by the user via "Save as PDF". | L3 POC revealed pdf-lib bidi gotchas; L3v2 POC proved DOCX is cleaner |
| 2026-05-20 | Logo updated. Canonical artwork is now `לוגו.png` (5-point crown + scroll flourishes + dotted tagline). `assets/logo.svg` and `assets/logo-light.svg` re-cut to match. | User provided the final approved logo artwork. |
| 2026-05-20 | Rust toolchain installed via `winget install Rustlang.Rustup`. | Required for Phase 3 Tauri scaffold. |
| 2026-05-20 | `uuid@^9` added to locked stack (Tech Stack table). Replaces all `crypto.randomUUID` usage for compatibility across Tauri WebView2 versions. | Reviewer flagged in SOP-02 catches; ratified by team-lead. |
| 2026-05-20 | Added § Verification — canonical 13-step end-to-end flow. | Tester needed an authoritative test script for #40; this is now the acceptance gate for Phase 3 / Phase 5. |
| 2026-05-20 | Added `'כיסא כלה'` to `ImageCategory` union. Synthetic category that absorbs the 2 loose JPGs in the project root (`כסא כלה בחוץ בסיס.jpg`, `כסא כלה בתוך האולם.jpg`). | Domain-expert flagged a Constitution-vs-types drift; ratified here so claude.md remains authoritative. |
| 2026-05-20 | Project root path (`D:/משה פרוייקטים/שון בלאיש`) hardcoded for MVP. Runtime "choose project folder" deferred (would require Tauri capability rewrite + custom Rust commands). `lib/config.ts` reads the same fixed value at runtime — same chokepoint, single source. | Security-auditor flagged that Tauri 2 capabilities cannot reference runtime variables; trying to do both would weaken least-privilege scoping. |
| 2026-05-20 | Dropped `shell:allow-open` from MVP. The "open backups folder in Explorer" feature is removed; if needed later it gets its own scoped permission with hardcoded path. | Security-auditor flagged that unscoped `shell.open` allows covert egress (`shell.open('https://attacker...')`). |
| 2026-05-20 | Tech Stack styling row updated: `Tailwind (inline CDN)` → `Tailwind v4 via @tailwindcss/vite plugin (compiled at build time, no CDN)`. Tokens live in `app/src/styles/index.css` `@theme` block; SOP 09 design tokens drive utilities (`bg-ink`, `text-cream`, `text-h1`, etc.). | The "inline CDN" choice predated Tailwind 4. CDN runtime would require either an external script load (violates Behavioral Rule #7 zero-network) or shipping a 300KB+ static `tailwind.min.js`. Compiled-at-build via the Vite plugin keeps zero-network, ships only used classes (3.33KB → 12.48KB CSS — 60KB JS unchanged), and is the canonical v4 path. Frontend-designer flagged the drift after #9; ratified after a Phase-3A revert attempt confirmed CDN is incompatible with our CSP. |
| 2026-05-20 | Added Image Tagging Pass: new `ImageTag` schema, `taggingComplete` meta flag, BACKUP_SCHEMA_VERSION 1→2. Behavioral Rule #11 added. SOP 12 + db.ts migration to follow. | User: "אפליקציה למעצב — סקשן ייחודי שיימחק לאחר סיום התיוגים". One-time gate before the home screen; allows Shon to attach his own categories/labels to the 884 media files. |
| 2026-05-20 | Phase 3B kickoff. Three new SOPs landed: SOP 13 (App Shell & Routing — boot sequence, `AppView` state machine, EventContext scope, error boundaries, reduced-motion plumbing), SOP 14 (Theme Toggle — `meta.theme` storage, light-mode token inversion, curtain `<ThemeToggle />` API, read-before-paint boot order), SOP 15 (Component Architecture — `components/{ui,shell,client,event,gallery,signature,tagging}` + `contexts/` layout, Layer 2 imports rule forbidding `@tauri-apps/*`/`idb` outside `lib/`, canonical test-ID convention). Behavioral Rule #12 added (theme persistence). `MetaKey` extends to include `'theme'` (backend-coder follow-up in `db.ts`). | Phase 3A closed; Phase 3B (Components & Layout) is unblocked. Locks the foundation before frontend-designer / backend-coder ship 3B components. |
| 2026-05-20 | Behavioral Rule #13 added: **DOCX/PDF output is always light-theme.** `meta.theme` only flips the React UI Shon sees during the meeting; generated DOCX deliverables ignore it entirely and always render with the white-page / dark-text light palette. Logo selection inside DOCX always uses `assets/logo.svg`. SOP 03 + SOP 14 cross-refs to follow. | User clarification: "ה-THEME ב-WORD וב-PDF תמיד יהיה בהיר רק באפליקציה ההחלפה ממצב כהה לבהיר ולהפך תהיה רלוונטית". Prevents future scope creep where someone tries to render a "dark-mode DOCX". |
| 2026-05-21 | Phase 4 Refinement self-annealing pass: SOP notes synchronized with progress.md learnings; task_plan updated to reflect 3A+3B completion. | Phase 4 housekeeping — every one of the 16 SOPs now carries a `Self-Annealing Notes` section and every cross-cutting Phase 3A/3B lesson observable in `progress.md` (must-fix M-1..M-4 close, v1→v2 migration, Tailwind v4 light-mode trick, react-signature-canvas typing, EventContext INV-02 deviation, AppBar `useTheme` shim, `_stubs.tsx` cleanup, Toast primitive backlog, code-splitting backlog, legal-terms blocker, Phase 5 Tauri/cargo/CSP gates) is now captured at the SOP that owns it. |
| 2026-05-21 | `Event.signature` schema flipped from `{ dataUrl, signedAt }` to a discriminated union `{ kind: 'png' \| 'vector' } \| null` (see Data Schemas above). Vector captures store `SignatureStroke[]` from `react-signature-canvas.toData()` so the ink can be re-painted with `currentColor` and follow theme flips at render time. PNG remains for legacy rows (read-only); no migration is performed (claude.md "don't touch old data"). DOCX export rasterizes vector to **black ink on white background** per Behavioral Rule #13 regardless of UI theme. SOP 06 + SOP 03 carry the implementation notes. Also fixed: `EventContext.signEvent` now creates the draft row before persisting the signature when `currentEvent.id === ''`, unblocking the "יישום וחתימה" / "ייצוא Word" buttons that previously did nothing on a freshly-created draft. SummaryTab surfaces both successes and failures via the global `<ToastProvider>`. | User report: "החתימה צריכה להיות נראית לעין כשהתפריט עובר ממצב כהה לבהיר ולהיפך"; "כפתור יישום וחתימה וייצוא ל WORD לא עובדים". Two distinct fixes — one rendering, one async-flow — landed together because they touch the same component graph. |
| 2026-05-21 | Extended `Napkins` and `Upgrades` schemas with optional `designSelections?: ImageSelection[]`. `Gallery` accepts new modes `'napkins'` (default category `'מפות מפיות'`) and `'upgrades'` (default category `'עיצובים שידרוג'`). All four image-bearing event tabs (napkins / tableDesigns / chuppah / upgrades) now expose a "פתח גלריה" button + a `<TagsDisplay>` slot that reads `imageTags` (SOP 12) for the picked images and renders chips, falling back to "תגיות יתווספו לאחר תיוג התמונות" when empty. Summary tab shows the union across all four. db.ts `normalizeEvent` + `assertEventBodyValid` updated; v1 events with no `designSelections` field round-trip cleanly. | User directive 2026-05-21: "תוך כדי שהמעצב מראה ללקוח עיצובים הוא יכול לבחור תמונות ששייכות לאותו עיצוב…אמורים להיות שם כפתורי פתיחת גלריה ולא רק קטגוריות של צבעים מומצאים". Closes the gap where only TableDesignsTab + ChuppahTab opened the gallery. SOPs to follow in next housekeeping pass. |

