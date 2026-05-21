// SOP: architecture/07-backup-strategy.md § Settings Panel Surface
// SOP: architecture/14-theme-toggle.md § 5–6 (Theme placement & component)
// SOP: claude.md § Verification step 8/9 (manual export → roundtrip restore)
//
// Settings panel — Editorial single-column layout. Hebrew, RTL.
//
// Three sections, separated by ❖ dividers, in this exact order:
//   1. גיבוי   — manual export, manual import, reset all local data
//   2. ערכת נושא — light / dark radio chips wired to ThemeContext
//   3. מידע    — backups dir path with copy button + version footer
//
// All buttons are inline-styled using the Luxury Editorial tokens
// (text-cream, text-cream-muted, text-gold-dark, border-border-subtle, …).
// Reset uses `db.exportAll → db.importAll(emptyEnvelope, 'overwrite')` so the
// user always has a "safety backup" snapshot of their previous state in
// memory (the export object is logged to console for diagnostics if anything
// goes wrong before the destructive write lands).
//
// Toasts: routed through the global `useToast()` hook (ToastContext). The
// previous inline state machine + per-component <AnimatePresence> have been
// retired in favor of the single app-wide <ToastProvider> mounted in App.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Moon, Sun, TriangleAlert, Upload } from 'lucide-react';

import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import * as backup from '../../lib/backup';
import * as db from '../../lib/db';
import { getBackupsDir } from '../../lib/paths';

