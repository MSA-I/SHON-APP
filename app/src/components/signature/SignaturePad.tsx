// SOP: architecture/06-signature-flow.md
// Mockup: .tmp/stitch-mockups/stitch_shon_blaish_luxury_planner/signature_dark/screen.png
//
// Signature pad — wraps `react-signature-canvas` with the Luxury Editorial
// design language. Used inline on the Summary tab (per SOP 06 § Capture
// Pipeline — no modal). The component is **uncontrolled during drawing**:
// strokes live inside the canvas until "אישור וחתימה" reads them out via
// `toDataURL('image/png')` and bubbles them up through `onConfirm`.
//
// `onConfirm(dataUrl, signedAt)` deviates from the SOP's `(dataUrl)` signature
// by also yielding `signedAt = Date.now()` — the calling SummaryTab needs both
// fields atomically to write `event.signature = { dataUrl, signedAt }` and
// flip status to `'signed'`. SOP 06 Self-Annealing Notes will be updated when
// the Summary tab lands; the spec's invariant (`signed ⇒ signature !== null`)
// is preserved either way.
//
// Imports rule (SOP 15 §7 "Layer 2 imports"): only `react`,
// `react-signature-canvas`, and sibling files under `../ui/*` are allowed.
// No lib/, no Tauri, no idb. Confirmed.

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

// ─── Public surface ──────────────────────────────────────────────────────────

export type SignaturePadProps = {
  /** Present iff editing an existing signature; renders the read-only view. */
  initialDataUrl?: string;
  /** Fired on "אישור וחתימה". `signedAt = Date.now()` at click time. */
  onConfirm: (dataUrl: string, signedAt: number) => void;
  /** Optional escape hatch — e.g. for an inline "skip" link upstream. */
  onCancel?: () => void;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 180;

/**
 * Hebrew month names in declarative form (used after a number, e.g. "20 במאי").
 * Source: standard Hebrew calendar Gregorian month names. Inlined per SOP 15
 * §3 "no i18n layer".
 */
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
  initialDataUrl,
  onConfirm,
  onCancel,
}: SignaturePadProps) {
  const padRef = useRef<SignatureCanvas | null>(null);

  /**
   * Read-only mode is sticky to whether `initialDataUrl` *was ever supplied*.
   * Once the user clicks "עריכה" we drop into the canvas-editing state and
   * stay there until the next confirm — at which point the parent will pass
   * a new `initialDataUrl` (or omit it).
   *
   * `editing` is initialized from props, then user-controlled. We do NOT
   * re-derive it on every render, otherwise an upstream re-render after
   * confirm would yo-yo the user back into read-only mid-flow.
   */
  const [editing, setEditing] = useState<boolean>(!initialDataUrl);

  /** Disables Confirm until the user has put at least one stroke down. */
  const [hasStroke, setHasStroke] = useState<boolean>(false);

  /** Live date stamp — recomputed each mount; tabular-numeric in the UI. */
  const todayStamp = useMemo(() => formatHebrewLongDate(Date.now()), []);

  // SOP 06 Failure Modes: reset stroke flag whenever we re-enter editing mode
  // (e.g. user clicks "עריכה" on a previously confirmed signature).
  useEffect(() => {
    if (editing) {
      setHasStroke(false);
    }
  }, [editing]);

  const handleEnd = useCallback(() => {
    const pad = padRef.current;
    if (pad && !pad.isEmpty()) {
      setHasStroke(true);
    }
  }, []);

  const handleClear = useCallback(() => {
    padRef.current?.clear();
    setHasStroke(false);
  }, []);

  const handleConfirm = useCallback(() => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      // Defensive — the button is disabled in this state, but a keyboard
      // activation race could theoretically slip through.
      return;
    }
    // SOP 06 §4 — read PNG via toDataURL, capture timestamp at the same
    // instant. We pass both up so the parent's IndexedDB write is atomic.
    const dataUrl = pad.toDataURL('image/png');
    onConfirm(dataUrl, Date.now());
  }, [onConfirm]);

  const handleEdit = useCallback(() => {
    setEditing(true);
  }, []);

  // ─── Inline styles for the canvas frame ───────────────────────────────────
  //
  // The canvas needs a fixed pixel size (the underlying drawing buffer is
  // sized in CSS pixels) and a 1px gold underline per the mockup. We keep
  // the wrapper as a Tailwind-utility surface for theme reactivity, and use
  // inline styles only for the dimensions and the hairline.

  const canvasFrameStyle: CSSProperties = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    borderBottom: '1px solid var(--color-gold, #C9A961)',
    background: 'var(--color-ink, #0F0E0C)',
    cursor: 'crosshair',
    position: 'relative',
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      data-testid="signature-pad"
      dir="rtl"
      className="flex flex-col items-center w-full"
    >
      {/* Small label above the canvas — mirrors mockup "חתימת הזוג". */}
      <h2 className="font-serif text-h3 text-cream mb-6">חתימת הזוג</h2>

      {/* aria-live region for the post-confirm success announcement
          (SOP 06 § Accessibility). Empty until a confirm round-trips back
          into read-only mode. */}
      <div className="sr-only" aria-live="polite">
        {!editing && initialDataUrl ? 'חתימה נשמרה' : ''}
      </div>

      {editing ? (
        // ─── Drawing mode ────────────────────────────────────────────────
        <div style={canvasFrameStyle}>
          <SignatureCanvas
            ref={(instance) => {
              padRef.current = instance;
            }}
            penColor="#F5F0E8" /* --color-cream */
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
        // ─── Read-only mode (initialDataUrl supplied) ───────────────────
        <div style={canvasFrameStyle}>
          <img
            src={initialDataUrl}
            alt="חתימת הזוג"
            data-testid="signature-pad-image"
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              display: 'block',
              objectFit: 'contain',
            }}
          />
          {/* Diamond corner marker — mockup detail; sits in the
              inline-start corner under RTL flow. */}
          <span
            aria-hidden="true"
            className="font-serif text-gold absolute top-2 select-none"
            style={{ insetInlineStart: '0.5rem', fontSize: '1rem', lineHeight: 1 }}
          >
            ❖
          </span>
        </div>
      )}

      {/* ─── Action row ────────────────────────────────────────────────────
          Layout per mockup:
            inline-start: "ניקוי" / "עריכה" tertiary
            inline-end:   date stamp + "אישור וחתימה" primary
          Width matches the canvas above. */}
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
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!hasStroke}
              data-testid="signature-pad-confirm"
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
            </button>
          ) : onCancel ? (
            // In read-only mode we expose the optional cancel as a tertiary
            // — it's not in the mockup, but the prop contract permits it
            // and we shouldn't silently swallow a supplied callback.
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
