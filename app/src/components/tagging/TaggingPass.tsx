// SOP 12 — Image Tagging Pass (architecture/12-image-tagging.md)
// Mirrors .tmp/stitch-mockups/.../tagging_pass_dark/screen.png (dark, RTL,
// Luxury Editorial). Renders one ImageMetadata at a time, full-screen, with
// a deterministic cursor (category lex → file lex per SOP 12 § 4 / SOP 01
// CATEGORY_SCAN_ORDER). The pass is interruptible — quit-and-resume is the
// implicit "save current and pause" path; the cursor resumes at the first
// untagged image in scan order on next mount.
//
// Layer 2 component — imports from React, Framer Motion, '../ui/*',
// '../../lib/db', '../../lib/images', '../../lib/backup', '../../types'
// only. No direct '@tauri-apps/*' or 'idb' usage (per SOP 15 § Layer 2
// imports rule).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Button } from '../ui/Button';
import { Ornament } from '../ui/Ornament';
import { TextArea } from '../ui/TextArea';
import {
  completeTaggingPass,
  listImageTags,
  putImageTag,
  setMeta,
} from '../../lib/db';
import { bakeThumbnailsBatch, scanAll, toImageSrc } from '../../lib/images';
import { exportBackup } from '../../lib/backup';
import {
  IMAGE_CATEGORIES,
  LibError,
  type ImageCategory,
  type ImageMetadata,
  type ImageTag,
} from '../../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type TaggingPassProps = {
  /** Fired exactly once when "סיים תיוג" succeeds (SOP 12 § 5). */
  onComplete: () => void;
  /**
   * Optional progress hook. Fired AFTER each successful save+advance, with the
   * count of tagged images so far and the total. Useful for an external
   * progress display.
   */
  onProgress?: (taggedCount: number, total: number) => void;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic ordering per SOP 12 § 4 / SOP 01 CATEGORY_SCAN_ORDER:
 *   • category lex (using IMAGE_CATEGORIES order — synthetic 'כיסא כלה' last);
 *   • file lex within each category (Hebrew-aware locale compare).
 *
 * The order is stable across reloads — the cursor is then a simple linear
 * scan over the resulting array.
 */
const CATEGORY_ORDER: readonly ImageCategory[] = [
  'אולם עיצוב בסיס 2026',
  'חופות אולם גדול גאמוס',
  'חופות ריזורט',
  'חופות שידרוג',
  'מפות מפיות',
  'עיצובים שידרוג',
  'ריזורט בסיס',
  'כיסא כלה', // synthetic — last per SOP 01 ratification
];

// ---------------------------------------------------------------------------
// Background thumbnail bake scheduler
// ---------------------------------------------------------------------------
//
// Plans/02 § 4 — once the scan resolves, kick off a low-priority background
// bake of every image's thumbnail so by the time Shon reaches the Gallery
// every card resolves out of IndexedDB instead of doing a fresh disk-read +
// decode + WebP encode. The on-demand path in the gallery is unchanged and
// still serves as a fallback for cards we did not reach.
//
// Constraints (from the task brief):
//   • Use requestIdleCallback if available, else a setTimeout(0) chunked
//     fallback. Never block the main thread for >~16ms at a time.
//   • Slice size ≤ ~50 images; yield between slices.
//   • Bake concurrency stays modest (<= 2) so the active TaggingPass UI
//     keeps the worker pool's headroom for its own image decodes.
//   • Cancellable via AbortSignal — when the component unmounts (user
//     finishes tagging or navigates away), the in-flight slice runs to
//     completion but no further slices are scheduled.

const BAKE_SLICE_SIZE = 50 as const;
const BAKE_SLICE_SIZE_LOW_POWER = 25 as const;
const BAKE_CONCURRENCY = 2 as const;
const BAKE_CONCURRENCY_LOW_POWER = 1 as const;

type IdleHandle = number;
type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
type IdleScheduler = (
  cb: (deadline: IdleDeadline) => void,
  opts?: { timeout?: number },
) => IdleHandle;

