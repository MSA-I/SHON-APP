// SOP: architecture/01-image-scanning.md (image library scanner + thumbnail pipeline)
// SOP: claude.md § Data Schemas — `ImageMetadata`, `IMAGE_CATEGORIES`, `MediaKind`, `ImageFileType`
// Perf contract: .tmp/perf-predictions.md § P-01 (Promise.allSettled, smallest-first ordering,
//   onCategoryDone callback per resolution, synthetic `כיסא כלה` via exists()).
//
// Layer 3 — pure deterministic library code. The only allowed imports are:
//   '../types', './config', './paths', './tauri-fs', './db'.
// No React, no framer-motion, no direct '@tauri-apps/*' (those go through tauri-fs).
//
// Public surface (all named exports):
//   • scanCategory(category, fs?)     → ImageMetadata[]
//   • scanAll(opts?)                  → { byCategory, failed }
//   • getOrBakeThumbnail(image, fs?)  → Blob | null
//   • bakeThumbnailsBatch(images, opts?) → { done, failed }
//   • toImageSrc(image, fs?)          → string
//   • CATEGORY_SCAN_ORDER             → readonly ImageCategory[]
//   • THUMBNAIL_MAX_EDGE              → number
//   • THUMBNAIL_QUALITY               → number

import {
  type FsProvider,
  type ImageCategory,
  type ImageFileType,
  type ImageMetadata,
  type MediaKind,
  IMAGE_CATEGORIES,
  LibError,
} from '../types';
import { getProjectRoot } from './config';
import { assertInsideRoot, tauriFsExtras, tauriFsProvider } from './tauri-fs';
import { getThumbnail, putThumbnail } from './db';

// ===========================================================================
// Constants — extension whitelist, scan order, thumbnail budget
// ===========================================================================

const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

const VIDEO_EXTS: ReadonlySet<string> = new Set(['.mp4', '.mov']);

/**
 * Scan order — smallest folder first so the gallery can render *something*
 * within the first few hundred ms while `מפות מפיות` (520 files) is still
 * resolving. Per perf-predictions.md § P-01 mitigation #2.
 *
 * `כיסא כלה` is the synthetic 2-file category and is fastest of all.
 */
export const CATEGORY_SCAN_ORDER: readonly ImageCategory[] = [
  'כיסא כלה', // 2 (synthetic — exists() on 2 root JPGs)
  'חופות שידרוג', // 26
  'חופות ריזורט', // 27
  'אולם עיצוב בסיס 2026', // 26
  'חופות אולם גדול גאמוס', // 31
  'עיצובים שידרוג', // 160
  'ריזורט בסיס', // 94
  'מפות מפיות', // 520 (last)
] as const;

/** Sanity guard — every literal in `CATEGORY_SCAN_ORDER` must be in `IMAGE_CATEGORIES`. */
{
  const known = new Set<string>(IMAGE_CATEGORIES);
  for (const c of CATEGORY_SCAN_ORDER) {
    if (!known.has(c)) {
      // Build-time guarantee via the `ImageCategory` type — runtime guard is
      // belt-and-braces in case the union and the const drift.
      throw new LibError('CATEGORY_SCAN_ORDER drifted from IMAGE_CATEGORIES', {
        code: 'IMG_CATEGORY_MISSING',
        path: c,
      });
    }
  }
}

/** SOP 01 § Thumbnail Strategy — 256 px on the longest edge. */
export const THUMBNAIL_MAX_EDGE = 256 as const;

/** SOP 01 § Thumbnail Strategy — WebP encode quality. Brief calls for q=0.8. */
export const THUMBNAIL_QUALITY = 0.8 as const;

/** Loose-file paths that make up the synthetic `כיסא כלה` category. */
const LOOSE_BRIDAL_CHAIR_PATHS: readonly string[] = [
  'כסא כלה בחוץ בסיס.jpg',
  'כסא כלה בתוך האולם.jpg',
] as const;

const SYNTHETIC_CATEGORY: ImageCategory = 'כיסא כלה';

/** Default concurrency for `bakeThumbnailsBatch`. Per perf-engineer. */
const DEFAULT_BAKE_CONCURRENCY = 4 as const;

// ===========================================================================
// Helpers
// ===========================================================================

