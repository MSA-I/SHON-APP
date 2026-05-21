/**
 * App.tsx — root view router (SOP 13 § AppView state machine).
 *
 * Boot sequence:
 *  1. ThemeProvider hydrates `meta.theme` (read-before-paint per SOP 14 §6).
 *  2. AppShell reads `meta.taggingComplete`:
 *      - false → <TaggingPass />
 *      - true  → <Home /> (with AppBar)
 *  3. Home → ClientList → on click → ClientDetail → "אירוע חדש" → EventTabs.
 *  4. Settings is reachable from any non-tagging view via AppBar.
 *
 * Behavioral Rule #11: TaggingPass blocks everything else when not complete.
 * Behavioral Rule #12: theme persisted in meta.theme.
 */

import { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { EventProvider, useEvent } from './contexts/EventContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/shell/ErrorBoundary';
import { FatalBanner } from './components/shell/FatalBanner';
import { BootSplash } from './components/shell/BootSplash';
import { AppBar } from './components/shell/AppBar';
import { WelcomeScreen } from './components/shell/WelcomeScreen';
import { ClientList } from './components/client';
import { TaggingPass } from './components/tagging/TaggingPass';
import { EventTabs } from './components/event';
import { Settings } from './components/settings/Settings';
import { Button, Ornament } from './components/ui';
import * as db from './lib/db';

type AppView =
  | { kind: 'boot' }
  | { kind: 'tagging' }
  | { kind: 'welcome' }
  | { kind: 'home' }
  | { kind: 'client-detail'; clientId: string }
  | { kind: 'event-tabs'; clientId: string }
  | { kind: 'settings' };

/** Returns today's local date as ISO yyyy-mm-dd. */
function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function App() {
  return (
    <ErrorBoundary
      fallback={
        <FatalBanner
          title="שגיאה בלתי צפויה"
          body="המערכת נתקלה בבעיה. נסה לרענן את האפליקציה."
        />
      }
    >
      <ThemeProvider>
        <ToastProvider>
          <EventProvider>
            <AppShell />
          </EventProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function AppShell() {
  const { hydrating: themeHydrating } = useTheme();
  const [view, setView] = useState<AppView>({ kind: 'boot' });
  const [bootError, setBootError] = useState<string | null>(null);

  // Boot sequence — read meta.taggingComplete + meta.lastWelcomeDate then route.
  // Tagging gate (BehavioralRule #11) wins; if cleared we check whether today's
  // welcome screen has been shown yet (Phase WOW). Same-day → straight to Home.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const complete = await db.getMeta('taggingComplete');
        if (cancelled) return;
        if (complete !== true) {
          setView({ kind: 'tagging' });
          return;
        }
        const lastWelcome = await db.getMeta('lastWelcomeDate');
        if (cancelled) return;
        if (lastWelcome === todayLocalIso()) {
          setView({ kind: 'home' });
        } else {
          setView({ kind: 'welcome' });
        }
      } catch (err) {
        console.error('[boot] meta read failed', err);
        if (!cancelled) {
          setBootError('פתיחת מסד הנתונים נכשלה');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootError) {
    return (
      <FatalBanner
        title="שגיאת אתחול"
        body={bootError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (themeHydrating || view.kind === 'boot') {
    return <BootSplash phase={themeHydrating ? 'reading-meta' : 'opening-db'} />;
  }

  if (view.kind === 'tagging') {
    return (
      <TaggingPass
        onComplete={async () => {
          // Bridge tagging → welcome on the same first-launch flow.
          const lastWelcome = await db.getMeta('lastWelcomeDate');
          setView(
            lastWelcome === todayLocalIso()
              ? { kind: 'home' }
              : { kind: 'welcome' },
          );
        }}
      />
    );
  }

  if (view.kind === 'welcome') {
    return (
      <WelcomeScreen
        onStart={async () => {
          // Single-writer of `lastWelcomeDate`. Best-effort: if the write
          // fails the user still proceeds; tomorrow's check naturally retries.
          try {
            await db.setMeta('lastWelcomeDate', todayLocalIso());
          } catch (err) {
            console.error('[welcome] setMeta failed', err);
          }
          setView({ kind: 'home' });
        }}
      />
    );
  }

  // From here on AppBar is rendered.
  return (
    <div className="min-h-screen bg-ink text-cream" dir="rtl" lang="he">
      <AppBar
        breadcrumb={breadcrumbFor(view)}
        showThemeToggle
        onLogoClick={
          view.kind === 'home' ? undefined : () => setView({ kind: 'home' })
        }
      />
      <main className="pt-[60px]">
        {view.kind === 'home' ? (
          <HomeView setView={setView} />
        ) : view.kind === 'client-detail' ? (
          <ClientDetailView clientId={view.clientId} setView={setView} />
        ) : view.kind === 'event-tabs' ? (
          <EventTabsView clientId={view.clientId} setView={setView} />
        ) : view.kind === 'settings' ? (
          <Settings />
        ) : null}
      </main>
      <FloatingNav view={view} setView={setView} />
    </div>
  );
}

function breadcrumbFor(view: AppView): { label: string; onClick?: () => void }[] | undefined {
  if (view.kind === 'home') return undefined;
  if (view.kind === 'settings') return [{ label: 'הגדרות' }];
  if (view.kind === 'client-detail') return [{ label: 'לקוחות' }, { label: 'פרטי לקוח' }];
  if (view.kind === 'event-tabs') return [{ label: 'לקוחות' }, { label: 'אירוע' }];
  return undefined;
}

// ---------------------------------------------------------------------------
// Floating nav — minimalist links to home/settings.
// ---------------------------------------------------------------------------

function FloatingNav({ view, setView }: { view: AppView; setView: (v: AppView) => void }) {
  if (view.kind === 'settings') {
    return (
      <div className="fixed bottom-6 inset-inline-end-6">
        <Button variant="tertiary" onClick={() => setView({ kind: 'home' })}>
          ← חזרה ללקוחות
        </Button>
      </div>
    );
  }
  if (view.kind === 'home') {
    return (
      <div className="fixed bottom-6 inset-inline-end-6">
        <Button variant="tertiary" onClick={() => setView({ kind: 'settings' })}>
          הגדרות
        </Button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Home view — wraps ClientList with the navigation handler.
// ---------------------------------------------------------------------------

function HomeView({ setView }: { setView: (v: AppView) => void }) {
  return (
    <ClientList
      onClientSelect={(clientId) => setView({ kind: 'client-detail', clientId })}
    />
  );
}

// ---------------------------------------------------------------------------
// Client detail — shows client info + event list. New event creates a draft.
// ---------------------------------------------------------------------------

function ClientDetailView({
  clientId,
  setView,
}: {
  clientId: string;
  setView: (v: AppView) => void;
}) {
  const ctx = useEvent();

  useEffect(() => {
    void ctx.loadClient(clientId);
  }, [clientId, ctx.loadClient]);

  const handleCreateEvent = () => {
    ctx.dispatch({ type: 'create-event-draft' });
    setView({ kind: 'event-tabs', clientId });
  };

  if (ctx.loading) {
    return (
      <div className="px-16 py-24 text-center text-cream-muted font-sans">
        טוען לקוח…
      </div>
    );
  }

  if (!ctx.currentClient) {
    return (
      <div className="px-16 py-24 text-center">
        <p className="text-cream-muted font-sans">לקוח לא נמצא</p>
        <div className="mt-6">
          <Button variant="primary" onClick={() => setView({ kind: 'home' })}>
            חזרה לרשימה
          </Button>
        </div>
      </div>
    );
  }

  const c = ctx.currentClient;

  return (
    <div className="px-16 py-12" data-testid="client-detail">
      <div className="flex flex-col items-end gap-2">
        <h1 className="font-serif text-hero text-cream">{c.coupleNames}</h1>
        <div className="flex flex-col items-end gap-1 text-cream-muted">
          <span dir="ltr" className="font-sans text-body font-tabular">
            {c.phone}
          </span>
          {c.email ? (
            <span dir="ltr" className="font-sans text-body">
              {c.email}
            </span>
          ) : null}
        </div>
      </div>

      <Ornament size="large" variant="divider" />

      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif text-h2 text-cream">אירועים</h2>
        <Button variant="primary" onClick={handleCreateEvent} testId="create-event">
          + אירוע חדש
        </Button>
      </div>

      {ctx.currentEvent ? (
        <div
          className="border border-border-subtle p-6 cursor-pointer hover:border-gold transition-colors"
          onClick={() => setView({ kind: 'event-tabs', clientId })}
          data-testid={`event-row-${ctx.currentEvent.id}`}
        >
          <div className="flex items-center justify-between">
            <span className="font-serif text-h3 text-cream">
              {ctx.currentEvent.location || 'אירוע'} —{' '}
              <span dir="ltr" className="font-tabular">
                {formatIsoDate(ctx.currentEvent.date)}
              </span>
            </span>
            <span className="font-sans text-label uppercase tracking-[0.12em] text-gold">
              {ctx.currentEvent.status === 'draft'
                ? 'טיוטה'
                : ctx.currentEvent.status === 'signed'
                  ? 'חתום'
                  : 'הושלם'}
            </span>
          </div>
          <p className="font-sans text-small text-cream-muted mt-2">
            {ctx.currentEvent.guestCount > 0
              ? `${ctx.currentEvent.guestCount} מוזמנים`
              : 'פרטים בעריכה'}
          </p>
        </div>
      ) : (
        <div className="text-center py-12 border border-border-subtle">
          <p className="font-sans text-cream-muted">אין אירועים עדיין</p>
        </div>
      )}

      <div className="mt-12">
        <Button variant="tertiary" onClick={() => setView({ kind: 'home' })}>
          ← חזרה לרשימת לקוחות
        </Button>
      </div>
    </div>
  );
}

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------------
// Event tabs view — wraps EventTabs container with back nav.
// ---------------------------------------------------------------------------

function EventTabsView({
  clientId,
  setView,
}: {
  clientId: string;
  setView: (v: AppView) => void;
}) {
  const ctx = useEvent();

  useEffect(() => {
    if (!ctx.currentClient || ctx.currentClient.id !== clientId) {
      void ctx.loadClient(clientId);
    }
  }, [clientId, ctx.currentClient, ctx.loadClient]);

  return (
    <div className="px-8 py-6">
      <div className="mb-6">
        <Button
          variant="tertiary"
          onClick={() => setView({ kind: 'client-detail', clientId })}
        >
          ← חזרה לפרטי לקוח
        </Button>
      </div>
      <EventTabs />
    </div>
  );
}
