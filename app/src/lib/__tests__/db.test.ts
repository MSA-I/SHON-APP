// SOP: architecture/02-indexeddb-persistence.md
// SOP: architecture/11-domain-invariants.md (INV-01 / 02 / 03 / 09 / 10)
// SOP: claude.md § Data Schemas
//
// IndexedDB CRUD + invariant smoke. Runs against `fake-indexeddb` (installed
// by `setup.ts` before any test module loads).

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  openDb,
  __resetDbForTests,
  createClient,
  getClient,
  listClients,
  findClientByPhone,
  updateClient,
  deleteClient,
  createEvent,
  getEvent,
  updateEvent,
  listEventsByClient,
  listEventsByStatus,
  deleteEvent,
  exportAll,
  importAll,
  getMeta,
  setMeta,
  putThumbnail,
  getThumbnail,
  deleteThumbnailsByCategory,
  deriveDayOfWeek,
  DB_VERSION,
} from '../db';
import type { Event, Signature } from '../../types';

// Shared event factory — keeps tests terse.
function buildEventInput(
  clientId: string,
  overrides: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Event, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    clientId,
    date: '2026-06-14',
    dayOfWeek: 'ראשון', // overwritten by lib (INV-03)
    startTime: '20:00',
    location: 'גאמוס',
    guestCount: 350,
    isMixed: true,
    notes: 'דגש על פרחים לבנים',
    napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: 'קיפול קלאסי' },
    reception: { atResort: false },
    tableDesignSelections: [],
    chairs: { type: 'אבירים', bridalChair: '' },
    chuppah: {
      location: 'בריכה',
      type: 'מרובעת',
      fabricDetails: 'וילון לבן נשפך',
      designSelections: [],
      aisleDetails: 'אבני חצץ לבנות',
    },
    upgrades: { description: '', items: [] },
    signature: null,
    status: 'draft',
    ...overrides,
  };
}

const FAKE_PNG_DATA_URL = 'data:image/png;base64,aGVsbG8=';

function makeSignature(): Signature {
  // Maintenance Log 2026-05-21: Signature is dual-shape; fixtures use the
  // 'png' kind to keep historical assertions stable.
  return { kind: 'png', dataUrl: FAKE_PNG_DATA_URL, signedAt: Date.now() };
}

beforeEach(async () => {
  await __resetDbForTests();
});

describe('db.openDb', () => {
  it('opens cold and exposes the right version', async () => {
    const handle = await openDb();
    expect(handle.version).toBe(DB_VERSION);
    expect(handle.objectStoreNames.contains('clients')).toBe(true);
    expect(handle.objectStoreNames.contains('events')).toBe(true);
    expect(handle.objectStoreNames.contains('thumbnails')).toBe(true);
    expect(handle.objectStoreNames.contains('meta')).toBe(true);
  });

  it('is idempotent when called twice', async () => {
    const a = await openDb();
    const b = await openDb();
    expect(a).toBe(b);
  });
});

describe('db client CRUD', () => {
  it('createClient → getClient round-trips', async () => {
    const c = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1234567' });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.coupleNames).toBe('ליאור ודן');
    expect(c.phone).toBe('050-1234567');
    expect(c.createdAt).toBe(c.updatedAt);

    const round = await getClient(c.id);
    expect(round).toBeDefined();
    expect(round?.coupleNames).toBe('ליאור ודן');
  });

  it('listClients returns N items after creating N', async () => {
    await createClient({ coupleNames: 'A', phone: '050-1' });
    await createClient({ coupleNames: 'B', phone: '050-2' });
    await createClient({ coupleNames: 'C', phone: '050-3' });
    const all = await listClients();
    expect(all.length).toBe(3);
  });

  it('findClientByPhone returns the right one', async () => {
    await createClient({ coupleNames: 'A', phone: '050-1111111' });
    const target = await createClient({ coupleNames: 'B', phone: '052-2222222' });
    await createClient({ coupleNames: 'C', phone: '054-3333333' });
    const got = await findClientByPhone('052-2222222');
    expect(got?.id).toBe(target.id);
    expect(got?.coupleNames).toBe('B');
  });

  it('findClientByPhone returns undefined for empty input', async () => {
    const got = await findClientByPhone('');
    expect(got).toBeUndefined();
  });

  it('updateClient bumps updatedAt and merges fields', async () => {
    const c = await createClient({ coupleNames: 'old', phone: '050-1' });
    const before = c.updatedAt;
    // Force a tick so updatedAt monotonically advances even on fast machines.
    await new Promise((r) => setTimeout(r, 5));
    const u = await updateClient(c.id, { coupleNames: 'new' });
    expect(u.coupleNames).toBe('new');
    expect(u.phone).toBe('050-1');
    expect(u.updatedAt).toBeGreaterThanOrEqual(before);
    expect(u.createdAt).toBe(c.createdAt);
  });

  it('updateClient on missing id throws DB_NOT_FOUND', async () => {
    await expect(
      updateClient('00000000-0000-4000-8000-000000000000', { coupleNames: 'x' }),
    ).rejects.toMatchObject({ code: 'DB_NOT_FOUND' });
  });

  it('deleteClient cascades to events (INV-10)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await createEvent(buildEventInput(c.id));
    await createEvent(buildEventInput(c.id, { date: '2026-07-15' }));
    let evts = await listEventsByClient(c.id);
    expect(evts.length).toBe(2);

    await deleteClient(c.id);

    expect(await getClient(c.id)).toBeUndefined();
    evts = await listEventsByClient(c.id);
    expect(evts.length).toBe(0);
  });

  it('createClient rejects undefined input', async () => {
    // @ts-expect-error testing runtime guard
    await expect(createClient(undefined)).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });
});