function nfc(s: string): string {
  return typeof s === 'string' ? s.normalize('NFC') : s;
}

function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) =>
      i === 0
        ? p.replace(/\/+$/, '')
        : p.replace(/^\/+|\/+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

/**
 * Last `.<ext>` in a filename, lowercased, e.g. `"foo.JPG"` → `".jpg"`.
 * Returns `''` if no extension.
 */
function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx).toLowerCase();
}

/** Strip the final extension off a filename. NFC-stable. */
function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return filename;
  return filename.slice(0, idx);
}

type Classification = {
  kind: MediaKind;
  fileType: ImageFileType;
};

/**
 * Map an extension like `.jpg` → `{ kind: 'image', fileType: 'jpg' }`.
 * Returns `null` for anything outside the whitelist.
 */
function classifyByExtension(filename: string): Classification | null {
  const ext = getExtension(filename);
  if (!ext) return null;
  if (IMAGE_EXTS.has(ext)) {
    return { kind: 'image', fileType: ext.slice(1) as ImageFileType };
  }
  if (VIDEO_EXTS.has(ext)) {
    return { kind: 'video', fileType: ext.slice(1) as ImageFileType };
  }
  return null;
}

/**
 * Build an absolute disk path for an `ImageMetadata.path`. Asserts the result
 * stays inside the project root (defense-in-depth — capability scope at the
 * Tauri layer is the primary guard).
 */
async function toAbsolutePath(relPath: string): Promise<string> {
  const root = await getProjectRoot();
  const abs = joinPosix(root, nfc(relPath));
  await assertInsideRoot(abs, 'IMG_NOT_FOUND');
  return abs;
}

/**
 * Build the absolute folder path for a scanned (non-synthetic) category.
 * The synthetic `כיסא כלה` category does NOT have a folder; never call this
 * with that literal.
 */
async function categoryDirAbsolute(category: ImageCategory): Promise<string> {
  if (category === SYNTHETIC_CATEGORY) {
    throw new LibError(
      `categoryDirAbsolute called with synthetic category ${SYNTHETIC_CATEGORY}`,
      { code: 'IMG_CATEGORY_MISSING', path: category },
    );
  }
  const root = await getProjectRoot();
  return joinPosix(root, category);
}

// ===========================================================================
// Synthetic `כיסא כלה` scan via exists() on 2 root JPGs
// ===========================================================================

async function scanSyntheticBridalChair(
  fs: FsProvider,
): Promise<ImageMetadata[]> {
  const out: ImageMetadata[] = [];
  for (const looseName of LOOSE_BRIDAL_CHAIR_PATHS) {
    const relPath = nfc(looseName);
    let absPath: string;
    try {
      absPath = await toAbsolutePath(relPath);
    } catch (cause) {
      // Defensive — should never trip for the two hardcoded names.
      console.error('[images] synthetic bridal-chair path failed root check', cause);
      continue;
    }

    let exists = false;
    try {
      exists = await tauriFsExtras.exists(absPath);
    } catch (cause) {
      // exists() should be infallible; treat any error as "not present" but log.
      console.error('[images] exists() failed for', relPath, cause);
      continue;
    }
    if (!exists) {
      // Per SOP 01 § Failure Modes: absent loose file → category-level
      // empty-with-warning, not a hard error.
      console.warn('[images] synthetic bridal-chair file missing:', relPath);
      continue;
    }

    const cls = classifyByExtension(relPath);
    if (!cls) {
      // Hardcoded names are .jpg — should never trip.
      console.error('[images] synthetic bridal-chair file failed classify:', relPath);
      continue;
    }

    let stat: { size: number; mtimeMs: number };
    try {
      stat = await fs.stat(absPath);
    } catch (cause) {
      console.error('[images] stat failed for synthetic file', relPath, cause);
      continue;
    }

    out.push({
      path: relPath, // POSIX, NFC, no leading slash
      name: nfc(stripExtension(relPath)),
      category: SYNTHETIC_CATEGORY,
      kind: cls.kind,
      fileType: cls.fileType,
      sizeBytes: stat.size,
      modifiedAt: stat.mtimeMs,
    });
  }
  return out;
}

// ===========================================================================
// scanCategory
// ===========================================================================

