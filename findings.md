# Findings — Research, Discoveries, Constraints

> Append to this file when you discover something that affects the project. Newest at top.

---

## 2026-05-20 — Initial Discovery (Phase 0/1)

### Project Inventory
- **Image folders found in `D:\משה פרוייקטים\שון בלאיש\`:**
  - `אולם עיצוב בסיס 2026/` — ~30 small JPGs (chandeliers, candles, candleholders, table designs)
  - `חופות אולם גדול גאמוס/` — large camera RAWs + WhatsApp photos + 2 videos (mix of huge 15MB files and small thumbnails)
  - `חופות ריזורט/` — ~25 photos, mostly large camera files
  - `חופות שידרוג/` — ~25 photos + 1 huge MOV (76MB) + 1 HTML scrape with assets folder
  - `מפות מפיות/` — ~25+ very large JPGs (3-5MB each)
  - `עיצובים שידרוג/` — large camera JPGs
  - `ריזורט בסיס/` — mix of large camera + WhatsApp + videos
  - 2 loose JPGs in root: `כסא כלה בחוץ בסיס.jpg`, `כסא כלה בתוך האולם.jpg`

### Constraints Discovered
- **File sizes are highly variable**: thumbnails are ~150KB, but RAW camera shots are 14-17MB. Loading naively will kill the browser. **Must lazy-load + thumbnail.**
- **Some folders contain `.mp4` and `.mov` videos** alongside images. Decision needed: show videos in gallery, or filter out and show images only?
- **Filenames are 100% Hebrew** with spaces (e.g., `שנדליר ורסאצה.JPG`) — must URL-encode paths carefully on Windows.
- **One subfolder is HTML scrape** (`חופה אובלית_ אליפסה להשכרה._files`) — should be excluded from the image gallery scanner.
- **Existing planning DOCX** confirms field structure: it matches our drafted schema in `claude.md` 1:1 (date, day, time, names, phone, location, guest count, mixed event, notes, napkin color, fabric, fold, reception location, 5 numbered design slots, chair type, bridal chair, chuppah location/type/fabric/design/aisle, upgrades total, legal terms, signature).

### Brand / Style
- The DOCX includes legal disclaimers about: flower availability ("חברת העיצוב אינה מתחייבת לסוג פרח מסוים"), photo usage release, and that upgrades are billed separately (not included in the contract with the venue "גאמוס").
- The venue is "גאמוס" — designs are categorized for גאמוס (large hall) and ריזורט (resort/pool area).

### Technical Discoveries
- (none yet — to be filled in Phase 2 Link, after Hebrew PDF + filesystem POC)

---

## Discovery Answers (resolved 2026-05-20)

1. **Videos in galleries** → ✅ **Show in a separate "וידאו" tab/section** within each category. Don't mix with image grid.
2. **Bride/groom name handling** → ✅ **Single combined "שמות בני הזוג" field** (free text), matching the original DOCX.
3. **Logo asset** → ✅ Source: `WhatsApp Image 2026-05-20 at 19.27.42.jpeg` (SB monogram with crown, double ring, "שון בלאיש" + "הפקות"). Converted to two SVG variants:
   - `assets/logo.svg` — black-on-white (for the PDF)
   - `assets/logo-light.svg` — cream + gold-accent on transparent (for the dark app UI)
4. **PDF audience** → ✅ **Both Shon and the couple.** Implication: the PDF must be both an internal production sheet (full detail, embedded images, signature) AND a take-home keepsake for the couple. One unified luxury layout — no need for two separate exports.
5. **Backup destination** → ✅ **Dedicated folder, auto-managed** (decided autonomously per user's "choose what's most efficient"):
   - Path: `D:\משה פרוייקטים\שון בלאיש\backups\`
   - Auto-snapshot on each signature event AND each "completed" status transition.
   - Filename pattern: `backup_YYYY-MM-DD_HH-mm.json`
   - Rolling retention: keep latest 30, auto-prune older.
   - Manual export/import buttons in app settings for ad-hoc backups.

## 2026-05-20 — Phase 2 Link results

### POC L3 — Hebrew RTL PDF (highest-risk item)
- ✅ `pdf-lib` + `@pdf-lib/fontkit` + Frank Ruhl Libre renders Hebrew correctly when codepoints are pre-reversed.
- ✅ Two-pass bidi reverser (reverse all + re-reverse contiguous LTR runs) keeps dates/times/numbers in natural order.
- ⚠️ Edge case: a date sitting at the END of a Hebrew sentence gets digit-pair flipped (`20.05.2026` → `02.50.2026`). Fix planned: replace regex bidi with a proper run-segmenter in `app/src/lib/pdf.ts`. Documented in `architecture/04-rtl-and-fonts.md` § Gotcha #4.
- ⚠️ Standard Helvetica's WinAnsi encoding cannot encode Unicode decorative symbols (`❖` U+2756). Use primitive shapes or embedded Hebrew font for ornaments.
- Output PDF size for a 1-page document with Hebrew + body + footer: ~6.5KB. Tiny.

### POC L2 — IndexedDB
- ✅ `idb` v8 + `fake-indexeddb` works in Node for testing; same code will run unmodified in Tauri's WebView2.
- ✅ Two object stores: `clients` (indexed by phone, createdAt) + `events` (indexed by clientId, date, status).
- ✅ Full CRUD + transactions + signed-status query verified.

### POC L4 — Signature embedding
- ✅ PNG bytes from a canvas → `pdfDoc.embedPng()` → `page.drawImage()` is straightforward.
- ✅ A 400×120 PNG signature scales cleanly to 200×60pt at the bottom of the page.
- ✅ Round-trip: synthesize → write to disk → embed → render in PDF.

### POC L1 — Filesystem scanning (CRITICAL FINDINGS)
- ✅ All 7 expected category folders exist and are readable.
- ✅ Hebrew filenames round-trip cleanly (read `"אהיל W קטיפה.jpg"` → JPEG magic bytes confirmed).
- 🚨 **Inventory is much larger than initial estimate**:

  | Category | Images | Videos | Size |
  |---|---:|---:|---:|
  | אולם עיצוב בסיס 2026 | 26 | 0 | 11.9 MB |
  | חופות אולם גדול גאמוס | 27 | 4 | 217.3 MB |
  | חופות ריזורט | 27 | 0 | 267.0 MB |
  | חופות שידרוג | 24 | 2 | 81.0 MB |
  | **מפות מפיות** | **520** | **0** | **2,465.8 MB** |
  | עיצובים שידרוג | 159 | 1 | 510.2 MB |
  | ריזורט בסיס | 91 | 3 | 859.2 MB |
  | **Total** | **874** | **10** | **4.4 GB** |

  → `מפות מפיות` alone has 520 images and 2.4GB. Previous plan assumed ~100 images per category. Architectural implications below.

### Tauri toolchain
- ⚠️ Rust/Cargo not installed on the dev machine. L1 fully verified the data layer in pure Node, which is byte-compatible with what Tauri's `@tauri-apps/api/fs` will return (same `path / size / mtime` shape). The Tauri integration itself is deferred to the start of Phase 3 (when we scaffold the app), and will be tested end-to-end then.
- Action item: install Rust via `rustup` before Phase 3 starts. Documented in `architecture/08-tauri-filesystem.md` (to be authored).

### Architectural implications of the 4.4GB / 874 image inventory
1. **MUST generate thumbnails on first scan.** Loading 520 raw 5MB JPEGs to render a grid will lock the app. We'll generate ~300px webp thumbnails on first scan, cache them in `.tmp/thumbnails/` (or IndexedDB blob store), and serve those for the grid. Full-res only loads on Lightbox open.
2. **MUST chunk the scan.** Don't block the UI for 5 seconds at startup. Stream results: render found categories progressively.
3. **Category index ≠ category list.** Some categories (`מפות מפיות`) need internal sub-grouping. Worth asking Shon if there's an obvious sub-classification (e.g., by color, by fold style) — but for MVP we'll show all and add search.
4. **Backup file size**: stays small. The IndexedDB JSON backup carries metadata + signature PNGs only, not images. Estimated <2MB per couple.

---

## Filesystem Access Decision (resolved 2026-05-20)

✅ **Tauri** chosen over Electron and Vite+symlink. Rationale:
- Native filesystem access via Rust backend (`@tauri-apps/api/fs`) → can read `D:\משה פרוייקטים\שון בלאיש\*` directly with proper permissions
- ~3-15MB final installer vs Electron's 80-150MB → faster install on Shon's PC, fewer support headaches
- Native window chrome looks more professional than a localhost browser tab
- Built-in updater for future versions
- Plays well with React 19 + Vite 6
- Trade-off accepted: requires Rust toolchain on dev machine; one-time setup

Fallback if Tauri proves problematic in Phase 2 Link: revert to Electron. Vite+symlink rejected because it lacks proper native packaging.

---
