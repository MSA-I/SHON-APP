// SOP: architecture/09-design-tokens.md — Luxury Editorial palette
// (ink-raised surface, cream text, gold-dark accents, sharp corners,
// no shadows, motion timings via --motion-modal / --motion-quick).
// SOP: architecture/15-component-architecture.md § ui/ — generic primitive,
// no domain knowledge of clients/events. Driven entirely by props.
//
// Toast — single transient notification. Three variants: info / success /
// error. RTL-aware (uses inline-end / inline-start). Click anywhere on the
// pill to dismiss. Auto-dismisses after `durationMs` (default 4000ms) unless
// `prefers-reduced-motion` is set, in which case the pill renders without
// entrance/exit animation but still auto-dismisses on the same timer.
//
// The provider in `contexts/ToastContext.tsx` is responsible for queueing,
// id assignment, and timer ownership. This file is presentation only.

import { motion, useReducedMotion } from 'framer-motion';
import type { MouseEvent } from 'react';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type ToastKind = 'info' | 'success' | 'error';

export type ToastProps = {
  /** Stable id — used for AnimatePresence keying by the provider. */
  id: number;
  /** Hebrew message. */
  message: string;
  /** Visual + a11y variant. */
  kind: ToastKind;
  /** Click-to-dismiss handler. The provider clears its timer in here. */
  onDismiss: (id: number) => void;
  /** Optional `data-testid` override — defaults to `toast-<kind>`. */
  testId?: string;
};

// ---------------------------------------------------------------------------
// Visual recipe per kind
// ---------------------------------------------------------------------------

/**
 * Border + accent color per variant. Gold-dark for info/success keeps the
 * editorial palette; a warm muted red for error per Settings.tsx precedent
 * (`#C46B6B`). No background fills, no gradients — depth is from the
 * --ink-raised step (SOP 09 § 4).
 */
const KIND_STYLES: Record<ToastKind, { borderColor: string; accent: string }> = {
  info: {
    borderColor: 'var(--border-subtle, #2A2520)',
    accent: 'var(--gold-dark, #A88B47)',
  },
  success: {
    borderColor: 'var(--gold, #C9A961)',
    accent: 'var(--gold, #C9A961)',
  },
  error: {
    borderColor: '#C46B6B',
    accent: '#C46B6B',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Toast({ id, message, kind, onDismiss, testId }: ToastProps) {
  const reduce = useReducedMotion();
  const styles = KIND_STYLES[kind];

  // a11y: errors are assertive (interrupt the SR), info/success are polite.
  const role = kind === 'error' ? 'alert' : 'status';
  const ariaLive = kind === 'error' ? 'assertive' : 'polite';

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    onDismiss(id);
  };

  return (
    <motion.div
      key={id}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      data-testid={testId ?? `toast-${kind}`}
      data-toast-kind={kind}
      initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.26, ease: [0.16, 1, 0.3, 1] }
      }
      className="pointer-events-auto"
    >
      <button
        type="button"
        onClick={handleClick}
        // Click-to-dismiss is the entire surface. We use a <button> so it's
        // keyboard-reachable and announces "press to dismiss" to AT users.
        aria-label={`${message} — לחץ להסגירה`}
        className="
          group inline-flex items-center gap-3
          bg-ink-raised
          border
          px-6 py-3
          text-small text-cream
          font-sans
          max-w-2xl text-start
          transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold
          focus-visible:ring-offset-2 focus-visible:ring-offset-ink
        "
        style={{ borderColor: styles.borderColor, borderRadius: 2 }}
      >
        <span
          aria-hidden="true"
          className="font-serif text-h3 leading-none"
          style={{ color: styles.accent }}
        >
          ❖
        </span>
        <span className="flex-1">{message}</span>
      </button>
    </motion.div>
  );
}

export default Toast;
