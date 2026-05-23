// SOP: architecture/05-gallery-selection.md § Sub-category Filtering
// SOP: architecture/12-image-tagging.md § 4.5 Automatic pre-pass
// SOP: architecture/09-design-tokens.md (gold accents, sharp corners,
//      uppercase tracking on labels — same vocabulary as CategoryTabs).
//
// Secondary chip strip rendered beneath the main 8-category strip in the
// Gallery. Sub-categories are derived from `imageTags.customLabels` for the
// images in the active main category — top-N by frequency, alphabetical
// fallback for ties. An explicit "הכל" chip resets the filter.
//
// The strip is hidden by the Gallery when the active main category has fewer
// than 2 distinct sub-categories.

import { motion } from 'framer-motion';

export type SubCategoryTabsProps = {
  /** The full ordered list of sub-category labels for the active main
   *  category, including the "הכל" reset chip as the first entry. */
  options: readonly string[];
  /** Current selection. `null` means "הכל" (no sub-filter). */
  active: string | null;
  /** Called when the user picks a different sub-category. `null` resets. */
  onChange: (next: string | null) => void;
  /** Per-sub-category count badge. Optional — entries missing render no badge. */
  counts?: Readonly<Record<string, number>>;
};

const ALL_LABEL = 'הכל';

export function SubCategoryTabs({
  options,
  active,
  onChange,
  counts,
}: SubCategoryTabsProps) {
  return (
    <nav
      data-testid="gallery-subcategory-tabs"
      className="flex shrink-0 items-center gap-3 overflow-x-auto py-4"
      style={{ scrollbarWidth: 'none' }}
      aria-label="תת-קטגוריות"
    >
      {options.map((option) => {
        const isAll = option === ALL_LABEL;
        const isActive = isAll ? active === null : active === option;
        const count = counts ? (counts[option] ?? 0) : null;
        return (
          <motion.button
            key={option}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(isAll ? null : option)}
            data-testid={`subcategory-chip-${option}`}
            whileHover={{ y: -1 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className={[
              'shrink-0 px-4 py-1.5 font-sans text-tiny uppercase tracking-[0.12em]',
              'border transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
              isActive
                ? 'border-gold text-gold'
                : 'border-border-subtle/60 text-cream-muted hover:border-cream hover:text-cream',
            ].join(' ')}
            style={{ borderRadius: 0 }}
          >
            <span dir="auto">{option}</span>
            {count !== null && count > 0 && !isAll ? (
              <span
                className={[
                  'ms-2 font-tabular',
                  isActive ? 'text-gold' : 'text-cream-muted/70',
                ].join(' ')}
                dir="ltr"
              >
                {count}
              </span>
            ) : null}
          </motion.button>
        );
      })}
    </nav>
  );
}

SubCategoryTabs.ALL_LABEL = ALL_LABEL;