/**
 * Scan one category folder (or, for the synthetic `כיסא כלה`, the two known
 * loose JPGs at the project root). Filenames are NFC-normalized and filtered
 * by the `ImageFileType` extension whitelist.
 *
 * A single corrupt file inside a folder does NOT abort the category scan
 * (per SOP 01 § Failure Modes "Single corrupt JPEG"). The failure is logged
 * via `console.error` and the file is omitted.
 *
 * Throws `LibError` only on category-level failures (e.g. folder missing).
 */
export async function scanCategory(
  category: ImageCategory,
  fs: FsProvider = tauriFsProvider,
): Promise<ImageMetadata[]> {
  if (typeof category !== 'string') {
    throw new LibError('scanCategory: category must be a string', {
      code: 'IMG_CATEGORY_MISSING',
    });
  }

  // Prime the sync cache for toImageSrc. getProjectRoot itself caches on a
  // module-level variable, so this is one extra await on cold start at most.
  if (cachedSyncRoot === null) {
    cachedSyncRoot = await getProjectRoot();
  }

  if (category === SYNTHETIC_CATEGORY) {
    return scanSyntheticBridalChair(fs);
  }

  // Real folder scan ----------------------------------------------------------
  const dir = await categoryDirAbsolute(category);

  let entries;
  try {
    entries = await fs.readDir(dir);
  } catch (cause) {
    // Per SOP 01 § Failure Modes: category folder deleted/renamed → empty
    // category + a typed error the caller can surface as a toast. The reading
    // of OTHER categories must not abort, so callers should drive scans
    // through `Promise.allSettled` (see scanAll).
    throw new LibError(`Failed to read category folder: ${category}`, {
      code: 'IMG_CATEGORY_MISSING',
      path: dir,
      cause,
    });
  }

  const out: ImageMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue; // skip subdirs (e.g. `_files` HTML scrape, nested duplicates)
    const rawName = entry.name;
    if (typeof rawName !== 'string' || rawName.length === 0) continue;
    const name = nfc(rawName);
    // SOP 01 § Excluded Items — defense in depth in case readDir surfaces them.
    if (name.startsWith('.') || name.endsWith('_files')) continue;

    const cls = classifyByExtension(name);
    if (!cls) continue; // not in whitelist (e.g. .DS_Store, .ini)

    const relPath = joinPosix(category, name);
    const absPath = joinPosix(dir, name);

    let stat: { size: number; mtimeMs: number };
    try {
      stat = await fs.stat(absPath);
    } catch (cause) {
      console.error('[images] stat failed for', relPath, cause);
      continue; // single-file failure does not abort the category
    }

    out.push({
      path: relPath,
      name: nfc(stripExtension(name)),
      category,
      kind: cls.kind,
      fileType: cls.fileType,
      sizeBytes: stat.size,
      modifiedAt: stat.mtimeMs,
    });
  }

  return out;
}

// ===========================================================================
// scanAll
// ===========================================================================

export type ScanAllResult = {
  byCategory: Map<ImageCategory, ImageMetadata[]>;
  failed: { category: ImageCategory; error: LibError }[];
};

export type ScanAllOptions = {
  /**
   * Fired ONCE per category as soon as that category resolves. Allows the
   * gallery to render incrementally — small categories appear first.
   * `count` is `null` if the category failed.
   */
  onCategoryDone?: (
    category: ImageCategory,
    count: number | null,
    error?: LibError,
  ) => void;
  fs?: FsProvider;
};

/**
 * Drive all 8 categories through their own promise chains so:
 *   1. `מפות מפיות` (520 stat calls) does NOT block the 7 other categories;
 *   2. one category's failure does not cascade — see SOP 01 § Failure Modes
 *      and perf-predictions.md § P-01 mitigation #1 (`Promise.allSettled`).
 *
 * `onCategoryDone` fires per resolution, NOT in scan-order — that's the
 * whole point of streaming. The smallest categories will fire first under
 * normal load, but ordering is a perf optimization, not a contract.
 */
