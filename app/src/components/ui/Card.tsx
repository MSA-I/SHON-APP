/**
 * Card — flat, sharp, padding-driven surface.
 *
 * SOP 09 §4 (no shadows, 0px radius, depth via spacing + hairline).
 * SOP 09 §9.6 (canonical Do/Don't gallery).
 * SOP 16 § Components / Cards.
 *
 * Geometry:
 *  - 1px hairline border (var(--border-subtle)).
 *  - 0px corner radius.
 *  - 24px padding (default) / 32px when `raised` is true to mirror the
 *    stitch form-container treatment (`p-8 bg-surface-container-low`).
 *  - no shadow, no gradient, no rounded corners.
 *
 * Variants:
 *  - default (raised=false): transparent fill, hairline border. Inherits
 *    page canvas. Used for client cards, tagging review tiles, etc.
 *  - raised (raised=true):  --surface-low fill, hairline border, 32px
 *    padding. Matches the stitch "form container" treatment used inside
 *    Event tabs and the Settings panel.
 *
 * Behavior:
 *  - hover (opt-in): 200ms transition; on hover border becomes gold + scale(1.02).
 *  - onClick (opt-in): cursor: pointer, role="button", focus-visible ring,
 *    keyboard activation (Enter / Space).
 *
 * Layer 2 only.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { type KeyboardEvent, type ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  hover?: boolean;
  /** When true, paints a `--surface-low` fill and 32px padding to match
      the stitch raised-form-container treatment. Default false (flat). */
  raised?: boolean;
  testId?: string;
  onClick?: () => void;
}

export function Card({
  children,
  hover = false,
  raised = false,
  testId,
  onClick,
}: CardProps) {
  const reduce = useReducedMotion();
  const isInteractive = typeof onClick === 'function';

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  // Per SOP 09 §3 flat cards have 24px (p-6) padding; raised cards bump
  // to 32px (p-8) to give the inner form room to breathe per the stitch
  // event_tabs_dark mockup. Brief explicitly requests 24px / 32px —
  // single source of truth.
  return (
    <motion.div
      data-testid={testId}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isInteractive ? handleKey : undefined}
      whileHover={hover && !reduce ? { scale: 1.02 } : undefined}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={[
        raised ? 'bg-surface-low' : 'bg-transparent',
        'border border-solid border-border-subtle',
        'rounded-none',
        raised ? 'p-8' : 'p-6',
        hover ? 'hover:border-gold' : '',
        hover ? 'transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]' : '',
        isInteractive ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      {children}
    </motion.div>
  );
}
