// SOP: architecture/15-component-architecture.md § contexts/ — sibling
// context to ThemeContext / EventContext. Layer-2 only; no @tauri-apps,
// no idb imports.
// SOP: architecture/09-design-tokens.md § 5 — RTL-aware inline-end pinning,
// no shadows, motion timings via --motion-modal / --motion-quick.
//
// Global toast queue. Replaces the inline toast state machines that used to
// live in Settings.tsx and (implicitly, as TODO comments) in Gallery.tsx.
//
// API:
//   const { toast } = useToast();
//   toast({ kind: 'success', message: 'הגיבוי נשמר' });
//   toast({ kind: 'error',   message: 'הייצוא נכשל' });
//
// The container renders a single fixed region pinned to the bottom-end
// (inline-end → bottom-left in RTL, bottom-right in LTR). We render at most
// MAX_VISIBLE toasts at once; older ones drop off the head of the queue
// when a new one arrives. Each entry auto-dismisses after `durationMs`
// (default 4000ms). Clicking the pill (or the focused button's keyboard
// activation) dismisses immediately and clears the timer.

import { AnimatePresence } from 'framer-motion';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Toast, type ToastKind } from '../components/ui/Toast';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type ToastInput = {
  kind: ToastKind;
  message: string;
  /** Optional override; defaults to DEFAULT_DURATION_MS. */
  durationMs?: number;
};

export type ToastContextValue = {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
  dismissAll: () => void;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ToastEntry = {
  id: number;
  kind: ToastKind;
  message: string;
};

const DEFAULT_DURATION_MS = 4000;
const MAX_VISIBLE = 3;

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // We keep the timer table in a ref so a `dismiss()` from a click handler
  // can clear the pending auto-dismiss without racing the next render.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Monotonically increasing id so AnimatePresence keys stay stable even if
  // two toasts are fired in the same millisecond.
  const idSeqRef = useRef(0);

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timers = timersRef.current;
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    setToasts((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    const timers = timersRef.current;
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      idSeqRef.current += 1;
      const id = idSeqRef.current;
      const duration = input.durationMs ?? DEFAULT_DURATION_MS;

      setToasts((prev) => {
        const next = [...prev, { id, kind: input.kind, message: input.message }];
        // Keep only the last MAX_VISIBLE; clear timers for any we drop.
        if (next.length > MAX_VISIBLE) {
          const dropped = next.slice(0, next.length - MAX_VISIBLE);
          for (const d of dropped) {
            const t = timersRef.current.get(d.id);
            if (t) {
              clearTimeout(t);
              timersRef.current.delete(d.id);
            }
          }
          return next.slice(-MAX_VISIBLE);
        }
        return next;
      });

      const timer = setTimeout(() => {
        // Inline-removed copy of `dismiss` to avoid re-creating the callback
        // identity per fire. Mirrors the same logic.
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((entry) => entry.id !== id));
      }, duration);
      timersRef.current.set(id, timer);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, dismissAll }),
    [toast, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Viewport — fixed region pinned to the bottom-end (RTL-aware)
// ---------------------------------------------------------------------------

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      data-testid="toast-viewport"
      aria-label="הודעות מערכת"
      className="
        pointer-events-none
        fixed bottom-8
        flex flex-col items-end gap-3
      "
      // inline-end → bottom-left in RTL, bottom-right in LTR. We use the
      // CSS logical property directly; Tailwind v4 doesn't ship a `end-8`
      // utility that maps to logical inset out of the box across all builds,
      // so we set it inline to be safe.
      style={{ insetInlineEnd: '2rem', zIndex: 60 }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <Toast
            key={t.id}
            id={t.id}
            kind={t.kind}
            message={t.message}
            onDismiss={onDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
