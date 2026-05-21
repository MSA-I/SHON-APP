/**
 * WelcomeScreen — daily personalized greeting interstitial.
 *
 * Shown once per calendar day on the first app open of the day, AFTER the
 * SOP 12 tagging gate has been cleared but BEFORE the user lands on
 * `<Home />`. Subsequent opens on the same day skip directly to Home.
 *
 * Persistence model:
 *  - meta key: `lastWelcomeDate` (yyyy-mm-dd, local time).
 *  - Boot sequence in App.tsx compares stored value vs today's local date.
 *  - When the user clicks "התחל", App.tsx writes today's date and routes
 *    to Home. We never write from this component — single-writer rule.
 *
 * Composition (top → bottom):
 *  1. Hebrew greeting chosen by local hour:
 *       05-11 → "בוקר טוב, שון"
 *       12-17 → "צהריים טובים, שון"
 *       18-04 → "ערב טוב, שון"
 *     Rendered in Frank Ruhl Libre at `text-display` (3rem) — the in-app
 *     hero treatment from SOP 16.
 *  2. ❖ ornament divider.
 *  3. Three label/value stat cards: active clients, events this month,
 *     next upcoming event (couple + date). Each is a sharp 1px hairline
 *     box with a label-caps eyebrow and a tabular figure.
 *  4. CTA button "התחל" — primary variant, calls `onStart`.
 *
 * Motion timeline (signature curve, reduced-motion → all instant):
 *  - greeting:  useEntrance({ delay: 0   })
 *  - ornament:  useEntrance({ delay: 0.18 })
 *  - stats:     <Stagger delay={0.32} step={0.12}>
 *  - CTA:       useEntrance({ delay: 0.78 })
 *
 * Constitution-clean: no shadow, no gradient, no rounded corners. All
 * colors come from the `bg-ink` / `text-cream` / `border-gold` Tailwind
 * tokens — light-mode flips automatically via `[data-theme="light"]`.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button, Ornament } from '../ui';
import { Stagger } from '../../lib/motion/Stagger';
import { useEntrance } from '../../lib/motion/useEntrance';
import {
  countActiveClients,
  countEventsThisMonth,
  getNextUpcomingEvent,
} from '../../lib/db';

export type WelcomeScreenProps = {
  /** Called when the user dismisses the screen via the "התחל" CTA. */
  onStart: () => void;
};

type Stats = {
  activeClients: number;
  eventsThisMonth: number;
  nextEvent: { couple: string; dateLabel: string } | null;
};

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function greetingForHour(h: number): string {
  if (h >= 5 && h < 12) return 'בוקר טוב, שון';
  if (h >= 12 && h < 18) return 'צהריים טובים, שון';
  return 'ערב טוב, שון';
}

function formatIsoDateLong(iso: string): string {
  // yyyy-mm-dd → "יום ראשון, 14.06.2026"
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  const day = HEBREW_DAYS[dateObj.getDay()];
  return `יום ${day}, ${d}.${m}.${y}`;
}

export function WelcomeScreen({ onStart }: WelcomeScreenProps) {
  const greetingEntrance = useEntrance({ delay: 0 });
  const ornamentEntrance = useEntrance({ delay: 0.18 });
  const ctaEntrance = useEntrance({ delay: 0.78 });

  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [active, monthly, upcoming] = await Promise.all([
        countActiveClients(),
        countEventsThisMonth(),
        getNextUpcomingEvent(),
      ]);
      if (cancelled) return;
      setStats({
        activeClients: active,
        eventsThisMonth: monthly,
        nextEvent: upcoming
          ? {
              couple: upcoming.coupleNames || 'לקוח',
              dateLabel: formatIsoDateLong(upcoming.event.date),
            }
          : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = greetingForHour(new Date().getHours());

  return (
    <div
      data-testid="welcome-screen"
      dir="rtl"
      lang="he"
      className="
        fixed inset-0 z-40
        flex flex-col items-center justify-center
        bg-ink text-cream
        px-16
      "
    >
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <motion.h1
        {...greetingEntrance}
        className="
          font-serif text-cream
          text-display
          tracking-[-0.01em]
          text-center
        "
      >
        {greeting}
      </motion.h1>

      {/* ── Ornament divider ─────────────────────────────────────────────── */}
      <motion.div {...ornamentEntrance}>
        <Ornament size="large" variant="divider" />
      </motion.div>

      {/* ── Day stats (3 hairline cards) ─────────────────────────────────── */}
      <Stagger
        delay={0.32}
        step={0.12}
        className="grid grid-cols-3 gap-6 w-full max-w-3xl"
      >
        <StatCard
          label="לקוחות פעילים"
          value={stats ? String(stats.activeClients) : '—'}
          tabular
        />
        <StatCard
          label="אירועים החודש"
          value={stats ? String(stats.eventsThisMonth) : '—'}
          tabular
        />
        <StatCard
          label="האירוע הקרוב"
          value={
            stats === null
              ? '—'
              : stats.nextEvent
                ? stats.nextEvent.couple
                : 'אין אירועים קרובים'
          }
          subValue={stats?.nextEvent?.dateLabel}
        />
      </Stagger>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <motion.div {...ctaEntrance} className="mt-16">
        <Button variant="primary" onClick={onStart} testId="welcome-start">
          התחל
        </Button>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard — local presentational primitive (not exported).
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subValue,
  tabular = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  tabular?: boolean;
}) {
  return (
    <div
      className="
        border border-border-subtle
        px-6 py-8
        flex flex-col items-center text-center gap-3
      "
    >
      <span
        className="
          font-sans text-label text-gold-dark
          tracking-[0.12em] uppercase
        "
      >
        {label}
      </span>
      <span
        // Numeric values render LTR so digit ordering is unambiguous inside
        // the RTL ancestor (a11y / bidi).
        dir={tabular ? 'ltr' : undefined}
        className={[
          'font-serif text-cream',
          // Use h2 for non-tabular (couple names) so longer Hebrew strings
          // breathe; numeric figures get the bigger hero treatment.
          tabular ? 'text-h1 font-tabular' : 'text-h2',
        ].join(' ')}
      >
        {value}
      </span>
      {subValue ? (
        <span
          dir="ltr"
          className="font-sans text-small text-cream-muted font-tabular"
        >
          {subValue}
        </span>
      ) : null}
    </div>
  );
}
