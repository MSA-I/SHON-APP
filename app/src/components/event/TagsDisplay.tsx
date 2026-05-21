// SOP: claude.md § Data Schemas (ImageTag)
// SOP: architecture/12-image-tagging.md (one-time tagging pass; tags persist
//      in the `imageTags` IndexedDB store keyed by `imagePath`)
// SOP: architecture/15-component-architecture.md §2 (Layer 2 components must
//      not import `idb` directly; tag reads go through `lib/db.ts`)
//
// Reusable tag-chip strip surfaced beneath every event tab's image grid.
// Reads the `customLabels` + `userCategory` for each selected image's path
// and renders the union as chips. Empty by design when no tags exist —
// either because the SOP 12 Image Tagging Pass has not yet completed, or
// because the picked images carry no labels.
//
// The slot is ALWAYS rendered (even when empty) so the UX is consistent
// across tabs per the Agent C task brief 2026-05-21.

import { useEffect, useState, type ReactNode } from 'react';

import { getImageTag } from '../../lib/db';
import type { ImageSelection, ImageTag } from '../../types';

import { ChipLabel } from './EventDetailsTab';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type TagsDisplayProps = {
  /** The tab's currently-selected images. The component will fetch tags
   *  for each image path and render the union of `customLabels` +
   *  `userCategory` as chips. */
  selections: readonly ImageSelection[];
  /** Optional override label. Defaults to "תגיות". */
  label?: string;
  /** Optional test-id suffix so the same component can ship in multiple tabs
   *  without colliding on data-testid="tags-display". */
  testIdSuffix?: string;
};

// ---------------------------------------------------------------------------
// Empty-state copy (locked Hebrew per Agent C brief)
// ---------------------------------------------------------------------------

const EMPTY_STATE_NO_SELECTIONS = 'תגיות יתווספו לאחר תיוג התמונות';
const EMPTY_STATE_NO_TAGS = 'תגיות יתווספו לאחר תיוג התמונות';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TagsDisplay({
  selections,
  label = 'תגיות',
  testIdSuffix,
}: TagsDisplayProps): ReactNode {
  const [tags, setTags] = useState<ImageTag[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Re-fetch whenever the set of selected paths changes. We depend on the
  // serialized list of paths so that React's referential check stays cheap
  // (selections is a fresh array on each render of the parent tab).
  const pathsKey = selections.map((s) => s.imagePath).join('|');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    void (async () => {
      if (selections.length === 0) {
        if (!cancelled) {
          setTags([]);
          setLoaded(true);
        }
        return;
      }
      try {
        // Fan out — one IDB get per selected image. Volume is bounded by
        // INV-01 (≤ 5 table selections) + a small chuppah/napkins/upgrades
        // count, so a Promise.all of getImageTag() reads is well within
        // the SOP 02 § Performance Notes envelope. Falls back to an empty
        // result if the SOP 12 pass has not yet completed (most tags will
        // be `undefined`) — `<EmptyState>` handles the display.
        const results = await Promise.all(
          selections.map((s) => getImageTag(s.imagePath)),
        );
        if (cancelled) return;
        const present: ImageTag[] = results.filter(
          (t): t is ImageTag => t !== undefined,
        );
        setTags(present);
        setLoaded(true);
      } catch (err) {
        // SOP 02 errors here are non-fatal — we just render the empty state
        // so the tab keeps working. Log for diagnostics.
        // eslint-disable-next-line no-console
        console.error('[TagsDisplay] getImageTag failed', err);
        if (!cancelled) {
          setTags([]);
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // pathsKey is the structural fingerprint we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  // ── Compute the displayed chips: union of every tag's customLabels +
  // userCategory, deduped, NFC-normalized (since labels were NFC-normalized
  // on write by db.ts). Order: userCategories first (they are well-known and
  // shorter), then customLabels alphabetically for stable rendering.
  const chips = unionTagChips(tags);

  // ── Render ─────────────────────────────────────────────────────────────
  const testId = testIdSuffix
    ? `tags-display-${testIdSuffix}`
    : 'tags-display';

  // No selections at all → render the slot with the empty-state copy. We do
  // NOT render a "0 selections, nothing to do" message — the parent tab
  // already shows its own empty state for the image grid.
  if (selections.length === 0) {
    return (
      <EmptyState testId={testId} label={label} message={EMPTY_STATE_NO_SELECTIONS} />
    );
  }

  // Selections exist but have not been tagged yet (or tagging pass hasn't
  // run). Show the standard empty-state copy.
  if (loaded && chips.length === 0) {
    return (
      <EmptyState testId={testId} label={label} message={EMPTY_STATE_NO_TAGS} />
    );
  }

  return (
    <div
      data-testid={testId}
      className="bg-ink-raised border border-border-subtle p-6 flex flex-col gap-3"
    >
      <ChipLabel>{label}</ChipLabel>
      {!loaded ? (
        // Brief flicker-free placeholder while the IDB reads resolve. We
        // still surface the label so the slot height is stable.
        <p
          data-testid={`${testId}-loading`}
          className="text-tiny text-cream-muted"
        >
          טוען תגיות…
        </p>
      ) : (
        <ul
          data-testid={`${testId}-chips`}
          className="flex flex-wrap gap-2"
          aria-label={label}
        >
          {chips.map((c) => (
            <li
              key={c}
              dir="auto"
              className="inline-flex items-center border border-gold-dark px-3 py-1 text-tiny text-cream"
              style={{ borderRadius: 0 }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal — empty state
// ---------------------------------------------------------------------------

function EmptyState({
  testId,
  label,
  message,
}: {
  testId: string;
  label: string;
  message: string;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      className="bg-ink-raised border border-border-subtle p-6 flex flex-col gap-2"
    >
      <ChipLabel>{label}</ChipLabel>
      <p
        data-testid={`${testId}-empty`}
        className="text-tiny text-cream-muted"
        dir="auto"
      >
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the deduped list of chips to render for a set of `ImageTag`s.
 * Order: userCategories first (deduped), then customLabels (deduped,
 * locale-sorted for Hebrew). Both halves are NFC-normalized — db.ts already
 * NFC-normalizes on write, but we re-normalize here as a defense against any
 * future caller that bypasses the lib boundary.
 */
function unionTagChips(tags: readonly ImageTag[]): string[] {
  const userCategories = new Set<string>();
  const customLabels = new Set<string>();
  for (const t of tags) {
    if (t.userCategory) userCategories.add(t.userCategory.normalize('NFC'));
    for (const label of t.customLabels) {
      const normalized = label.trim().normalize('NFC');
      if (normalized.length > 0) customLabels.add(normalized);
    }
  }
  const sortedLabels = Array.from(customLabels).sort((a, b) =>
    a.localeCompare(b, 'he'),
  );
  return [...userCategories, ...sortedLabels];
}
