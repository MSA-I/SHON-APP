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

// ---------------------------------------------------------------------------
// Human-readable event folder + filename (Maintenance Log 2026-05-25)
// ---------------------------------------------------------------------------
//
// Shon asked for the exported DOCX to live in a folder named after the
// couple, not after a UUID, so he can browse `events/` and recognize each
// file without opening it. The eventId is still appended as a short suffix
// so two events for the same couple on the same date don't collide. The
// folder + filename basename are computed by the same helper, which:
//   • NFC-normalizes the input (Hebrew + combining marks);
//   • strips Windows-reserved chars `<>:"|?*` + control chars + path
//     separators (`/`, `\`, `\0`);
//   • collapses whitespace runs to a single space;
//   • trims leading/trailing whitespace and dots (Windows refuses dot
//     suffixes on directory names);
//   • truncates to a reasonable length so we don't hit the Win32 MAX_PATH;
//   • appends the first 8 chars of the eventId for disambiguation.
// On empty / fully-stripped input it falls back to the eventId so we can
// always produce a usable path.

/** Reserved/forbidden characters on Windows + POSIX path separators. */
const FORBIDDEN_FILENAME_CHARS = /[<>:"|?*/\\\x00-\x1F]/g;

const FOLDER_BASENAME_MAX_LEN = 96;

/**
 * Build the human-readable folder/file basename for one event.
 * Pure function — no FS access, no `Date.now()`. Output is safe to use as
 * both a directory name and a filename stem (we add `.docx` for the file).
 */
export function buildEventFolderBasename(input: {
  coupleNames: string;
  date: string; // ISO yyyy-mm-dd
  eventId: string; // uuid v4
}): string {
  assertEventId(input.eventId);

  const namesNfc = (input.coupleNames || '').normalize('NFC');
  const cleaned = namesNfc
    .replace(FORBIDDEN_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, FOLDER_BASENAME_MAX_LEN);

  const idSuffix = input.eventId.slice(0, 8);
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';

  if (!cleaned) {
    // Fully-stripped input — fall back to a stable, unique basename.
    return datePart
      ? `event_${datePart}_${idSuffix}`
      : `event_${idSuffix}`;
  }

  if (!datePart) {
    return `${cleaned}_${idSuffix}`;
  }
  return `${cleaned}_${datePart}_${idSuffix}`;
}

/**
 * "<root>/events/<couple-names>_<date>_<id8>" — the human-readable per-event
 * folder. Created by `tauriFsProvider.ensureDir` before the atomic write in
 * `SummaryTab.onExport`. Stays inside `events/**` so the existing Tauri
 * capability scope and `assertInsideRoot` defense both still apply.
 */
export async function getEventDirByName(input: {
  coupleNames: string;
  date: string;
  eventId: string;
}): Promise<string> {
  const root = await getProjectRoot();
  const basename = buildEventFolderBasename(input);
  return joinPosix(root, EVENTS_DIRNAME, basename);
}

/** "<root>/events/<couple-names>_<date>_<id8>/<couple-names>_<date>_<id8>.docx" */
export async function getEventDocxPathByName(input: {
  coupleNames: string;
  date: string;
  eventId: string;
}): Promise<string> {
  const dir = await getEventDirByName(input);
  const basename = buildEventFolderBasename(input);
  return joinPosix(dir, `${basename}.docx`);
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
