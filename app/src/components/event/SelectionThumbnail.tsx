// SOP: architecture/05-gallery-selection.md (selected cards must show the
//      chosen image, not a placeholder)
// Maintenance Log 2026-05-21: every event tab's selection card was rendering
// a `<span>תמונה</span>` placeholder instead of the actual thumbnail. Bug
// observed in NapkinsTab/UpgradesTab/TableDesignsTab/ChuppahTab/SummaryTab
// after Agent C delivered the gallery picker integration on 2026-05-21.
// Maintenance Log 2026-05-25: cold-start regression — when Shon reopened the
// app and went straight to Summary without visiting the gallery, the FS-URL
// resolution returned `null` and the card stuck on the placeholder. Added
// two persistent fallbacks below: `selectedImageBytes` (the 600px PNG cache
// baked at the previous export) and `thumbnails` (the 256px blob cache from
// the gallery scan). Order: FS URL → selectedImageBytes → thumbnails → ❖.
//
// This component is the single chokepoint for rendering an
// `ImageSelection`'s thumbnail across all event tabs.

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { selectionPathToSrc, selectionPathToSrcAsync } from '../../lib/images';
import { getSelectedImageBytes, getThumbnail } from '../../lib/db';

export type SelectionThumbnailProps = {
  imagePath: string;
  imageName?: string;
  /** Override aspect ratio class. Defaults to `aspect-[4/3]`. */
  aspectClass?: string;
  /** Inline className passed to the outer wrapper. */
  className?: string;
};

export function SelectionThumbnail({
  imagePath,
  imageName,
  aspectClass = 'aspect-[4/3]',
  className = '',
}: SelectionThumbnailProps): ReactNode {
  const syncSrc = selectionPathToSrc(imagePath);
  const [src, setSrc] = useState<string | null>(syncSrc);
  const [errored, setErrored] = useState(false);
  // Track the object URL we own so we can revoke it on unmount / path change.
  // Browsers leak the underlying blob memory until revoked even after the
  // <img> is gone, so this matters for long-running sessions.
  const ownedObjectUrlRef = useRef<string | null>(null);

  // Reset when the path changes
  useEffect(() => {
    setSrc(selectionPathToSrc(imagePath));
    setErrored(false);
    if (ownedObjectUrlRef.current) {
      URL.revokeObjectURL(ownedObjectUrlRef.current);
      ownedObjectUrlRef.current = null;
    }
  }, [imagePath]);

  // Stage 1 — async FS URL (primes the project-root cache).
  // Stage 2 — `selectedImageBytes` IDB cache (600px PNG baked at last export).
  // Stage 3 — `thumbnails` IDB cache (256px scan blob).
  // If all three miss, `src` stays null and we render the ❖ placeholder.
  useEffect(() => {
    if (src) return;
    let cancelled = false;

    async function resolve() {
      // Stage 1: FS URL via the asset protocol.
      try {
        const asyncSrc = await selectionPathToSrcAsync(imagePath);
        if (cancelled) return;
        if (asyncSrc) {
          setSrc(asyncSrc);
          return;
        }
      } catch {
        // fall through
      }

      // Stage 2: previously-baked PNG bytes.
      try {
        const cached = await getSelectedImageBytes(imagePath);
        if (cancelled) return;
        if (cached && cached.bytes && cached.bytes.byteLength > 0) {
          const blob = new Blob([cached.bytes], { type: cached.mimeType });
          const url = URL.createObjectURL(blob);
          if (ownedObjectUrlRef.current) {
            URL.revokeObjectURL(ownedObjectUrlRef.current);
          }
          ownedObjectUrlRef.current = url;
          setSrc(url);
          return;
        }
      } catch {
        // fall through
      }

      // Stage 3: gallery-scan thumbnail (256px JPEG blob).
      try {
        const thumb = await getThumbnail(imagePath);
        if (cancelled) return;
        if (thumb && thumb.blob) {
          const url = URL.createObjectURL(thumb.blob);
          if (ownedObjectUrlRef.current) {
            URL.revokeObjectURL(ownedObjectUrlRef.current);
          }
          ownedObjectUrlRef.current = url;
          setSrc(url);
          return;
        }
      } catch {
        // fall through — render placeholder
      }
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [imagePath, src]);

  // Revoke any owned object URL on unmount.
  useEffect(() => {
    return () => {
      if (ownedObjectUrlRef.current) {
        URL.revokeObjectURL(ownedObjectUrlRef.current);
        ownedObjectUrlRef.current = null;
      }
    };
  }, []);

  // If <img> errors out (e.g., the FS URL points at a file that was moved
  // since the asset protocol resolved it), drop back through the cache
  // fallbacks instead of giving up immediately.
  function onImgError() {
    setErrored(true);
    // Force re-resolution: clear src so the resolve() effect re-runs.
    setSrc(null);
  }

  const wrapperBase =
    'bg-ink border border-border-subtle flex items-center justify-center overflow-hidden';
  const wrapper = `${aspectClass} ${wrapperBase} ${className}`.trim();

  if (!src) {
    // Empty state — same chrome as the legacy placeholder. We use
    // a discreet glyph instead of the literal word "תמונה" so a missing
    // thumbnail reads as a state, not a label.
    return (
      <div className={wrapper} aria-hidden="true">
        <span className="text-h3 text-cream-muted/50 select-none">❖</span>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <img
        src={src}
        alt={imageName || ''}
        loading="lazy"
        decoding="async"
        onError={onImgError}
        className="w-full h-full object-cover"
        style={{ display: 'block' }}
      />
      {/* `errored` is referenced for hooks correctness; UI-wise we just
          retry through the resolve() effect. */}
      {errored ? null : null}
    </div>
  );
}