export async function scanAll(
  opts: ScanAllOptions = {},
): Promise<ScanAllResult> {
  const fs = opts.fs ?? tauriFsProvider;
  const byCategory = new Map<ImageCategory, ImageMetadata[]>();
  const failed: { category: ImageCategory; error: LibError }[] = [];

  const tasks = CATEGORY_SCAN_ORDER.map((category) =>
    // Each category gets its own independent chain.
    scanCategory(category, fs).then(
      (items) => {
        byCategory.set(category, items);
        if (opts.onCategoryDone) {
          try {
            opts.onCategoryDone(category, items.length);
          } catch (cb) {
            // A buggy callback cannot abort the scan.
            console.error('[images] onCategoryDone threw for', category, cb);
          }
        }
        return { category, ok: true as const };
      },
      (err: unknown) => {
        const libErr =
          err instanceof LibError
            ? err
            : new LibError(`scanCategory rejected: ${category}`, {
                code: 'IMG_CATEGORY_MISSING',
                path: category,
                cause: err,
              });
        failed.push({ category, error: libErr });
        // Still record an empty list so the gallery can render an "empty
        // state" tile for the category instead of leaving it undefined.
        byCategory.set(category, []);
        if (opts.onCategoryDone) {
          try {
            opts.onCategoryDone(category, null, libErr);
          } catch (cb) {
            console.error('[images] onCategoryDone threw for', category, cb);
          }
        }
        return { category, ok: false as const };
      },
    ),
  );

  // `Promise.allSettled` is overkill here because every chain catches its own
  // rejection above — `Promise.all` would suffice. We use `allSettled` anyway
  // as the explicit guard demanded by perf-predictions § P-01 mitigation #1
  // so future edits can't re-introduce a cascade by removing the inner catch.
  await Promise.allSettled(tasks);

  return { byCategory, failed };
}

// ===========================================================================
// Thumbnail pipeline
// ===========================================================================

type Canvas2D = {
  width: number;
  height: number;
  // Minimal subset we need.
  getContext(id: '2d'): CanvasRenderingContext2D | null;
  // OffscreenCanvas exposes convertToBlob; HTMLCanvasElement exposes toBlob.
  convertToBlob?: (opts?: ImageEncodeOptions) => Promise<Blob>;
  toBlob?: (
    cb: (b: Blob | null) => void,
    type?: string,
    quality?: number,
  ) => void;
};

function isOffscreenCanvasAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas !==
      'undefined'
  );
}

function createCanvas(width: number, height: number): Canvas2D {
  if (isOffscreenCanvasAvailable()) {
    return new (
      globalThis as unknown as {
        OffscreenCanvas: new (w: number, h: number) => Canvas2D;
      }
    ).OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined') {
    throw new LibError('No canvas available (no document, no OffscreenCanvas)', {
      code: 'IMG_THUMBNAIL',
    });
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c as unknown as Canvas2D;
}

async function canvasToWebpBlob(canvas: Canvas2D, quality: number): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }
  if (typeof canvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!(
        (blob) => {
          if (blob) resolve(blob);
          else
            reject(
              new LibError('canvas.toBlob returned null', {
                code: 'IMG_THUMBNAIL',
              }),
            );
        },
        'image/webp',
        quality,
      );
    });
  }
  throw new LibError('Canvas has neither convertToBlob nor toBlob', {
    code: 'IMG_THUMBNAIL',
  });
}

/**
 * Decode bytes → ImageBitmap (modern browsers / WebView2). Fall back to an
 * `<img>` element if `createImageBitmap` is unavailable.
 */
