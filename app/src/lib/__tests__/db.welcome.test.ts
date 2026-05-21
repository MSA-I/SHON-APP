// SOP: claude.md § Phase WOW
// SOP: architecture/02-indexeddb-persistence.md
//
// Coverage for the three read-only helpers backing <WelcomeScreen />:
//   - countActiveClients()      — clients that have ≥ 1 event.
//   - countEventsThisMonth()    — events whose `date` falls in current month.
//   - getNextUpcomingEvent()    — soonest event with date >= today, with
//                                  matching client's coupleNames.
//
// All three must degrade silently (0 / 0 / undefined) on empty DB. We use a
// fixed `Date.now()` mock so month-boundary arithmetic is deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  __resetDbForTests,
  createClient,
  createEvent,
  countActiveClients,
  countEventsThisMonth,
  getNextUpcomingEvent,
} from '../db';
import type { Event } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Anchor "today" inside the smoke test so month math is stable. Picked a date
// well inside June so a "previous month" / "next month" fixture stays unambiguous.
const FIXED_NOW = new Date('2026-06-14T10:00:00').getTime();

function buildEventInput(
  clientId: string,
  overrides: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Event, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    clientId,
    date: '2026-06-20',
    dayOfWeek: 'ראשון', // overwritten by lib (INV-03)
    startTime: '20:00',
    location: 'גאמוס',
    guestCount: 350,
    isMixed: true,
    notes: '',
    napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
    reception: { atResort: false },
    tableDesignSelections: [],
    chairs: { type: 'אבירים', bridalChair: '' },
    chuppah: {
      location: 'בריכה',
      type: 'מרובעת',
      fabricDetails: '',
      designSelections: [],
      aisleDetails: '',
    },
    upgrades: { description: '', items: [] },
    signature: null,
    status: 'draft',
    ...overrides,
  };
}

// We only fake Date — NOT setTimeout/queueMicrotask, because fake-indexeddb
// schedules its async work through real timers. `vi.useFakeTimers()` would
// hang every IndexedDB op. The `toFake: ['Date']` option faked Date alone.
beforeEach(async () => {
  await __resetDbForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Empty-DB defaults
// ---------------------------------------------------------------------------

describe('welcome helpers — empty DB', () => {
  it('countActiveClients returns 0 when there are no clients', async () => {
    expect(await countActiveClients()).toBe(0);
  });

  it('countEventsThisMonth returns 0 when there are no events', async () => {
    expect(await countEventsThisMonth()).toBe(0);
  });

  it('getNextUpcomingEvent returns undefined when there are no events', async () => {
    expect(await getNextUpcomingEvent()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countActiveClients — "active" = has ≥ 1 event
// ---------------------------------------------------------------------------

describe('countActiveClients', () => {
  it('does not count clients with no events', async () => {
    await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    await createClient({ coupleNames: 'מיכל ויובל', phone: '050-2222222' });
    expect(await countActiveClients()).toBe(0);
  });

  it('counts clients that have at least one event', async () => {
    const a = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    const b = await createClient({ coupleNames: 'מיכל ויובל', phone: '050-2222222' });
    // Third client has no events — exercise the "no events" branch of the cursor.
    await createClient({ coupleNames: 'נועה ואייל', phone: '050-3333333' });

    await createEvent(buildEventInput(a.id, { date: '2026-06-20' }));
    await createEvent(buildEventInput(b.id, { date: '2026-07-01' }));

    expect(await countActiveClients()).toBe(2);
  });

  it('counts a client only once even when they have multiple events', async () => {
    const a = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    await createEvent(buildEventInput(a.id, { date: '2026-06-20' }));
    await createEvent(buildEventInput(a.id, { date: '2026-07-01' }));
    await createEvent(buildEventInput(a.id, { date: '2026-08-15' }));
    expect(await countActiveClients()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// countEventsThisMonth — only events whose ISO date is in current calendar month
// ---------------------------------------------------------------------------

describe('countEventsThisMonth', () => {
  it('counts events whose date falls in the current calendar month', async () => {
    const c = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    // FIXED_NOW = 2026-06-14
    await createEvent(buildEventInput(c.id, { date: '2026-06-01' }));
    await createEvent(buildEventInput(c.id, { date: '2026-06-14' })); // today
    await createEvent(buildEventInput(c.id, { date: '2026-06-30' }));
    expect(await countEventsThisMonth()).toBe(3);
  });

  it('excludes events from other months', async () => {
    const c = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    await createEvent(buildEventInput(c.id, { date: '2026-05-31' })); // last month
    await createEvent(buildEventInput(c.id, { date: '2026-06-15' })); // this month
    await createEvent(buildEventInput(c.id, { date: '2026-07-01' })); // next month
    await createEvent(buildEventInput(c.id, { date: '2027-06-15' })); // next year, same month-of-year
    expect(await countEventsThisMonth()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getNextUpcomingEvent — soonest event with date >= today, with hydrated couple
// ---------------------------------------------------------------------------

describe('getNextUpcomingEvent', () => {
  it('returns the soonest event whose date is on or after today', async () => {
    const a = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    const b = await createClient({ coupleNames: 'מיכל ויובל', phone: '050-2222222' });

    // Past — should be ignored.
    await createEvent(buildEventInput(a.id, { date: '2026-05-01' }));
    // Future — different orderings to make sure we pick the earliest.
    await createEvent(buildEventInput(a.id, { date: '2026-08-15' }));
    await createEvent(buildEventInput(b.id, { date: '2026-06-20' })); // <-- soonest
    await createEvent(buildEventInput(a.id, { date: '2026-07-04' }));

    const result = await getNextUpcomingEvent();
    expect(result).toBeDefined();
    expect(result!.event.date).toBe('2026-06-20');
    expect(result!.event.clientId).toBe(b.id);
    expect(result!.coupleNames).toBe('מיכל ויובל');
  });

  it('treats today as eligible (date === today wins)', async () => {
    const a = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    await createEvent(buildEventInput(a.id, { date: '2026-06-14' })); // today
    await createEvent(buildEventInput(a.id, { date: '2026-06-30' }));

    const result = await getNextUpcomingEvent();
    expect(result).toBeDefined();
    expect(result!.event.date).toBe('2026-06-14');
    expect(result!.coupleNames).toBe('ליאור ודן');
  });

  it('returns undefined when every event is in the past', async () => {
    const a = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1111111' });
    await createEvent(buildEventInput(a.id, { date: '2026-05-01' }));
    await createEvent(buildEventInput(a.id, { date: '2026-04-15' }));
    expect(await getNextUpcomingEvent()).toBeUndefined();
  });
});
