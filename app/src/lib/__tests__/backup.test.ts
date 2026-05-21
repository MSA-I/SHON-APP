// SOP: architecture/07-backup-strategy.md
// SOP: architecture/11-domain-invariants.md (INV-05, INV-08, INV-11)
// SOP: claude.md § Backup Policy
//
// `backup.ts` smoke. Pure-validator surface only — `exportBackup` /
// `importBackup` (which touch IDB + Tauri) are exercised in the canonical
// E2E flow (#40). Here we cover:
//   • `buildBackupFilename` deterministic output
//   • `parseBackup` schemaVersion mismatch
//   • `parseBackup` __proto__ stripping
//   • `parseBackup` oversize text rejection
//   • `parseBackup` invalid uuid rejection
//   • exportAll → JSON → parseBackup roundtrip equivalence

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri layer so backup.ts doesn't try to load the plugin. Plain
// returners — no shared state needed because parseBackup is the focus and it
// touches neither plugin.
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: () => Promise.resolve([]),
  readFile: () => Promise.resolve(new Uint8Array()),
  readTextFile: () => Promise.resolve(''),
  writeFile: () => Promise.resolve(undefined),
  writeTextFile: () => Promise.resolve(undefined),
  remove: () => Promise.resolve(undefined),
  rename: () => Promise.resolve(undefined),
  mkdir: () => Promise.resolve(undefined),
  stat: () => Promise.resolve({ size: 0, mtime: new Date(0) }),
  exists: () => Promise.resolve(false),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}));

import { buildBackupFilename, parseBackup } from '../backup';
import {
  __resetDbForTests,
  createClient,
  createEvent,
  exportAll,
} from '../db';
import { BACKUP_SCHEMA_VERSION, type BackupEnvelope, type Event } from '../../types';

function buildEventInput(
  clientId: string,
): Omit<Event, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    clientId,
    date: '2026-06-14',
    dayOfWeek: 'ראשון',
    startTime: '20:00',
    location: 'גאמוס',
    guestCount: 350,
    isMixed: true,
    notes: '',
    napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: 'קלאסי' },
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
  };
}

function envelope(overrides: Partial<BackupEnvelope> = {}): BackupEnvelope {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: 1234567890,
    clients: [],
    events: [],
    imageTags: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await __resetDbForTests();
});

describe('buildBackupFilename', () => {
  it('formats local date+time per SOP 07', () => {
    // 2026-05-20 12:30 LOCAL — Date constructor with no Z is local.
    const d = new Date(2026, 4, 20, 12, 30, 0); // month is 0-indexed → 4 = May
    expect(buildBackupFilename(d)).toBe('backup_2026-05-20_12-30.json');
  });

  it('zero-pads single-digit components', () => {
    const d = new Date(2026, 0, 1, 1, 5, 0); // Jan 1 01:05
    expect(buildBackupFilename(d)).toBe('backup_2026-01-01_01-05.json');
  });

  it('produces a string matching the SOP 07 regex', () => {
    const got = buildBackupFilename(new Date(2026, 11, 31, 23, 59, 0));
    expect(got).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.json$/);
  });
});

describe('parseBackup — schemaVersion + envelope shape', () => {
  it('forward-migrates schemaVersion 1 (SOP 07 § Restore from v1 → v2)', () => {
    // v1 envelopes pre-date SOP 12; missing imageTags → []. Output is always
    // stamped with BACKUP_SCHEMA_VERSION (= 2).
    const text = JSON.stringify({
      schemaVersion: 1,
      exportedAt: 1,
      clients: [],
      events: [],
    });
    const got = parseBackup(text);
    expect(got.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(got.imageTags).toEqual([]);
  });

  it('rejects schemaVersion 999 (unknown future version)', () => {
    const text = JSON.stringify({
      schemaVersion: 999,
      exportedAt: 1,
      clients: [],
      events: [],
    });
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({
        name: 'LibError',
        code: 'BACKUP_SCHEMA_MISMATCH',
      }),
    );
  });

  it('rejects missing schemaVersion', () => {
    const text = JSON.stringify({ clients: [], events: [], exportedAt: 1 });
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_SCHEMA_MISMATCH' }),
    );
  });

  it('rejects non-object top-level', () => {
    expect(() => parseBackup(JSON.stringify([]))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects invalid JSON', () => {
    expect(() => parseBackup('{not-json}')).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects missing exportedAt', () => {
    const text = JSON.stringify({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      clients: [],
      events: [],
    });
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });
});