async function decodeToBitmap(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ width: number; height: number; bitmap: ImageBitmap | HTMLImageElement }> {
  // Copy into a fresh ArrayBuffer so the Blob is detached from the underlying
  // typed array (avoids shared-memory / SAB ambiguity in Workers).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mimeType });

  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blob);
      return { width: bm.width, height: bm.height, bitmap: bm };
    } catch (cause) {
      throw new LibError('createImageBitmap failed', {
        code: 'IMG_DECODE',
        cause,
      });
    }
  }

  // Fallback for older WebViews — use an <img> tag.
  if (typeof document === 'undefined') {
    throw new LibError('No image decoder available', { code: 'IMG_DECODE' });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(
          new LibError('HTMLImageElement decode failed', {
            code: 'IMG_DECODE',
          }),
        );
      el.src = url;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      bitmap: img,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitInsideMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { w: number; h: number } {
  if (width <= 0 || height <= 0) {
    return { w: 1, h: 1 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { w: Math.round(width), h: Math.round(height) };
  }
  const ratio = maxEdge / longest;
  return {
    w: Math.max(1, Math.round(width * ratio)),
    h: Math.max(1, Math.round(height * ratio)),
  };
}

function mimeForFileType(ft: ImageFileType): string {
  switch (ft) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    default:
      // Type-narrow exhaustiveness — should never reach here.
      return 'application/octet-stream';
  }
}

/**
 * Read source bytes → decode → 256-px-on-longest-edge → WebP @ q=0.8 →
 * Blob. Caller is responsible for caching the result via `putThumbnail`.
 */
async function bakeThumbnailBlob(
  image: ImageMetadata,
  fs: FsProvider,
): Promise<Blob> {
  const absPath = await toAbsolutePath(image.path);

  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(absPath);
  } catch (cause) {
    throw new LibError(`Failed to read source for thumbnail: ${image.path}`, {
      code: 'IMG_NOT_FOUND',
      path: image.path,
      cause,
    });
  }

  const decoded = await decodeToBitmap(bytes, mimeForFileType(image.fileType));
  const { w, h } = fitInsideMaxEdge(decoded.width, decoded.height, THUMBNAIL_MAX_EDGE);

  let blob: Blob;
  try {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new LibError('Canvas 2d context unavailable', {
        code: 'IMG_THUMBNAIL',
        path: image.path,
      });
    }
    // Both ImageBitmap and HTMLImageElement are valid drawImage sources.
    ctx.drawImage(decoded.bitmap as CanvasImageSource, 0, 0, w, h);
    blob = await canvasToWebpBlob(canvas, THUMBNAIL_QUALITY);
  } catch (cause) {
    if (cause instanceof LibError) throw cause;
    throw new LibError(`Thumbnail bake failed: ${image.path}`, {
      code: 'IMG_THUMBNAIL',
      path: image.path,
      cause,
    });
  } finally {
    // Free the bitmap if it's an ImageBitmap (HTMLImageElement is GC'd normally).
    const bm = decoded.bitmap as { close?: () => void };
    if (typeof bm.close === 'function') {
      try {
        bm.close();
      } catch {
        /* no-op */
      }
    }
  }

  return blob;
}

/**
 * Cache-aware thumbnail accessor.
 *
 * Flow:
 *   1. Look up `getThumbnail(path)` in IndexedDB.
 *   2. If the cached record exists AND `cached.sourceModifiedAt >=
 *      image.modifiedAt`, return the cached Blob.
 *   3. Otherwise, read full bytes via `fs.readFile`, decode to ImageBitmap,
 *      draw to a 256-px-on-longest-edge canvas, encode WebP @ q=0.8, persist
 *      via `putThumbnail`, and return the freshly-baked Blob.
 *
 * For videos, returns `null` — the UI renders a generic placeholder. (Per
 * SOP 01 § Thumbnail Strategy "Skip thumbnail generation for videos.")
 */
export async function getOrBakeThumbnail(
  image: ImageMetadata,
  fs: FsProvider = tauriFsProvider,
): Promise<Blob | null> {
  if (!image || typeof image !== 'object') {
    throw new LibError('getOrBakeThumbnail: image is required', {
      code: 'IMG_THUMBNAIL',
    });
  }
  if (image.kind === 'video') {
    return null;
  }

  const key = nfc(image.path);

  // 1. Cache lookup.
  try {
    const cached = await getThumbnail(key);
    if (cached && cached.sourceModifiedAt >= image.modifiedAt) {
      return cached.blob;
    }
  } catch (cause) {
    // A cache-lookup failure should not block a fresh bake — log and continue.
    console.error('[images] getThumbnail lookup failed for', key, cause);
  }

  // 2. Bake fresh.
  const blob = await bakeThumbnailBlob(image, fs);

  // 3. Persist (best-effort — a write failure does NOT prevent returning the
  //    blob; the next session will re-bake. Logged so QuotaExceededError is
  //    visible during dev.)
  try {
    await putThumbnail({
      path: key,
      category: image.category,
      blob,
      generatedAt: Date.now(),
      sourceModifiedAt: image.modifiedAt,
    });
  } catch (cause) {
    console.error('[images] putThumbnail failed for', key, cause);
  }

  return blob;
}

