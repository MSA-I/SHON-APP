/**
 * Ornament — the project's signature ❖ (U+2756).
 *
 * SOP 09 §6 (the ornament has exactly three canonical contexts):
 *   - section divider (centered, h2 size, gold)
 *   - DOCX upgrade-list bullet (out of scope here — DOCX-only)
 *   - signature flourish (corner, gold-dark, h3-size)
 *
 * This component covers (a) and (c). Always rendered in `var(--gold)`.
 *
 * Sizes: small=16px, medium=20px, large=28px (matches text-h3 baseline /
 * h2 baseline per SOP 09 §6).
 */

import type { CSSProperties } from 'react';

export type OrnamentSize = 'small' | 'medium' | 'large';
export type OrnamentVariant = 'divider' | 'corner';

export interface OrnamentProps {
  size?: OrnamentSize;
  variant?: OrnamentVariant;
}

const SIZE_PX: Record<OrnamentSize, string> = {
  small: '16px',
  medium: '20px',
  large: '28px',
};

export function Ornament({ size = 'medium', variant = 'divider' }: OrnamentProps) {
  const fontSize = SIZE_PX[size];

  if (variant === 'corner') {
    // Parent must be position: relative (caller's responsibility — documented
    // in the SOP and the prop comment in the type above).
    const style: CSSProperties = {
      position: 'absolute',
      top: '16px',
      insetInlineEnd: '16px',
      color: 'var(--gold)',
      fontSize,
      lineHeight: 1,
      pointerEvents: 'none',
      userSelect: 'none',
    };
    return (
      <span aria-hidden="true" style={style}>
        ❖
      </span>
    );
  }

  // divider — centered with 48px (space-12) vertical breathing room
  return (
    <div
      className="flex items-center justify-center my-12"
      aria-hidden="true"
    >
      <span
        className="text-gold leading-none select-none"
        style={{ fontSize }}
      >
        ❖
      </span>
    </div>
  );
}
