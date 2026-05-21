// SOP: architecture/06-signature-flow.md § Self-Annealing 2026-05-21
// SOP: architecture/03-document-generation.md § Self-Annealing 2026-05-21
// Schema: claude.md § Data Schemas (Signature) — Maintenance Log 2026-05-21
//
// Layer 3 — pure helpers for the dual-shape `Signature` (png | vector).
//
// Two kinds of work happen here:
//
//  1. `normalizeSignature(raw)` — read-side adapter. The IndexedDB store has
//     legacy rows shaped as `{ dataUrl, signedAt }` (no `kind` field). Every
//     read path that returns `Event` to a consumer routes through this so the
//     consumer never has to branch on the legacy shape. This is a READ-ONLY
//     transform: we never mutate the stored row (claude.md "don't touch old
//     data").
//
//  2. `rasterizeStrokes()` — DOCX-side rasterizer. Converts a vector
//     signature to a PNG byte buffer using a HEADLESS `<canvas>` with BLACK
//     ink on a WHITE background, regardless of the active UI theme. This is
//     the materialization of Behavioral Rule #13 ("DOCX output is always
//     light-theme") — the function ignores `meta.theme` entirely.
//
// Imports here are restricted to `'../types'`. No React, no Tauri, no idb,
// no `docx`. The rasterizer relies only on the WebView2 DOM canvas API.

import {
  type Signature,
  type SignatureStroke,
  LibError,
} from '../types';

// ---------------------------------------------------------------------------
// Read-side adapter
// ---------------------------------------------------------------------------

/**
 * Type-guard / migrator for any value that could be in `event.signature`.
 *
 * Inputs we accept:
 *   • `null`                         → returns `null`
 *   • `{ kind: 'png',    … }`         → returned as-is (validated)
 *   • `{ kind: 'vector', … }`         → returned as-is (validated)
 *   • `{ dataUrl, signedAt }` (legacy → coerced to `{ kind: 'png', … }`
 *
 * Anything else → `null`. We do NOT throw, because `normalizeSignature` runs
 * inside hot read paths (every `getEvent` / `listEvents`) and a single
 * malformed row should not poison the entire list.
 */
export function normalizeSignature(raw: unknown): Signature | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Discriminator branch.
  if (obj.kind === 'png') {
    if (typeof obj.dataUrl !== 'string') return null;
    if (typeof obj.signedAt !== 'number' || !Number.isFinite(obj.signedAt)) {
      return null;
    }
    return { kind: 'png', dataUrl: obj.dataUrl, signedAt: obj.signedAt };
  }

  if (obj.kind === 'vector') {
    if (!Array.isArray(obj.strokes)) return null;
    const strokes = obj.strokes
      .map(coerceStroke)
      .filter((s): s is SignatureStroke => s !== null);
    const width =
      typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0
        ? obj.width
        : 600;
    const height =
      typeof obj.height === 'number' &&
      Number.isFinite(obj.height) &&
      obj.height > 0
        ? obj.height
        : 180;
    const signedAt =
      typeof obj.signedAt === 'number' && Number.isFinite(obj.signedAt)
        ? obj.signedAt
        : 0;
    if (signedAt === 0) return null;
    return { kind: 'vector', strokes, width, height, signedAt };
  }

  // Legacy shape — `{ dataUrl, signedAt }` with no discriminator.
  if (typeof obj.dataUrl === 'string' && typeof obj.signedAt === 'number') {
    return { kind: 'png', dataUrl: obj.dataUrl, signedAt: obj.signedAt };
  }

  return null;
}

function coerceStroke(raw: unknown): SignatureStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.points)) return null;
  const points: { x: number; y: number }[] = [];
  for (const p of obj.points) {
    if (!p || typeof p !== 'object') continue;
    const px = (p as { x?: unknown }).x;
    const py = (p as { y?: unknown }).y;
    if (
      typeof px === 'number' &&
      Number.isFinite(px) &&
      typeof py === 'number' &&
      Number.isFinite(py)
    ) {
      points.push({ x: px, y: py });
    }
  }
  if (points.length === 0) return null;
  const width =
    typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0
      ? obj.width
      : 2;
  return { points, width };
}

// ---------------------------------------------------------------------------
// DOCX-side rasterizer (Behavioral Rule #13)
// ---------------------------------------------------------------------------

/**
 * Convert a vector signature to a PNG `Uint8Array` for embedding in DOCX.
 *
 * ALWAYS renders BLACK ink on a WHITE background. The active UI theme is
 * irrelevant — Behavioral Rule #13 makes DOCX output light-theme by law.
 *
 * Throws `LibError(DOCX_IMAGE_EMBED)` if the WebView2 canvas API is
 * unavailable, the canvas refuses to produce a PNG dataURL, or base64
 * decoding fails. The caller (docx.ts) wraps the error with the document's
 * own context.
 */
export async function rasterizeStrokes(
  strokes: SignatureStroke[],
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new LibError('rasterizeStrokes: DOM canvas API unavailable', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new LibError('rasterizeStrokes: 2d context unavailable', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }

  // Behavioral Rule #13 — always light: white page, black ink.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.lineWidth = stroke.width > 0 ? stroke.width : 2;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    if (stroke.points.length === 1) {
      // Single dot — emit a tiny filled circle so it isn't invisible.
      ctx.fillStyle = '#000000';
      ctx.arc(stroke.points[0].x, stroke.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      continue;
    }
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (cause) {
    throw new LibError('rasterizeStrokes: canvas.toDataURL failed', {
      code: 'DOCX_IMAGE_EMBED',
      cause,
    });
  }
  return decodePngDataUrl(dataUrl);
}

/**
 * Convert a `data:image/png;base64,…` URL to raw PNG bytes. Mirrors the
 * decoder previously inlined inside `docx.ts` so both modules can share one
 * implementation.
 */
export function decodePngDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new LibError('signature dataUrl missing payload separator', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }
  const header = dataUrl.slice(0, comma);
  if (!/^data:image\/png(;[^,]*)?$/i.test(header)) {
    throw new LibError('signature dataUrl is not a PNG', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
