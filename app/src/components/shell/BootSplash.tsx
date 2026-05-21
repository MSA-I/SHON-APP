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
      {/* ── ❖ ornament — cinematic overture ───────────────────────────────
          Designer-Reviewer P0 (BootSplash #1): infinite linear rotation
          read as a utility loading-spinner. We now do ONE full rotation
          on signature ease (2.4s) — overture-feel — then settle into a
          slow opacity pulse if the boot is still pending. Reduced-motion
          → static glyph at full opacity. */}
      <motion.span
        aria-hidden="true"
        className="font-serif text-gold select-none"
        style={{ fontSize: "48px", lineHeight: 1 }}
        initial={prefersReducedMotion ? false : { rotate: 0, opacity: 0.6 }}
        animate={
          prefersReducedMotion
            ? { rotate: 0, opacity: 1 }
            : { rotate: 360, opacity: [0.6, 1, 0.92, 1] }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : {
                rotate: { duration: 2.4, ease: [0.22, 1, 0.36, 1], times: undefined },
                opacity: { duration: 2.4, ease: [0.22, 1, 0.36, 1] },
              }
        }
      >
        ❖
      </motion.span>

      {/* ── Brand wordmark ──────────────────────────────────────────────────
          Phase WOW: stagger each Hebrew code-point so the wordmark "writes
          itself" after the rotating ornament. Total budget = 7 chars × 60ms
          ≈ 420ms (≤ 480ms target per plan §B.7). `Array.from` is code-point
          safe — important for Hebrew so combining marks aren't split.
          Reduced-motion → all letters appear at once with delay 0. */}
      <h1
        className="font-serif text-cream mt-8 flex"
        style={{ fontSize: "32px", fontWeight: 500, lineHeight: 1.15 }}
        aria-label="שון בלאיש"
      >
        {Array.from("שון בלאיש").map((ch, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.32,
              ease: [0.22, 1, 0.36, 1],
              delay: prefersReducedMotion ? 0 : 0.18 + i * 0.06,
            }}
            // Whitespace must stay whitespace — `&nbsp;` keeps inline-flex
            // layout from collapsing the natural space.
            style={{ whiteSpace: "pre" }}
          >
            {ch === " " ? "\u00A0" : ch}
          </motion.span>
        ))}
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
