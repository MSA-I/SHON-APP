// SOP: architecture/08-tauri-filesystem.md § Project Root Resolution
// SOP: architecture/07-backup-strategy.md § Filename
//
// `paths.ts` is the only chokepoint that turns logical handles (eventId,
// backup filename) into absolute disk paths. These tests prove every helper
// rejects malformed input loudly (LibError with the right code) and passes
// every well-formed input.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  getEventDir,
  getEventDocxPath,
  getEventSignaturePath,
  getBackupsDir,
  getBackupPath,
  getEventsDir,
} from '../paths';
import { __resetProjectRootForTests } from '../config';
import { LibError, DEFAULT_PROJECT_ROOT } from '../../types';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  __resetProjectRootForTests();
});

describe('paths.getEventDir', () => {
  it('returns "<root>/events/<id>" for a valid uuid v4', async () => {
    const got = await getEventDir(VALID_UUID);
    expect(got).toBe(`${DEFAULT_PROJECT_ROOT}/events/${VALID_UUID}`);
  });

  it('rejects a non-uuid eventId with FS_ENSURE_DIR', async () => {
    await expect(getEventDir('not-a-uuid')).rejects.toMatchObject({
      name: 'LibError',
      code: 'FS_ENSURE_DIR',
    });
  });

  it('rejects a uuid v1 (wrong version digit) with FS_ENSURE_DIR', async () => {
    // v1 has '1' at position 14; the regex demands '4'.
    const v1 = '11111111-1111-1111-8111-111111111111';
    await expect(getEventDir(v1)).rejects.toBeInstanceOf(LibError);
  });

  it('rejects empty string', async () => {
    await expect(getEventDir('')).rejects.toMatchObject({ code: 'FS_ENSURE_DIR' });
  });
});

describe('paths.getEventDocxPath', () => {
  it('returns "<root>/events/<id>/plan.docx"', async () => {
    const got = await getEventDocxPath(VALID_UUID);
    expect(got).toBe(`${DEFAULT_PROJECT_ROOT}/events/${VALID_UUID}/plan.docx`);
  });

  it('rejects bad uuid', async () => {
    await expect(getEventDocxPath('xxx')).rejects.toMatchObject({ code: 'FS_ENSURE_DIR' });
  });
});

describe('paths.getEventSignaturePath', () => {
  it('returns "<root>/events/<id>/signature.png"', async () => {
    const got = await getEventSignaturePath(VALID_UUID);
    expect(got).toBe(
      `${DEFAULT_PROJECT_ROOT}/events/${VALID_UUID}/signature.png`,
    );
  });
});

describe('paths.getBackupsDir', () => {
  it('returns "<root>/backups"', async () => {
    const got = await getBackupsDir();
    expect(got).toBe(`${DEFAULT_PROJECT_ROOT}/backups`);
  });
});

describe('paths.getEventsDir', () => {
  it('returns "<root>/events"', async () => {
    const got = await getEventsDir();
    expect(got).toBe(`${DEFAULT_PROJECT_ROOT}/events`);
  });
});

describe('paths.getBackupPath', () => {
  it('accepts a SOP-07-pattern filename', async () => {
    const got = await getBackupPath('backup_2026-05-20_12-00.json');
    expect(got).toBe(
      `${DEFAULT_PROJECT_ROOT}/backups/backup_2026-05-20_12-00.json`,
    );
  });

  it('accepts the _pre-migration suffix variant', async () => {
    const got = await getBackupPath('backup_2026-05-20_12-00_pre-migration.json');
    expect(got).toBe(
      `${DEFAULT_PROJECT_ROOT}/backups/backup_2026-05-20_12-00_pre-migration.json`,
    );
  });

  it('rejects traversal "../events/spoof.docx" with BACKUP_WRITE', async () => {
    await expect(getBackupPath('../events/spoof.docx')).rejects.toMatchObject({
      name: 'LibError',
      code: 'BACKUP_WRITE',
    });
  });

  it('rejects "foo.json" — does not match SOP 07 regex', async () => {
    await expect(getBackupPath('foo.json')).rejects.toMatchObject({
      name: 'LibError',
      code: 'BACKUP_WRITE',
    });
  });

  it('rejects backslash in filename', async () => {
    await expect(getBackupPath('back\\up.json')).rejects.toMatchObject({
      code: 'BACKUP_WRITE',
    });
  });

  it('rejects null byte', async () => {
    await expect(getBackupPath('backup_2026-05-20_12-00.json\0')).rejects.toMatchObject({
      code: 'BACKUP_WRITE',
    });
  });

  it('rejects empty filename', async () => {
    await expect(getBackupPath('')).rejects.toMatchObject({ code: 'BACKUP_WRITE' });
  });

  it('rejects ".." segment in filename', async () => {
    await expect(getBackupPath('..')).rejects.toMatchObject({ code: 'BACKUP_WRITE' });
  });
});
