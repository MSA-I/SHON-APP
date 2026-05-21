// SOP: architecture/05-gallery-selection.md § Lightbox — full-resolution
// preview rendered via `images.toImageSrc` (asset:// URL, bypasses thumbnail).
// SOP: architecture/05-gallery-selection.md § Accessibility — ESC closes,
// `role="dialog" aria-modal="true"`, focus-trap on the wrapper.
// SOP: architecture/09-design-tokens.md § 4 — sharp corners, no shadow,
// ink-raised surface; gold reserved for the focus ring + the ❖ flourish.

import { motion } from 'framer-motion';
import { Check, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toImageSrc } from '../../lib/images';
import type { ImageMetadata } from '../../types';

export type LightboxProps = {
  image: ImageMetadata;
  onClose: () => void;
  /** When provided, renders the select / deselect button. */
  onSelect?: () => void;
  /** Whether the image is currently in the selection set. */
  selected: boolean;
};

/**
 * Full-screen image preview. Click backdrop or press ESC to close. The
 * source URL is resolved synchronously via `toImageSrc(image)` — the gallery
 * has already triggered a scan, so the project root cache is primed.
 */
export function Lightbox({ image, onClose, onSelect, selected }: LightboxProps) {
  const [errored, setErrored] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Resolve the image src once. If `toImageSrc` ever throws (path-traversal
  // guard, unprimed root, etc.), we render the "not found" state and let the
  // user dismiss the lightbox without crashing the whole gallery.
  let resolvedSrc: string | null = null;
  try {
    resolvedSrc = toImageSrc(image);
  } catch {
    resolvedSrc = null;
  }

  // ESC key + initial focus trap (§ Accessibility).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      data-testid="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      onClick={(e) => {
        // Close when the dim backdrop itself is clicked — not when the
        // children are clicked.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Close button (top inline-end → top-left in RTL). */}
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        aria-label="סגור"
        data-testid="lightbox-close"
        className="absolute top-8 end-8 inline-flex h-11 w-11 items-center justify-center text-cream-muted transition-colors duration-150 hover:text-gold focus-visible:outline-2 focus-visible:outline-gold"
      >
        <X size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {/* Image surface */}
      <div
        className="relative flex max-h-[80vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {resolvedSrc && !errored ? (
          <img
            src={resolvedSrc}
            alt={image.name}
            data-testid="lightbox-image"
            className="block max-h-[80vh] max-w-[90vw] object-contain"
            onError={() => setErrored(true)}
          />
        ) : (
          <div
            data-testid="lightbox-error"
            className="flex h-[60vh] w-[60vw] items-center justify-center border border-border-subtle bg-ink-raised px-12 text-center"
          >
            <p className="font-sans text-body text-cream-muted">
              התמונה לא נמצאה
            </p>
          </div>
        )}
      </div>

      {/* Filename + select action */}
      <div
        className="mt-8 flex flex-col items-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="font-sans text-tiny text-cream-muted"
          data-testid="lightbox-filename"
          dir="rtl"
        >
          {image.name}
        </p>

        {onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            data-testid="lightbox-select"
            aria-pressed={selected}
            className={[
              'group relative inline-flex items-center gap-2 px-6 py-3 font-sans text-label uppercase tracking-[0.12em]',
              'border transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
              selected
                ? 'border-gold text-gold'
                : 'border-border-subtle text-cream hover:border-gold hover:text-gold',
            ].join(' ')}
            style={{ borderRadius: 0 }}
          >
            {selected ? (
              <>
                <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>נבחר</span>
              </>
            ) : (
              <>
                <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>הוסף לבחירה</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}
