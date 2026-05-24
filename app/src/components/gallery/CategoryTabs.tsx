// SOP: architecture/05-gallery-selection.md § Filtering Rules — 8 fixed
// categories surfaced as chips. Active is single-select.
// SOP: architecture/09-design-tokens.md § 9.2 / § 4 — gold for accents and
// 1px hairline borders; sharp corners; uppercase tracking on labels.
//
// Helper subcomponent for the category strip rendered along the top of the
// gallery, below the sub-tabs. Each chip shows the Hebrew category name and
// a count badge, and inverts to gold-on-ink when active.

import { motion } from 'framer-motion';
import {
  IMAGE_CATEGORIES,
  type ImageCategory,
} from '../../types';

export type CategoryTabsProps = {
  /** Currently active category. Single-select. */
  active: ImageCategory;
  /** Called when the user picks a different category. */
  onChange: (c: ImageCategory) => void;
  /** Per-category total count (already filtered to the active media kind). */
  counts: Record<ImageCategory, number>;
};

/**
 * Horizontal chip strip — 8 fixed categories. Scrolls horizontally if the
 * viewport is narrow; the parent gallery clips overflow. Renders RTL via
 * inheritance from the gallery container.
 */
export function CategoryTabs({
  active,
  onChange,
  counts,
}: CategoryTabsProps) {
  return (
    <nav
      data-testid="gallery-category-tabs"
      className="flex shrink-0 items-center gap-4 overflow-x-auto overscroll-x-contain border-b border-border-subtle/50 py-8 px-16 scroll-px-16"
      style={{ scrollbarWidth: 'none' }}
      aria-label="קטגוריות"
    >
      {IMAGE_CATEGORIES.map((category) => {
        const isActive = category === active;
        const count = counts[category] ?? 0;
        return (
          <motion.button
            key={category}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(category)}
            data-testid={`category-chip-${category}`}
            whileHover={{ y: -1 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className={[
              'shrink-0 px-6 py-2 font-sans text-label uppercase tracking-[0.12em]',
              'border transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
              isActive
                ? 'border-gold text-gold'
                : 'border-border-subtle text-cream-muted hover:border-cream hover:text-cream',
            ].join(' ')}
            style={{ borderRadius: 0 }}
          >
            <span>{category}</span>
            <span
              className={[
                'ms-2 font-tabular text-tiny',
                isActive ? 'text-gold' : 'text-cream-muted/70',
              ].join(' ')}
              dir="ltr"
            >
              {count}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}