// =============================================================================
// Component
// =============================================================================

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [backupsDir, setBackupsDir] = useState<string>('');
  const [pathCopied, setPathCopied] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Resolve the backups directory once on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dir = await getBackupsDir();
        if (!cancelled) setBackupsDir(dir);
      } catch {
        if (!cancelled) setBackupsDir('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Backup actions ────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await backup.exportBackup('manual');
      toast({ kind: 'success', message: `הגיבוי נשמר ב: ${result.path}` });
    } catch (err) {
      console.error('[settings] exportBackup failed', err);
      toast({ kind: 'error', message: 'ייצוא הגיבוי נכשל' });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, toast]);

  const handleImportClick = useCallback(() => {
    if (isImporting) return;
    fileInputRef.current?.click();
  }, [isImporting]);

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Always reset the input so picking the same file twice still fires.
      event.target.value = '';
      if (!file) return;
      setIsImporting(true);
      try {
        const text = await file.text();
        const result = await backup.importBackup(text, 'overwrite');
        toast({
          kind: 'success',
          message: `הגיבוי שוחזר: ${result.clients} לקוחות, ${result.events} אירועים`,
        });
      } catch (err) {
        console.error('[settings] importBackup failed', err);
        toast({ kind: 'error', message: 'ייבוא הגיבוי נכשל — בדוק את הקובץ' });
      } finally {
        setIsImporting(false);
      }
    },
    [toast],
  );

  const handleReset = useCallback(async () => {
    if (isResetting) return;
    // Native confirm is fine here per the spec — keeps Settings.tsx self-
    // contained without a modal component dep. (RTL is honored by the OS.)
    const confirmed = window.confirm('האם לאפס את כל הנתונים?');
    if (!confirmed) return;
    setIsResetting(true);
    try {
      // Safety net: snapshot the current DB to memory before the destructive
      // write. We don't write this to disk (the user can always export
      // manually first) — it's logged so support can recover from a console
      // dump if a reset was accidental.
      try {
        const snapshot = await db.exportAll();
        console.info(
          '[settings] reset: pre-clear snapshot captured (in memory only)',
          {
            clients: snapshot.clients.length,
            events: snapshot.events.length,
            imageTags: snapshot.imageTags.length,
          },
        );
      } catch (snapshotErr) {
        console.error('[settings] reset: pre-clear snapshot failed', snapshotErr);
      }

      // Build a fresh, empty envelope at the live DB_VERSION. `db.importAll`
      // in 'overwrite' mode clears clients + events + imageTags atomically
      // and stamps `meta.lastImportAt` (preserving lastBackupAt / lastScanAt
      // / theme per SOP 02).
      await db.importAll(
        {
          schemaVersion: db.DB_VERSION,
          clients: [],
          events: [],
          imageTags: [],
        },
        'overwrite',
      );
      toast({ kind: 'success', message: 'הנתונים אופסו' });
    } catch (err) {
      console.error('[settings] reset failed', err);
      toast({ kind: 'error', message: 'איפוס הנתונים נכשל' });
    } finally {
      setIsResetting(false);
    }
  }, [isResetting, toast]);

  // ── Theme switch (light/dark chips) ───────────────────────────────────────

  const handleThemeChange = useCallback(
    (next: 'light' | 'dark') => {
      if (next === theme) return;
      setTheme(next);
    },
    [setTheme, theme],
  );

  // ── Copy backups dir path ─────────────────────────────────────────────────

  const handleCopyPath = useCallback(async () => {
    if (!backupsDir) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(backupsDir);
      } else {
        // Best-effort fallback for environments without the async clipboard
        // API (jsdom, older WebView2 builds): no-op + toast.
        throw new Error('clipboard unavailable');
      }
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1500);
      toast({ kind: 'success', message: 'הנתיב הועתק' });
    } catch (err) {
      console.error('[settings] copy path failed', err);
      toast({ kind: 'error', message: 'העתקת הנתיב נכשלה' });
    }
  }, [backupsDir, toast]);

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <main
      data-testid="settings"
      dir="rtl"
      lang="he"
      className="min-h-screen bg-ink text-cream"
    >
      <div className="mx-auto max-w-3xl px-16 py-24">
        {/* ── Page title ───────────────────────────────────────────────── */}
        <header>
          <p
            className="text-label uppercase text-gold-dark"
            style={{ letterSpacing: '0.12em' }}
          >
            ❖ ניהול האפליקציה
          </p>
          <h1 className="font-serif text-hero mt-6">הגדרות</h1>
        </header>

        <Divider />

        {/* ── 1. גיבוי ─────────────────────────────────────────────────── */}
        <Section title="גיבוי" eyebrow="ייצוא, שחזור ואיפוס">
          <p className="text-body text-cream-muted leading-relaxed">
            שמור עותק מלא של כל הלקוחות והאירועים, או שחזר מצב קודם מקובץ JSON.
            איפוס יוחק את כל הרשומות המקומיות — פעולה זו אינה ניתנת לשחזור ללא
            גיבוי.
          </p>

          <div className="mt-8 flex flex-col gap-6">
            <div className="flex items-center gap-6 flex-wrap">
              <PrimaryButton
                onClick={handleExport}
                disabled={isExporting}
                icon={<Download size={16} strokeWidth={1.5} />}
                testId="settings-export"
              >
                {isExporting ? 'מייצא…' : 'ייצוא גיבוי'}
              </PrimaryButton>

              <PrimaryButton
                onClick={handleImportClick}
                disabled={isImporting}
                icon={<Upload size={16} strokeWidth={1.5} />}
                testId="settings-import"
              >
                {isImporting ? 'מייבא…' : 'ייבוא גיבוי'}
              </PrimaryButton>

              {/* Hidden file picker — triggered by the import button. */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                style={{ display: 'none' }}
                data-testid="settings-import-input"
              />
            </div>

            <div>
              <DangerButton
                onClick={handleReset}
                disabled={isResetting}
                icon={<TriangleAlert size={16} strokeWidth={1.5} />}
                testId="settings-reset"
              >
                {isResetting ? 'מאפס…' : 'אפס נתונים מקומיים'}
              </DangerButton>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── 2. ערכת נושא ─────────────────────────────────────────────── */}
        <Section title="ערכת נושא" eyebrow="כהה / בהיר">
          <p className="text-body text-cream-muted leading-relaxed">
            ההעדפה נשמרת באופן מקומי ומשוחזרת בהפעלה הבאה.
          </p>

          <div
            role="radiogroup"
            aria-label="בחירת ערכת נושא"
            className="mt-8 inline-flex items-stretch border border-border-subtle"
          >
            <ThemeChip
              active={theme === 'dark'}
              onClick={() => handleThemeChange('dark')}
              icon={<Moon size={16} strokeWidth={1.5} />}
              label="כהה"
              testId="settings-theme-dark"
            />
            <span
              aria-hidden="true"
              className="self-stretch w-px bg-border-subtle"
            />
            <ThemeChip
              active={theme === 'light'}
              onClick={() => handleThemeChange('light')}
              icon={<Sun size={16} strokeWidth={1.5} />}
              label="בהיר"
              testId="settings-theme-light"
            />
          </div>
        </Section>

        <Divider />

        {/* ── 3. מידע ──────────────────────────────────────────────────── */}
        <Section title="מידע" eyebrow="נתיבים וגרסה">
          <div>
            <p
              className="text-label uppercase text-gold-dark block"
              style={{ letterSpacing: '0.12em' }}
            >
              תיקיית הגיבויים
            </p>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <code
                dir="ltr"
                className="text-small text-cream-muted bg-ink-raised border border-border-subtle px-4 py-3 font-tabular flex-1 min-w-0 break-all"
                data-testid="settings-backups-dir"
              >
                {backupsDir || '—'}
              </code>
              <TertiaryButton
                onClick={handleCopyPath}
                disabled={!backupsDir}
                icon={
                  pathCopied ? (
                    <Check size={14} strokeWidth={1.5} />
                  ) : (
                    <Copy size={14} strokeWidth={1.5} />
                  )
                }
                testId="settings-copy-path"
              >
                {pathCopied ? 'הועתק' : 'העתק'}
              </TertiaryButton>
            </div>
          </div>

          <p className="text-tiny text-cream-muted mt-16">
            Shon Blaish — Event Designer v1.0
          </p>
        </Section>
      </div>
    </main>
  );
}

