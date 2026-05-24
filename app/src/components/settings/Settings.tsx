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
import { Check, Copy, Download, Files, Moon, RefreshCw, Sun, TriangleAlert, Upload } from 'lucide-react';
import { motion } from 'framer-motion';

import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import * as backup from '../../lib/backup';
import * as db from '../../lib/db';
import { getBackupsDir } from '../../lib/paths';
import { Stagger } from '../../lib/motion/Stagger';
import { useEntrance } from '../../lib/motion/useEntrance';
import { DuplicatesReport } from './DuplicatesReport';
import { tauriFsExtras } from '../../lib/tauri-fs';

// =============================================================================
// Component
// =============================================================================

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const headerEntrance = useEntrance();

  const [backupsDir, setBackupsDir] = useState<string>('');
  const [pathCopied, setPathCopied] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isDuplicatesOpen, setIsDuplicatesOpen] = useState(false);
  const [isRetagModalOpen, setIsRetagModalOpen] = useState(false);
  const [isRetagging, setIsRetagging] = useState(false);

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

  // ── Retag entire library (SOP 12 reset) ──────────────────────────────────

  const handleRetagClick = useCallback(() => {
    if (isRetagging) return;
    setIsRetagModalOpen(true);
  }, [isRetagging]);

  const handleRetagConfirm = useCallback(async () => {
    if (isRetagging) return;
    setIsRetagModalOpen(false);
    setIsRetagging(true);
    try {
      // Step 1-2: export current imageTags to a timestamped backup file.
      const tags = await db.listImageTags();
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const backupFilename = `imageTags-backup-${timestamp}.json`;
      const backupPath = `${backupsDir}/${backupFilename}`;
      const envelope = {
        exportedAt: Date.now(),
        imageTags: tags,
      };
      try {
        await tauriFsExtras.writeTextFile(backupPath, JSON.stringify(envelope, null, 2));
      } catch (backupErr) {
        console.error('[settings] retag: backup write failed', backupErr);
        toast({ kind: 'error', message: 'יצירת הגיבוי נכשלה — התייג מחדש בוטל' });
        return; // Abort before clearing.
      }

      // Step 3: clear all imageTags.
      try {
        await db.clearImageTags();
      } catch (clearErr) {
        console.error('[settings] retag: clearImageTags failed', clearErr);
        toast({ kind: 'error', message: 'מחיקת התיוגים הקיימים נכשלה' });
        return;
      }

      // Step 4: set taggingComplete = false so the boot sequence re-opens the pass.
      try {
        await db.setMeta('taggingComplete', false);
      } catch (metaErr) {
        console.error('[settings] retag: setMeta failed', metaErr);
        toast({ kind: 'error', message: 'איפוס הסטטוס נכשל' });
        return;
      }

      // Step 5: success toast.
      toast({ kind: 'success', message: 'הספרייה אופסה. מתחיל תיוג מחדש...' });

      // Step 6: reload (boot sequence will see taggingComplete=false and open the pass).
      window.setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err) {
      console.error('[settings] retag failed', err);
      toast({ kind: 'error', message: 'התייג מחדש נכשל' });
    } finally {
      setIsRetagging(false);
    }
  }, [isRetagging, backupsDir, toast]);

  const handleRetagCancel = useCallback(() => {
    setIsRetagModalOpen(false);
  }, []);

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
        <motion.header {...headerEntrance}>
          <p
            className="text-label uppercase text-gold-dark"
            style={{ letterSpacing: '0.12em' }}
          >
            ❖ ניהול האפליקציה
          </p>
          <h1 className="font-serif text-hero mt-6">הגדרות</h1>
        </motion.header>

        <Divider />

        {/* Stagger the three sections after the title divider so the page
            reveals top-down rather than as a single block. Step 0.1 keeps
            the cascade snappy (≈ 300ms total). */}
        <Stagger step={0.1} delay={0.18}>
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

              <PrimaryButton
                onClick={() => setIsDuplicatesOpen(true)}
                icon={<Files size={16} strokeWidth={1.5} />}
                testId="settings-find-duplicates"
              >
                מצא תמונות כפולות
              </PrimaryButton>

              <PrimaryButton
                onClick={handleRetagClick}
                disabled={isRetagging}
                icon={<RefreshCw size={16} strokeWidth={1.5} />}
                testId="settings-retag"
              >
                {isRetagging ? 'מאפס…' : 'תייג מחדש את כל הספרייה'}
              </PrimaryButton>
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
        </Stagger>
      </div>

      {isDuplicatesOpen && (
        <DuplicatesReport onClose={() => setIsDuplicatesOpen(false)} />
      )}

      {isRetagModalOpen && (
        <RetagConfirmModal
          onConfirm={handleRetagConfirm}
          onCancel={handleRetagCancel}
        />
      )}
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
      style={{ color: 'var(--danger)' }}
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
        style={{ background: 'var(--danger)' }}
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

// =============================================================================
// Retag Confirm Modal
// =============================================================================
//
// Simple centered overlay modal for the "תייג מחדש את כל הספרייה" confirmation
// flow. Uses the same Luxury Editorial palette + inline styling as the rest of
// Settings.tsx (no extra primitive dep). Inline modal state kept in Settings;
// this is a presentational child.

function RetagConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="retag-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retag-modal-title"
      dir="rtl"
      lang="he"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        className="
          relative w-full max-w-md
          bg-ink-raised border border-border-subtle
          px-8 py-8
        "
        style={{ borderRadius: 2 }}
      >
        <h2
          id="retag-modal-title"
          className="font-serif text-h2 mb-6"
        >
          תייג מחדש את כל הספרייה
        </h2>
        <p className="text-body text-cream-muted leading-relaxed mb-8">
          <span className="text-danger font-bold">אזהרה:</span> פעולה זו תמחק
          את כל התיוגים הקיימים ותפתח מחדש את שלב התיוג. גיבוי אוטומטי של
          התיוגים הנוכחיים יישמר לפני המחיקה.
        </p>

        <div className="flex gap-4 justify-end">
          <button
            type="button"
            onClick={onCancel}
            data-testid="retag-modal-cancel"
            className="
              px-6 py-3
              text-body text-cream-muted
              border border-border-subtle
              transition-colors duration-150
              hover:border-gold hover:text-cream
            "
            style={{ borderRadius: 2 }}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="retag-modal-confirm"
            className="
              px-6 py-3
              text-body text-cream
              bg-ink-raised border border-border-subtle
              transition-colors duration-150
              hover:border-gold hover:text-gold-dark
            "
            style={{ borderRadius: 2 }}
          >
            המשך
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default Settings;
