// SOP: architecture/06-signature-flow.md (Self-Annealing 2026-05-21)
// Schema: claude.md § Data Schemas (Signature) — Maintenance Log 2026-05-21
//
// Signature pad — wraps `react-signature-canvas` with the Luxury Editorial
// design language. Used inline on the Summary tab (per SOP 06 § Capture
// Pipeline — no modal). The component is **uncontrolled during drawing**:
// strokes live inside the canvas until "אישור וחתימה" reads them out via
// `toData()` (vector) and bubbles them up through `onConfirm` as the new
// dual-shape `Signature` value.
//
// On display:
//   • `kind: 'png'`    → renders the dataUrl in <img> (legacy data path).
//   • `kind: 'vector'` → renders an inline <svg> with stroke="currentColor"
//                        so the ink follows the active UI theme. This is the
//                        fix for the user complaint "החתימה צריכה להיות
//                        נראית לעין כשהתפריט עובר ממצב כהה לבהיר".
//
// Imports rule (SOP 15 §7 "Layer 2 imports"): only `react`,
// `react-signature-canvas`, project `types`, and sibling files under
// `../ui/*` are allowed. No lib/, no Tauri, no idb. Confirmed.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CanvasHTMLAttributes,
  type CSSProperties,
} from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { motion, useReducedMotion } from 'framer-motion';

import type { Signature, SignatureStroke } from '../../types';

// ─── Public surface ──────────────────────────────────────────────────────────