// ===========================================================================
// bakeThumbnailsBatch
// ===========================================================================

export type BakeBatchOptions = {
  /** Default 4 (per perf-engineer's optimal). Range: 1..32. */
  concurrency?: number;
  /** Fired per resolution (success or failure). */
  onProgress?: (done: number, total: number) => void;
  fs?: FsProvider;
};

export type BakeBatchResult = {
  done: number;
  failed: { path: string; error: LibError }[];
};

/**
 * Run `getOrBakeThumbnail` over `images` with a small worker-pool-style
 * concurrency cap. Failures are recorded in `failed` and do NOT abort the
 * batch — see SOP 01 § Failure Modes "Single corrupt JPEG".
 *
 * For videos, the entry counts as "done" without a thumbnail being produced.
 */
export async function bakeThumbnailsBatch(
  images: ImageMetadata[],
  opts: BakeBatchOptions = {},
): Promise<BakeBatchResult> {
  if (!Array.isArray(images)) {
    throw new LibError('bakeThumbnailsBatch: images must be an array', {
      code: 'IMG_THUMBNAIL',
    });
  }
  const total = images.length;
  if (total === 0) {
    return { done: 0, failed: [] };
  }

  const fs = opts.fs ?? tauriFsProvider;
  const concurrency = Math.max(
    1,
    Math.min(32, Math.floor(opts.concurrency ?? DEFAULT_BAKE_CONCURRENCY)),
  );

  const failed: { path: string; error: LibError }[] = [];
  let done = 0;
  let nextIndex = 0;

  const reportProgress = (): void => {
    if (opts.onProgress) {
      try {
        opts.onProgress(done, total);
      } catch (cause) {
        console.error('[images] onProgress threw', cause);
      }
    }
  };

  // Simple promise-pool: N workers each pull the next index off a shared
  // counter until exhausted. Failures are caught per-worker so the pool drains.
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIndex++;
      if (i >= total) return;
      const image = images[i]!;
      try {
        await getOrBakeThumbnail(image, fs);
      } catch (err) {
        const libErr =
          err instanceof LibError
            ? err
            : new LibError(`Thumbnail bake failed: ${image?.path ?? '<unknown>'}`, {
                code: 'IMG_THUMBNAIL',
                path: image?.path,
                cause: err,
              });
        failed.push({ path: image?.path ?? '', error: libErr });
      } finally {
        done += 1;
        reportProgress();
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, total); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { done, failed };
}

// ===========================================================================
// URL helpers
// ===========================================================================

// One-shot cache so we don't await `getProjectRoot()` from a sync API path
// that promised a string. We require that `scanCategory`/`scanAll` runs
// before any `toImageSrc` consumer (the gallery flow already does this), so
// the root has been resolved at least once.
let cachedSyncRoot: string | null = null;

/**
 * Internal — primes the sync cache. Safe to call from anywhere; idempotent.
 * Made an exported test hook so #16 can pre-seed without scanning.
 */
export async function __primeProjectRootForImageSrc(): Promise<void> {
  if (cachedSyncRoot === null) {
    cachedSyncRoot = await getProjectRoot();
  }
}

/**
 * Convert an `ImageMetadata` to a WebView-loadable URL for full-resolution
 * rendering (Lightbox). Synchronous to keep the React render path clean.
 *
 * Pre-condition: the project root must have been resolved at least once
 * before this is called. `scanCategory()` / `scanAll()` both resolve it as
 * a side-effect; `__primeProjectRootForImageSrc()` is the explicit hook for
 * tests.
 *
 * Per the brief: "Asserts the path is inside the project root before
 * computing the absolute path." We mirror the assertion here synchronously
 * (string-prefix check after building the absolute path).
 */
