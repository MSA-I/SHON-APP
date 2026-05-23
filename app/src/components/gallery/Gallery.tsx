// SOP: architecture/05-gallery-selection.md — full-screen modal that shows
// the scanned ImageMetadata library, lets the user filter (category, search,
// tab=images/videos) and pick selections that flow back to the caller via
// `onClose(selections)`.
// SOP: architecture/09-design-tokens.md — Luxury Editorial: ink canvas,
// cream text, gold reserved for accents (selected ring + ❖ + 1px hairlines).
//
// Visual reference: .tmp/stitch-mockups/.../gallery_dark/screen.png and
// the corresponding code.html. The implementation mirrors the mockup's
// 4-column square-tile grid, the centered serif sub-tabs, and the chip
// strip beneath them.

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronRight, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from '../../contexts/ToastContext';
import { listImageTags } from '../../lib/db';
import { getOrBakeThumbnail, scanAll } from '../../lib/images';
import {
  IMAGE_CATEGORIES,
  type ImageCategory,
  type ImageMetadata,
  type ImageSelection,
  type ImageTag,
  type MediaKind,
} from '../../types';
import { Button } from '../ui/Button';
import { CategoryTabs } from './CategoryTabs';
import { Lightbox } from './Lightbox';
import { SubCategoryTabs } from './SubCategoryTabs';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type GalleryMode =
  | 'tableDesigns'
  | 'chuppah'
  // Maintenance Log 2026-05-21: every event tab now opens the gallery so the
  // designer can pick reference images alongside the form fields. The new
  // modes mirror `chuppah` (no hard cap) and only differ in their landing
  // category — the user can switch freely afterwards.
  | 'napkins'
  | 'upgrades';

export type GalleryProps = {
  /** Determines the selection cap and the default landing category. */
  mode: GalleryMode;
  /** Pre-selected items — survives gallery open/close cycles. */
  selections: ImageSelection[];
  /** Optional override; defaults to 5 for tableDesigns, ∞ for everything else. */
  maxSelections?: number;
  /** Called on close — caller persists the (possibly mutated) selections. */
  onClose: (selections: ImageSelection[]) => void;
};

const DEFAULT_MAX: Record<GalleryMode, number> = {
  tableDesigns: 5,
  chuppah: Number.POSITIVE_INFINITY,
  napkins: Number.POSITIVE_INFINITY,
  upgrades: Number.POSITIVE_INFINITY,
};

/**
 * Default landing category per mode. The user can switch freely afterwards;
 * this only chooses the first chip the gallery opens on.
 */
