/**
 * ProjectRootPicker — manual fallback when `discoverProjectRoot()` returns
 * `kind: 'not-found'`. Shown to Shon (or any installer) before the home
 * screen can render so the app knows where the image library lives.
 *
 * SOP: architecture/08-tauri-filesystem.md § Project Root Resolution (v2)
 * claude.md Maintenance Log 2026-05-24 — runtime root discovery.
 *
 * Flow:
 *  1. User clicks "בחר תיקייה" → opens `@tauri-apps/plugin-dialog` directory picker.
 *  2. On selection, call `setProjectRootManually(absPath)`. Validates that the
 *     chosen folder contains the canonical 8 image folders.
 *  3. On success → `onPicked()`, AppShell re-runs the boot sequence from the top.
 *  4. On validation failure → surface `IMG_CATEGORY_MISSING` Hebrew message.
 *
 * The list of paths we already tried is shown in a collapsed details block so
 * the user can verify their folder isn't there and understand why we're
 * asking. No Tauri capability constraints inside dialog — picker is unscoped.
 */

import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { setProjectRootManually } from '../../lib/config';
import { LibError } from '../../types';
import { Button, Ornament } from '../ui';

export type ProjectRootPickerProps = {
  /** List of paths discovery tried — surfaced for transparency. */
  triedPaths: string[];
  /** Called after a successful pick + persist. AppShell should re-run boot. */
  onPicked: () => void;
};

export function ProjectRootPicker({ triedPaths, onPicked }: ProjectRootPickerProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTried, setShowTried] = useState(false);

  const handlePick = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: 'בחר את תיקיית "שון בלאיש"',
      });
      if (!picked || typeof picked !== 'string') {
        // User cancelled — nothing to do.
        setBusy(false);
        return;
      }
      try {
        await setProjectRootManually(picked);
        onPicked();
      } catch (err) {
        if (err instanceof LibError) {
          setError(err.message);
        } else {
          setError('שגיאה בלתי צפויה. נסה שוב.');
          console.error('[ProjectRootPicker] unexpected error', err);
        }
        setBusy(false);
      }
    } catch (err) {
      console.error('[ProjectRootPicker] dialog failed', err);
      setError('פתיחת חלון בחירת תיקייה נכשלה.');
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="project-root-picker"
      dir="rtl"
      lang="he"
      className="min-h-screen bg-ink text-cream flex flex-col items-center justify-center px-8"
    >
      <div className="max-w-2xl w-full text-center">
        <span
          aria-hidden="true"
          className="font-serif text-gold block"
          style={{ fontSize: '48px', lineHeight: 1 }}
        >
          ❖
        </span>
        <h1
          className="font-serif text-cream mt-6"
          style={{ fontSize: '32px', fontWeight: 500, lineHeight: 1.2 }}
        >
          איתור ספריית התמונות
        </h1>
        <p className="font-sans text-cream-muted mt-4 leading-relaxed">
          האפליקציה לא מצאה את תיקיית "שון בלאיש" עם תיקיות התמונות הצפויות.
          <br />
          אנא בחר את התיקייה הראשית שמכילה את 8 תיקיות הקטגוריות.
        </p>

        <Ornament size="medium" variant="divider" />

        <div className="flex flex-col items-center gap-4">
          <Button
            variant="primary"
            onClick={handlePick}
            disabled={busy}
            testId="pick-project-root"
          >
            {busy ? 'בודק…' : 'בחר תיקייה'}
          </Button>

          {error ? (
            <p
              role="alert"
              className="font-sans text-small max-w-md"
              style={{ color: 'var(--color-danger, #c25b5b)' }}
            >
              {error}
            </p>
          ) : null}
        </div>

        {triedPaths.length > 0 ? (
          <details
            className="mt-12 text-right max-w-xl mx-auto"
            open={showTried}
            onToggle={(e) => setShowTried((e.target as HTMLDetailsElement).open)}
          >
            <summary className="font-sans text-small text-cream-muted cursor-pointer select-none">
              נתיבים שנוסו במהלך החיפוש האוטומטי ({triedPaths.length})
            </summary>
            <ul className="mt-3 font-sans text-small text-cream-muted space-y-1 list-disc inset-inline-start-6">
              {triedPaths.map((p) => (
                <li key={p} dir="ltr" className="font-mono">
                  {p}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