export type SignaturePadProps = {
  /**
   * Present iff editing an existing signature; renders the read-only view.
   * Dual-shape — PNG for legacy data, vector for new captures. The pad
   * decides how to render based on `initialSignature.kind`.
   */
  initialSignature?: Signature | null;
  /**
   * Fired on "אישור וחתימה" with the captured `Signature`. New captures emit
   * `kind: 'vector'`; the pad never produces a PNG itself anymore (legacy
   * data flows through `initialSignature` for read-only display only).
   */
  onConfirm: (signature: Signature) => void;
  /** Optional escape hatch — e.g. for an inline "skip" link upstream. */
  onCancel?: () => void;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 180;

/** Fallback stroke width when `react-signature-canvas` does not surface one. */
const DEFAULT_STROKE_WIDTH = 2;

const HEBREW_MONTHS = [
  'בינואר',
  'בפברואר',
  'במרץ',
  'באפריל',
  'במאי',
  'ביוני',
  'ביולי',
  'באוגוסט',
  'בספטמבר',
  'באוקטובר',
  'בנובמבר',
  'בדצמבר',
] as const;

function formatHebrewLongDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${HEBREW_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SignaturePad({
  initialSignature,
  onConfirm,
  onCancel,
}: SignaturePadProps) {
  const padRef = useRef<SignatureCanvas | null>(null);

  /**
   * Read-only mode is sticky to whether a signature was supplied at mount.
   * Once the user clicks "עריכה" we drop into the canvas-editing state.
   */
  const [editing, setEditing] = useState<boolean>(!initialSignature);
  const [hasStroke, setHasStroke] = useState<boolean>(false);
  // Phase WOW: confirmation-pulse latch — flips true for ~520ms after
  // handleConfirm fires. Reduced-motion → no scale animation observed,
  // but the toast (owned by SummaryTab) still surfaces success.
  const [pulsing, setPulsing] = useState<boolean>(false);
  const reduce = useReducedMotion();

  const todayStamp = useMemo(() => formatHebrewLongDate(Date.now()), []);

  useEffect(() => {
    if (editing) setHasStroke(false);
  }, [editing]);

  const handleEnd = useCallback(() => {
    const pad = padRef.current;
    if (pad && !pad.isEmpty()) setHasStroke(true);
  }, []);

  const handleClear = useCallback(() => {
    padRef.current?.clear();
    setHasStroke(false);
  }, []);

  const handleConfirm = useCallback(() => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;

    // SOP 06 §4 — capture timestamp at the same instant as the strokes.
    // `toData()` is the source of truth for the new vector shape; we never
    // emit a PNG from the pad anymore (the docx exporter rasterizes at
    // export time per Behavioral Rule #13, and the on-screen render uses
    // currentColor).
    //
    // The @types/signature_pad d.ts types `toData()` as `Point[][]`, but the
    // actual signature_pad runtime returns `{ color, points: Point[] }[]`.
    // We coerce defensively via `unknown` and accept either shape.
    const rawData = (pad.toData() as unknown) as unknown[];
    const strokes: SignatureStroke[] = rawData
      .map((entry): SignatureStroke | null => {
        if (!entry) return null;
        // Shape A (modern): { points: Point[], minWidth?, maxWidth?, ... }
        const e = entry as { points?: unknown };
        if (Array.isArray(e.points)) {
          const points = (e.points as unknown[])
            .map((p) => {
              if (!p || typeof p !== 'object') return null;
              const px = (p as { x?: unknown }).x;
              const py = (p as { y?: unknown }).y;
              if (typeof px === 'number' && typeof py === 'number') {
                return { x: px, y: py };
              }
              return null;
            })
            .filter((v): v is { x: number; y: number } => v !== null);
          if (points.length === 0) return null;
          return { points, width: DEFAULT_STROKE_WIDTH };
        }
        // Shape B (legacy d.ts type): Point[] directly.
        if (Array.isArray(entry)) {
          const points = (entry as unknown[])
            .map((p) => {
              if (!p || typeof p !== 'object') return null;
              const px = (p as { x?: unknown }).x;
              const py = (p as { y?: unknown }).y;
              if (typeof px === 'number' && typeof py === 'number') {
                return { x: px, y: py };
              }
              return null;
            })
            .filter((v): v is { x: number; y: number } => v !== null);
          if (points.length === 0) return null;
          return { points, width: DEFAULT_STROKE_WIDTH };
        }
        return null;
      })
      .filter((s): s is SignatureStroke => s !== null);

    if (strokes.length === 0) {
      // Defensive — pad reported non-empty but we couldn't extract any
      // strokes. Don't emit a malformed signature.
      return;
    }

    // Trigger the confirmation pulse before bubbling up — the parent will
    // unmount the editing UI shortly after, but a 520ms one-shot still
    // completes inside the brief window the button stays mounted.
    setPulsing(true);
    window.setTimeout(() => setPulsing(false), 520);

    onConfirm({
      kind: 'vector',
      strokes,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      signedAt: Date.now(),
    });
  }, [onConfirm]);

  const handleEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const canvasFrameStyle: CSSProperties = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    borderBottom: '1px solid var(--color-gold, #C9A961)',
    background: 'var(--color-ink, #0F0E0C)',
    cursor: 'crosshair',
    position: 'relative',
  };

  return (
    <section
      data-testid="signature-pad"
      dir="rtl"
      className="flex flex-col items-center w-full"
    >
      <h2 className="font-serif text-h3 text-cream mb-6">חתימת הזוג</h2>

      <div className="sr-only" aria-live="polite">
        {!editing && initialSignature ? 'חתימה נשמרה' : ''}
      </div>

      {editing ? (
        <div style={canvasFrameStyle}>
          <SignatureCanvas
            ref={(instance) => {
              padRef.current = instance;
            }}
            penColor="#F5F0E8" /* --color-cream — visible while drawing */
            backgroundColor="rgba(0,0,0,0)"
            canvasProps={
              {
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                'data-testid': 'signature-pad-canvas',
                'aria-label': 'אזור חתימה',
                style: {
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  display: 'block',
                },
              } as CanvasHTMLAttributes<HTMLCanvasElement>
            }
            onEnd={handleEnd}
            clearOnResize={false}
          />
        </div>
      ) : (
        <div style={canvasFrameStyle}>
          <SignatureView signature={initialSignature ?? null} />
          <span
            aria-hidden="true"
            className="font-serif text-gold absolute top-2 select-none"
            style={{ insetInlineStart: '0.5rem', fontSize: '1rem', lineHeight: 1 }}
          >
            ❖
          </span>
        </div>
      )}

      <div
        className="flex items-center justify-between w-full mt-6"
        style={{ maxWidth: CANVAS_WIDTH }}
      >
        {editing ? (
          <button
            type="button"
            onClick={handleClear}
            data-testid="signature-pad-clear"
            className="
              text-label uppercase text-cream-muted
              hover:text-cream
              transition-colors duration-150
              border-b border-transparent hover:border-cream
              pb-1
            "
          >
            ניקוי
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEdit}
            data-testid="signature-pad-edit"
            className="
              text-label uppercase text-cream-muted
              hover:text-cream
              transition-colors duration-150
              border-b border-transparent hover:border-cream
              pb-1
            "
          >
            עריכה
          </button>
        )}

        <div className="flex items-center gap-6">
          <span
            className="text-small font-tabular text-cream-muted"
            data-testid="signature-pad-date"
            dir="ltr"
          >
            {todayStamp}
          </span>

          {editing ? (
            <motion.button
              type="button"
              onClick={handleConfirm}
              disabled={!hasStroke}
              data-testid="signature-pad-confirm"
              // Confirmation-pulse: 520ms one-shot scale 1 → 1.04 → 1 with
              // a subtle ring expansion via box-shadow (zero-blur, so
              // SOP 09 §4 compliant — same hairline-ring rule as Button).
              // Designer-Reviewer P0: button is bg-gold, so a gold ring
              // disappears against it. Use cream ink for the pulse so the
              // ceremony is actually visible to the couple.
              animate={
                pulsing && !reduce
                  ? {
                      scale: [1, 1.04, 1],
                      // Reviewer: keep the ring strictly within the
                      // hairline-ring contract (1px spread, zero blur).
                      // 2px read as a thicker ring; 1px is the same shape
                      // the user explicitly ratified for Button.tsx.
                      boxShadow: [
                        '0 0 0 0px var(--cream)',
                        '0 0 0 1px var(--cream)',
                        '0 0 0 0px var(--cream)',
                      ],
                    }
                  : { scale: 1, boxShadow: '0 0 0 0px var(--cream)' }
              }
              transition={{ duration: 0.52, ease: [0.34, 1.32, 0.64, 1] }}
              className="
                px-6 py-2
                text-label uppercase
                bg-gold text-ink
                border border-gold
                hover:bg-gold-dark hover:border-gold-dark
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gold disabled:hover:border-gold
                transition-colors duration-150
              "
            >
              אישור וחתימה
            </motion.button>
          ) : onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              data-testid="signature-pad-cancel"
              className="
                text-label uppercase text-cream-muted
                hover:text-cream
                transition-colors duration-150
                border-b border-transparent hover:border-cream
                pb-1
              "
            >
              ביטול
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─── Read-only signature view (theme-reactive ink) ───────────────────────────

/**
 * Render a saved `Signature` in read-only mode:
 *
 *  • PNG (legacy): `<img src={dataUrl}>` exactly as the previous component
 *    did. Cream ink baked into the PNG; visible against the dark canvas
 *    frame, less so against light. Old data is left as-is per the
 *    "don't touch old data" rule.
 *
 *  • Vector: inline `<svg>` with `stroke="currentColor"`. The wrapper sets
 *    color to `var(--color-cream)` which the Tailwind v4 light-theme
 *    invert flips appropriately, so the ink stays legible in both themes.
 */
function SignatureView({ signature }: { signature: Signature | null }) {
  if (!signature) {
    return (
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-cream-muted text-small"
      >
        —
      </span>
    );
  }
  if (signature.kind === 'png') {
    return (
      <img
        src={signature.dataUrl}
        alt="חתימת הזוג"
        data-testid="signature-pad-image"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          display: 'block',
          objectFit: 'contain',
        }}
      />
    );
  }
  // kind === 'vector' — re-render strokes in SVG, inheriting color from the
  // theme via `currentColor`.
  const pathD = strokesToSvgPath(signature.strokes);
  return (
    <svg
      data-testid="signature-pad-svg"
      role="img"
      aria-label="חתימת הזוג"
      viewBox={`0 0 ${signature.width} ${signature.height}`}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{
        display: 'block',
        // `text-cream` resolves to a CSS variable that the light-theme
        // override flips to dark ink. Either way, `currentColor` follows.
        color: 'var(--color-cream, #F5F0E8)',
      }}
      className="text-cream"
    >
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function strokesToSvgPath(strokes: SignatureStroke[]): string {
  const parts: string[] = [];
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const [first, ...rest] = s.points;
    parts.push(`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);
    for (const p of rest) {
      parts.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
    }
  }
  return parts.join(' ');
}