export function toImageSrc(
  image: ImageMetadata,
  fs: FsProvider = tauriFsProvider,
): string {
  if (!image || typeof image.path !== 'string') {
    throw new LibError('toImageSrc: image.path is required', {
      code: 'IMG_NOT_FOUND',
    });
  }
  if (cachedSyncRoot === null) {
    throw new LibError(
      'toImageSrc called before project root resolved; ' +
        'call scanCategory()/scanAll() or __primeProjectRootForImageSrc() first',
      { code: 'IMG_NOT_FOUND', path: image.path },
    );
  }

  const relPath = nfc(image.path);
  // Reject `..` segments and absolute paths defensively (capability scope is
  // the primary guard at the Tauri layer; this is belt-and-braces).
  for (const seg of relPath.split('/')) {
    if (seg === '..' || seg === '.') {
      throw new LibError('Path traversal segment in image.path', {
        code: 'IMG_NOT_FOUND',
        path: image.path,
      });
    }
  }
  if (
    relPath.startsWith('/') ||
    relPath.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(relPath)
  ) {
    throw new LibError('image.path must be relative to the project root', {
      code: 'IMG_NOT_FOUND',
      path: image.path,
    });
  }

  const abs = joinPosix(cachedSyncRoot, relPath);
  // Sync prefix check — mirrors `assertInsideRoot` without the await.
  const anchor = cachedSyncRoot.replace(/\/+$/, '');
  if (abs !== anchor && !abs.startsWith(anchor + '/')) {
    throw new LibError('toImageSrc: path escaped project root', {
      code: 'IMG_NOT_FOUND',
      path: image.path,
    });
  }

  return fs.toFileSrc(abs);
}

/**
 * Path-only variant of `toImageSrc` for `ImageSelection.imagePath` callers
 * (the event tabs). The selected card needs an actual thumbnail; the
 * selection schema only stores the relative path string, not a full
 * `ImageMetadata`. Returns `null` if the project-root cache hasn't been
 * primed yet (e.g. before the gallery has been opened in this session) so
 * the caller can render an empty placeholder rather than a broken `<img>`.
 *
 * Same defenses as `toImageSrc`: rejects `..`/absolute/UNC, and verifies
 * the resolved path stays inside the project root anchor.
 */
export function selectionPathToSrc(
  imagePath: string,
  fs: FsProvider = tauriFsProvider,
): string | null {
  if (typeof imagePath !== 'string' || imagePath.length === 0) return null;
  if (cachedSyncRoot === null) return null;

  const relPath = nfc(imagePath);
  for (const seg of relPath.split('/')) {
    if (seg === '..' || seg === '.') return null;
  }
  if (
    relPath.startsWith('/') ||
    relPath.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(relPath)
  ) {
    return null;
  }

  const abs = joinPosix(cachedSyncRoot, relPath);
  const anchor = cachedSyncRoot.replace(/\/+$/, '');
  if (abs !== anchor && !abs.startsWith(anchor + '/')) return null;
  try {
    return fs.toFileSrc(abs);
  } catch {
    return null;
  }
}

/**
 * Async variant of `selectionPathToSrc` that ensures the project root is
 * loaded before converting the path to a file URL. This is the preferred API
 * for React components that can tolerate async initialization (e.g.,
 * `SelectionThumbnail` on a freshly loaded event from IndexedDB before the
 * gallery has been opened).
 *
 * Returns `null` if the path validation fails or the file system cannot
 * resolve the URL. Same validation defenses as the sync variant.
 */
export async function selectionPathToSrcAsync(
  imagePath: string,
  fs: FsProvider = tauriFsProvider,
): Promise<string | null> {
  if (typeof imagePath !== 'string' || imagePath.length === 0) return null;

  // Prime the cache if needed
  if (cachedSyncRoot === null) {
    try {
      cachedSyncRoot = await getProjectRoot();
    } catch {
      return null;
    }
  }

  // Now we can delegate to the sync path (cache is primed)
  return selectionPathToSrc(imagePath, fs);
}

// ===========================================================================
// Downscale to PNG (DOCX embedding + selectedImageBytes cache)
// ===========================================================================