describe('db event CRUD + invariants', () => {
  it('deriveDayOfWeek for 2026-06-14 is ראשון', () => {
    expect(deriveDayOfWeek('2026-06-14')).toBe('ראשון');
  });

  it('createEvent overrides caller dayOfWeek (INV-03)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    // Caller passes the WRONG day on purpose.
    const e = await createEvent(buildEventInput(c.id, { dayOfWeek: 'שבת' }));
    expect(e.dayOfWeek).toBe('ראשון'); // overridden from date 2026-06-14
  });

  it('createEvent rejects clientId that does not exist (INV-10)', async () => {
    await expect(
      createEvent(buildEventInput('00000000-0000-4000-8000-000000000000')),
    ).rejects.toMatchObject({ code: 'DB_NOT_FOUND' });
  });

  it('createEvent rejects status="completed" up-front (INV-09)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await expect(
      createEvent(buildEventInput(c.id, { status: 'completed' })),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('createEvent rejects status="signed" without signature (INV-02)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await expect(
      createEvent(buildEventInput(c.id, { status: 'signed', signature: null })),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('createEvent rejects tableDesignSelections.length > 5 (INV-01)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const six = Array.from({ length: 6 }, (_, i) => ({
      imagePath: `אולם עיצוב בסיס 2026/foo-${i}.jpg`,
      category: 'אולם עיצוב בסיס 2026' as const,
      imageName: `foo-${i}`,
      notes: '',
      selectedAt: Date.now(),
    }));
    await expect(
      createEvent(buildEventInput(c.id, { tableDesignSelections: six })),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('createEvent rejects unknown ImageCategory (INV-05)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await expect(
      createEvent(
        buildEventInput(c.id, {
          tableDesignSelections: [
            {
              imagePath: 'foo/bar.jpg',
              // @ts-expect-error testing runtime category guard
              category: 'NotARealCategory',
              imageName: 'bar',
              notes: '',
              selectedAt: Date.now(),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('updateEvent transitions draft→signed, then signed→completed (INV-09)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const e = await createEvent(buildEventInput(c.id));
    expect(e.status).toBe('draft');

    const signed = await updateEvent(e.id, {
      status: 'signed',
      signature: makeSignature(),
    });
    expect(signed.status).toBe('signed');

    const completed = await updateEvent(e.id, { status: 'completed' });
    expect(completed.status).toBe('completed');
  });

  it('updateEvent draft→completed without prior signed throws DB_CONFLICT (INV-09)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const e = await createEvent(buildEventInput(c.id));
    await expect(
      updateEvent(e.id, { status: 'completed' }),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('updateEvent rejects tableDesignSelections.length > 5 (INV-01)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const e = await createEvent(buildEventInput(c.id));
    const six = Array.from({ length: 6 }, (_, i) => ({
      imagePath: `אולם עיצוב בסיס 2026/foo-${i}.jpg`,
      category: 'אולם עיצוב בסיס 2026' as const,
      imageName: `foo-${i}`,
      notes: '',
      selectedAt: Date.now(),
    }));
    await expect(
      updateEvent(e.id, { tableDesignSelections: six }),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('updateEvent rejects unsetting signature once present (INV-02)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const e = await createEvent(buildEventInput(c.id));
    await updateEvent(e.id, { status: 'signed', signature: makeSignature() });
    await expect(
      updateEvent(e.id, { signature: null }),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('updateEvent recomputes dayOfWeek when date changes (INV-03)', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const e = await createEvent(buildEventInput(c.id)); // 2026-06-14 ראשון
    const u = await updateEvent(e.id, { date: '2026-06-15', dayOfWeek: 'שבת' });
    expect(u.date).toBe('2026-06-15');
    expect(u.dayOfWeek).toBe('שני'); // 2026-06-15 is Monday
  });

  it('listEventsByStatus filters', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const a = await createEvent(buildEventInput(c.id));
    await createEvent(buildEventInput(c.id, { date: '2026-07-01' }));
    await updateEvent(a.id, { status: 'signed', signature: makeSignature() });

    const drafts = await listEventsByStatus('draft');
    const signedEvts = await listEventsByStatus('signed');
    expect(drafts.length).toBe(1);
    expect(signedEvts.length).toBe(1);
    expect(signedEvts[0]?.id).toBe(a.id);
  });

  it('deleteEvent removes a single event without touching siblings', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    const a = await createEvent(buildEventInput(c.id));
    const b = await createEvent(buildEventInput(c.id, { date: '2026-07-01' }));
    await deleteEvent(a.id);
    expect(await getEvent(a.id)).toBeUndefined();
    expect((await getEvent(b.id))?.id).toBe(b.id);
  });
});

describe('db meta', () => {
  it('setMeta + getMeta round-trip', async () => {
    await setMeta('lastBackupAt', 1234567890);
    const v = await getMeta<number>('lastBackupAt');
    expect(v).toBe(1234567890);
  });

  it('rejects unknown meta key', async () => {
    await expect(setMeta('bogus' as never, 1)).rejects.toMatchObject({
      code: 'DB_CONFLICT',
    });
  });
});

describe('db thumbnails', () => {
  it('put then get returns the same record', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    await putThumbnail({
      path: 'מפות מפיות/x.jpg',
      category: 'מפות מפיות',
      blob,
      generatedAt: 100,
      sourceModifiedAt: 50,
    });
    const got = await getThumbnail('מפות מפיות/x.jpg');
    expect(got).toBeDefined();
    expect(got?.category).toBe('מפות מפיות');
    expect(got?.generatedAt).toBe(100);
  });

  it('deleteThumbnailsByCategory removes only that category', async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await putThumbnail({
      path: 'מפות מפיות/a.jpg',
      category: 'מפות מפיות',
      blob,
      generatedAt: 1,
      sourceModifiedAt: 0,
    });
    await putThumbnail({
      path: 'חופות ריזורט/b.jpg',
      category: 'חופות ריזורט',
      blob,
      generatedAt: 2,
      sourceModifiedAt: 0,
    });
    const removed = await deleteThumbnailsByCategory('מפות מפיות');
    expect(removed).toBe(1);
    expect(await getThumbnail('מפות מפיות/a.jpg')).toBeUndefined();
    expect(await getThumbnail('חופות ריזורט/b.jpg')).toBeDefined();
  });
});

describe('db.exportAll / importAll', () => {
  it('exportAll returns the right envelope shape', async () => {
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await createEvent(buildEventInput(c.id));
    const dump = await exportAll();
    expect(dump.schemaVersion).toBe(DB_VERSION);
    expect(typeof dump.exportedAt).toBe('number');
    expect(dump.clients.length).toBe(1);
    expect(dump.events.length).toBe(1);
  });

  it('importAll(overwrite) wipes + replaces', async () => {
    const c = await createClient({ coupleNames: 'old', phone: '050-1' });
    await createEvent(buildEventInput(c.id));

    // Snapshot.
    const snapshot = await exportAll();

    // Trash the DB.
    await createClient({ coupleNames: 'orphan', phone: '050-9' });
    expect((await listClients()).length).toBe(2);

    // Restore.
    const result = await importAll(
      {
        schemaVersion: snapshot.schemaVersion,
        clients: snapshot.clients,
        events: snapshot.events,
      },
      'overwrite',
    );
    expect(result.clientsWritten).toBe(1);
    expect(result.eventsWritten).toBe(1);

    const after = await listClients();
    expect(after.length).toBe(1);
    expect(after[0]?.coupleNames).toBe('old');

    // lastImportAt is set inside the same tx.
    const stamp = await getMeta<number>('lastImportAt');
    expect(typeof stamp).toBe('number');
  });

  it('importAll rejects schemaVersion drift', async () => {
    await expect(
      importAll(
        { schemaVersion: 999, clients: [], events: [] },
        'overwrite',
      ),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });

  it('importAll rejects invalid mode', async () => {
    await expect(
      importAll(
        { schemaVersion: DB_VERSION, clients: [], events: [] },
        // @ts-expect-error testing runtime guard
        'replace',
      ),
    ).rejects.toMatchObject({ code: 'DB_CONFLICT' });
  });
});

describe('db.__resetDbForTests', () => {
  it('clears the database between calls', async () => {
    await createClient({ coupleNames: 'x', phone: '050-1' });
    expect((await listClients()).length).toBe(1);
    await __resetDbForTests();
    expect((await listClients()).length).toBe(0);
  });
});

describe('db INV-04 soft-warn (napkins.color === "אחר")', () => {
  it('warns when other-color has no foldType or notes', async () => {
    // Suppress the setup.ts throwing-warn wrapper for this test.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = await createClient({ coupleNames: 'x', phone: '050-1' });
    await createEvent(
      buildEventInput(c.id, {
        napkins: { color: 'אחר', fabric: 'סטן', foldType: '' },
        notes: '',
      }),
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
