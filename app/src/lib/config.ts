// SOP: architecture/08-tauri-filesystem.md § Project Root Resolution (v1)
//
// Single chokepoint for the project-root path. Capability JSON in
// `src-tauri/capabilities/*.json` hardcodes the same absolute string at build
// time; this module is the runtime mirror. They MUST agree — security audit
// #17 verifies this.
//
// `localStorage` is intentionally NOT consulted: anything user-mutable that
// shapes paths would let a malicious DevTools session escape capability scope.

import { DEFAULT_PROJECT_ROOT, LibError } from '../types';

let cachedRoot: string | null = null;

/**
 * Resolve the absolute project root. v1 returns `DEFAULT_PROJECT_ROOT`; future
 * versions can introduce runtime selection via a custom Rust command that
 * re-validates each path against the chosen root before delegating to fs APIs.
 */
export async function getProjectRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot;
  const root = DEFAULT_PROJECT_ROOT;
  if (!root || typeof root !== 'string') {
    throw new LibError('PROJECT_ROOT is not configured', {
      code: 'FS_ENSURE_DIR',
    });
  }
  cachedRoot = root;
  return cachedRoot;
}

/** Test-only hook. Never call from app code. */
export function __resetProjectRootForTests(): void {
  cachedRoot = null;
}