/**
 * Downscale `originalBytes` (any browser-decodable image: JPEG/PNG/WebP) to a
 * PNG `Uint8Array` whose largest edge is ≤ `maxWidth` pixels. Used by:
 *
 *   • `lib/docx.ts` — embeds 600px PNG into the generated DOCX. The choice of
 *     PNG here is NOT cosmetic: `docx@8.5.0` hard-codes every `ImageRun` part
 *     name as `word/media/<uuid>.png` (see `node_modules/docx/build/index.cjs`
 *     line 11122 — `__publicField(this, "key", `${uniqueId()}.png`)`), and
 *     `[Content_Types].xml` only declares `Default Extension="png"
 *     ContentType="image/png"`. Embedding JPEG bytes inside a `.png`-keyed
 *     part triggers Word's "this file is corrupt" dialog. PNG bytes inside a
 *     `.png`-keyed part are correct and Word accepts them.
 *
 *   • `components/event/SummaryTab.tsx` — bakes a 600px PNG once per unique
 *     selection during export, persists it to the `selectedImageBytes` IDB
 *     store, and reuses it on the next export (or on a cold restart) so the
 *     DOCX still builds even if the source file is moved or deleted.
 *
 * Returns the original bytes if any step of the canvas pipeline is
 * unavailable (no `createImageBitmap`, no `document`, no `2d` context). The
 * caller should treat that fallback as best-effort: the bytes are still
 * embeddable iff they were already PNG/JPEG to begin with — and the DOCX
 * pipeline gates that with a magic-byte check.
 */
export async function downscaleImageToPng(
  originalBytes: Uint8Array,
  maxWidth: number,
): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function') {
    return originalBytes;
  }
  const blob = new Blob([originalBytes]);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return originalBytes;
  }

  const w = bitmap.width;
  const h = bitmap.height;
  if (w === 0 || h === 0) {
    bitmap.close?.();
    return originalBytes;
  }

  const scale = Math.min(1, maxWidth / w);
  const targetW = Math.max(1, Math.floor(w * scale));
  const targetH = Math.max(1, Math.floor(h * scale));

  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    bitmap.close?.();
    return originalBytes;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return originalBytes;
  }

  try {
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);
  } catch {
    bitmap.close?.();
    return originalBytes;
  }
  bitmap.close?.();

  let dataUrl: string;
  try {
    // PNG (no quality arg). `image/png` re-encodes regardless of source
    // format, so JPEG/WebP inputs become PNG outputs. This is the whole
    // point of this function: produce bytes safe for `docx@8.5` ImageRun.
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return originalBytes;
  }

  const comma = dataUrl.indexOf(',');
  if (comma < 0) return originalBytes;
  const base64 = dataUrl.slice(comma + 1);
  try {
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  } catch {
    return originalBytes;
  }
}

/** Pixel dimensions of a downscaled image, used by the IDB cache record so
 *  callers don't have to re-decode the bytes to learn the size. */
export type ImageDimensions = { widthPx: number; heightPx: number };

/**
 * Variant of `downscaleImageToPng` that also returns the rendered pixel
 * dimensions. Avoids a second `createImageBitmap` call in `SummaryTab` when
 * we want to persist `widthPx`/`heightPx` alongside the bytes in the
 * `selectedImageBytes` IDB store.
 */
export async function downscaleImageToPngWithSize(
  originalBytes: Uint8Array,
  maxWidth: number,
): Promise<{ bytes: Uint8Array } & Partial<ImageDimensions>> {
  if (typeof createImageBitmap !== 'function') {
    return { bytes: originalBytes };
  }
  const blob = new Blob([originalBytes]);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { bytes: originalBytes };
  }
  const w = bitmap.width;
  const h = bitmap.height;
  if (w === 0 || h === 0) {
    bitmap.close?.();
    return { bytes: originalBytes };
  }
  const scale = Math.min(1, maxWidth / w);
  const targetW = Math.max(1, Math.floor(w * scale));
  const targetH = Math.max(1, Math.floor(h * scale));
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    bitmap.close?.();
    return { bytes: originalBytes };
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return { bytes: originalBytes };
  }
  try {
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);
  } catch {
    bitmap.close?.();
    return { bytes: originalBytes };
  }
  bitmap.close?.();
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return { bytes: originalBytes };
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return { bytes: originalBytes, widthPx: targetW, heightPx: targetH };
  const base64 = dataUrl.slice(comma + 1);
  try {
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      arr[i] = bin.charCodeAt(i);
    }
    return { bytes: arr, widthPx: targetW, heightPx: targetH };
  } catch {
    return { bytes: originalBytes, widthPx: targetW, heightPx: targetH };
  }
}

// ===========================================================================
// Test hooks
// ===========================================================================

/** Test-only: reset the sync project-root cache used by `toImageSrc`. */
export function __resetImageSrcCacheForTests(): void {
  cachedSyncRoot = null;
}
