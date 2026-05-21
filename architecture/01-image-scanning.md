# SOP 01 — Image Scanning & Thumbnail Pipeline

> Authoritative spec for how the app discovers and indexes the on-disk image library. Update *before* code changes.

## Source of Truth

The image library lives at `D:\משה פרוייקטים\שון בלאיש\` with **7 category subfolders** plus the synthetic 8th category `כיסא כלה` (absorbing the 2 loose JPGs in the project root: `כסא כלה בחוץ בסיס.jpg`, `כסא כלה בתוך האולם.jpg`). The full frozen list of 8 categories is in `claude.md` § ImageCategory (ratified 2026-05-20). The app is **read-only** against this directory. It must never copy, move, rename, or delete files in the source folders.

## Scan Inputs (verified Phase 2 L1)

| Category | Images | Videos | Size |
|---|---:|---:|---:|
| אולם עיצוב בסיס 2026 | 26 | 0 | 11.9 MB |
| חופות אולם גדול גאמוס | 27 | 4 | 217.3 MB |
| חופות ריזורט | 27 | 0 | 267.0 MB |
| חופות שידרוג | 24 | 2 | 81.0 MB |
| מפות מפיות | 520 | 0 | 2,465.8 MB |
| עיצובים שידרוג | 159 | 1 | 510.2 MB |
| ריזורט בסיס | 91 | 3 | 859.2 MB |

Total: **874 images + 10 videos = 4.4 GB**

## Scan Algorithm

### Layer 3 — `app/src/lib/images.ts`

```typescript
type MediaKind = 'image' | 'video';

export type ImageMetadata = {
  path: string;          // POSIX-style relative path "אולם עיצוב בסיס 2026/שנדליר ורסאצה.JPG"
  name: string;          // filename without extension
  category: ImageCategory;
  kind: MediaKind;
  fileType: 'jpg' | 'jpeg' | 'png' | 'webp' | 'mp4' | 'mov';
  sizeBytes: number;
  modifiedAt: number;    // epoch ms
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);