function scheduleIdle(cb: () => void, timeoutMs = 1000): () => void {
  const g = globalThis as unknown as {
    requestIdleCallback?: IdleScheduler;
    cancelIdleCallback?: (h: IdleHandle) => void;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(() => cb(), { timeout: timeoutMs });
    return () => {
      if (typeof g.cancelIdleCallback === 'function') {
        try {
          g.cancelIdleCallback(handle);
        } catch {
          /* no-op */
        }
      }
    };
  }
  // Fallback: setTimeout(0). Keeps the main thread responsive between slices.
  const handle = setTimeout(() => cb(), 0) as unknown as number;
  return () => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

/**
 * Sequentially bake `images` in idle slices. Resolves once every slice has
 * either run or been cancelled. Failures inside a slice are logged but never
 * thrown — `bakeThumbnailsBatch` already aggregates per-file errors and the
 * gallery's on-demand path remains the safety net.
 */
async function runBackgroundBake(
  images: ImageMetadata[],
  signal: AbortSignal,
  opts: { sliceSize: number; concurrency: number },
): Promise<void> {
  // Skip videos at the slice level — getOrBakeThumbnail returns null for
  // them, but filtering up front avoids burning idle slots on no-ops.
  const queue = images.filter((img) => img.kind === 'image');
  if (queue.length === 0) return;

  const { sliceSize, concurrency } = opts;
  let cursor = 0;

  while (cursor < queue.length) {
    if (signal.aborted) return;

    // Wait for the next idle window before starting a slice.
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const cancelIdle = scheduleIdle(() => resolve(), 1500);
      const onAbort = () => {
        cancelIdle();
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    if (signal.aborted) return;

    const slice = queue.slice(cursor, cursor + sliceSize);
    cursor += slice.length;

    try {
      await bakeThumbnailsBatch(slice, { concurrency });
    } catch (err) {
      // bakeThumbnailsBatch only throws on programmer error (non-array input);
      // per-file failures are returned in `.failed`. Keep the loop alive.
      console.error('[TaggingPass] background bake slice failed', err);
    }
  }
}

function flattenAndSort(
  byCategory: Map<ImageCategory, ImageMetadata[]>,
): ImageMetadata[] {
  const out: ImageMetadata[] = [];
  for (const cat of CATEGORY_ORDER) {
    const group = byCategory.get(cat) ?? [];
    const sorted = [...group].sort((a, b) =>
      a.name.localeCompare(b.name, 'he'),
    );
    out.push(...sorted);
  }
  return out;
}

/**
 * After a save, find the next untagged index from `fromIndex` (inclusive).
 * Returns -1 if every remaining image has a tag (i.e. the pass is done).
 */
function firstUntaggedFrom(
  images: ImageMetadata[],
  taggedSet: ReadonlySet<string>,
  fromIndex: number,
): number {
  for (let i = fromIndex; i < images.length; i += 1) {
    const item = images[i];
    if (item && !taggedSet.has(item.path)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaggingPass({ onComplete, onProgress }: TaggingPassProps) {
  const prefersReducedMotion = useReducedMotion();

  // ── Boot state ──────────────────────────────────────────────────────────
  const [allImages, setAllImages] = useState<ImageMetadata[]>([]);
  const [taggedSet, setTaggedSet] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Per-card form state ─────────────────────────────────────────────────
  const [userCategory, setUserCategory] = useState<ImageCategory | undefined>();
  const [customLabels, setCustomLabels] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState('');
  const [notes, setNotes] = useState('');

  // ── Action state ────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Track the most recent saved tag for use by the SOP 12 § 5 finish path.
   * v1.0 always starts at first-untagged, so this stays null until the user
   * presses "שמור והבא" at least once.
   */
  const lastSavedTagRef = useRef<ImageTag | null>(null);

  // ── Boot effect: scan + load existing tags + pick cursor ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [scan, existingTags] = await Promise.all([
          scanAll(),
          listImageTags(),
        ]);
        if (cancelled) return;

        const flattened = flattenAndSort(scan.byCategory);
        const tagged = new Set<string>();
        for (const t of existingTags) tagged.add(t.imagePath);

        const startIdx = firstUntaggedFrom(flattened, tagged, 0);
        // If startIdx === -1, every image has a tag already — we still mount
        // so the user can press "סיים תיוג" to finalize. We park the cursor
        // at the last image (or 0 for an empty library).
        const initialCursor =
          startIdx === -1 ? Math.max(0, flattened.length - 1) : startIdx;

        setAllImages(flattened);
        setTaggedSet(tagged);
        setCursor(initialCursor);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof LibError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        setBootError(msg);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Background thumbnail bake (Plans/02 § 4) ────────────────────────────
  // Once the scan has populated `allImages`, kick off an idle-priority
  // background bake of the full library so the Gallery is warm by the time
  // Shon and the couple reach it. The on-demand `getOrBakeThumbnail` flow
  // in the gallery remains the fallback for any images the bake didn't reach.
  useEffect(() => {
    if (allImages.length === 0) return;

    const controller = new AbortController();
    const lowPower = prefersReducedMotion === true;
    const sliceOpts = {
      sliceSize: lowPower ? BAKE_SLICE_SIZE_LOW_POWER : BAKE_SLICE_SIZE,
      concurrency: lowPower ? BAKE_CONCURRENCY_LOW_POWER : BAKE_CONCURRENCY,
    };

    void runBackgroundBake(allImages, controller.signal, sliceOpts).catch(
      (err) => {
        // Defensive — runBackgroundBake swallows its own errors, but never
        // let an unhandled rejection escape into the React tree.
        console.error('[TaggingPass] background bake aborted with error', err);
      },
    );

    return () => {
      controller.abort();
    };
  }, [allImages, prefersReducedMotion]);

  // Reset the per-card form whenever the cursor advances. We deliberately do
  // NOT pre-fill from an existing tag — v1.0 only ever lands on untagged
  // cards. Re-tagging (v1.x) will revisit this with prefill semantics.
  useEffect(() => {
    setUserCategory(undefined);
    setCustomLabels([]);
    setCustomDraft('');
    setNotes('');
    setSaveError(null);
  }, [cursor]);

  // ── Derived values ──────────────────────────────────────────────────────
  const total = allImages.length;
  const taggedCount = taggedSet.size;
  const currentImage = allImages[cursor];
  const progressPct = total > 0 ? (taggedCount / total) * 100 : 0;

  const imageSrc = useMemo(() => {
    if (!currentImage) return null;
    try {
      return toImageSrc(currentImage);
    } catch (err) {
      console.error('[TaggingPass] toImageSrc failed', err);
      return null;
    }
  }, [currentImage]);

  // ── Custom-tag chip handlers ────────────────────────────────────────────
  const commitCustomDraft = useCallback(() => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    setCustomLabels((prev) => {
      // De-dupe (case-sensitive Hebrew — exact match).
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
    setCustomDraft('');
  }, [customDraft]);

  const removeCustomLabel = useCallback((label: string) => {
    setCustomLabels((prev) => prev.filter((l) => l !== label));
  }, []);

  const onCustomKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitCustomDraft();
      } else if (
        e.key === 'Backspace' &&
        customDraft.length === 0 &&
        customLabels.length > 0
      ) {
        // Quick remove last chip on Backspace when input is empty.
        e.preventDefault();
        setCustomLabels((prev) => prev.slice(0, -1));
      }
    },
    [commitCustomDraft, customDraft, customLabels],
  );

  // ── Save & advance ──────────────────────────────────────────────────────
  const handleSaveAndNext = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      if (saving || !currentImage) return;

      // Flush any in-progress draft into chips first.
      const draftTrimmed = customDraft.trim();
      const labelsToWrite = draftTrimmed
        ? customLabels.includes(draftTrimmed)
          ? customLabels
          : [...customLabels, draftTrimmed]
        : customLabels;

      const tag: ImageTag = {
        imagePath: currentImage.path,
        userCategory,
        customLabels: labelsToWrite,
        notes,
        // db.ts overwrites taggedAt with Date.now() (INV-12). We pass 0 as
        // a sentinel — the value is never observed.
        taggedAt: 0,
      };

      setSaving(true);
      setSaveError(null);
      try {
        await putImageTag(tag);
        lastSavedTagRef.current = { ...tag, taggedAt: Date.now() };

        // Update local set + cursor synchronously based on the freshly-tagged
        // path (don't trust setState ordering for the next-untagged search).
        const nextTagged = new Set(taggedSet);
        nextTagged.add(currentImage.path);
        setTaggedSet(nextTagged);

        const nextIdx = firstUntaggedFrom(allImages, nextTagged, cursor + 1);
        if (nextIdx === -1) {
          // Wrap around — also check from the start in case the user skipped
          // earlier. (v1.0 always starts at first-untagged, so this only ever
          // matches if EVERYTHING is now tagged.)
          const wrapIdx = firstUntaggedFrom(allImages, nextTagged, 0);
          if (wrapIdx === -1) {
            // Every image is tagged. Auto-complete the pass per SOP 12 § 4
            // ("If none left, auto-call completeTaggingPass").
            try {
              await completeTaggingPass({
                ...tag,
                taggedAt: 0,
              });
              try {
                await exportBackup('tagging-complete');
              } catch (backupErr) {
                console.error(
                  '[TaggingPass] auto-backup on completion failed (non-fatal)',
                  backupErr,
                );
              }
              onComplete();
              return;
            } catch (completeErr) {
              const msg =
                completeErr instanceof LibError
                  ? `${completeErr.code}: ${completeErr.message}`
                  : completeErr instanceof Error
                    ? completeErr.message
                    : 'Unknown error';
              setSaveError(`completion failed: ${msg}`);
              setSaving(false);
              return;
            }
          }
          setCursor(wrapIdx);
        } else {
          setCursor(nextIdx);
        }

        if (onProgress) {
          try {
            onProgress(nextTagged.size, allImages.length);
          } catch (cb) {
            console.error('[TaggingPass] onProgress threw', cb);
          }
        }
      } catch (err) {
        const msg =
          err instanceof LibError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        setSaveError(`שמירת התיוג נכשלה — ${msg}`);
      } finally {
        setSaving(false);
      }
    },
    [
      allImages,
      cursor,
      currentImage,
      customDraft,
      customLabels,
      notes,
      onComplete,
      onProgress,
      saving,
      taggedSet,
      userCategory,
    ],
  );

  // ── Finish ──────────────────────────────────────────────────────────────
  const handleFinish = useCallback(async () => {
    if (saving || !currentImage) return;
    // Confirm dialog per SOP 12 § 5.
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('האם לסיים? לא תוכל לחזור לתיוג.')
        : true;
    if (!ok) return;

    setSaving(true);
    setSaveError(null);
    try {
      // Per SOP 12 § 5: "If the current card has any input, persists it".
      // Compose the tag (same shape as save-and-next). If the card is fully
      // empty, we still persist a "skipped" empty record (SOP 12 § 4 Skipping
      // a card semantics).
      const draftTrimmed = customDraft.trim();
      const labelsToWrite = draftTrimmed
        ? customLabels.includes(draftTrimmed)
          ? customLabels
          : [...customLabels, draftTrimmed]
        : customLabels;

      const finalTag: ImageTag = {
        imagePath: currentImage.path,
        userCategory,
        customLabels: labelsToWrite,
        notes,
        taggedAt: 0, // db re-stamps
      };

      await completeTaggingPass(finalTag);

      // Auto-backup per SOP 07 BackupTrigger 'tagging-complete'.
      try {
        await exportBackup('tagging-complete');
      } catch (backupErr) {
        // Non-blocking per SOP 12 § 5 step 5.
        console.error(
          '[TaggingPass] backup on completion failed (non-fatal)',
          backupErr,
        );
      }

      onComplete();
    } catch (err) {
      const msg =
        err instanceof LibError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      setSaveError(`סיום נכשל — ${msg}`);
      setSaving(false);
    }
  }, [
    currentImage,
    customDraft,
    customLabels,
    notes,
    onComplete,
    saving,
    userCategory,
  ]);

  // ── Render: loading / error / pass ──────────────────────────────────────
  if (isLoading) {
    return (
      <main
        data-testid="tagging-pass"
        dir="rtl"
        className="min-h-screen bg-ink text-cream flex items-center justify-center"
      >
        <p className="text-cream-muted">טוען ספריית תמונות…</p>
      </main>
    );
  }

  if (bootError) {
    return (
      <main
        data-testid="tagging-pass"
        dir="rtl"
        className="min-h-screen bg-ink text-cream flex items-center justify-center px-16"
      >
        <div className="max-w-prose text-center">
          <p
            className="text-label uppercase text-gold-dark mb-4"
            style={{ letterSpacing: '0.12em' }}
          >
            שגיאה
          </p>
          <p className="text-body text-cream-muted">{bootError}</p>
        </div>
      </main>
    );
  }

  if (total === 0) {
    return (
      <main
        data-testid="tagging-pass"
        dir="rtl"
        className="min-h-screen bg-ink text-cream flex items-center justify-center px-16"
      >
        <div className="max-w-prose text-center">
          <p
            className="text-label uppercase text-gold-dark mb-4"
            style={{ letterSpacing: '0.12em' }}
          >
            ספריית התמונות ריקה
          </p>
          <Button
            variant="tertiary"
            onClick={handleFinish}
            disabled={saving}
            testId="tagging-finish"
          >
            המשך אל המסך הראשי
          </Button>
        </div>
      </main>
    );
  }

  // The image renders motion-free under reduced motion (per brief).
  // Phase WOW: cross-slide (opacity + 12px x-shift) on the signature ease
  // — keyed on path via the parent <motion.img key=...>, so React unmounts
  // the previous tile and lets Framer animate the new one in.
  const imageMotionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
      };

  // Stitch-mockup max image frame: 800×600 contain.
  const imageFrameStyle: CSSProperties = {
    maxWidth: '800px',
    maxHeight: '600px',
    width: '100%',
    aspectRatio: '4 / 3',
  };

  return (
    <main
      data-testid="tagging-pass"
      dir="rtl"
      lang="he"
      className="min-h-screen bg-ink text-cream"
    >
      <div className="mx-auto max-w-5xl px-16 py-12">
        {/* ── Progress header ──────────────────────────────────────────── */}
        <header className="mb-12">
          <div className="flex items-center justify-between">
            <span
              data-testid="tagging-counter"
              className="font-tabular text-label uppercase text-gold-dark tracking-[0.12em]"
            >
              <span dir="ltr">
                {taggedCount} / {total}
              </span>{' '}
              תויגו
            </span>
            {/* TEMP: skip the tagging pass for preview only — remove once Shon has tagged the library. */}
            <button
              type="button"
              data-testid="tagging-skip-temp"
              onClick={async () => {
                try {
                  await setMeta('taggingComplete', true);
                  onComplete();
                } catch (err) {
                  console.error('[TaggingPass] skip failed', err);
                }
              }}
              className="font-sans text-label uppercase tracking-[0.12em] text-cream-muted transition-colors duration-150 hover:text-gold"
            >
              דלג זמנית
            </button>
          </div>
          {/* Gold progress rule. Width fills from the inline-start (right in
              RTL) to match the Stitch mockup. */}
          <div
            className="mt-4 w-full border-b border-border-subtle relative"
            role="progressbar"
            aria-valuenow={taggedCount}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="התקדמות תיוג"
          >
            {/* progress-shimmer: flat opacity pulse on the gold fill (CSS
                keyframe in styles/index.css). NOT a gradient — Constitution
                §SOP-09 §4 forbids gradients as decoration. Reduced-motion
                handled by the keyframe's @media guard, so the fill stays
                solid for users who prefer no motion. */}
            <div
              className="absolute top-0 h-px progress-shimmer-fill"
              style={{
                insetInlineStart: 0,
                width: `${progressPct}%`,
                transition: prefersReducedMotion
                  ? 'none'
                  : 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>
        </header>

        {/* ── Image card ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center mb-12">
          <div
            className="border border-gold bg-ink-raised overflow-hidden flex items-center justify-center"
            style={imageFrameStyle}
          >
            {currentImage && imageSrc ? (
              currentImage.kind === 'video' ? (
                <video
                  key={currentImage.path}
                  src={imageSrc}
                  controls
                  className="w-full h-full object-contain"
                />
              ) : (
                <motion.img
                  key={currentImage.path}
                  src={imageSrc}
                  alt={currentImage.name}
                  className="w-full h-full object-contain"
                  {...imageMotionProps}
                />
              )
            ) : (
              <p className="text-cream-muted text-small">תמונה לא זמינה</p>
            )}
          </div>

          {/* Filename + folder category — informational only. */}
          {currentImage && (
            <div className="mt-4 text-center">
              <p className="text-small text-cream-muted">
                {currentImage.name}
              </p>
              <p className="text-tiny uppercase text-gold-dark mt-1 tracking-[0.12em]">
                {currentImage.category}
              </p>
            </div>
          )}
        </div>

        {/* ── ❖ Ornament divider (SOP 09 §6) ───────────────────────────── */}
        <Ornament size="large" variant="divider" />

        {/* ── Form: two-column on md+ (categories | notes) ────────────── */}
        <form
          onSubmit={handleSaveAndNext}
          className="grid grid-cols-1 md:grid-cols-2 gap-12"
        >
          {/* Left column: categories + custom-tag chips */}
          <fieldset className="min-w-0">
            <legend className="text-label uppercase text-gold-dark mb-6 block tracking-[0.12em]">
              קטגוריה
            </legend>
            <div className="grid grid-cols-2 gap-2 mb-8">
              {IMAGE_CATEGORIES.map((cat) => {
                const checked = userCategory === cat;
                return (
                  <label
                    key={cat}
                    className="cursor-pointer"
                    data-testid={`tagging-category-${cat}`}
                  >
                    <input
                      type="radio"
                      name="userCategory"
                      value={cat}
                      checked={checked}
                      onChange={() =>
                        setUserCategory(
                          // Toggle off if clicking the already-checked option.
                          checked ? undefined : cat,
                        )
                      }
                      className="sr-only peer"
                    />
                    <div
                      className={
                        'border px-3 py-3 text-center text-small transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] ' +
                        (checked
                          ? 'border-gold text-gold-dark'
                          : 'border-border-subtle text-cream hover:border-gold')
                      }
                    >
                      {cat}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Custom-tag chip input ("אחר") */}
            <div>
              <label
                htmlFor="custom-tag-input"
                className="text-label uppercase text-gold-dark block mb-3 tracking-[0.12em]"
              >
                אחר — תוויות חופשיות
              </label>
              <input
                id="custom-tag-input"
                type="text"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={onCustomKeyDown}
                onBlur={commitCustomDraft}
                placeholder="הוסף תווית חופשית"
                data-testid="tagging-custom-input"
                className={[
                  'w-full bg-transparent',
                  'border-0 border-b border-solid border-border-subtle',
                  'rounded-none px-0 py-3',
                  'font-sans text-body text-cream placeholder:text-cream-muted',
                  'focus:outline-none focus:border-b-2 focus:border-gold focus:pb-[10px]',
                  'transition-[border-color,padding-bottom] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
                ].join(' ')}
              />
              {customLabels.length > 0 && (
                <ul
                  className="flex flex-wrap gap-2 mt-4 list-none p-0"
                  data-testid="tagging-custom-labels"
                >
                  {customLabels.map((label) => (
                    <li key={label}>
                      <span className="inline-flex items-center gap-2 border border-border-subtle px-3 py-1 text-small text-cream-muted">
                        {label}
                        <button
                          type="button"
                          onClick={() => removeCustomLabel(label)}
                          aria-label={`הסר תווית ${label}`}
                          className="text-cream-muted hover:text-cream transition-colors duration-150"
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </fieldset>

          {/* Right column: notes (TextArea primitive) */}
          <div className="min-w-0">
            <TextArea
              label="הערות"
              value={notes}
              onChange={setNotes}
              placeholder="הוסף הערה פנימית לתמונה זו…"
              rows={6}
              testId="tagging-notes"
            />
          </div>

          {/* Save error (per-card) */}
          {saveError && (
            <p
              role="alert"
              className="md:col-span-2 text-small text-cream-muted"
            >
              {saveError}
            </p>
          )}

          {/* ── Footer actions ────────────────────────────────────────── */}
          <footer className="md:col-span-2 mt-12 flex items-center justify-between gap-8">
            {/* Tertiary: "סיים תיוג" — disabled until at least one image is saved. */}
            <Button
              variant="tertiary"
              onClick={handleFinish}
              disabled={saving || taggedCount === 0}
              testId="tagging-finish"
            >
              סיים תיוג
            </Button>

            {/* Primary: "שמור והבא" */}
            <Button
              variant="primary"
              type="submit"
              disabled={saving}
              testId="tagging-save-next"
            >
              שמור והבא
            </Button>
          </footer>
        </form>
      </div>
    </main>
  );
}

export default TaggingPass;
