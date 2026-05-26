// SOP: architecture/12-image-tagging.md § 4.5 Automatic pre-pass
// SOP: claude.md § Behavioral Rules #11 (one-time gate) — auto-tagged rows are
//      first-class ImageTag records, identical in shape to manually-tagged ones.
// SOP: claude.md § Data Schemas (ImageTag).
//
// Layer 3 — pure deterministic library. Allowed imports: '../types', './db',
// './images'. No React, no framer-motion, no '@tauri-apps/*' direct.
//
// The auto-tag pre-pass walks every scanned ImageMetadata once and writes an
// `ImageTag` row when at least one of two stacked heuristics is confident:
//   A. Filename heuristic — Hebrew substring match on a fixed dictionary.
//   B. Pixel-color heuristic — HSL bucket of the cached 256px WebP thumbnail.
// Images that neither heuristic can classify are left without a tag, so the
// SOP 12 manual TaggingPass naturally lands on them via firstUntaggedFrom().
//
// Public surface:
//   • autoTagLibrary(images, opts?)             → AutoTagResult
//   • deriveLabelsFromName(image)                → string[]   (exposed for tests)
//   • deriveColorFromThumbnail(blob)             → string|null (exposed for tests)
//
// All Hebrew strings emitted as labels are NFC-normalized at the source dictionary
// so db.ts does not need to re-transform them.

import { type ImageMetadata, type ImageTag, LibError } from '../types';
import { putImageTag } from './db';
import { getOrBakeThumbnail } from './images';
import { allowedLabelsFor, normalizeFabric } from './category-schema';

// ===========================================================================
// A. Filename heuristic
// ===========================================================================

/**
 * Token → labels emitted on a substring match. Order matters only for
 * deterministic dedupe — the union of labels is what gets written.
 *
 * The list is intentionally small. We err on the side of NOT inventing labels
 * when uncertain — Shon will tag the rest manually via SOP 12.
 */
const FILENAME_DICTIONARY: ReadonlyArray<{
  match: readonly string[];
  emit: readonly string[];
}> = [
  // Chuppah types ---------------------------------------------------------
  { match: ['מרובעת', 'מרובע'], emit: ['מרובעת'] },
  { match: ['עגולה', 'עגול'], emit: ['עגולה'] },
  { match: ['שקופה', 'שקופהה', 'שקוף'], emit: ['שקופה'] },
  { match: ['אובלית', 'אליפסה'], emit: ['אובלית'] },
  { match: ['בוהו'], emit: ['בוהו'] },

  // Decor objects ---------------------------------------------------------
  { match: ['פמוט', 'פמוטי', 'פמוטים'], emit: ['פמוט'] },
  { match: ['שנדליר'], emit: ['שנדליר'] },
  { match: ['סחלב'], emit: ['סחלב'] },
  { match: ['טוליפ'], emit: ['טוליפ'] },
  { match: ['נרות', 'נר '], emit: ['נרות'] },
  { match: ['צילנדר', 'צילנדרים'], emit: ['צילנדר'] },
  { match: ['סידור', 'סידורי'], emit: ['סידור'] },
  { match: ['אביר', 'אבירים'], emit: ['אבירים'] },
  { match: ['גיבסניות'], emit: ['גיבסניות'] },
  { match: ['אהיל'], emit: ['אהיל'] },

  // Materials -------------------------------------------------------------
  { match: ['קטיפה'], emit: ['קטיפה'] },
  { match: ['משי'], emit: ['משי'] },
  { match: ['בדים', 'וילון'], emit: ['בדים'] },

  // Furniture / setting ---------------------------------------------------
  { match: ['כסא כלה', 'כיסא כלה'], emit: ['כיסא כלה'] },
  { match: ['בריכה'], emit: ['בריכה'] },
  { match: ['חופה'], emit: ['חופה'] },
  { match: ['שולחן', 'שולחנות'], emit: ['שולחן'] },
  { match: ['שדרה'], emit: ['שדרה'] },

  // Color words (also produced by pixel heuristic; filename match wins
  // when both fire — same label, dedupe on write). ------------------------
  { match: ['לבן', 'לבנים', 'לבנות'], emit: ['לבן'] },
  { match: ['ורוד', 'ורודים', 'ורודות'], emit: ['ורוד'] },
  { match: ['אדום', 'אדומים', 'אדומות'], emit: ['אדום'] },
  { match: ['זהב', 'זהובים', 'מוזהב'], emit: ['זהב'] },
  { match: ['כסף', 'כסוף'], emit: ['כסף'] },
  { match: ['שחור', 'שחורים', 'שחורות'], emit: ['שחור'] },
  { match: ['חום', 'חומים', 'חומות'], emit: ['חום'] },
  { match: ['כחול', 'כחולים'], emit: ['כחול'] },
  { match: ['ירוק', 'ירוקים'], emit: ['ירוק'] },
  { match: ['סגול', 'סגולים'], emit: ['סגול'] },
  { match: ['שמנת'], emit: ['שמנת'] },
];

