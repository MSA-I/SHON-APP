/**
 * Button — Luxury Editorial primitive.
 *
 * SOP 09 §9.3 (hover behavior — gold underline grow + text color shift).
 * SOP 16 § Components (primary buttons: gold border, cream text, sharp corners).
 * SOP 15 § Test-ID convention (data-testid passthrough).
 *
 * Variants:
 *  - primary:  1px gold border, cream text, transparent background, sharp 0px
 *              corners, padding 12px 24px, sans (Heebo). Hover: border ->
 *              gold-dark + scale(1.02). Active: scale(0.98).
 *  - tertiary: plain text, gold-dark color. Hover: gold underline width grows
 *              0% -> 100% over 150ms.
 *
 * Disabled: 50% opacity, hover/active suppressed.
 * Focus-visible: 2px gold outline + 2px offset (delegated to global :focus-visible
 *                in styles/index.css §base).
 *
 * Layer 2 only — no @tauri-apps, no idb. Pure visual primitive.
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'tertiary';

export interface ButtonProps {
  variant?: ButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  testId?: string;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  children,
  onClick,
  disabled = false,
  type = 'button',
  testId,
  icon,
}: ButtonProps) {
  const reduce = useReducedMotion();

  if (variant === 'tertiary') {
    return (
      <motion.button
        type={type}
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        initial="rest"
        animate="rest"
        whileHover={disabled ? undefined : 'hover'}
        className={[
          'relative inline-flex items-center gap-2',
          'font-sans text-body text-gold-dark',
          'bg-transparent border-0 px-1 py-1',
          'cursor-pointer select-none',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        {icon ? <span className="inline-flex items-center">{icon}</span> : null}
        <span>{children}</span>
        {/* Underline: width 0 -> 100% over 150ms (SOP 09 §5 motion-quick). */}
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px bg-gold"
          variants={{
            rest: { scaleX: 0 },
            hover: { scaleX: reduce ? 0 : 1 },
          }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          style={{ transformOrigin: 'inset-inline-start' }}
        />
      </motion.button>
    );
  }

  // primary
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      whileHover={disabled || reduce ? undefined : { scale: 1.02 }}
      whileTap={disabled || reduce ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      className={[
        'inline-flex items-center justify-center gap-2',
        'font-sans text-body text-cream',
        'bg-transparent border border-gold hover:border-gold-dark',
        'rounded-none', // 0px corners — SOP 09 §4 + SOP 16 § Shapes
        'px-6 py-3', // 24px / 12px per brief
        'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        'cursor-pointer select-none',
        disabled
          ? 'opacity-50 cursor-not-allowed pointer-events-none'
          : '',
      ].join(' ')}
    >
      {icon ? <span className="inline-flex items-center">{icon}</span> : null}
      <span>{children}</span>
    </motion.button>
  );
}