describe('parseBackup — prototype-pollution defense', () => {
  it('strips __proto__ key from the parsed envelope', () => {
    const malicious = `{
      "schemaVersion": ${BACKUP_SCHEMA_VERSION},
      "exportedAt": 1,
      "clients": [],
      "events": [],
      "imageTags": [],
      "__proto__": { "polluted": true }
    }`;
    const parsed = parseBackup(malicious);
    // The reviver dropped the key, so the prototype chain is unmodified.
    expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    expect((parsed as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it('strips constructor key cleanly', () => {
    const malicious = `{
      "schemaVersion": ${BACKUP_SCHEMA_VERSION},
      "exportedAt": 1,
      "clients": [],
      "events": [],
      "imageTags": [],
      "constructor": { "evil": true }
    }`;
    const parsed = parseBackup(malicious);
    // No `evil` smuggled onto the result.
    expect((parsed as unknown as { evil?: unknown }).evil).toBeUndefined();
  });
});

describe('parseBackup — size cap (P-05)', () => {
  it('rejects oversize text (>5MB) before JSON.parse', () => {
    const huge = '"' + 'a'.repeat(5 * 1024 * 1024 + 10) + '"';
    expect(() => parseBackup(huge)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects clients overflow', () => {
    const tooMany = Array.from({ length: 10_001 }, () => ({}));
    const text = JSON.stringify({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 1,
      clients: tooMany,
      events: [],
      imageTags: [],
    });
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });
});

describe('parseBackup — record validation', () => {
  it('rejects client with non-uuid id', () => {
    const text = JSON.stringify(
      envelope({
        clients: [
          {
            id: 'not-a-uuid',
            coupleNames: 'x',
            phone: '050-1',
            createdAt: 1,
            updatedAt: 1,
          } as never,
        ],
      }),
    );
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects event with non-uuid id', () => {
    const text = JSON.stringify(
      envelope({
        events: [
          {
            id: 'not-a-uuid',
          } as never,
        ],
      }),
    );
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects ImageSelection.imagePath with backslash (path traversal defense)', () => {
    const env = envelope({
      clients: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          coupleNames: 'x',
          phone: '050-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      events: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          clientId: '11111111-1111-4111-8111-111111111111',
          date: '2026-06-14',
          dayOfWeek: 'ראשון',
          startTime: '20:00',
          location: 'גאמוס',
          guestCount: 1,
          isMixed: false,
          notes: '',
          napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
          reception: { atResort: false },
          tableDesignSelections: [
            {
              imagePath: 'אולם עיצוב בסיס 2026\\foo.jpg', // backslash forbidden
              category: 'אולם עיצוב בסיס 2026',
              imageName: 'foo',
              notes: '',
              selectedAt: 1,
            },
          ],
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
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });
    expect(() => parseBackup(JSON.stringify(env))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects ImageSelection.imagePath with traversal segment', () => {
    const env = envelope({
      clients: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          coupleNames: 'x',
          phone: '050-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      events: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          clientId: '11111111-1111-4111-8111-111111111111',
          date: '2026-06-14',
          dayOfWeek: 'ראשון',
          startTime: '20:00',
          location: 'גאמוס',
          guestCount: 1,
          isMixed: false,
          notes: '',
          napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
          reception: { atResort: false },
          tableDesignSelections: [
            {
              imagePath: 'אולם עיצוב בסיס 2026/../events/spoof.docx',
              category: 'אולם עיצוב בסיס 2026',
              imageName: 'spoof',
              notes: '',
              selectedAt: 1,
            },
          ],
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
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });
    expect(() => parseBackup(JSON.stringify(env))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects unknown ImageCategory (INV-05)', () => {
    const env = envelope({
      clients: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          coupleNames: 'x',
          phone: '050-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      events: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          clientId: '11111111-1111-4111-8111-111111111111',
          date: '2026-06-14',
          dayOfWeek: 'ראשון',
          startTime: '20:00',
          location: 'גאמוס',
          guestCount: 1,
          isMixed: false,
          notes: '',
          napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
          reception: { atResort: false },
          tableDesignSelections: [
            {
              imagePath: 'foo/bar.jpg',
              category: 'NotARealCategory',
              imageName: 'bar',
              notes: '',
              selectedAt: 1,
            },
          ],
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
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });
    expect(() => parseBackup(JSON.stringify(env))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });

  it('rejects oversize signature dataUrl (P-05 §2)', () => {
    const bigSig = 'data:image/png;base64,' + 'a'.repeat(200 * 1024 + 10);
    const env = envelope({
      clients: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          coupleNames: 'x',
          phone: '050-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      events: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          clientId: '11111111-1111-4111-8111-111111111111',
          date: '2026-06-14',
          dayOfWeek: 'ראשון',
          startTime: '20:00',
          location: 'גאמוס',
          guestCount: 1,
          isMixed: false,
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
          signature: { dataUrl: bigSig, signedAt: 1 },
          status: 'signed',
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });
    expect(() => parseBackup(JSON.stringify(env))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PARSE' }),
    );
  });
});

describe('parseBackup — empty envelope acceptance', () => {
  it('accepts a minimal v2 envelope with empty arrays', () => {
    const text = JSON.stringify(envelope());
    const got = parseBackup(text);
    expect(got.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(got.clients.length).toBe(0);
    expect(got.events.length).toBe(0);
    expect(got.imageTags.length).toBe(0);
  });

  it('rejects v2 envelope missing imageTags', () => {
    // v2 envelopes MUST carry imageTags (even as []). Only v1 inputs are
    // forward-migrated with imageTags inferred to []. See SOP 07 § Restore
    // from v1 → v2.
    const text = JSON.stringify({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 1,
      clients: [],
      events: [],
    });
    expect(() => parseBackup(text)).toThrowError(
      expect.objectContaining({
        name: 'LibError',
        code: 'BACKUP_PARSE',
      }),
    );
  });
});

describe('parseBackup roundtrip with db.exportAll', () => {
  it('exportAll → wrap envelope → JSON → parseBackup yields equal arrays', async () => {
    const c = await createClient({ coupleNames: 'ליאור ודן', phone: '050-1234567' });
    await createEvent(buildEventInput(c.id));

    const dump = await exportAll();

    // Wrap into the BackupEnvelope shape (parallels what exportBackup does
    // before atomicWriteFile is invoked).
    const env: BackupEnvelope = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: dump.exportedAt,
      clients: dump.clients,
      events: dump.events,
      imageTags: [],
    };

    const text = JSON.stringify(env);
    const round = parseBackup(text);

    expect(round.clients.length).toBe(1);
    expect(round.clients[0]?.coupleNames).toBe('ליאור ודן');
    expect(round.events.length).toBe(1);
    expect(round.events[0]?.clientId).toBe(c.id);
    expect(round.events[0]?.dayOfWeek).toBe('ראשון');
  });
});