/**
 * Pure, synchronous. Returns the deduped labels emitted by the filename
 * dictionary against `image.name` + `image.path` (NFC-normalized).
 */
export function deriveLabelsFromName(image: ImageMetadata): string[] {
  const haystack = `${image.name} ${image.path}`.normalize('NFC');
  const out = new Set<string>();
  for (const rule of FILENAME_DICTIONARY) {
    for (const token of rule.match) {
      if (haystack.includes(token)) {
        for (const label of rule.emit) out.add(label);
        break; // any one token in the rule is enough
      }
    }
  }
  return Array.from(out);
}

// ===========================================================================
// B. Pixel-color heuristic
// ===========================================================================

/** Hebrew color palette emitted by the pixel heuristic. Locked here. */
const COLOR_PALETTE: readonly string[] = [
  'לבן',
  'שמנת',
  'ורוד',
  'אדום',
  'זהב',
  'ירוק',
  'כחול',
  'סגול',
  'שחור',
  'חום',
];

/**
 * Confidence threshold for the pixel heuristic. Maintenance Log 2026-05-26:
 * raised from 0.40 to 0.50 — at 0.40 a "mostly green table runner with pink
 * flowers" image would emit BOTH ירוק and ורוד, even though neither colour
 * is the photograph's primary subject. With weighted scoring (filename=1.0,
 * visual-range=0.9, pixel=variable) and a per-label cutoff of 0.9, a 0.50
 * dominance threshold is the bar at which a single colour is unambiguously
 * the picture's surface.
 */
const COLOR_CONFIDENCE = 0.5;

/** Sample grid edge — 64×64 = 4096 pixels per image. */
const SAMPLE_EDGE = 64;

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN:
        h = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60;
        break;
      case gN:
        h = ((bN - rN) / d + 2) * 60;
        break;
      default:
        h = ((rN - gN) / d + 4) * 60;
        break;
    }
  }
  return { h, s, l };
}

/**
 * Map one HSL pixel to a palette bucket. Returns null for "indeterminate"
 * pixels (mid-grey, low saturation in mid-lightness) so they don't pollute the
 * histogram.
 */
function bucketForPixel({ h, s, l }: HSL): string | null {
  // Achromatic branch — saturation < 0.18 means we trust lightness only.
  if (s < 0.18) {
    if (l > 0.85) return 'לבן';
    if (l > 0.7) return 'שמנת';
    if (l < 0.18) return 'שחור';
    return null; // mid-grey — drop
  }

  // Chromatic branch — hue dictates the bucket.
  // Cream / gold split: warm yellows in the lighter range fall to שמנת,
  // saturated yellows to זהב.
  if (h >= 340 || h < 15) {
    // Reds. Light + low-mid saturation → ורוד; otherwise אדום.
    if (l > 0.6 && s < 0.6) return 'ורוד';
    return 'אדום';
  }
  if (h < 45) {
    // Orange-brown range — collapse to חום (no orange in palette).
    return 'חום';
  }
  if (h < 70) {
    // Yellows → gold when saturated, cream when pale.
    if (s > 0.4 && l < 0.7) return 'זהב';
    return 'שמנת';
  }
  if (h < 160) {
    return 'ירוק';
  }
  if (h < 250) {
    return 'כחול';
  }
  if (h < 340) {
    // Magenta / purple. Lighter → ורוד; darker → סגול.
    return l > 0.6 ? 'ורוד' : 'סגול';
  }
  return null;
}

function isOffscreenCanvasAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { OffscreenCanvas?: unknown })
      .OffscreenCanvas !== 'undefined'
  );
}

type SampleCanvas = {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
};

function makeSampleCanvas(): SampleCanvas {
  if (isOffscreenCanvasAvailable()) {
    return new (
      globalThis as unknown as {
        OffscreenCanvas: new (w: number, h: number) => SampleCanvas;
      }
    ).OffscreenCanvas(SAMPLE_EDGE, SAMPLE_EDGE);
  }
  if (typeof document === 'undefined') {
    throw new LibError('auto-tag: no canvas available', {
      code: 'IMG_THUMBNAIL',
    });
  }
  const c = document.createElement('canvas');
  c.width = SAMPLE_EDGE;
  c.height = SAMPLE_EDGE;
  return c as unknown as SampleCanvas;
}

/**
 * Async. Decode the WebP thumbnail blob, downsample to 64×64, and pick a
 * single palette label iff the dominant bucket owns ≥ COLOR_CONFIDENCE share.
 * Returns null otherwise.
 *
 * Failures (decode errors, missing canvas) resolve to null — the caller treats
 * them as "no color signal" and the image falls through to the manual pass.
 */
export async function deriveColorFromThumbnail(
  blob: Blob,
): Promise<string | null> {
  if (!blob || typeof (blob as Blob).size !== 'number') return null;
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  let canvas: SampleCanvas;
  try {
    canvas = makeSampleCanvas();
  } catch {
    bitmap.close?.();
    return null;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return null;
  }

  try {
    ctx.drawImage(
      bitmap as unknown as CanvasImageSource,
      0,
      0,
      SAMPLE_EDGE,
      SAMPLE_EDGE,
    );
  } catch {
    bitmap.close?.();
    return null;
  }
  bitmap.close?.();

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
  } catch {
    return null;
  }

  const histogram = new Map<string, number>();
  let counted = 0;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (a < 200) continue; // skip transparent pixels
    const bucket = bucketForPixel(rgbToHsl({ r, g, b }));
    if (bucket === null) continue;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    counted += 1;
  }

  if (counted === 0) return null;

  let topBucket: string | null = null;
  let topShare = 0;
  for (const [bucket, count] of histogram) {
    const share = count / counted;
    if (share > topShare) {
      topShare = share;
      topBucket = bucket;
    }
  }

  if (topBucket === null || topShare < COLOR_CONFIDENCE) return null;
  if (!COLOR_PALETTE.includes(topBucket)) return null;
  return topBucket;
}

/**
 * Maintenance Log 2026-05-26: companion to `deriveColorFromThumbnail` that
 * returns the dominant bucket together with its share `(0..1)`. The caller
 * uses the share as a confidence multiplier in the weighted scorer (a 0.85
 * dominance scores higher than a 0.55 dominance, so it can outrank competing
 * heuristics on tight calls). Returns `null` if no bucket clears the
 * `COLOR_CONFIDENCE` floor — same gate as the legacy function.
 */
export type DominantColorSignal = {
  label: string;
  share: number;
};

export async function deriveDominantColorWithShare(
  blob: Blob,
): Promise<DominantColorSignal | null> {
  if (!blob || typeof (blob as Blob).size !== 'number') return null;
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  let canvas: SampleCanvas;
  try {
    canvas = makeSampleCanvas();
  } catch {
    bitmap.close?.();
    return null;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return null;
  }

  try {
    ctx.drawImage(
      bitmap as unknown as CanvasImageSource,
      0,
      0,
      SAMPLE_EDGE,
      SAMPLE_EDGE,
    );
  } catch {
    bitmap.close?.();
    return null;
  }
  bitmap.close?.();

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
  } catch {
    return null;
  }

  const histogram = new Map<string, number>();
  let counted = 0;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (a < 200) continue;
    const bucket = bucketForPixel(rgbToHsl({ r, g, b }));
    if (bucket === null) continue;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    counted += 1;
  }
  if (counted === 0) return null;

  let topBucket: string | null = null;
  let topShare = 0;
  for (const [bucket, count] of histogram) {
    const share = count / counted;
    if (share > topShare) {
      topShare = share;
      topBucket = bucket;
    }
  }

  if (topBucket === null || topShare < COLOR_CONFIDENCE) return null;
  if (!COLOR_PALETTE.includes(topBucket)) return null;
  return { label: topBucket, share: topShare };
}