const DEFAULT_CATEGORY: Record<GalleryMode, ImageCategory> = {
  tableDesigns: 'אולם עיצוב בסיס 2026',
  chuppah: 'חופות ריזורט',
  napkins: 'מפות מפיות',
  upgrades: 'עיצובים שידרוג',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format the counter label. `Infinity` collapses to "∞".
 */
function formatCounter(count: number, max: number): string {
  const ceiling = Number.isFinite(max) ? String(max) : '∞';
  return `${count} / ${ceiling} נבחרו`;
}

/**
 * Hebrew-NFC-aware case-insensitive substring filter on filename.
 */
function matchesQuery(name: string, query: string): boolean {
  if (!query) return true;
  const a = name.normalize('NFC').toLowerCase();
  const b = query.normalize('NFC').toLowerCase();
  return a.includes(b);
}

/** Maximum number of sub-category chips to render (excluding "הכל"). */
const MAX_SUBCATEGORIES = 8;

/**
 * Build the top-N sub-categories for an active main category from the union
 * of `customLabels` across the tags of every image in that category. Sorted
 * by descending count (ties broken by Hebrew locale compare). Returns the
 * raw list — the "הכל" chip is prepended by the caller.
 */
function deriveSubCategories(
  imagesInCategory: readonly ImageMetadata[],
  tagsByPath: ReadonlyMap<string, ImageTag>,
  limit: number,
): { labels: string[]; counts: Record<string, number> } {
  const counts = new Map<string, number>();
  for (const img of imagesInCategory) {
    const tag = tagsByPath.get(img.path);
    if (!tag) continue;
    for (const raw of tag.customLabels) {
      const label = raw.trim().normalize('NFC');
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const ranked = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], 'he');
    })
    .slice(0, limit);
  const labels = ranked.map(([label]) => label);
  const countsOut: Record<string, number> = {};
  for (const [label, count] of counts) countsOut[label] = count;
  return { labels, counts: countsOut };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Gallery({
  mode,
  selections: incomingSelections,
  maxSelections,
  onClose,
}: GalleryProps) {
  const cap = maxSelections ?? DEFAULT_MAX[mode];
  const { toast } = useToast();

  // Local working copy — only flushed back via `onClose`.
  const [selections, setSelections] = useState<ImageSelection[]>(
    () => incomingSelections.slice(),
  );

  // Library state (populated by scanAll).
  const [byCategory, setByCategory] = useState<
    Map<ImageCategory, ImageMetadata[]>
  >(() => new Map());
  const [scanComplete, setScanComplete] = useState(false);

  // Tag map (populated alongside the scan from the imageTags store).
  const [tagsByPath, setTagsByPath] = useState<Map<string, ImageTag>>(
    () => new Map(),
  );

  // Filters
  const [activeCategory, setActiveCategory] = useState<ImageCategory>(
    () => DEFAULT_CATEGORY[mode],
  );
  const [activeKind, setActiveKind] = useState<MediaKind>('image');
  const [query, setQuery] = useState('');
  const [activeSubCategory, setActiveSubCategory] = useState<string | null>(
    null,
  );

  // Lightbox open state
  const [lightboxImage, setLightboxImage] = useState<ImageMetadata | null>(
    null,
  );

  // -----------------------------------------------------------------------
  // Library scan — runs once on mount. The gallery is a pure consumer per
  // SOP 05 § Source Data, but on a cold open we still need *something* in
  // memory; in production this state would come from EventContext. The
  // streaming `onCategoryDone` callback gives the user partial results
  // before the slow categories (520 images) finish.
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Tags load in parallel with the scan — they don't gate rendering and
      // a failure here just disables the sub-category strip.
      void (async () => {
        try {
          const tags = await listImageTags();
          if (cancelled) return;
          const map = new Map<string, ImageTag>();
          for (const t of tags) map.set(t.imagePath, t);
          setTagsByPath(map);
        } catch (err) {
          console.error('[gallery] listImageTags failed', err);
        }
      })();

      try {
        const result = await scanAll({
          onCategoryDone: (category, count) => {
            if (cancelled || count === null) return;
            // We re-set the same Map ref to a clone so React sees the change.
            setByCategory((prev) => {
              const next = new Map(prev);
              // The scan stream itself doesn't pass items in this callback;
              // we only mark "this category resolved" — full items arrive
              // from the awaited `result` below.
              if (!next.has(category)) next.set(category, []);
              return next;
            });
          },
        });
        if (cancelled) return;
        setByCategory(new Map(result.byCategory));
        setScanComplete(true);
      } catch (err) {
        // Catastrophic failure (e.g. project root missing). Keep the gallery
        // open so the user can still close it; surface a console error for
        // diagnostics. SOP 05 § Failure Modes covers per-category failures
        // already inside `scanAll`.
        console.error('[gallery] scanAll failed', err);
        if (!cancelled) setScanComplete(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -----------------------------------------------------------------------
  // Derived: per-category counts (filtered to active media kind only — the
  // kind toggle changes the count badges, the search box does not).
  // -----------------------------------------------------------------------
  const counts = useMemo<Record<ImageCategory, number>>(() => {
    const out = {} as Record<ImageCategory, number>;
    for (const cat of IMAGE_CATEGORIES) {
      const list = byCategory.get(cat) ?? [];
      out[cat] = list.filter((i) => i.kind === activeKind).length;
    }
    return out;
  }, [byCategory, activeKind]);

  // Whether the videos sub-tab is hidden (per SOP 05 § Filtering Rules #2).
  const hasVideosInActiveCategory = useMemo(() => {
    const list = byCategory.get(activeCategory) ?? [];
    return list.some((i) => i.kind === 'video');
  }, [byCategory, activeCategory]);

  // If the user is on the וידאו tab and switches to a category with no
  // videos, snap them back to תמונות so the empty grid doesn't confuse.
  useEffect(() => {
    if (activeKind === 'video' && !hasVideosInActiveCategory) {
      setActiveKind('image');
    }
  }, [activeKind, hasVideosInActiveCategory]);

  // -----------------------------------------------------------------------
  // Sub-category options derived from imageTags for the active main category.
  // Re-derived on category, kind, or tag map change. Hidden when fewer than 2
  // distinct labels exist (the strip is information-dense; one chip is noise).
  // -----------------------------------------------------------------------
  const { subCategoryOptions, subCategoryCounts } = useMemo(() => {
    const list = (byCategory.get(activeCategory) ?? []).filter(
      (img) => img.kind === activeKind,
    );
    const { labels, counts } = deriveSubCategories(
      list,
      tagsByPath,
      MAX_SUBCATEGORIES,
    );
    return { subCategoryOptions: labels, subCategoryCounts: counts };
  }, [byCategory, activeCategory, activeKind, tagsByPath]);

  // Reset sub-filter when the user changes main category or media kind, since
  // a label that exists in one category usually does not exist in another.
  useEffect(() => {
    setActiveSubCategory(null);
  }, [activeCategory, activeKind]);

  // Drop a stale sub-selection if the option vanished (e.g. tag map updated).
  useEffect(() => {
    if (
      activeSubCategory !== null &&
      !subCategoryOptions.includes(activeSubCategory)
    ) {
      setActiveSubCategory(null);
    }
  }, [activeSubCategory, subCategoryOptions]);

  // -----------------------------------------------------------------------
  // Visible images = active category × active kind × search query × sub-cat
  // -----------------------------------------------------------------------
  const visibleImages = useMemo<ImageMetadata[]>(() => {
    const list = byCategory.get(activeCategory) ?? [];
    return list.filter((img) => {
      if (img.kind !== activeKind) return false;
      if (!matchesQuery(img.name, query)) return false;
      if (activeSubCategory !== null) {
        const tag = tagsByPath.get(img.path);
        if (!tag) return false;
        if (!tag.customLabels.includes(activeSubCategory)) return false;
      }
      return true;
    });
  }, [
    byCategory,
    activeCategory,
    activeKind,
    query,
    activeSubCategory,
    tagsByPath,
  ]);

  // -----------------------------------------------------------------------
  // Selection helpers
  // -----------------------------------------------------------------------
  const isSelected = useCallback(
    (path: string) => selections.some((s) => s.imagePath === path),
    [selections],
  );

  const toggleSelection = useCallback(
    (image: ImageMetadata) => {
      setSelections((prev) => {
        const idx = prev.findIndex((s) => s.imagePath === image.path);
        if (idx >= 0) {
          // Deselect.
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        }
        if (prev.length >= cap) {
          // Hit the cap — surface a toast via the global ToastProvider so
          // the user understands why the click did nothing. SOP 05 §
          // Selection Semantics: the cap is hard.
          const ceiling = Number.isFinite(cap) ? String(cap) : '∞';
          toast({
            kind: 'info',
            message: `הגעת למקסימום הבחירות (${ceiling})`,
          });
          return prev;
        }
        const fresh: ImageSelection = {
          imagePath: image.path,
          category: image.category,
          imageName: image.name,
          notes: '',
          selectedAt: Date.now(),
        };
        return [...prev, fresh];
      });
    },
    [cap, toast],
  );

  // -----------------------------------------------------------------------
  // Footer actions
  // -----------------------------------------------------------------------
  const handleConfirm = useCallback(() => {
    onClose(selections);
  }, [onClose, selections]);

  const handleCancel = useCallback(() => {
    onClose(incomingSelections);
  }, [onClose, incomingSelections]);

  return (
    <motion.div
      data-testid="gallery"
      role="dialog"
      aria-modal="true"
      aria-label="גלריית תמונות"
      dir="rtl"
      lang="he"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-40 flex flex-col bg-ink"
    >
      {/* ───── Top bar ─────────────────────────────────────────────────── */}
      <header className="relative flex shrink-0 items-center justify-between border-b border-border-subtle px-16 pb-6 pt-12">
        {/* Inline-start (RTL right): counter + check icon */}
        <div className="flex items-center gap-3">
          <span
            data-testid="selection-counter"
            className="font-sans text-tiny tracking-[0.12em] text-gold-dark uppercase"
            dir="ltr"
          >
            {formatCounter(selections.length, cap)}
          </span>
          <CheckCircle2
            size={18}
            strokeWidth={1.5}
            className="text-gold"
            aria-hidden="true"
          />
        </div>

        {/* Center: media-kind sub-tabs */}
        <div
          className="absolute start-1/2 flex -translate-x-1/2 items-center gap-12"
          role="tablist"
          aria-label="סוג מדיה"
        >
          <SubTab
            label="תמונות"
            active={activeKind === 'image'}
            onClick={() => setActiveKind('image')}
            data-testid="kind-tab-image"
          />
          {hasVideosInActiveCategory ? (
            <SubTab
              label="וידאו"
              active={activeKind === 'video'}
              onClick={() => setActiveKind('video')}
              data-testid="kind-tab-video"
            />
          ) : null}
        </div>

        {/* Inline-end (RTL left): search */}
        <div className="group relative flex w-64 items-center">
          <Search
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="pointer-events-none absolute end-0 text-cream-muted transition-colors duration-150 group-focus-within:text-gold"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם קובץ..."
            aria-label="חיפוש לפי שם קובץ"
            data-testid="gallery-search"
            className="w-full border-0 border-b border-border-subtle bg-transparent py-2 pe-8 text-body text-cream placeholder:text-cream-muted focus:border-gold focus:outline-none"
            style={{ borderRadius: 0 }}
          />
        </div>
      </header>

      {/* ───── Category chip strip ─────────────────────────────────────── */}
      <div className="px-16">
        <CategoryTabs
          active={activeCategory}
          onChange={setActiveCategory}
          counts={counts}
        />
        {/* Sub-category strip — derived from imageTags. Hidden when there are
            fewer than 2 distinct labels for the active main category. */}
        {subCategoryOptions.length >= 2 ? (
          <SubCategoryTabs
            options={[SubCategoryTabs.ALL_LABEL, ...subCategoryOptions]}
            active={activeSubCategory}
            onChange={setActiveSubCategory}
            counts={subCategoryCounts}
          />
        ) : null}
      </div>

      {/* ───── Grid (windowed) ─────────────────────────────────────────── */}
      <VirtualGrid
        scanComplete={scanComplete}
        visibleImages={visibleImages}
        query={query}
        onClearFilters={() => setQuery('')}
        isSelected={isSelected}
        onToggle={toggleSelection}
        onOpen={(img) => setLightboxImage(img)}
      />

      {/* ───── Footer actions ──────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-border-subtle px-16 py-8">
        {/* Inline-start (RTL right) — back / cancel */}
        <Button
          variant="tertiary"
          onClick={handleCancel}
          testId="gallery-cancel"
          icon={
            <ChevronRight
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className="rtl:scale-x-[-1]"
            />
          }
        >
          חזרה
        </Button>
        {/* Inline-end (RTL left) — confirm */}
        <Button
          variant="primary"
          onClick={handleConfirm}
          testId="gallery-confirm"
        >
          אישור הבחירה
        </Button>
      </footer>

      {/* ───── Lightbox portal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {lightboxImage ? (
          <Lightbox
            image={lightboxImage}
            selected={isSelected(lightboxImage.path)}
            onSelect={() => {
              toggleSelection(lightboxImage);
            }}
            onClose={() => setLightboxImage(null)}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

// ===========================================================================
// SubTab — center sub-tabs in the header (תמונות / וידאו)
// ===========================================================================

function SubTab({
  label,
  active,
  onClick,
  ...rest
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'relative pb-2 font-serif text-h3 transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        active
          ? 'text-gold'
          : 'text-cream-muted hover:text-cream',
      ].join(' ')}
      style={{ borderRadius: 0 }}
      data-testid={rest['data-testid']}
    >
      {label}
      {/* 2px gold underline on active. */}
      <span
        aria-hidden="true"
        className={[
          'absolute inset-x-0 -bottom-px h-0.5 bg-gold transition-transform duration-150',
          active ? 'scale-x-100' : 'scale-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ===========================================================================
// Tile — a single thumbnail card with lazy-loaded blob URL
// ===========================================================================

type TileProps = {
  image: ImageMetadata;
  index: number;
  /**
   * True only for tiles in the first painted viewport (≈ rows 0..3 from
   * the virtualizer). Beyond that, the entrance animation is suppressed
   * entirely so virtualizer-recycled tiles render instant on scroll —
   * Designer-Reviewer P0 (Gallery #1) fix for scroll-back jitter.
   */
  enableEntrance: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
};

function Tile({
  image,
  index,
  enableEntrance,
  selected,
  onToggle,
  onOpen,
}: TileProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  // Lazy thumbnail load — fetches the WebP blob from IndexedDB (or bakes it)
  // and creates an object URL. We revoke on unmount to avoid leaking.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setErrored(false);
    setThumbUrl(null);

    void (async () => {
      try {
        const blob = await getOrBakeThumbnail(image);
        if (cancelled) return;
        if (!blob) {
          // videos return null → render a placeholder, not an error
          setThumbUrl(null);
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setThumbUrl(createdUrl);
      } catch (err) {
        if (!cancelled) {
          console.error('[gallery] thumbnail failed for', image.path, err);
          setErrored(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [image]);

  // Click vs. selection — single click toggles selection (mockup mirror);
  // a "long press" or right-click would open the lightbox in a fuller build.
  // For now: click on the body toggles, the small ⤢ button at top-end opens
  // the lightbox.
  const handleTileClick = (e: React.MouseEvent): void => {
    if (e.detail === 2) {
      // Double-click → open lightbox.
      onOpen();
      return;
    }
    onToggle();
  };

  // Phase WOW: stagger only the FIRST viewport's tiles on initial paint —
  // beyond that (or on scroll-back), virtualizer-recycled tiles render
  // instant so scrolling stays at 60fps. The decision is owned by the
  // caller via `enableEntrance` (gated on `vRow.index < 4`); when false,
  // the tile renders with no animation at all.
  const stagger = enableEntrance ? (index % 16) * 0.04 : 0;

  return (
    <motion.div
      data-testid={`gallery-card-${index}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={image.name}
      onClick={handleTileClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      initial={enableEntrance ? { opacity: 0, y: 8 } : false}
      animate={enableEntrance ? { opacity: 1, y: 0 } : false}
      transition={
        enableEntrance
          ? { duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: stagger }
          : { duration: 0 }
      }
      className={[
        'group relative aspect-square cursor-pointer transition-colors duration-150',
        selected
          ? 'border-2 border-gold p-1'
          : 'border border-transparent p-1 hover:border-gold',
      ].join(' ')}
      style={{ borderRadius: 0 }}
    >
      <div className="relative h-full w-full overflow-hidden bg-ink-raised">
        {/* Thumbnail / placeholder / error states */}
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={image.name}
            loading="lazy"
            className={[
              'h-full w-full object-cover transition-opacity duration-200',
              selected ? '' : 'opacity-90 group-hover:opacity-100',
            ].join(' ')}
          />
        ) : errored ? (
          <div className="flex h-full w-full items-center justify-center text-cream-muted">
            <span className="font-sans text-tiny">×</span>
          </div>
        ) : image.kind === 'video' ? (
          <div className="flex h-full w-full items-center justify-center text-cream-muted">
            <span className="font-sans text-label uppercase tracking-[0.12em]">
              וידאו
            </span>
          </div>
        ) : (
          // Loading placeholder — matches the mockup's "image" icon tile.
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-8 w-8 border border-border-subtle" aria-hidden="true" />
          </div>
        )}

        {/* Hovered overlay — preserve the mockup's mix-blend dim on selected. */}
        {selected ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-ink/30 mix-blend-multiply"
          />
        ) : null}
      </div>

      {/* Selection ❖ corner mark (top inline-start → top-right in RTL).
          The mockup positions it at top-left visually (LTR end); we use
          start to honor RTL flow. */}
      {selected ? (
        <div
          aria-hidden="true"
          title="נבחר"
          className="absolute top-3 start-3 font-serif text-h3 leading-none text-gold drop-shadow"
        >
          ❖
        </div>
      ) : null}

      {/* Open-in-lightbox affordance (top inline-end). Stops click bubbling
          so toggling and opening don't collide. */}
      <button
        type="button"
        aria-label={`פתח את ${image.name}`}
        data-testid={`gallery-card-open-${index}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="absolute top-3 end-3 hidden h-8 w-8 items-center justify-center text-cream-muted transition-colors duration-150 hover:text-gold focus-visible:flex group-hover:flex"
        style={{ borderRadius: 0 }}
      >
        <span className="font-sans text-tiny" aria-hidden="true">↗</span>
      </button>
    </motion.div>
  );
}

// ===========================================================================
// Empty / loading state
// ===========================================================================

function EmptyState({
  scanComplete,
  hasQuery,
  onClearFilters,
}: {
  scanComplete: boolean;
  hasQuery: boolean;
  onClearFilters: () => void;
}) {
  if (!scanComplete) {
    return (
      <div
        data-testid="gallery-loading"
        className="flex h-64 items-center justify-center"
      >
        <p className="font-serif text-h3 text-cream-muted">
          סורק את ספריית התמונות…
        </p>
      </div>
    );
  }
  if (hasQuery) {
    return (
      <div
        data-testid="gallery-empty"
        className="flex flex-col items-center justify-center gap-6 py-24"
      >
        <p className="font-serif text-h3 text-cream-muted">
          אין התאמות לחיפוש
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="font-sans text-label uppercase tracking-[0.12em] text-cream transition-colors duration-150 hover:text-gold"
        >
          נקה חיפוש
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid="gallery-empty"
      className="flex h-64 items-center justify-center"
    >
      <p className="font-serif text-h3 text-cream-muted">
        אין פריטים בקטגוריה זו
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VirtualGrid — windowed 4-column tile grid (fixes 60fps jank on 520-image
// categories like "מפות מפיות"). Only the visible rows + small overscan are
// mounted; the rest are placeholder space inside an absolutely-sized inner div.
// ---------------------------------------------------------------------------

const COLUMNS = 4;
const ROW_GAP_PX = 16;       // matches Tailwind `gap-4`
const TILE_HEIGHT_PX = 220;  // approx aspect-square tile in 4-col layout @1440 viewport

function VirtualGrid({
  scanComplete,
  visibleImages,
  query,
  onClearFilters,
  isSelected,
  onToggle,
  onOpen,
}: {
  scanComplete: boolean;
  visibleImages: ImageMetadata[];
  query: string;
  onClearFilters: () => void;
  isSelected: (path: string) => boolean;
  onToggle: (image: ImageMetadata) => void;
  onOpen: (image: ImageMetadata) => void;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const rowCount = Math.ceil(visibleImages.length / COLUMNS);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_HEIGHT_PX + ROW_GAP_PX,
    overscan: 4,
  });

  return (
    <main
      ref={scrollRef}
      data-testid="gallery-grid-scroll"
      className="flex-1 overflow-y-auto px-16 py-8"
    >
      {visibleImages.length === 0 ? (
        <EmptyState
          scanComplete={scanComplete}
          hasQuery={query.length > 0}
          onClearFilters={onClearFilters}
        />
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const start = vRow.index * COLUMNS;
            const rowImages = visibleImages.slice(start, start + COLUMNS);
            // Designer-Reviewer P0 fix: gate the entrance animation on
            // ROW index (not item index) so virtualizer-recycled tiles
            // don't re-stagger when the user scrolls back to the top.
            // Rows 0..3 = first viewport ≈ 16 tiles total.
            const enableEntrance = vRow.index < 4;
            return (
              <div
                key={vRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vRow.start}px)`,
                  height: `${TILE_HEIGHT_PX}px`,
                }}
                className="grid grid-cols-4 gap-4"
              >
                {rowImages.map((img, colIdx) => (
                  <Tile
                    key={img.path}
                    image={img}
                    index={start + colIdx}
                    enableEntrance={enableEntrance}
                    selected={isSelected(img.path)}
                    onToggle={() => onToggle(img)}
                    onOpen={() => onOpen(img)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {visibleImages.length > 0 ? (
        <div
          className="my-16 flex justify-center text-gold"
          aria-hidden="true"
        >
          <span className="font-serif text-h2">❖</span>
        </div>
      ) : null}
    </main>
  );
}

