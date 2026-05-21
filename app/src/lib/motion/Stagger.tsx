/**
 * Stagger — wraps N siblings and reveals them with a per-child offset.
 *
 * Children are individually wrapped in motion.<as> elements; the parent
 * orchestrates the timing via Framer Motion variants. `cap` limits how
 * many children receive the staggered delay — useful for long lists
 * (e.g. ClientList with 60 clients) where a full cascade would feel slow.
 *
 * Reduced-motion → step collapses to 0 and all children appear together.
 *
 * Source: plan dreamy-mixing-pine.md §A.1 + §A.3 (entrance-stagger).
 */
import { Children, type ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

export type StaggerProps = {
  children: ReactNode;
  /** Base delay before the first child starts (seconds). */
  delay?: number;
  /** Per-child delta (seconds). Default 0.08. */
  step?: number;
  /** Max children that receive a unique delay. Children beyond `cap`
   *  share the cap-th delay so very long lists do not cascade for seconds. */
  cap?: number;
  /** Travel axis. Default 'y'. */
  axis?: 'y' | 'x';
  /** Wrapper tag. Default 'div'. */
  as?: 'div' | 'section' | 'ul' | 'ol';
  /** Wrapper className. */
  className?: string;
};

const SIGNATURE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const DISTANCE = 12;

export function Stagger({
  children,
  delay = 0,
  step = 0.08,
  cap,
  axis = 'y',
  as = 'div',
  className,
}: StaggerProps) {
  const reduced = useReducedMotion();
  const childArray = Children.toArray(children);
  const effectiveStep = reduced ? 0 : step;

  const Wrapper = motion[as] as React.ElementType;

  const childVariants: Variants = {
    hidden:
      axis === 'y'
        ? { opacity: 0, y: DISTANCE }
        : { opacity: 0, x: DISTANCE },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      x: 0,
      transition: {
        duration: reduced ? 0 : 0.42,
        ease: SIGNATURE_EASE,
        delay: delay + i * effectiveStep,
      },
    }),
  };

  return (
    <Wrapper className={className} initial="hidden" animate="visible">
      {childArray.map((child, i) => {
        const idx = cap !== undefined ? Math.min(i, cap - 1) : i;
        return (
          <motion.div key={i} custom={idx} variants={childVariants}>
            {child}
          </motion.div>
        );
      })}
    </Wrapper>
  );
}