// ===========================================================================
// C. Visual range heuristic (curator-inspected, 2026-05-24)
// ===========================================================================
/**
 * Direct visual inspection of the מפות מפיות 0S3A#### sequence by the
 * auto-tag curator. Each range covers a contiguous block of images shot in
 * the same session with the same color/style.
 *
 * Format: { pathFragment, from, to, labels }
 *   pathFragment — substring of image.path to scope the rule to one folder.
 *   from / to    — inclusive numeric range of the filename number.
 *   labels       — Hebrew labels to emit.
 */
const VISUAL_RANGE_DICT: ReadonlyArray<{
  pathFragment: string;
  from: number;
  to: number;
  labels: readonly string[];
}> = [
  // ── מפות מפיות — individual napkin color swatches ─────────────────────
  { pathFragment: 'מפות מפיות', from: 1412, to: 1419, labels: ['ירוק זית', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1420, to: 1444, labels: ['שחור', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1445, to: 1459, labels: ['תכלת', 'כחול בהיר', 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1460, to: 1469, labels: ['ורוד', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1470, to: 1479, labels: ['כחול נייבי', 'כחול כהה', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1480, to: 1494, labels: ['שמנת', "בז'", 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1495, to: 1499, labels: ['ורוד אבק', 'מוב', 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1500, to: 1509, labels: ['זהב', 'שמפניה', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1510, to: 1514, labels: ['ורוד אבק', 'מוב', 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1515, to: 1519, labels: ['ירוק זית', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1520, to: 1529, labels: ['לבן', 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1530, to: 1539, labels: ['זהב', 'שמפניה', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1540, to: 1546, labels: ['ירוק זית', 'פשתן'] },
  { pathFragment: 'מפות מפיות', from: 1547, to: 1559, labels: ['תכלת', 'כחול בהיר', 'סאטן'] },
  { pathFragment: 'מפות מפיות', from: 1560, to: 1569, labels: ['כחול כהה', 'טיל', 'פשתן'] },

  // ── מפות מפיות — full table design photos (from ~1570) ─────────────────
  { pathFragment: 'מפות מפיות', from: 1570, to: 1579, labels: ['עיצוב שולחן', 'שנדליר', 'נרות'] },
  { pathFragment: 'מפות מפיות', from: 1580, to: 1589, labels: ['עיצוב שולחן', 'לבן'] },
  { pathFragment: 'מפות מפיות', from: 1590, to: 1609, labels: ['עיצוב שולחן', 'ורוד'] },
  { pathFragment: 'מפות מפיות', from: 1610, to: 1629, labels: ['עיצוב שולחן', 'ורוד', 'לילך'] },
  { pathFragment: 'מפות מפיות', from: 1630, to: 1649, labels: ['עיצוב שולחן', 'ורוד', 'שנדליר'] },
  { pathFragment: 'מפות מפיות', from: 1650, to: 1679, labels: ['עיצוב שולחן', 'ורוד'] },
  { pathFragment: 'מפות מפיות', from: 1680, to: 1699, labels: ['עיצוב שולחן', 'לבן', 'שחור'] },
  { pathFragment: 'מפות מפיות', from: 1700, to: 1719, labels: ['עיצוב שולחן', 'בורדו', 'שנדליר'] },
  { pathFragment: 'מפות מפיות', from: 1720, to: 1739, labels: ['עיצוב שולחן', 'בורדו', 'פרחים'] },
  { pathFragment: 'מפות מפיות', from: 1740, to: 1814, labels: ['עיצוב שולחן', 'לבן', 'פרחים לבנים'] },
  { pathFragment: 'מפות מפיות', from: 1815, to: 1859, labels: ['עיצוב שולחן', 'לבן', 'פרחים לבנים'] },
  { pathFragment: 'מפות מפיות', from: 1860, to: 1876, labels: ['עיצוב שולחן', 'נרות', 'צילנדר'] },
  { pathFragment: 'מפות מפיות', from: 1877, to: 1909, labels: ['עיצוב שולחן', 'שנדליר', 'זהב'] },
  { pathFragment: 'מפות מפיות', from: 1910, to: 1970, labels: ['עיצוב שולחן', 'אולם', 'ורוד'] },
];

/** Extract trailing number from a filename stem, e.g. "0S3A1412" → 1412. */
function extractFilenameNumber(name: string): number | null {
  const m = name.match(/(\d+)\s*$/);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure, synchronous. Returns curator-inspected labels for images whose
 * filename number falls within a known visual range.
 */
export function deriveLabelsFromVisualRange(image: ImageMetadata): string[] {
  const num = extractFilenameNumber(image.name);
  if (num === null) return [];
  const path = image.path.normalize('NFC');
  const out = new Set<string>();
  for (const rule of VISUAL_RANGE_DICT) {
    if (path.includes(rule.pathFragment) && num >= rule.from && num <= rule.to) {
      for (const label of rule.labels) out.add(label);
    }
  }
  return Array.from(out);
}

// ===========================================================================
// Public driver
// ===========================================================================

export type AutoTagResult = {
  /** Images that received at least one confident label and were persisted. */
  written: number;
  /** Images neither heuristic could classify — left for the manual pass. */
  skipped: number;
  /** Thumbnail decode / IDB write errors. */
  failed: number;
};

export type AutoTagProgress = (
  done: number,
  total: number,
  current?: ImageMetadata,
) => void;

export type AutoTagOptions = {
  onProgress?: AutoTagProgress;
  signal?: AbortSignal;
  /**
   * Skip the pixel-colour heuristic (no thumbnail bake). Only filename +
   * visual-range heuristics run — completes in < 1 s even for 884 images.
   * Used by Gallery when tagging was previously skipped via "דלג זמנית".
   */
  nameOnly?: boolean;
};

const CHUNK_SIZE = 8;

/**
 * Weighted-scoring constants for the auto-tag pipeline. Maintenance Log
 * 2026-05-26: replaces the previous "union all heuristic outputs" model that
 * produced false-positive labels (a flower image inside `מפות מפיות` getting
 * a "מפיה" label because the napkin was also visible in the frame).
 *
 * Each heuristic that emits a label contributes a numeric score; labels are
 * kept iff the cumulative score reaches `LABEL_CONFIDENCE_FLOOR`. A filename
 * match alone clears the bar; a pixel-only signal needs to be *very*
 * dominant (≥ 0.85 share) to outrank an absent filename match.
 *
 *   FILENAME_WEIGHT    1.00 — Shon's curators name files explicitly
 *                              (e.g. `מפית-וורד-עתיק-12.JPG`).
 *   VISUAL_RANGE_WEIGHT 0.90 — curator-inspected ranges are explicit too.
 *   PIXEL_WEIGHT_MIN   0.50 — the bare minimum at COLOR_CONFIDENCE share.
 *   PIXEL_WEIGHT_MAX   1.00 — when a single colour owns ≥ 0.85 of pixels.
 *   LABEL_CONFIDENCE_FLOOR 0.90 — keep label only if score ≥ this.
 */
const FILENAME_WEIGHT = 1.0;
const VISUAL_RANGE_WEIGHT = 0.9;
const PIXEL_WEIGHT_MIN = 0.5;
const PIXEL_WEIGHT_MAX = 1.0;
const LABEL_CONFIDENCE_FLOOR = 0.9;

/**
 * Map a pixel-bucket dominance share to a heuristic weight. Linearly
 * interpolates between `PIXEL_WEIGHT_MIN` (at COLOR_CONFIDENCE share) and
 * `PIXEL_WEIGHT_MAX` (at 0.85 share or above). Sub-COLOR_CONFIDENCE shares
 * never reach this function — they're filtered upstream.
 */
function pixelWeightForShare(share: number): number {
  const lo = COLOR_CONFIDENCE;
  const hi = 0.85;
  if (share >= hi) return PIXEL_WEIGHT_MAX;
  if (share <= lo) return PIXEL_WEIGHT_MIN;
  const t = (share - lo) / (hi - lo);
  return PIXEL_WEIGHT_MIN + t * (PIXEL_WEIGHT_MAX - PIXEL_WEIGHT_MIN);
}

/**
 * Walk the full ImageMetadata array and write an ImageTag for every image we
 * can confidently classify. Yields between chunks so the progress UI stays
 * responsive on a 884-image cold run.
 *
 * Per-image failures (decode error, IDB write error) increment `failed` but
 * never abort the run — partial progress is desirable: every successful write
 * is durable on its own transaction (SOP 02 § Performance Notes).
 */
export async function autoTagLibrary(
  images: readonly ImageMetadata[],
  opts: AutoTagOptions = {},
): Promise<AutoTagResult> {
  const { onProgress, signal, nameOnly = false } = opts;
  const result: AutoTagResult = { written: 0, skipped: 0, failed: 0 };
  const total = images.length;
  if (total === 0) return result;

  for (let start = 0; start < total; start += CHUNK_SIZE) {
    if (signal?.aborted) break;
    const slice = images.slice(start, start + CHUNK_SIZE);

    await Promise.all(
      slice.map(async (image, offset) => {
        if (signal?.aborted) return;

        try {
          // Maintenance Log 2026-05-26: weighted scoring replaces the old
          // "union of all heuristic outputs". Each candidate label collects
          // scores from every heuristic that emitted it; only labels whose
          // summed score clears `LABEL_CONFIDENCE_FLOOR` (0.9) survive.
          // Filename alone (1.0) qualifies; visual-range alone (0.9) is on
          // the edge but qualifies; pixel alone needs > 0.85 dominance to
          // outrank an absent filename match. The result: incidental
          // objects in the frame stop emitting labels by themselves.
          const scores = new Map<string, number>();
          const bumpScore = (label: string, weight: number): void => {
            const normalized = normalizeFabric(label);
            scores.set(normalized, (scores.get(normalized) ?? 0) + weight);
          };

          for (const label of deriveLabelsFromName(image)) {
            bumpScore(label, FILENAME_WEIGHT);
          }
          for (const label of deriveLabelsFromVisualRange(image)) {
            bumpScore(label, VISUAL_RANGE_WEIGHT);
          }

          // Pixel heuristic only for actual images (videos return null from
          // getOrBakeThumbnail). Skip when nameOnly=true (Gallery fast-pass).
          if (!nameOnly && image.kind === 'image') {
            let blob: Blob | null = null;
            try {
              blob = await getOrBakeThumbnail(image);
            } catch {
              blob = null;
            }
            if (blob) {
              const dominant = await deriveDominantColorWithShare(blob);
              if (dominant) {
                bumpScore(dominant.label, pixelWeightForShare(dominant.share));
              }
            }
          }

          // Apply the confidence floor + category-schema filter together.
          // Labels that don't appear in `allowedLabelsFor(image.category)`
          // are dropped regardless of score (a "מפיה" label has no place
          // under `כיסא כלה`, even if every heuristic agreed).
          const allowed = allowedLabelsFor(image.category);
          const labels = new Set<string>();
          for (const [label, score] of scores) {
            if (score < LABEL_CONFIDENCE_FLOOR) continue;
            if (!allowed.has(label)) continue;
            labels.add(label);
          }

          if (labels.size === 0) {
            result.skipped += 1;
            return;
          }

          const tag: ImageTag = {
            imagePath: image.path,
            customLabels: Array.from(labels),
            notes: '',
            taggedAt: 0, // db.ts re-stamps via INV-12
          };
          await putImageTag(tag);
          result.written += 1;
        } catch (err) {
          result.failed += 1;
          // Defensive — never let a per-image error escape the chunk.
          // eslint-disable-next-line no-console
          console.error('[auto-tag] failed for', image.path, err);
        } finally {
          if (onProgress) {
            try {
              onProgress(start + offset + 1, total, image);
            } catch (cb) {
              // eslint-disable-next-line no-console
              console.error('[auto-tag] onProgress threw', cb);
            }
          }
        }
      }),
    );

    // Yield to the event loop so the React tree can repaint the progress UI.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return result;
}
