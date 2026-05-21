# SOP 08 — Tauri Filesystem Boundary

> Authoritative spec for how the React app reads images, writes DOCX files, and manages backups via Tauri's Rust backend. Update *before* code changes. The boundary defined here is the only place the app touches the host filesystem.

## Purpose

Pin the precise Tauri APIs, capabilities, and path scopes the app uses. SOPs 01 (image scan), 03 (DOCX generation), and 07 (backup) all sit on top of this boundary. The provider abstraction lets the same lib code run unchanged in Node tests with `fake-indexeddb` + `fs/promises`.

## Stack

- **Tauri version:** 2.x (locked in scaffold: tauri 2.11.2, plugin-fs 2.5.1, plugin-dialog 2.7.1)
- **Rust toolchain:** installed via `rustup` (verified 2026-05-20 in `progress.md`)
- **JS bindings:** `@tauri-apps/api` (path + core + dialog), `@tauri-apps/plugin-fs` (filesystem). **`@tauri-apps/api/shell` is NOT used in MVP** — see § Permission Model. The "open backups folder" feature is deferred; Settings will display the absolute path as a copyable text field instead.
- **Plugin-fs permission identifiers (verified against installed plugin-fs 2.5.1):** plugin-fs 2.5.1 does NOT split read by encoding — `fs:allow-read-file` covers binary and text. The full set we ship: `fs:allow-read-file`, `fs:allow-read-text-file`, `fs:allow-read-dir`, `fs:allow-stat`, `fs:allow-exists`, `fs:allow-write-file`, `fs:allow-write-text-file`, `fs:allow-mkdir`, `fs:allow-rename`, `fs:allow-remove`, plus inline `fs:scope`, `dialog:allow-open`, `dialog:allow-save`. Originally-proposed names that do NOT exist in 2.5.1 (build fails loud if used): `fs:allow-read-binary-file`, `fs:allow-write-binary-file`, `fs:allow-create-dir`, `fs:allow-remove-file`.
- **Cargo features:** `app/src-tauri/Cargo.toml` declares `tauri = { version = "2", features = ["protocol-asset"] }`. Without this, `tauri-build` rejects `tauri.conf.json > app.security.assetProtocol` outright.
- **Bundle target:** Windows `.exe` (single-file installer, ~3-15MB)

## Path Scopes (Capabilities)

Tauri 2 enforces scoped FS access via `tauri.conf.json` capabilities. The app declares **two distinct permission blocks** — never merged. Merging them would re-grant write access to the image library through the read-only path, defeating the "MUST keep images in their existing folders" rule.

