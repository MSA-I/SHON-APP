# Shon Blaish — Event Designer App

Local-first desktop app for the event-design workflow of Shon Blaish.
React 19 + TypeScript + Vite + Tauri 2.

> The Project Constitution lives at `../claude.md`. Architecture SOPs live at `../architecture/`. Read those before changing anything in this directory.

## Stack

- **Framework**: React 19 + TypeScript (strict)
- **Bundler**: Vite 7
- **Desktop runtime**: Tauri 2 (`tauri 2.11`, `tauri-plugin-fs 2.5`, `tauri-plugin-dialog 2.7`)
- **Persistence**: IndexedDB via `idb`
- **Documents**: `docx` v8 (Word handles RTL natively; PDF is a one-click "Save as PDF" from Word)
- **Animation**: Framer Motion 12
- **Icons**: Lucide React
- **Signature capture**: react-signature-canvas

## Scripts

```bash
npm run dev          # Vite dev server (browser-only; no Tauri)
npm run tauri:dev    # full Tauri 2 dev window — what you actually want during development
npm run build        # type-check + vite build
npm run tauri:build  # production .exe bundle (Windows)
npm run typecheck    # tsc --noEmit
```

## First-time toolchain setup (Windows + bash)

Rust/Cargo is installed via `rustup` (see `../progress.md`), but **its bin directory is not on PATH inside Git Bash by default**. Before running any `tauri:dev` / `tauri:build` / `cargo` command from bash:

```bash
export PATH="/c/Users/$(whoami)/.cargo/bin:$PATH"
cargo --version   # should print 1.95+ — sanity check
```

PowerShell or `cmd.exe` already see the cargo path via the system PATH set by the rustup installer, so this dance is bash-only. CI / release builds should run in PowerShell or use the env-source dance above.

## Filesystem boundaries (security-critical)

The app touches the local filesystem only through two scopes — read-only image library and read-write `events/` + `backups/`. Capability JSON lives at `src-tauri/capabilities/`. **Do not edit those files without re-reading `../architecture/08-tauri-filesystem.md` § Security.** Wrong scope = leaks the read-only invariant.

- `image-library.json` — read-only over the 7 category folders + 2 loose root JPGs. Never add a write permission to this file.
- `app-writable.json` — read-write over `events/**` + `backups/**` only. Never add image-library paths.
- `default.json` — `core:default` only.

The CSP and `assetProtocol.scope` in `tauri.conf.json` mirror these constraints. The `protocol-asset` Tauri feature is required (and set in `Cargo.toml`).

## Layer 3 entry points (`src/lib/`)

These are the only places the rest of the app talks to side effects:

| Module | Owns |
|---|---|
| `config.ts` | `getProjectRoot()` |
| `paths.ts` | absolute-path helpers + traversal guards (`assertInsideRoot`, `assertInsideBackups`) |
| `tauri-fs.ts` | `FsProvider` adapter wrapping `@tauri-apps/plugin-fs` + atomic writes + `safeRemoveFile` |
| `db.ts` | IndexedDB CRUD via `idb` |
| `images.ts` | scan + thumbnail pipeline |
| `docx.ts` | DOCX builder |
| `backup.ts` | export / import / auto-snapshot |

Components in `src/components/` and contexts in `src/contexts/` **never** touch `@tauri-apps/*` or `idb` directly — they call lib functions.
