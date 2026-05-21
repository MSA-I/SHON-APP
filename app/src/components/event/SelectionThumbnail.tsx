// SOP: architecture/05-gallery-selection.md (selected cards must show the
//      chosen image, not a placeholder)
// Maintenance Log 2026-05-21: every event tab's selection card was rendering
// a `<span>תמונה</span>` placeholder instead of the actual thumbnail. Bug
// observed in NapkinsTab/UpgradesTab/TableDesignsTab/ChuppahTab/SummaryTab
// after Agent C delivered the gallery picker integration on 2026-05-21.
//
// This component is the single chokepoint for rendering an
// `ImageSelection`'s thumbnail across all event tabs. Uses
// `selectionPathToSrc` (lib/images.ts) which returns null until the
// project-root cache is primed — in that window we render the same empty
// chrome that was there before so layout doesn't shift.

import { useState, type ReactNode } from 'react';
import { selectionPathToSrc } from '../../lib/images';

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
  const src = selectionPathToSrc(imagePath);
  const [errored, setErrored] = useState(false);

  const wrapperBase =
    'bg-ink border border-border-subtle flex items-center justify-center overflow-hidden';
  const wrapper = `${aspectClass} ${wrapperBase} ${className}`.trim();

  if (!src || errored) {
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
        onError={() => setErrored(true)}
        className="w-full h-full object-cover"
        style={{ display: 'block' }}
      />
    </div>
  );
}
