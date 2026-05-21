/**
 * BootSplash — full-screen loading surface shown while the boot effect runs.
 *
 * Per SOP 13 §3 the splash MUST be visible for at least 80ms even if the boot
 * effect resolves faster, to prevent a sub-frame flash on cold boot. The
 * timing is the caller's responsibility (App.tsx's `Promise.all([initBoot(),
 * wait(80)])`); this component just renders the visual.
 *
 * Visual brief:
 *  - Full-bleed `bg-ink`, no AppBar, no chrome.
 *  - Centered ❖ ornament rotating slowly (6s linear infinite).
 *  - "שון בלאיש" wordmark in Frank Ruhl Libre 32px below the ornament.
 *  - Subtle phase label below in `text-cream-muted`, tiny uppercase letterspacing.
 *  - Reduced-motion: ornament is static (no rotation) per SOP 13 §8 + SOP 09 §5.
 *
 * Test-id: `boot-splash` (root).
 */

import { motion, useReducedMotion } from "framer-motion";

export type BootPhase = "opening-db" | "reading-meta" | "ready";

export type BootSplashProps = {
  /** Optional phase label rendered below the wordmark. */
  phase?: BootPhase;
};

// ─── Phase label dictionary (Hebrew, inline per SOP 15 §4) ────────────────────

const PHASE_LABEL: Record<BootPhase, string> = {
  "opening-db": "טוען מסד נתונים",
  "reading-meta": "מאתר העדפות",
  ready: "מוכן",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BootSplash({ phase }: BootSplashProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      data-testid="boot-splash"
      className="
        fixed inset-0 z-50
        flex flex-col items-center justify-center
        bg-ink text-cream
      "
    >
      {/* ── Rotating ❖ ornament ───────────────────────────────────────────── */}
      <motion.span
        aria-hidden="true"
        className="font-serif text-gold select-none"
        style={{ fontSize: "48px", lineHeight: 1 }}
        animate={prefersReducedMotion ? undefined : { rotate: 360 }}
        transition={
          prefersReducedMotion
            ? undefined
            : { duration: 6, ease: "linear", repeat: Infinity }
        }
      >
        ❖
      </motion.span>

      {/* ── Brand wordmark ────────────────────────────────────────────────── */}
      <h1
        className="font-serif text-cream mt-8"
        style={{ fontSize: "32px", fontWeight: 500, lineHeight: 1.15 }}
      >
        שון בלאיש
      </h1>

      {/* ── Phase label ───────────────────────────────────────────────────── */}
      {phase && (
        <p
          className="font-sans text-cream-muted mt-6"
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {PHASE_LABEL[phase]}
        </p>
      )}
    </div>
  );
}
