/**
 * useEntrance — shared entrance-animation hook.
 *
 * Returns Framer Motion props that fade-up an element on mount, using the
 * weblove "signature" ease curve. Honors `useReducedMotion()` — when the
 * user has prefers-reduced-motion set, the returned props collapse to an
 * instant render (duration 0, no transform).
 *
 * Source: plan dreamy-mixing-pine.md §A.1 + §A.3 (entrance-fade-up).
 */
import { useReducedMotion } from 'framer-motion';

export type EntranceOpts = {
  /** Delay before the entrance starts, in seconds. */
  delay?: number;
  /** Travel distance in px. Default 12. */
  distance?: number;
  /** Axis to translate along. Default 'y'. */
  axis?: 'y' | 'x';
};

export type EntranceState = {
  initial: { opacity: number; y?: number; x?: number };
  animate: { opacity: number; y: number; x: number } | { opacity: number };
  transition: { duration: number; ease: [number, number, number, number]; delay?: number };
};

const SIGNATURE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function useEntrance(opts: EntranceOpts = {}): EntranceState {
  const reduced = useReducedMotion();
  const distance = opts.distance ?? 12;
  const axis = opts.axis ?? 'y';

  if (reduced) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      transition: { duration: 0, ease: SIGNATURE_EASE, delay: 0 },
    };
  }

  const initial =
    axis === 'y'
      ? { opacity: 0, y: distance }
      : { opacity: 0, x: distance };
  const animate = { opacity: 1, y: 0, x: 0 };

  return {
    initial,
    animate,
    transition: {
      duration: 0.42,
      ease: SIGNATURE_EASE,
      delay: opts.delay ?? 0,
    },
  };
}