export async function scanCategory(rootDir: string, category: ImageCategory): Promise<ImageMetadata[]>;
export async function scanAll(rootDir: string, onCategoryDone: (cat, items) => void): Promise<ImageMetadata[]>;
```

### Streaming, not blocking
The scan runs **per-category**, calling `onCategoryDone` after each folder finishes so the UI can render found categories incrementally. A category never blocks others — `Promise.all([...categories.map(scanCategory)])`.

### Filesystem provider abstraction
```typescript
type FsProvider = {
  readDir: (path: string) => Promise<{name: string, isFile: boolean}[]>;
  stat: (path: string) => Promise<{size: number, mtimeMs: number}>;
  readFile: (path: string) => Promise<Uint8Array>;
};
```
Two impls:
- `nodeFsProvider` — for tests with `fake-indexeddb` + Node `fs/promises`
- `tauriFsProvider` — wraps `@tauri-apps/api/fs.readDir` + `metadata`
The lib code is provider-agnostic; the app picks the provider once at startup.

## Thumbnail Strategy

The full library is 4.4GB. Loading even 50 raw JPEGs at full resolution will jank the gallery. **Thumbnails are mandatory.**

### Approach
- **First scan**: generate a 300px-on-longest-edge WebP thumbnail per image. Store as Blob in IndexedDB (`thumbnails` object store, keyed by `path`). Skip thumbnail generation for videos (use a generic icon + filename).
- **On every subsequent scan**: compare `modifiedAt`. If image's mtime ≤ thumbnail's `generatedAt`, reuse thumbnail. Otherwise regenerate.
- **Failed thumbnails**: log + show a fallback placeholder; never crash.

### Implementation choices
- **Generation**: client-side via `<canvas>` + `OffscreenCanvas` if available. Or, defer to Tauri's Rust side for speed (Phase 5 optimization).
- **MIME**: WebP, quality 0.75. Empirical estimate: ~25KB per thumbnail × 874 = ~22 MB total in IndexedDB. Acceptable.
- **Lightbox**: opens a *new* `<img src={fullPath}>` directly from disk via Tauri's `convertFileSrc`. No re-encoding.

## Performance

> Implementation contract for `app/src/lib/images.ts` (#12) and the gallery components (#24). Numbers below come from a host-machine baseline measured against the real 4.4 GB / 874-image library on 2026-05-20 — see `.tmp/perf-baseline/NOTES.md` for the harness, raw output, and methodology. The Tauri/WebView2 numbers (task #16) will refine this; targets remain the same.

### Performance budget (per `claude.md` § Verification)

| Phase | Target | Status from baseline |
|---|---|---|
| App cold-start to interactive | < 3 s | Comfortable: scan ≤ 100 ms even with 5–10× IPC tax. Tauri+WebView2+React mount dominates. |
| Gallery scroll | 60 fps (frame budget < 16 ms) | Requires virtualization regardless of thumbnail caching. |
| Thumbnail generation per image (avg) | < 100 ms | Read-only floor 11.5 ms; decode + 300px downscale + WebP encode in browser must stay under ~85 ms. |
| First-scan thumbnail bake (full library) | not blocking app, streamed | Read floor ~1.26 s; total likely 30–60 s for `מפות מפיות` alone. |
| IndexedDB CRUD roundtrip | < 50 ms | Not yet measured against WebView2; verified in #16. |

### Implementation contract — gallery + thumbnails

These tactics are **pre-approved by team-lead** as the implementation contract for backend-coder (#12) and frontend-designer (#24). Do not deviate without escalation.

1. **Virtualized grid (mandatory).** `react-window` `FixedSizeGrid` (or equivalent custom virtualizer if `react-window` proves too restrictive for RTL).
   - Item size: ~280 px (square card).
   - Overscan: 2 rows above / below the viewport.
   - Justification: 874 DOM `<img>` elements will jank on first paint and shred scroll FPS even with cached thumbnails. Virtualizing keeps DOM cost bounded to ~30–50 cards regardless of category size.

2. **OffscreenCanvas thumbnail generation in a Web Worker pool.**
   - Pool size: **4** workers.
   - Justification: I/O baseline shows aggregate read throughput peaks at concurrency 4–8; above 8, per-file p95 latency grows from 37 ms to 64 ms while throughput barely moves. 4 workers also leaves the main thread headroom for scroll + scan-progress UI on a 4-core laptop.
   - Each worker: receives `{ path, mtime }`, fetches bytes via the FS provider, decodes to `ImageBitmap`, draws to 300 px-on-longest-edge `OffscreenCanvas`, encodes as WebP @ q=0.75, posts the resulting Blob back to main, plus a generation receipt `{ path, mtime, generatedAt, sizeBytes }`.
   - Fallback: if `OffscreenCanvas` is unavailable in the WebView2 build (extremely unlikely; modern Chromium supports it), fall back to single-threaded main-thread Canvas with a yield (`scheduler.postTask` or `requestIdleCallback`) between every 4 thumbnails. Document the fallback path in code; do not ship without it.

3. **Blob URL recycling (mandatory; otherwise memory grows monotonically).**
   - Every `URL.createObjectURL` for a thumbnail blob must be paired with `URL.revokeObjectURL` when the card unmounts (scrolls beyond overscan).
   - For the lightbox: revoke the full-res blob URL on lightbox close. Full-res images are 5–10 MB; leaking one held reference per session is enough to balloon memory.

4. **IndexedDB blob cache (mtime-validated).**
   - Object store: `thumbnails`, keyed by `path`, value `{ blob: Blob, generatedAt: number, sizeBytes: number }`.
   - Lookup flow on scan: for each scanned image, query the cache by `path`. If `cached.generatedAt ≥ image.modifiedAt`, reuse. Otherwise enqueue regeneration.
   - This makes second-launch thumbnail "generation" effectively a series of IndexedDB lookups — sub-second for the whole library.

5. **Lazy load via `IntersectionObserver`.**
   - Only cards within the viewport (plus virtualization overscan) request their thumbnail blob from the cache or generation queue.
   - Cards scrolled out cancel any pending generation request (worker-side cancellation token by `path`).

6. **Debounced scroll-progress UI.**
   - Re-rendering a "X of Y loaded" indicator on every scroll-y is cheap to write and expensive to run. Debounce to 100 ms.
   - The indicator itself lives in a `<div>` outside the React tree if possible (refs + manual `textContent` mutation), or in a leaf component with `React.memo` and explicit comparator.

### First-scan UX (decided 2026-05-20 — team-lead)

The first-time thumbnail bake for `מפות מפיות` (520 images × ~5 MB) will take 30–60 s wall-clock even with the 4-worker pool. UX decision: **stream-as-you-go, no blocking modal.**

- The app is fully usable immediately — meeting can start, client list works, signature flow works.
- The gallery shows real thumbnails for cards already baked, and a low-key skeleton/placeholder for cards still queued.
- A subtle **bottom-right toast** displays `מכין תצוגות מקדימות… {N}/{M}` with a thin progress bar.
- Toast disappears automatically when the queue drains. No "OK" button, no scrim.
- Subsequent app launches see no toast — the IndexedDB cache satisfies all lookups.
- If the user navigates to a gallery whose category is still baking, the in-grid skeletons fill in smoothly as workers complete.

This UX must be encoded by frontend-designer in #24 (Gallery system). The toast component itself can live in the app shell (#21) so it's scope-stable.

### Verification gates

- **#16 (baseline):** re-run `.tmp/perf-baseline/scan-timing.mjs` and `io-throughput.mjs` against the Tauri bridge. Add a third harness for IndexedDB CRUD (clients + events + thumbnail blob round-trip) measured in WebView2. Append numbers to `findings.md § Performance baseline (Phase 3A)`.
- **#26 (gallery perf):** Chrome DevTools profile a real meeting flow — open `מפות מפיות` (520 images), scroll-end-to-end, open lightbox on 5 random items. Frame time p99 must stay under 16 ms; main-thread blocks > 50 ms must not appear during scroll.
- **#38 (final pass):** repeat #26 plus end-to-end DOCX export with 4 embedded images on a real signed event — must complete in < 2 s. (DOCX target also mirrored in SOP 03 § Performance.)

## Hebrew Path Handling

- All paths are stored as POSIX-style with forward slashes (`scanCategory` normalizes Windows backslashes).
- All filenames stay in Hebrew Unicode (NFC normalized to be safe). Verified L1: Tauri/Node both round-trip cleanly.
- When constructing display URLs, percent-encode segments via `encodeURIComponent` per segment, never on the joined string (preserves slashes).

## Excluded Items

- Subdirectory `חופות שידרוג/חופה אובלית_ אליפסה להשכרה._files/` is an HTML scrape's asset folder. **Skip it.** Filter rule: skip any folder whose name ends with `_files` or starts with `.`
- Subdirectory `חופות ריזורט/חופות ריזורט/` is a duplicate nested folder (visible from the L1 scan listing). Investigate in Phase 3 — for now its contents are scanned twice if recursed; we choose **non-recursive scanning** (only direct children of each category) to avoid this.
- Two loose files in the project root (`כסא כלה בחוץ בסיס.jpg`, `כסא כלה בתוך האולם.jpg`) — currently uncategorized. Decision: surface them under a synthetic category `כיסא כלה` in the gallery.

## Failure Modes & Self-Annealing

| Failure | Detection | Recovery |
|---|---|---|
| Category folder deleted/renamed | `readDir` error | Show empty state for that category + warning toast; don't crash |
| Single corrupt JPEG | `stat` ok but `<img>` errors | Mark item with `error: true` in metadata, render placeholder |
| Hebrew filename invalid in URL | thumbnail load 404 | Re-encode and retry once; on second failure, mark broken |
| Disk drive D: unmounted | `readDir` throws | Show "Image library not found at D:\…" full-screen banner with re-scan button |

When any failure occurs, append a one-liner to `progress.md` so we accumulate evidence over time.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | POC L1 verified: 874 images / 10 videos / 4.4 GB across 7 native folders + 2 loose JPGs in the project root. Hebrew filenames work end-to-end. | Stack verified at the L1 POC; locked the synthetic `כיסא כלה` category to absorb the 2 loose JPGs. |
| 2026-05-20 | `images.ts` shipped per § Scan Algorithm. **Synthetic `כיסא כלה`** is special-cased — instead of `readDir(projectRoot)` (rejected by perf-predictions § P-01 mitigation #4), the scanner calls `tauriFsExtras.exists()` against the 2 known root paths. Absent files emit a `console.warn` and produce 0–2 entries, never a hard error. | `scanCategory` + `scanSyntheticBridalChair` cover both paths. |
| 2026-05-20 | `scanAll` uses **`Promise.allSettled`** (not `Promise.all`) so one category's `readDir` failure can never cascade. Failed categories still get an empty array entry in `byCategory` so the gallery renders an empty state. `onCategoryDone(category, count\|null, error?)` fires per resolution. | Phase 3A images.ts close; perf-predictions § P-01 mitigation #1 honored. |
| 2026-05-20 | `bakeThumbnailsBatch` concurrency = **4** found optimal by the perf-engineer card. Promise-pool with per-worker error capture so one failure cannot abort the batch. WebP @ q=0.8 at 256 px on the longest edge. Cache-keyed by `path`; invalidated when `cached.sourceModifiedAt < image.modifiedAt`. | Default tuned to 4 in `images.ts`. |
| 2026-05-20 | `toImageSrc(image)` is synchronous but depends on a project-root cache primed at the start of every `scanCategory` call. Throws `LibError IMG_NOT_FOUND` if called before any scan has resolved the project root. Tests prime via `__primeProjectRootForImageSrc()`. | Documented in `images.ts` doc-comment; W-6 in #19 review backlog flagged "sync-prime fragility" for v1.x. |
| 2026-05-20 | NFC normalization applied at every boundary (`scanCategory`, `scanSyntheticBridalChair`, `getOrBakeThumbnail` cache key, `toImageSrc`). Apple/Windows decomposed Hebrew vs precomposed Hebrew otherwise miss in cache lookups. | Phase 3A images.ts close. |
| 2026-05-21 | Phase 5 still owes a real Tauri-side `scanAll()` against the 884 production files (browser dev runs cannot exercise `@tauri-apps/plugin-fs`). | Tracked in `task_plan.md` Phase 5 § Tauri integration testing. |