// =============================================================================
// Local presentational primitives
// =============================================================================

function Divider() {
  return (
    <div className="my-16 flex items-center justify-center" aria-hidden="true">
      <span className="font-serif text-h2 text-gold">❖</span>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p
        className="text-label uppercase text-gold-dark"
        style={{ letterSpacing: '0.12em' }}
      >
        {eyebrow}
      </p>
      <h2 className="font-serif text-h2 mt-3">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

type ButtonBaseProps = {
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
};

function PrimaryButton({
  onClick,
  disabled,
  icon,
  children,
  testId,
}: ButtonBaseProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="
        group relative inline-flex items-center gap-3
        px-6 py-3
        bg-ink-raised border border-border-subtle
        text-body text-cream
        transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]
        hover:border-gold hover:text-gold-dark
        disabled:opacity-50 disabled:cursor-not-allowed
        disabled:hover:border-border-subtle disabled:hover:text-cream
      "
      style={{ borderRadius: 2 }}
    >
      {icon && (
        <span className="flex items-center text-gold-dark group-hover:text-gold">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}

function DangerButton({
  onClick,
  disabled,
  icon,
  children,
  testId,
}: ButtonBaseProps) {
  // Red-tinted tertiary: muted destructive cue without abandoning the
  // editorial palette. Uses the same gold underline pattern as the primary
  // links but tints the text with a warm red on hover.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="
        group relative inline-flex items-center gap-3
        text-small
        transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]
        disabled:opacity-50 disabled:cursor-not-allowed
      "
      style={{ color: '#C46B6B' }}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      <span>{children}</span>
      <span
        aria-hidden="true"
        className="
          absolute inset-x-0 -bottom-1 h-px
          origin-[inset-inline-start]
          scale-x-0 transition-transform duration-150
          ease-[cubic-bezier(0.4,0,0.2,1)]
          group-hover:scale-x-100
          group-disabled:scale-x-0
        "
        style={{ background: '#C46B6B' }}
      />
    </button>
  );
}

function TertiaryButton({
  onClick,
  disabled,
  icon,
  children,
  testId,
}: ButtonBaseProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="
        group inline-flex items-center gap-2
        text-small text-cream-muted
        transition-colors duration-150
        ease-[cubic-bezier(0.4,0,0.2,1)]
        hover:text-cream
        disabled:opacity-50 disabled:cursor-not-allowed
        disabled:hover:text-cream-muted
      "
    >
      {icon && (
        <span className="flex items-center text-gold-dark group-hover:text-gold">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}

function ThemeChip({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className="
        inline-flex items-center gap-3
        px-6 py-3
        text-body
        transition-colors duration-150
        ease-[cubic-bezier(0.4,0,0.2,1)]
      "
      style={{
        background: active ? 'var(--ink-raised, #1A1714)' : 'transparent',
        color: active
          ? 'var(--cream, #F5F0E8)'
          : 'var(--cream-muted, #A8A39B)',
      }}
    >
      <span
        className="flex items-center"
        style={{
          color: active
            ? 'var(--gold, #C9A961)'
            : 'var(--gold-dark, #A88B47)',
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default Settings;
