// SOP: architecture/08-tauri-filesystem.md § Project Root Resolution (v1)
// SOP: architecture/07-backup-strategy.md § Filename
//
// Single chokepoint for derived paths. Lib code never concatenates paths
// inline — everything funnels through the helpers below. The security audit
// (#17) walks this file to verify no caller can smuggle traversal.
//
// Internal representation is POSIX (`/`). The `tauri-fs.ts` provider swaps to
// native (`\`) only at the FFI boundary, per SOP 08 § Path Conventions.

import {
  BACKUPS_DIRNAME,
  EVENTS_DIRNAME,
  EVENT_DOCX_FILENAME,
  LibError,
} from '../types';
import { getProjectRoot } from './config';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BACKUP_FILENAME_RE =
  /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(_pre-migration)?\.json$/;

function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

function assertEventId(eventId: string): void {
  if (!UUID_V4_RE.test(eventId)) {
    throw new LibError('Invalid event id; expected uuid v4', {
      code: 'FS_ENSURE_DIR',
      id: eventId,
    });
  }
}

function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0')
  ) {
    throw new LibError('Unsafe filename', {
      code: 'BACKUP_WRITE',
      path: filename,
    });
  }
}

/** "<root>/events/<eventId>" */
export async function getEventDir(eventId: string): Promise<string> {
  assertEventId(eventId);
  const root = await getProjectRoot();
  return joinPosix(root, EVENTS_DIRNAME, eventId);
}

/** "<root>/events/<eventId>/plan.docx" */
export async function getEventDocxPath(eventId: string): Promise<string> {
  const dir = await getEventDir(eventId);
  return joinPosix(dir, EVENT_DOCX_FILENAME);
}

/** "<root>/events/<eventId>/signature.png" — needed by SOP 06 */
export async function getEventSignaturePath(eventId: string): Promise<string> {
  const dir = await getEventDir(eventId);
  return joinPosix(dir, 'signature.png');
}

/** "<root>/backups" */
export async function getBackupsDir(): Promise<string> {
  const root = await getProjectRoot();
  return joinPosix(root, BACKUPS_DIRNAME);
}

/**
 * "<root>/backups/<filename>"
 * Validates filename against the SOP 07 regex. Callers cannot smuggle traversal
 * through this helper.
 */
export async function getBackupPath(filename: string): Promise<string> {
  assertSafeFilename(filename);
  if (!BACKUP_FILENAME_RE.test(filename)) {
    throw new LibError('Backup filename does not match SOP 07 pattern', {
      code: 'BACKUP_WRITE',
      path: filename,
    });
  }
  const dir = await getBackupsDir();
  return joinPosix(dir, filename);
}

/** "<root>/events" — used by housekeeping that scans all events. */
export async function getEventsDir(): Promise<string> {
  const root = await getProjectRoot();
  return joinPosix(root, EVENTS_DIRNAME);
}
