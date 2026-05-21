// SOP: .tmp/path-traversal-vectors.md (tester, 2026-05-20)
//
// Typed array of inputs `tauri-fs.ts` must reject (or — for accept cases —
// must NOT throw). Consumed by `tauri-fs.test.ts`.

import type { LibErrorCode } from '../../../types';

export type Op = 'readFile' | 'readDir' | 'writeFile' | 'safeRemoveFile';

export type Vector = {
  /** Stable label (for vitest test names). */
  id: string;
  /** Raw input string. The lib must `normalizeForCompare` defensively. */
  input: (root: string) => string;
  /** Which `tauriFsProvider` / `tauriFsExtras` method to call. */
  op: Op;
  /** Expected outcome. `'reject'` → throws/rejects with LibError. */
  outcome: 'reject' | 'accept';
  /** Required when outcome === 'reject'. */
  expectedCode?: LibErrorCode;
  /** Comment for failure debugging. */
  reason: string;
};

const ROOT = 'F:/MyFiles/העסק שלי/שון בלאיש';
const FAKE_EVENT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Each vector is realised at runtime by composing on the (mocked) project root.
 * Group letters mirror `.tmp/path-traversal-vectors.md`.
 */
export const vectors: Vector[] = [
  // -----------------------------------------------------------------------
  // Group A — POSIX traversal
  // -----------------------------------------------------------------------
  {
    id: 'A1',
    input: () => '../../../Windows/System32/notepad.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'classic POSIX traversal — relative outside-of-root',
  },
  {
    id: 'A2',
    input: () => '../../Windows/System32',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'parent-of-parent escape',
  },
  {
    id: 'A3',
    input: () => 'events/../../Windows',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 're-escape via known scoped child',
  },
  {
    id: 'A4',
    input: () => 'backups/../events/spoof.docx',
    op: 'writeFile',
    outcome: 'reject',
    expectedCode: 'FS_WRITE_FILE',
    reason: 'cross-scope traversal',
  },
  {
    id: 'A5',
    input: () => `events/${FAKE_EVENT_ID}/../../Windows/System32/cmd.exe`,
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'scope-relative double-up',
  },

  // -----------------------------------------------------------------------
  // Group B — Windows backslash
  // -----------------------------------------------------------------------
  {
    id: 'B1',
    input: () => '..\\..\\..\\Windows\\System32\\notepad.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'normalize backslash BEFORE prefix check',
  },
  {
    id: 'B2',
    input: () => `${ROOT}\\events\\${FAKE_EVENT_ID}\\plan.docx`,
    op: 'writeFile',
    outcome: 'accept',
    reason: 'duplicate-slash + backslash normalization, valid scope',
  },
  {
    id: 'B3',
    input: () => '..\\events\\..\\..\\Windows',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'backslash-escaped traversal',
  },
  {
    id: 'B4',
    input: () => 'backups\\..\\events\\spoof.docx',
    op: 'writeFile',
    outcome: 'reject',
    expectedCode: 'FS_WRITE_FILE',
    reason: 'mixed separators with cross-scope escape',
  },

  // -----------------------------------------------------------------------
  // Group C — Absolute path bypass
  // -----------------------------------------------------------------------
  {
    id: 'C1',
    input: () => 'C:/Windows/System32/notepad.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'abs path different drive',
  },
  {
    id: 'C2',
    input: () => 'C:\\Windows\\System32\\notepad.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'abs + backslash',
  },
  {
    id: 'C3',
    input: () => 'D:/Windows/System32',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'abs same drive but outside project root',
  },
  {
    id: 'C4',
    input: () => `${ROOT}/Windows/notepad.exe`,
    op: 'readFile',
    outcome: 'accept',
    // NOTE: tauri-fs.ts only enforces "inside project root", scope-folder
    // narrowing is the caller's job (paths.ts) — so a path inside ROOT but
    // not in events/backups passes the assertInsideRoot guard. The vector
    // doc says C4 should reject, but the lib implementation defers that to
    // paths.ts (validated separately in paths.test.ts via getEventDocxPath).
    // This vector is reclassified as a "lib accepts; caller-helper rejects".
    reason: 'abs INSIDE project root — assertInsideRoot accepts; scope narrowing is paths.ts job',
  },
  {
    id: 'C5',
    input: () => `${ROOT}/אולם עיצוב בסיס 2026/foo.jpg`,
    op: 'readFile',
    outcome: 'accept',
    reason: 'abs inside Block A (read-only image scope)',
  },
  {
    id: 'C6',
    input: () => `${ROOT}/events/${FAKE_EVENT_ID}/plan.docx`,
    op: 'writeFile',
    outcome: 'accept',
    reason: 'abs inside Block B (write scope)',
  },

  // -----------------------------------------------------------------------
  // Group D — UNC / extended-length
  //
  // `normalizeForCompare` rejects `\\?\…` and `\\.\…` *before* the per-op
  // code is consulted, so D1/D2/D3 throw FS_ENSURE_DIR regardless of the
  // caller. (Documented behaviour — reviewer confirmed in #17 audit.)
  // -----------------------------------------------------------------------
  {
    id: 'D1',
    input: () => '\\\\?\\C:\\Windows\\System32\\notepad.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_ENSURE_DIR',
    reason: 'extended-length UNC — rejected by normalizeForCompare',
  },
  {
    id: 'D2',
    input: () => '\\\\?\\D:\\משה פרוייקטים\\שון בלאיש\\..\\..\\Windows\\',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_ENSURE_DIR',
    reason: 'UNC prefix tripped before traversal walk',
  },
  {
    id: 'D3',
    input: () => '\\\\.\\C:\\Windows',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_ENSURE_DIR',
    reason: 'DOS device path — rejected by normalizeForCompare',
  },
  {
    id: 'D4',
    input: () => '\\\\server\\share\\file.exe',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'UNC remote share — falls through to "escapes anchor" with op-specific code',
  },

  // -----------------------------------------------------------------------
  // Group E — Hebrew + traversal mix
  // -----------------------------------------------------------------------
  {
    id: 'E1',
    input: () => 'אולם עיצוב בסיס 2026/../events/spoof.docx',
    op: 'writeFile',
    outcome: 'reject',
    expectedCode: 'FS_WRITE_FILE',
    reason: 'Hebrew category as stepping stone for traversal',
  },
  {
    id: 'E2',
    input: () => 'אולם עיצוב בסיס 2026/../../Windows',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'Hebrew + double escape',
  },

  // -----------------------------------------------------------------------
  // Group F — Encoding tricks
  // -----------------------------------------------------------------------
  {
    id: 'F1',
    input: () => `events/${FAKE_EVENT_ID}/plan.docx\0.jpg`,
    op: 'writeFile',
    outcome: 'reject',
    // normalizeForCompare's null-byte branch throws FS_ENSURE_DIR before the
    // op-specific code reaches the assertInside walker.
    expectedCode: 'FS_ENSURE_DIR',
    reason: 'null-byte truncation — rejected at normalize layer',
  },
  {
    id: 'F3',
    input: () => `${ROOT}/events//${FAKE_EVENT_ID}//plan.docx`,
    op: 'writeFile',
    outcome: 'accept',
    reason: 'duplicate-slash sanity',
  },
  {
    id: 'F4',
    input: () => `${ROOT}/events/${FAKE_EVENT_ID}/./plan.docx`,
    op: 'writeFile',
    outcome: 'accept',
    reason: 'curdir segment collapses',
  },
  {
    id: 'F5',
    input: () => `${ROOT}/events/${FAKE_EVENT_ID}/.//plan.docx`,
    op: 'writeFile',
    outcome: 'accept',
    reason: 'mixed curdir + duplicate slash',
  },

  // -----------------------------------------------------------------------
  // Group H — Empty / weird
  // -----------------------------------------------------------------------
  {
    id: 'H1',
    input: () => '',
    op: 'readFile',
    outcome: 'reject',
    expectedCode: 'FS_READ_FILE',
    reason: 'empty path',
  },
  {
    id: 'H2',
    input: () => '/',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'root only — outside project root',
  },
  {
    id: 'H3',
    input: () => '.',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'curdir, not anchored',
  },
  {
    id: 'H4',
    input: () => '..',
    op: 'readDir',
    outcome: 'reject',
    expectedCode: 'FS_READ_DIR',
    reason: 'escape',
  },
  {
    id: 'H5',
    input: () => `events/${FAKE_EVENT_ID}/plan\0docx`,
    op: 'writeFile',
    outcome: 'reject',
    expectedCode: 'FS_ENSURE_DIR',
    reason: 'embedded null byte — rejected at normalize layer',
  },
];
