// SOP: claude.md § Behavioral Rule #2 (image library is read-only — detect-only)
// SOP: architecture/09-design-tokens.md (Luxury Editorial palette)
// SOP: architecture/15-component-architecture.md (Layer 2 imports — components
//      may use lib/ but must NOT import from '@tauri-apps/*' outside lib/, with
//      a single exception: the opener plugin, used the same way as in
//      components/event/SummaryTab.tsx).
//
// Full-screen modal that surfaces likely-duplicate images in the read-only
// reference library. The user can ONLY view + open in Explorer — no delete,
// no move, no rename — because Behavioral Rule #2 forbids touching the
// source folders.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, X } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';
import { findDuplicates, type DuplicateCluster, type DuplicateReason } from '../../lib/dedup';
import { getOrBakeThumbnail, scanAll } from '../../lib/images';
import { getProjectRoot } from '../../lib/config';
import type { ImageMetadata } from '../../types';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type DuplicatesReportProps = {
  /** Closes the modal. The caller is expected to abort any in-flight work via
   *  its own AbortController if needed (we only fire `onClose` once the user
   *  confirms — the unmount-side abort is handled internally). */
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<DuplicateReason, string> = {
  name: 'לפי שם',
  hash: 'לפי תוכן',
  'name+hash': 'לפי שם + תוכן',
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.round(kb)} KB`;
}

/** POSIX-style relPath → absolute Windows-native path for revealItemInDir. */
function toNativeAbsolute(root: string, relPath: string): string {
  const joined = `${root.replace(/[\\/]+$/, '')}/${relPath.replace(/^[\\/]+/, '')}`;
  return joined.replace(/\//g, '\\');
}

// ---------------------------------------------------------------------------
// Thumbnail tile — defers blob → object URL creation per row.
// ---------------------------------------------------------------------------

function Thumbnail({ image, size }: { image: ImageMetadata; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      try {
        const blob = await getOrBakeThumbnail(image);
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {
        // Non-fatal — render the placeholder.
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  return (
    <div
      style={{
        width: size,
        height: size,
        background: 'var(--ink-raised, #1A1714)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={image.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--cream-muted)',
            fontSize: 12,
          }}
        >
          ···
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning'; done: number; total: number }
  | { kind: 'done'; clusters: DuplicateCluster[] }
  | { kind: 'error'; message: string };

export function DuplicatesReport({ onClose }: DuplicatesReportProps) {
  const { toast } = useToast();
  const [state, setState] = useState<ScanState>({ kind: 'idle' });
  const [projectRoot, setProjectRoot] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // Run the scan once on mount; abort on unmount.
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: 'scanning', done: 0, total: 0 });

    void (async () => {
      try {
        // Resolve the project root in parallel with the scan so the
        // "open in Explorer" buttons have a path to use later.
        const [root, scan] = await Promise.all([
          getProjectRoot(),
          scanAll(),
        ]);
        if (ctrl.signal.aborted) return;
        setProjectRoot(root);

        // Flatten all categories. We deduplicate across the WHOLE library —
        // the same picture sometimes lives in two category folders.
        const allImages: ImageMetadata[] = [];
        for (const items of scan.byCategory.values()) {
          for (const it of items) allImages.push(it);
        }

        if (allImages.length === 0) {
          setState({ kind: 'done', clusters: [] });
          return;
        }

        setState({ kind: 'scanning', done: 0, total: allImages.length });

        const clusters = await findDuplicates(
          allImages,
          (img) => getOrBakeThumbnail(img),
          {
            signal: ctrl.signal,
            onProgress: (done, total) => {
              if (ctrl.signal.aborted) return;
              setState({ kind: 'scanning', done, total });
            },
          },
        );

        if (ctrl.signal.aborted) return;
        setState({ kind: 'done', clusters });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'שגיאה בסריקה';
        setState({ kind: 'error', message });
      }
    })();

    return () => {
      ctrl.abort();
      abortRef.current = null;
    };
  }, []);

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const handleReveal = async (image: ImageMetadata) => {
    if (!projectRoot) {
      toast({ kind: 'error', message: 'נתיב הפרויקט לא זמין' });
      return;
    }
    try {
      await revealItemInDir(toNativeAbsolute(projectRoot, image.path));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[duplicates] revealItemInDir failed', err);
      toast({ kind: 'error', message: 'פתיחת התיקייה נכשלה' });
    }
  };

  const totalDuplicates = useMemo(() => {
    if (state.kind !== 'done') return 0;
    return state.clusters.reduce((sum, c) => sum + c.duplicates.length, 0);
  }, [state]);

  return (
    <AnimatePresence>
      <motion.div
        key="duplicates-overlay"
        dir="rtl"
        lang="he"
        data-testid="duplicates-report"
        className="fixed inset-0 z-50 flex flex-col bg-ink text-cream"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicates-title"
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header
          className="flex items-center justify-between px-12 py-8 border-b border-border-subtle"
          style={{ flexShrink: 0 }}
        >
          <div>
            <p
              className="text-label uppercase text-gold-dark"
              style={{ letterSpacing: '0.12em' }}
            >
              ❖ ניהול ספריית התמונות
            </p>
            <h1 id="duplicates-title" className="font-serif text-h1 mt-3">
              תמונות כפולות
            </h1>
          </div>
          <button
            type="button"
            onClick={handleClose}
            data-testid="duplicates-close"
            aria-label="סגור"
            className="
              inline-flex items-center justify-center
              w-12 h-12
              text-cream-muted hover:text-cream
              transition-colors duration-150
            "
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </header>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-12 py-8" style={{ minHeight: 0 }}>
          {state.kind === 'idle' && (
            <p className="text-body text-cream-muted">מתחיל סריקה…</p>
          )}

          {state.kind === 'scanning' && (
            <ScanProgress done={state.done} total={state.total} />
          )}

          {state.kind === 'error' && (
            <p className="text-body" style={{ color: 'var(--danger)' }}>
              שגיאה בסריקה: {state.message}
            </p>
          )}

          {state.kind === 'done' && state.clusters.length === 0 && (
            <div className="mt-12">
              <p className="font-serif text-h2">לא נמצאו כפולות</p>
              <p className="text-body text-cream-muted mt-4">
                ספריית התמונות נסרקה במלואה ולא זוהו תמונות חופפות.
              </p>
            </div>
          )}

          {state.kind === 'done' && state.clusters.length > 0 && (
            <>
              <p className="text-body text-cream-muted mb-8">
                נמצאו {state.clusters.length} קבוצות (סך הכל {totalDuplicates}{' '}
                כפילויות). התמונה הראשונה בכל קבוצה היא המקור — שאר התמונות
                נראות זהות לה. ניתן לפתוח כל אחת בתיקייה כדי להחליט ידנית מה
                לעשות.
              </p>

              <ul className="flex flex-col gap-12">
                {state.clusters.map((cluster, i) => (
                  <ClusterCard
                    key={cluster.canonical.path + ':' + i}
                    cluster={cluster}
                    onReveal={handleReveal}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer
          className="px-12 py-6 border-t border-border-subtle flex items-center justify-end gap-4"
          style={{ flexShrink: 0 }}
        >
          <Button
            variant="primary"
            onClick={handleClose}
            testId="duplicates-footer-close"
          >
            סגור
          </Button>
        </footer>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-12 max-w-2xl" data-testid="duplicates-progress">
      <p
        className="text-label uppercase text-gold-dark"
        style={{ letterSpacing: '0.12em' }}
      >
        סורק…
      </p>
      <p className="font-serif text-h2 mt-3">
        {total === 0 ? 'מאתר תמונות' : `${done} מתוך ${total}`}
      </p>
      <div
        className="mt-6 h-px w-full bg-border-subtle relative overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <motion.div
          className="absolute inset-y-0 right-0 bg-gold"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>
      <p className="text-small text-cream-muted mt-3">{pct}%</p>
    </div>
  );
}

function ClusterCard({
  cluster,
  onReveal,
}: {
  cluster: DuplicateCluster;
  onReveal: (image: ImageMetadata) => void;
}) {
  return (
    <li
      className="border border-border-subtle p-8"
      style={{ background: 'var(--ink-raised)' }}
      data-testid="duplicates-cluster"
    >
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <p
          className="text-label uppercase text-gold-dark"
          style={{ letterSpacing: '0.12em' }}
        >
          {REASON_LABEL[cluster.reason]} · {cluster.duplicates.length + 1} תמונות
        </p>
        <p className="text-tiny text-cream-muted">
          קטגוריה: {cluster.canonical.category}
        </p>
      </div>

      <div className="flex flex-wrap gap-6">
        <ImageBlock
          image={cluster.canonical}
          isCanonical
          onReveal={onReveal}
        />
        {cluster.duplicates.map((img) => (
          <ImageBlock
            key={img.path}
            image={img}
            isCanonical={false}
            onReveal={onReveal}
          />
        ))}
      </div>
    </li>
  );
}

function ImageBlock({
  image,
  isCanonical,
  onReveal,
}: {
  image: ImageMetadata;
  isCanonical: boolean;
  onReveal: (image: ImageMetadata) => void;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      style={{ width: 160 }}
    >
      <div style={{ position: 'relative' }}>
        <Thumbnail image={image} size={160} />
        {isCanonical && (
          <span
            className="absolute top-1 right-1 text-tiny px-2 py-0.5"
            style={{
              background: 'var(--gold)',
              color: 'var(--ink, #0E0B08)',
              letterSpacing: '0.08em',
            }}
          >
            מקור
          </span>
        )}
      </div>
      <p
        className="text-tiny text-cream truncate"
        title={image.name}
        dir="auto"
      >
        {image.name}
      </p>
      <p className="text-tiny text-cream-muted">
        {formatSize(image.sizeBytes)}
      </p>
      <button
        type="button"
        onClick={() => onReveal(image)}
        className="
          inline-flex items-center gap-2
          text-small text-gold-dark hover:text-gold
          transition-colors duration-150
        "
      >
        <FolderOpen size={14} strokeWidth={1.5} />
        <span>פתח בתיקייה</span>
      </button>
    </div>
  );
}

export default DuplicatesReport;