**v1 path-resolution constraint (security-auditor item #5).** Capability JSON is parsed at build time and cannot reference values resolved at runtime from `localStorage`. Tauri 2 supports built-ins like `$APPDATA`, `$RESOURCE`, `$HOME` — not arbitrary `$PROJECT`-style names. For v1 we **hardcode** the absolute project root in capability JSON; the same value is duplicated in `src/lib/config.ts` for runtime path construction. This is the same value living in two places by necessity (capability scopes + lib path joins). Documented as an accepted constraint, not a bug. "Choose project folder" is therefore **read-only / disabled in v1** — moving the root requires a re-build.

### Block A — `image-library` (read-only, scoped per-subfolder)

- **Scope:** every image-library subfolder named explicitly. **Never** uses `D:/משה פרוייקטים/שון בלאיש/**` as a glob root, because that root also contains `events/`, `backups/`, and the app source — granting write under the same root would break the read-only invariant.
- **Permissions (read-only, as shipped in `capabilities/image-library.json`):**
  - `fs:allow-read-file` — image bytes for thumbnail generation (SOP 01); plugin-fs 2.5.1 does not split read by encoding
  - `fs:allow-read-dir` — for `readDir(category)` during scan
  - `fs:allow-stat` — file size + mtime for the `ImageMetadata` index
  - `fs:allow-exists` — boot-time sanity check (`getProjectRoot()` verifies at least one expected category folder is present)
  - inline `fs:scope` — listing every image-library subfolder + the 2 loose root JPGs
- **Explicitly excluded:** every write / mkdir / rename / remove identifier. The `image-library` capability file must never grant `fs:allow-write-file`, `fs:allow-write-text-file`, `fs:allow-mkdir`, `fs:allow-rename`, or `fs:allow-remove`.

### Block B — `app-writable` (read-write, scoped to `events/` + `backups/`)

- **Scope:** exactly two subtrees — `D:/משה פרוייקטים/שון בלאיש/events/**` and `D:/משה פרוייקטים/שון בלאיש/backups/**`. These are the **only** places the app writes.
- **Permissions (as shipped in `capabilities/app-writable.json`):**
  - `fs:allow-read-file` — DOCX bytes back for verification, signature.png re-load, backup JSON during restore
  - `fs:allow-read-text-file` — explicit text-only companion for backup restore
  - `fs:allow-read-dir` — `listBackups`, `listEvents`
  - `fs:allow-stat` — backup file metadata for retention pruning
  - `fs:allow-exists` — pre-write check for `events/<id>` and `backups/`
  - `fs:allow-write-file` — DOCX + signature.png writes (SOP 03 / 06)
  - `fs:allow-write-text-file` — backup JSON writes (SOP 07)
  - `fs:allow-mkdir` — `mkdir events/<id>` and ensuring `backups/` exists
  - `fs:allow-rename` — atomic-write linchpin (`<final>.tmp` → `<final>`); see § Atomic Writes
  - `fs:allow-remove` — used **only** by backup retention pruning. Wrapped at the lib layer in `safeRemoveFile`, which refuses any path outside `getBackupsDir()`. Generated DOCX deliverables must never be deleted by the app
  - `dialog:allow-open` — Settings → "Pick backup file"
  - `dialog:allow-save` — Settings → "Manual export" save-as picker
  - inline `fs:scope` — `events/**` and `backups/**` only
- **Excluded:** the originally-proposed `fs:allow-remove-dir` (does not exist in 2.5.1 either). The app never removes folders.

### Capability JSON (`src-tauri/capabilities/main.json`)

Two permission blocks — read scope first, write scope second, neither overlapping the other:

```jsonc
{
  "identifier": "main",
  "windows": ["main"],
  "permissions": [
    "core:default",

    // --- Block A: read-only over the image library ---
    {
      "identifier": "fs:allow-read-binary-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/אולם עיצוב בסיס 2026/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות אולם גדול גאמוס/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות ריזורט/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/מפות מפיות/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/עיצובים שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/ריזורט בסיס/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/כסא כלה בחוץ בסיס.jpg" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/כסא כלה בתוך האולם.jpg" }
      ]
    },
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/אולם עיצוב בסיס 2026/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות אולם גדול גאמוס/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות ריזורט/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/מפות מפיות/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/עיצובים שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/ריזורט בסיס/**" }
      ]
    },
    {
      "identifier": "fs:allow-read-dir",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/אולם עיצוב בסיס 2026/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות אולם גדול גאמוס/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות ריזורט/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/חופות שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/מפות מפיות/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/עיצובים שידרוג/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/ריזורט בסיס/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/events/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups/**" }
      ]
    },

    // --- Block B: read-write, scoped to events/ + backups/ ---
    {
      "identifier": "fs:allow-write-binary-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/events/**" }
      ]
    },
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups/**" }
      ]
    },
    {
      "identifier": "fs:allow-read-binary-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/events/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups/**" }
      ]
    },
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups/**" }
      ]
    },
    {
      "identifier": "fs:allow-mkdir",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/events/**" },
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups" }
      ]
    },
    {
      "identifier": "fs:allow-remove-file",
      "allow": [
        { "path": "D:/משה פרוייקטים/שון בלאיש/backups/**" }
      ]
    },

    // --- Dialog (folder/file picker only; no scope variable needed) ---
    "dialog:allow-open"
  ]
}
```

The literal path string `D:/משה פרוייקטים/שון בלאיש/` appears in two places by necessity: (a) here in capability JSON (build-time, can't reference runtime config), and (b) in `src/lib/config.ts` at `DEFAULT_PROJECT_ROOT`. Both must agree. A single mismatch breaks every FS call. The #17 security audit verifies they're identical.

## API Surface (`app/src/lib/tauri-fs.ts`)

The file is a thin adapter that conforms to the `FsProvider` interface introduced in SOP 01:

```typescript
import { readDir, readFile, writeFile, writeTextFile, readTextFile,
         removeFile, stat, mkdir, exists } from '@tauri-apps/plugin-fs';
import { join, normalize } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';

export type FsProvider = {
  readDir: (path: string) => Promise<{ name: string; isFile: boolean }[]>;
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  readFile: (path: string) => Promise<Uint8Array>;
  readTextFile: (path: string) => Promise<string>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  writeTextFile: (path: string, text: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  toAssetUrl: (absolutePath: string) => string;   // wraps convertFileSrc — for <img src> in WebView
};

export const tauriFsProvider: FsProvider = { /* … wraps the imports above … */ };

export async function getProjectRoot(): Promise<string>;        // returns the configured root
export async function getEventsDir(): Promise<string>;          // join(root, 'events')
export async function getBackupsDir(): Promise<string>;         // join(root, 'backups')
export async function ensureAppDirs(): Promise<void>;           // mkdir events/ and backups/ if missing
```

The pure function `toAssetUrl` is the bridge for `<img src>` in the gallery Lightbox: Tauri's `convertFileSrc` produces a `tauri://localhost/...` URL that bypasses HTTP entirely and lets WebView2 render disk images without sandbox issues.

## Path Conventions

1. **Internal path representation: POSIX slashes.** Lib code stores `'אולם עיצוב בסיס 2026/שנדליר ורסאצה.JPG'` regardless of host OS. The `tauriFsProvider` wraps every path with a `toNativePath` helper that swaps `/` → `\\` on Windows just before crossing the FFI boundary.
2. **Hebrew characters: NFC-normalized** at scan time (`name.normalize('NFC')`). Tauri returns NFC on Windows, but normalize defensively to survive future runtime upgrades.
3. **Absolute vs relative:** lib code passes relative paths (relative to project root) into the provider. The provider joins with `getProjectRoot()` before calling Tauri APIs.
4. **`convertFileSrc` requires absolute paths.** `toAssetUrl` accepts absolute only.

## Project Root Resolution (v1)

For v1, the project root is **fixed at build time** to match the capability scopes (see § Path Scopes). This is enforced through two cooperating modules:

- **`src/lib/config.ts`** — exports `DEFAULT_PROJECT_ROOT = 'D:/משה פרוייקטים/שון בלאיש'` plus a runtime resolver `getProjectRoot()` that returns the same value. Currently a wrapper around the constant; structured this way so future versions can introduce runtime selection (with a custom Rust command that re-validates each path against the chosen root before delegating to fs APIs).
- **`src/lib/paths.ts`** — single chokepoint for all derived paths: `getEventDir(eventId)`, `getEventDocxPath(eventId)`, `getBackupsDir()`, `getBackupPath(filename)`. Lib code never concatenates paths inline. This is the audit-friendly chokepoint #17 will validate.

A boot-time sanity check verifies the project root contains at least one of the 8 expected categories (7 subfolders + the 2 loose `כיסא כלה` JPGs). On failure, the app shows a fatal banner: "ספריית התמונות לא נמצאה — נא להריץ מחדש את ההתקנה". v1 has no in-app folder picker; reinstalling with a different path requires a rebuild.

`localStorage` is **not** consulted for path resolution. Anything user-mutable that affects paths would let a malicious dev-tools session escape capability scope.

## Image-Loading Pipeline (Gallery + Lightbox)

```
[Card thumbnail in grid]
  IndexedDB.thumbnails.get(path) → Blob → URL.createObjectURL → <img src>

[Lightbox full-resolution]
  absPath = join(projectRoot, relativePath)
  tauriFsProvider.toAssetUrl(absPath) → 'tauri://localhost/...' → <img src>
```

Why two paths: thumbnails are pre-generated and cached; full-res images are streamed straight from disk by the WebView when the Lightbox opens. No re-encoding, no base64 — the WebView reads the file with its native I/O.

## DOCX Export

```typescript
import { tauriFsProvider, getEventsDir } from './tauri-fs';

export async function saveDocxForEvent(eventId: string, bytes: Uint8Array, signaturePngBytes?: Uint8Array): Promise<string> {
  const eventsDir = await getEventsDir();
  const eventDir = await join(eventsDir, eventId);
  await tauriFsProvider.mkdir(eventDir, { recursive: true });
  const docxPath = await join(eventDir, 'plan.docx');
  await tauriFsProvider.writeFile(docxPath, bytes);
  if (signaturePngBytes) {
    await tauriFsProvider.writeFile(await join(eventDir, 'signature.png'), signaturePngBytes);
  }
  return docxPath;
}
```

The eventId is used as the folder name (UUID) — guaranteed unique, no Hebrew filename quirks.

## Backup IO

`SOP 07` calls `tauriFsProvider.writeTextFile(path, json)` and `readTextFile(path)`. `listBackups` calls `readDir(backupsDir)`, filters by the filename regex `/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(_pre-migration)?\.json$/`, then `stat`s each.

## Asset Protocol Scope (CRITICAL)

`tauri.conf.json > app.security.assetProtocol` controls what the WebView's `asset://` and `tauri://` URLs can resolve to. **Without an explicit scope, `convertFileSrc` bypasses the FS capability scope entirely** — the renderer can `<img src="asset://localhost/C:/Windows/...">` and the OS will happily serve it. This is the single most important config in this SOP.

The asset-protocol scope **must mirror Block A's read scope** (the image-library subfolders + the 2 loose root JPGs):

```jsonc
// tauri.conf.json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": [
          "D:/משה פרוייקטים/שון בלאיש/אולם עיצוב בסיס 2026/**",
          "D:/משה פרוייקטים/שון בלאיש/חופות אולם גדול גאמוס/**",
          "D:/משה פרוייקטים/שון בלאיש/חופות ריזורט/**",
          "D:/משה פרוייקטים/שון בלאיש/חופות שידרוג/**",
          "D:/משה פרוייקטים/שון בלאיש/מפות מפיות/**",
          "D:/משה פרוייקטים/שון בלאיש/עיצובים שידרוג/**",
          "D:/משה פרוייקטים/שון בלאיש/ריזורט בסיס/**",
          "D:/משה פרוייקטים/שון בלאיש/כסא כלה בחוץ בסיס.jpg",
          "D:/משה פרוייקטים/שון בלאיש/כסא כלה בתוך האולם.jpg"
        ]
      }
    }
  }
}
```

**Do not include `events/**` or `backups/**` in this scope** — the renderer never needs to render DOCX/JSON files via `<img src>`, and broadening the asset scope is a needless attack surface increase.

The Lightbox flow (`toAssetUrl(absolutePath)`) is the only consumer. If `convertFileSrc` returns a URL but the WebView still 404s, the asset-protocol scope is the first thing to check.

## Permission Model

- The user runs the bundled `.exe`. There is no first-run OS-permission prompt; the app accesses the project folder under the user's existing privileges (no UAC elevation).
- **No network permissions are ever requested.** This is enforced at three layers: (a) the CSP `connect-src` directive (see § CSP), (b) the absence of `http:` plugin, (c) the bundle never includes a fetch polyfill or third-party network library.
- `dialog:allow-open` is the only dialog permission (used by Settings → "Pick backup file"). Folder selection is **not** in MVP per § Project Root Resolution.
- **`shell:allow-open` is NOT included.** The "open backups folder in Explorer" feature is out of MVP — Settings displays the absolute backup path as a copyable text field instead. If/when reintroduced, it needs its own scope: `shell.open` allowed for exactly one path (the backups folder), nothing else. An unscoped `shell.open` lets the renderer call `shell.open('https://attacker.example')`, launching the OS browser as a covert network egress channel.
- `core:default` is included — provides only the safe `app:*` queries (version, name) the WebView needs.

## CSP

`tauri.conf.json > app.security.csp` pins a full set of directives. `default-src` alone does NOT cover all directives; in particular `connect-src` falls through to its own default of `*` if not specified, breaking the no-network rule.

```
default-src 'self';
connect-src 'self' tauri: ipc:;
img-src 'self' asset: data: blob:;
style-src 'self' 'unsafe-inline';
script-src 'self';
font-src 'self' data:;
```

Per directive:
- `connect-src 'self' tauri: ipc:` — allows the WebView ↔ Tauri IPC channel and the dev-server in dev mode; blocks `fetch('https://...')` and `XMLHttpRequest`. **This is the directive that enforces the no-network behavioral rule at the browser level.**
- `img-src 'self' asset: data: blob:` — `asset:` for Lightbox full-res via `convertFileSrc`; `blob:` for IndexedDB-cached thumbnails (`URL.createObjectURL`); `data:` for the SVG logo and signature-canvas data URLs.
- `style-src 'self' 'unsafe-inline'` — concession for Tailwind's runtime classes. Revisit when we move to compiled Tailwind (post-MVP).
- `script-src 'self'` — no inline scripts, no remote scripts. The bundle is the only script source.
- `font-src 'self' data:` — Frank Ruhl Libre + Heebo are bundled in `public/fonts/`, served `'self'`. `data:` is for any inline font fallback.

If a future feature requires loosening any directive, document the specific use case in § Self-Annealing and re-run the #17 / #39 audits.

## Concurrency Model

- The lib does not parallelize FS reads beyond `Promise.all([...categories.map(scanCategory)])`. Tauri's I/O is async on the Rust side; concurrent `readDir` across 7 folders is well within Windows' file-handle budget.
- Writes are serialized at the lib level — `saveDocxForEvent` and `exportBackup` use a single in-process mutex (per-event for DOCX, global for backup) to prevent partial-file races on the same target.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Project root not found at boot | sanity check fails (no expected category folder under `DEFAULT_PROJECT_ROOT`) | Fatal banner "ספריית התמונות לא נמצאה — נא להריץ מחדש את ההתקנה". v1 has no in-app folder picker; user re-installs with the correct path. |
| FS capability scope mismatch | `forbidden path` error from Tauri (any read/write call) | Show error with the offending path; this indicates capability JSON drift from `DEFAULT_PROJECT_ROOT` — code must be rebuilt. The lib's `safeRemoveFile` raises a typed `LibError` *before* hitting Tauri. |
| Asset-protocol scope missing → Lightbox 404s | `<img onerror>` + URL inspection shows `asset://localhost/...` | First check: `tauri.conf.json > app.security.assetProtocol.scope` matches Block A's read scope. Almost always the cause of a "thumbnails work, lightbox doesn't" report. |
| `D:` drive not mounted | `readDir` rejects | Full-screen banner "כונן D: לא מחובר" + retry button |
| Hebrew path encoding error | `convertFileSrc` returns broken URL | Re-encode each segment via `encodeURIComponent`; if still broken, show placeholder. Note: Tauri 2 returns NFC on Windows; ensure scope strings are also NFC. |
| Backups folder not writable | `writeTextFile` rejects | Toast + Settings warning; user data still safe in IndexedDB; manual export remains an option |
| Events folder partially written (crash mid-export) | DOCX file truncated | On next export, the lib writes to `plan.docx.tmp` first, then atomic rename to `plan.docx` |
| Path-traversal attempt reaches the lib | `safeRemoveFile`/`safeRead*`/`safeWrite*` resolves outside expected root | Reject with typed `LibError` (FS_*); never delegate to Tauri. See § Security § Path-traversal test vectors |
| Tauri capability JSON malformed at build | bundler error | Build fails — caught in CI, never ships |

## Atomic Writes

For DOCX and backup writes that must not leave half-written files behind:

```typescript
async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`;
  await tauriFsProvider.writeFile(tmp, bytes);
  // Tauri 2's `rename` is in @tauri-apps/plugin-fs
  await fs.rename(tmp, path);
}
```

Both `saveDocxForEvent` and `exportBackup` use `atomicWrite`. If the rename fails (e.g., destination locked because the user has the DOCX open in Word), the `.tmp` file remains and the user is told to close Word.

## Testing Hooks

The Node test provider (`nodeFsProvider`) implements the same `FsProvider` interface using `fs/promises`. POC L1 confirmed byte-compatible behavior on Hebrew paths: read `name`, `size`, `mtime` from Node match what Tauri returns. Lib code under test never imports `@tauri-apps/*`; only the production app shell wires `tauriFsProvider`.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Tauri toolchain installed via `winget install Rustlang.Rustup`; Cargo available in new shell sessions | Recorded in `progress.md` |
| 2026-05-20 | Locked the read-only / read-write scope split, atomic-write pattern, and POSIX-internal / native-on-boundary path convention | Initial spec |
| 2026-05-20 | `cargo --version` not on PATH inside the existing bash shell (binaries exist at `%USERPROFILE%\.cargo\bin\cargo.exe`); `tauri init` calls `cargo` repeatedly | The scaffold step (#7) launches from a fresh shell that has sourced `%USERPROFILE%\.cargo\env`, OR threads cargo via its absolute path. Recommend the fresh shell — fewer moving parts. |
| 2026-05-20 | Security-auditor pre-review of #8 found 6 critical issues. | Split into 3 capability files (`default.json` core-only, `image-library.json` read-only, `app-writable.json` read-write). Dropped `shell:allow-open` from MVP. Added § Asset Protocol Scope mirroring read scope. Hardcoded absolute project root in capability JSON. Pinned full 6-directive CSP. |
| 2026-05-20 | At #8 implementation, backend-coder discovered plugin-fs 2.5.1 does NOT split read by encoding — `fs:allow-read-file` covers binary AND text. Originally-proposed names (`fs:allow-read-binary-file`, `fs:allow-write-binary-file`, `fs:allow-create-dir`, `fs:allow-remove-file`) do not exist in 2.5.1; build would have failed loud. | Rewrote § Stack identifier list and § Path Scopes Blocks A+B to match what shipped: `fs:allow-read-file`, `fs:allow-read-text-file`, `fs:allow-write-file`, `fs:allow-write-text-file`, `fs:allow-mkdir`, `fs:allow-rename`, `fs:allow-remove`, `fs:allow-stat`, `fs:allow-exists`. Added `dialog:allow-save`. Added Cargo `protocol-asset` feature note. |
| 2026-05-20 | Task #10 lib chokepoints (`config.ts`, `paths.ts`, `tauri-fs.ts`) implemented. `assertInsideRoot` rejects `..`, NUL, `\\?\` UNC, drive prefixes, non-NFC; `assertInsideBackups` anchored at `getBackupsDir()`; `safeRemoveFile` only deletes inside `backups/` matching the SOP 07 backup-name regex; `atomicWriteFile` writes to `.tmp` then renames. typecheck + vite build green. | Lib boundary aligned to canonical `FsProvider` shape in `app/src/types/index.ts` (`toFileSrc` / `ensureDir`, not `toAssetUrl` / `mkdir`). |
| 2026-05-20 | Path-traversal vector reconciliation: `normalizeForCompare` throws `LibError(FS_ENSURE_DIR)` for null bytes and UNC prefixes regardless of the calling op. Vectors **D1, D2, D3, F1, H5** in `.tmp/path-traversal-vectors.md` were updated to expect `FS_ENSURE_DIR` (was the op-specific code). Not a lib bug — the early-exit is by design (the path is uniformly malformed; the calling op is irrelevant). Vector **C4** (`<root>/Windows/notepad.exe`) was reclassified `accept` at the `tauri-fs` layer because scope narrowing (events/ vs backups/) is `paths.ts`'s job. | Vectors-vs-impl reconciliation logged in #15 progress entry; 45 tauri-fs tests green. |
| 2026-05-20 | Vitest harness wired with `fake-indexeddb/auto` + happy-dom + `nodeFsProvider` Node-side test adapter. `FsProvider` interface is the seam — production wires `tauriFsProvider`; tests wire `nodeFsProvider`. Lib code never imports `@tauri-apps/*`. | Phase 3A test foundation; 121/121 baseline. |
| 2026-05-21 | Phase 5 still owes: (a) `cargo audit` inside `app/src-tauri/`; (b) manual NTFS-reparse-point traversal verification (Group G) on Windows; (c) production-mode CSP verification under `tauri build`, not `tauri:dev`. | Tracked in `task_plan.md` Phase 5 § Security gates. |

## Verification (planned)

Phase 3 step 8 (capabilities) + step 10 (`tauri-fs.ts`) + step 15 (smoke test) + step 17 (security audit). Local acceptance gates:
- `readDir(projectRoot)` returns the 7 expected category subfolders + the 2 loose `כסא כלה *.jpg` root JPGs (which feed the synthetic 8th category `כיסא כלה`) + `events/` + `backups/`
- Attempting `writeFile(projectRoot/'אולם עיצוב בסיס 2026'/'test.jpg')` is rejected by capability scope (Block A is read-only; Block B does not include the image-library subfolders)
- Attempting `removeFile(projectRoot/'events/<id>/plan.docx')` is rejected by `safeRemoveFile` lib wrapper (events are deliverables; only `backups/**` is removable)
- DOCX export to `events/<id>/plan.docx` succeeds; same path `.tmp` is cleaned up on success
- Lightbox `<img src>` from a Hebrew filename renders without 404 (asset-protocol scope verified)
- Lightbox `<img src="asset://localhost/C:/Windows/System32/cmd.exe">` is blocked by asset-protocol scope (manual probe in #17)
- `fetch('https://example.com')` from DevTools console is blocked by CSP `connect-src` (manual probe in #17)
- Disk-D-unmounted simulation shows the failure banner, not a crash

End-to-end acceptance is gated by the **canonical 13-step flow** in `claude.md § Verification`. This SOP underwrites step 5 (DOCX file appears at `events/<event-id>/plan.docx`), step 7 (backup file appears at `backups/backup_<timestamp>.json`), the FS-backed parts of steps 8-10 (manual export/import via Tauri file picker), and Performance Gate 11 (cold-start ≤ 3s, which depends on the FS scan time bounded by this provider).

---

## Security

> Owner: security-auditor. Tasks #17 (post-#8 audit) and #39 (final pre-ship audit) populate this section. Pre-staged subsections appear here ahead of the formal audits.

### Threat model (one-liner)

Single-user, fully-offline desktop app. The only attack surface is the local filesystem and any backup JSON the user manually imports. There is **no network egress**, **no auth**, **no remote attacker**. Realistic threats:
1. A malicious or tampered backup JSON tricking `importAll` into corrupting the IndexedDB or escaping path scope.
2. A category-folder image filename or symlink crafted to break out of scope (`../`, NTFS reparse points).
3. A future maintainer accidentally broadening the Tauri capabilities.
4. A vulnerable Rust crate in the Tauri tree (parser, image decoder) exploitable by a crafted file.

### Pre-audit notes (security-auditor, 2026-05-20)

Pre-review of this SOP before task #8 (capabilities config) is implemented. These are flagged so backend-coder can address them while writing `src-tauri/capabilities/main.json` rather than fix them after the formal #17 audit.

1. **Scope split must be two permission blocks, not one.** The example `permissions` array in § Path Scopes shows a single `fs:scope` block whose `allow` list contains `$PROJECT/**` *and* the `events/`/`backups/` subpaths *and* one combined set of read+write permissions. The first entry already matches everything, making the rest redundant — and because both `fs:allow-read-file` and `fs:allow-write-file` are granted in the same block, **the app would be authorized to write anywhere under the project root, including the read-only image library.** Required: split into two distinct blocks (or two capability files), one read-only over the image folders, one read-write over `events/**` + `backups/**`. Never include `$PROJECT/**` in any block that grants write permissions.
2. **Verify Tauri 2 fs permission identifiers against the installed plugin.** Run `cargo tree -p tauri-plugin-fs` and inspect the plugin's `permissions/autogenerated/` directory for the canonical names. Likely corrections from the SOP's draft list: `fs:allow-read-binary-file` for `readFile()`, `fs:allow-write-binary-file` for binary writes (DOCX, signature.png), `fs:allow-write-text-file` for backup JSON. Wrong identifiers → build failure (caught early), so this is a fast-feedback fix.
3. **`shell:allow-open` needs a URL/path scope.** Without one, the renderer can call `shell.open('https://attacker.example')` which launches the OS browser — a covert network egress channel that violates the "no networking" rule. Restrict `shell.open` to ONLY the absolute backups folder path. If we cannot scope `shell.open` tightly enough, drop the "open backups folder in Explorer" feature and rely on a path-display field the user can copy.
4. **Add explicit `assetProtocol.scope`.** The `convertFileSrc` / Lightbox flow (line 71, 121) depends on `tauri.conf.json > app.security.assetProtocol`. If unset, the renderer can `<img src="asset://localhost/C:/Windows/...">` — bypassing the FS capability scope entirely. Mirror the image-library read scope here.
5. **`$PROJECT` placeholder is not a Tauri 2 built-in scope variable.** Capability JSON is parsed at build time and cannot reference values resolved at runtime from `localStorage`. Tauri 2 supports built-ins like `$APPDATA`, `$RESOURCE`, `$HOME` but not arbitrary names. Either (a) hardcode `D:/משה פרוייקטים/שון בלאיש/**` literally in the capability JSON and document that "Choose project folder" is read-only / disabled in v1, or (b) drop user-chosen-folder from MVP. Cannot have strict scope **and** runtime root selection without a custom Rust command that re-validates each path against the chosen root before delegating to fs APIs.
6. **Pin a full CSP, not just `default-src 'self'`.** Recommended: `default-src 'self'; img-src 'self' data: tauri: blob: asset:; media-src 'self' tauri: asset:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' tauri: ipc:; font-src 'self' data:`. The `connect-src` directive is what enforces "no networking" at the browser level — `default-src` alone does not cover all directives. `style-src 'unsafe-inline'` is a concession for Tailwind's runtime classes; revisit if we move to compiled Tailwind.
7. **Lib-level path-traversal guard in `tauri-fs.ts`.** Even with Tauri's scope check, the provider should validate every path passed to `readFile`/`writeFile`/`mkdir`/`removeFile` resolves inside `getProjectRoot()` (or `getBackupsDir()` for `removeFile`). Failing fast with a typed `LibError` is friendlier than a Tauri error string and provides defense in depth if a future capability change is too broad. Test vectors below.
8. **`removeFile` should be wrapped to only delete inside `backups/`.** Used by backup retention pruning. Even if `events/**` is in the write scope, the lib should refuse `removeFile(events/...)` — generated DOCX files are deliverables and must not be deleted by the app once written.

### Path-traversal test vectors (formal #17)

Run these against `tauri-fs.ts` once it exists. Each must reject with a typed `LibError` (FS_READ_FILE / FS_WRITE_FILE / FS_ENSURE_DIR), not silently fall through:

| Input | Expected | Notes |
|---|---|---|
| `../../../Windows/System32/notepad.exe` | rejected | classic POSIX traversal |
| `..\\..\\..\\Windows\\System32\\notepad.exe` | rejected | Windows backslash variant |
| `C:/Windows/System32/notepad.exe` | rejected | absolute path bypass |
| `\\\\?\\C:\\Windows\\System32\\notepad.exe` | rejected | UNC / extended-length path |
| `\\\\?\\D:\\משה פרוייקטים\\שון בלאיש\\..\\..\\Windows\\` | rejected | UNC + traversal |
| `events/<id>/../../../Windows/System32/...` | rejected | scope-relative traversal |
| `אולם עיצוב בסיס 2026/../events/spoof.docx` | rejected | Hebrew + traversal |
| `events/<id>/plan.docx%00.jpg` | rejected | null-byte / encoded-NUL |
| symlink in image folder → `C:\Users\` | rejected | Tauri must follow-and-check; verify on Windows reparse points |
| `events//<id>//plan.docx` | accepted (collapsed to single slash) | duplicate-slash normalization sanity |

### Backup JSON tampering (formal #17 + #39)

Backup files are user-supplied untrusted data on import. `importAll` must:
1. Reject prototype-pollution keys (`__proto__`, `constructor`, `prototype`) at the JSON parse layer or via a structural validator.
2. Validate `schemaVersion` is a known integer (currently `1`); reject all others.
3. Validate every `Client.id` and `Event.id` matches the uuid v4 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
4. Validate every `ImageSelection.imagePath` is a **relative** POSIX path with no `..`, no leading `/`, no drive letter, no `\\`. Image paths in backups are reference-only — the restore flow does not re-read the binaries.
5. Validate `signature.dataUrl` (if present) matches `^data:image/png;base64,[A-Za-z0-9+/=]+$` and stays under ~512KB after base64 decode.
6. Bound checks: refuse files > 50MB, refuse `clients` or `events` arrays > 10,000 items.

These checks belong in `src/lib/backup.ts`, not in `tauri-fs.ts`. The audit will verify the lib layer enforces them; missing any one is a blocking finding.

### Rust dependency audit (`cargo audit`)

The Tauri backend pulls a non-trivial Rust dependency tree (`tauri`, `serde`, `tokio`, `windows-sys`, image/document crates and their transitives). Even with zero network egress, a vulnerable dep can still be exploited locally — e.g., a parser CVE in a crate that handles paths or JSON we read from `backups/`, or an image decoder bug triggered by a malformed JPEG in the gallery.

#### One-time setup
```bash
cargo install cargo-audit --locked
```

#### Cadence
- **Before every release build** (manual `npm run tauri build`).
- **First Monday of each month** as a maintenance pulse, regardless of release activity.
- **Immediately** if RustSec announces a high-severity advisory affecting any crate in our `Cargo.lock` (subscribe to https://rustsec.org/feed.xml).

#### Run
From `app/src-tauri/`:
```bash
cargo audit
cargo audit --json > ../../.tmp/cargo-audit-$(date +%Y-%m-%d).json
```

#### Triage matrix

| Severity | Action |
|---|---|
| `critical` / `high` | Stop. Open a P0 task. Bump the affected crate, rebuild, re-run audit. Do not ship. |
| `medium` | Open a task within 7 days. Acceptable to ship the current build only if no exploit path matches our threat model (no network, no user-supplied binaries beyond images and JSON we already validate). Document the rationale in `progress.md`. |
| `low` / `informational` | Track in `progress.md`; address opportunistically during the next dependency bump. |
| `unmaintained` warning | Evaluate replacement. Not blocking unless paired with an unfixed CVE. |

#### Accepted risks

If `cargo audit` flags a transitive crate that we cannot directly upgrade (parent hasn't released a fix), record an entry below. Re-evaluate every 30 days.

| Date | Crate + version | Advisory | Severity | Why our threat model neutralizes it | Re-review by |
|---|---|---|---|---|---|
| _none yet_ | | | | | |

#### Companion: `cargo deny`

For long-term hygiene, consider adding `cargo-deny` with a `deny.toml` that forbids unmaintained crates and pins a license allowlist. Not required for v1; revisit at the first major dependency bump.

### Final audit (#39)

_Pending — populated when #36 and #37 complete. The final audit re-runs the formal #17 checklist against the production build, plus inspects: (a) `vite.config.ts` for any dev-server proxy or network leak that survived into the build, (b) `tauri.conf.json` for `devPath` / `bundle` settings that could leak in release mode, (c) the bundled `.exe` for unexpected shipped resources, (d) a clean `cargo audit` on the `Cargo.lock` used for the release build._
