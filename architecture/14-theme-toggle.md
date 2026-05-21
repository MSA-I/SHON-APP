# SOP 14 — Theme Toggle (Light / Dark)

> Authoritative spec for the Light/Dark theme system. Update *before* code changes. Companion to:
>
> - `claude.md § Behavioral Rules #12` (theme persistence — `meta.theme`)
> - SOP 02 § Object Stores (`meta.theme` joins `MetaKey`)
> - SOP 07 § File Format (theme is part of `BackupEnvelope.meta`)
> - SOP 09 § Color Tokens (defines the dark palette; light-mode is an inversion)
> - SOP 13 § 6 Theme state (the boot-time bootstrap and persist-on-toggle handlers)
> - SOP 15 § ui (the `<ThemeToggle />` component lives in `components/ui/`)

## 1. Purpose

Shon's app ships with a Luxury Editorial **dark** theme (deep ink + cream + antique gold). Some meeting rooms are lit, some are not — Shon asked for an opt-in light mode that inverts the canvas without softening the editorial feel (no rounded corners, no shadows; the gold rules and ❖ ornament still anchor the page).

This SOP locks:
1. The storage key (`meta.theme`).
2. The DOM application surface (`[data-theme]` + `.dark` class — both must agree).
3. The token-inversion contract (cream ↔ ink, gold-dark ↔ gold).
4. The component (curtain-animated icon toggle).
5. The placement rules (top-right of AppBar; hidden on TaggingPass).
6. The boot-time read-before-paint sequence (no flash-of-wrong-theme).
7. Backup parity (theme survives export/import).
8. The Behavioral Rule update.

### Scope: app-only

**`meta.theme` only flips the React UI Shon and the couple see during the meeting.** Generated DOCX deliverables are ALWAYS rendered with the light-theme palette per SOP 03 § Color Palette and `claude.md` Behavioral Rule #13. `buildEventDocx()` does not import the theme context and MUST NOT branch on theme state. The same rule applies to any future PDF derived from the DOCX. This prevents scope creep where someone tries to render a "dark-mode DOCX" — that artifact is always for print and email, where dark backgrounds make no sense.

## 2. Storage

### Key: `meta.theme`

| Field | Value |
|---|---|
| Store | `meta` (SOP 02 § Object Stores) |
| Key | `'theme'` |
| Type | `'light' | 'dark' | undefined` |
| Default | `undefined` → treated as `'dark'` by readers |
| Single writer | `<ThemeToggle />` `onClick` handler — `setMeta('theme', next)` |

### `MetaKey` extension (backend-coder follow-up)

Add `'theme'` to the `MetaKey` union in `app/src/lib/db.ts` and to the `META_KEYS` runtime guard:

```typescript
export type MetaKey =
  | 'lastBackupAt'
  | 'lastScanAt'
  | 'lastImportAt'
  | 'taggingComplete'
  | 'theme';                       // ← new in SOP 14
```

The `setMeta('theme', value)` call at the boundary should validate `value` against the literal set `{'light', 'dark'}` and reject anything else with `LibError({ code: 'DB_TX' })` — defense in depth against a corrupt write surfacing through some future migration.

**Architect does NOT edit `db.ts`** — this is the backend-coder's task in the SOP 14 follow-up. Architect's job is to lock the spec; the spec says: union expands to include `'theme'`, validators reject non-`'light' | 'dark'`, no other behavioral change.

### Default semantics

- **Fresh install** (no `meta.theme` row): readers see `undefined`, render as dark, do NOT write to db. The user's first toggle is the first write — implicit migration is forbidden.
- **Upgrade from a pre-SOP-14 build**: same story. The migration callback in `db.ts` (DB version bump triggered by future schema work) does NOT seed `meta.theme`. Existing users start in dark and stay there until they toggle.
- **Import a v2 backup** with `meta.theme === 'light'`: applied on next boot.
- **Import a v1 backup** (no meta.theme field): same as fresh install behavior — undefined, default dark, no implicit write.

## 3. DOM application surface

Two attributes must always agree:

```html
<html lang="he" dir="rtl" data-theme="dark" class="dark">
<!-- or -->
<html lang="he" dir="rtl" data-theme="light" class="">
```

| Surface | Used by | Why both? |
|---|---|---|
| `data-theme="..."` | `tokens.css` `[data-theme="light"] { … }` block — drives CSS variables (`--bg-primary`, etc.) | SOP 09's `:root` block currently defines dark-mode CSS variables. Light mode is a **second `[data-theme="light"]` block** that re-binds those same variables. Frontend-designer writes that block in 14-follow-up |
| `.dark` class on `<html>` | Tailwind v4 `darkMode: 'class'` — drives any explicit `dark:` utility (e.g. `dark:bg-ink dark:text-cream`) | Tailwind v4 reads the class, not the data-attribute. Both must match so utilities and CSS variables stay in sync |

The shell mutates **both** in the same microtask. See SOP 13 §6.

### Read-before-paint contract

The `<html>` element in `index.html` ships with `data-theme="dark" class="dark"` as the default. The boot effect (SOP 13 §3 step ②) reads `meta.theme` and overrides ONLY if the stored value is `'light'`. This means:

- New users: paint dark immediately, stay dark. Zero flash.
- Returning dark users: paint dark immediately, stay dark. Zero flash.
- Returning light users: paint dark for ~30 ms while `openDb` resolves, then flip to light during the boot splash. The flip happens on the BootSplash, not on the home screen — by the time `<HomeScreen />` first paints, the theme is settled.

If the ~30 ms dark flash on the BootSplash bothers the reviewer, a future enhancement is to write `meta.theme` to a tiny synchronous storage layer (localStorage) and read it before React mounts. Out of scope for SOP 14; the IDB read is fine for v1.

## 4. Token inversion contract

SOP 09 §1 defines the dark palette. Light mode is a **simple inversion** of the four canvas/text tokens, plus a slight muting of the gold accent:

| Token              | Dark (current SOP 09) | Light (new in SOP 14)         | Rule                                        |
|--------------------|-----------------------|-------------------------------|---------------------------------------------|
| `--ink`            | `#0F0E0C`             | `#F5F0E8`                     | Swap with `--cream`                         |
| `--ink-raised`     | `#1A1714`             | `#EFE8DD`                     | Slight tint above `--ink` (parchment feel)  |
| `--cream`          | `#F5F0E8`             | `#0F0E0C`                     | Swap with `--ink`                           |
| `--cream-muted`    | `#A8A39B`             | `#5C564D`                     | 65% of cream → 65% of ink                   |
| `--gold`           | `#C9A961`             | `#A88B47`                     | Use the deep gold — full gold is too loud on cream |
| `--gold-dark`      | `#A88B47`             | `#C9A961`                     | Inverse — bright gold reads better on cream as text |
| `--border-subtle`  | `#2A2520`             | `#D8CFC2`                     | Inverted hairline                           |
| (functional aliases) | unchanged           | unchanged                     | `--bg-primary`/etc. just point at the new variables |

### Frontend-designer's task in the SOP 14 follow-up

Append to `app/src/styles/tokens.css`:

```css
[data-theme="light"] {
  --ink: #F5F0E8;
  --ink-raised: #EFE8DD;
  --cream: #0F0E0C;
  --cream-muted: #5C564D;
  --gold: #A88B47;
  --gold-dark: #C9A961;
  --border-subtle: #D8CFC2;
}
```

(Functional aliases like `--bg-primary: var(--ink)` are defined in `:root` and don't need to be repeated — they automatically pick up the inverted value.)

**Contrast verification (frontend-designer's own check before merging):**
- `--cream` on `--ink` (light): `#0F0E0C` on `#F5F0E8` → **15.8 : 1** (AAA, same as dark inverted)
- `--cream-muted` on `--ink` (light): `#5C564D` on `#F5F0E8` → must be ≥ AA 4.5:1 — verify before merge
- `--gold-dark` on `--ink` (light): `#C9A961` on `#F5F0E8` → must be ≥ AA 4.5:1 for text — verify before merge

If a contrast ratio falls short, the frontend-designer adjusts the hex (within ±10) and updates this table — the table is the contract.

### What MUST NOT change in light mode

- **Border radius:** still `0` everywhere except the 2px hint on inputs/buttons (SOP 09 §4). Light theme does not soften the editorial feel.
- **No box-shadows, no gradients, no glassmorphism** (SOP 09 anti-patterns, both themes).
- **❖ ornament:** still gold. In light mode this means `--gold` (which is `#A88B47` — the muted variant). Still reads unambiguously as gold against cream.
- **Frank Ruhl Libre:** unchanged. Same weights, same axis values.
- **DOCX export:** unaffected — the DOCX is always dark-text-on-white print mode (SOP 09 §11). The theme is screen-only. **This is Behavioral Rule #13** in `claude.md`: `buildEventDocx()` ignores `meta.theme` entirely; logo selection inside DOCX always uses `assets/logo.svg` (the dark-on-white variant), never `assets/logo-light.svg`. Same rule applies to any future PDF output produced from the DOCX.

## 5. Component

### `<ThemeToggle />` lives at `app/src/components/ui/curtain-theme-toggle.tsx`

The user provides this component (drops into the codebase in 3B). Architect locks the **API**, frontend-designer integrates the file the user supplies.

```typescript
type ThemeToggleProps = {
  variant: 'icon';                  // v1 ships only the icon variant
  theme: 'light' | 'dark';          // current theme — controlled
  onToggle: (next: 'light' | 'dark') => void;
  prefersReducedMotion: boolean;    // from SOP 13 ThemeContext
  testId?: string;                  // e.g. 'theme-toggle' (SOP 15 § test-IDs)
};
```

### Behavior

- **Click** fires `onToggle(next)` where `next === current === 'dark' ? 'light' : 'dark'`.
- **Curtain animation** — 550 ms total, easing `cubic-bezier(0.16, 1, 0.3, 1)`. A diagonal cream/ink curtain sweeps across the screen during the swap. Implementation detail of the user-supplied component; the shell only commits to invoking `onToggle` and updating `data-theme` synchronously.
- **Reduced motion**: when `prefersReducedMotion === true`, the component swaps theme **instantly** with no curtain. The icon still rotates 90° as a state-change cue.
- **Icon set**: Lucide React `Sun` (light theme active → click swaps to dark) and `Moon` (dark theme active → click swaps to light).
- **Stroke width 1.5** per SOP 09 §8 iconography rule.
- **Hit target** 44×44 px (SOP 09 §12 accessibility floor).

### Single source of truth

The component is **controlled** — it does NOT hold its own theme state, does NOT call `setMeta` directly. The shell (SOP 13 §6) owns theme and feeds `theme` + `onToggle` props down. Why: keeps theme as a single value flowing through `ThemeContext`, no race between component-local state and meta state.

## 6. Placement

### Where the toggle appears

| Surface | Toggle visible? | Reason |
|---|---|---|
| `<BootSplash />` | No | Pre-router; theme already applied; nothing to toggle against |
| `<TaggingPass />` | No | Pass owns its own visual; Behavioral Rule #11 forbids any control surface besides the pass's own buttons |
| `<HomeScreen />` AppBar | **Yes — top-right** | Standard placement |
| `<ClientDetail />` AppBar | Yes — top-right | Same AppBar component |
| `<EventTabs />` AppBar | Yes — top-right | Same AppBar component |
| `<SettingsScreen />` AppBar | **Yes — top-right** | Standard placement |
| `<FatalBanner />` | No | Dead-end screen; reload-only |

The toggle is rendered **inside the AppBar component** (SOP 15 — `components/shell/AppBar.tsx`), so all four surfaces share one declaration.

### RTL placement

The AppBar uses `flex` with `justify-between`. In `dir="rtl"`:
- `<BackButton />` sits at the inline-start (visually right edge in RTL).
- The page title sits in the middle.
- `<ThemeToggle />` sits at the inline-end (visually left edge in RTL).

This is the inverse of an English app. Do not use `ml-auto` or `mr-auto` — use `ms-auto` / `me-auto` per SOP 09 §7 RTL conventions.

## 7. Boot order

Reproduced from SOP 13 §3 + §6 for self-containment. The bootstrap MUST follow this order to avoid flash-of-wrong-theme:

1. `<html data-theme="dark" class="dark">` is the static default in `index.html`.
2. React mounts `<App />`.
3. `<BootSplash />` paints in dark (the static default).
4. `useEffect` runs: `openDb()` → `getMeta<'light'|'dark'>('theme')`.
5. If stored is `'light'`: synchronously mutate `data-theme` to `'light'` AND remove the `dark` class. The `<BootSplash />` re-renders in light during the same frame. (For ~30 ms after openDb resolves.)
6. `getMeta('taggingComplete')` resolves. Reducer dispatches.
7. The first non-boot view paints in the correct theme. No flash.

If `getMeta('theme')` rejects for any reason: stay in dark, do NOT write to db, log via `console.error`. Failing to read is not the same as the user choosing dark — the user's intent (whatever it was) is preserved on disk.

## 8. Backup integration

`meta.theme` is part of `BackupEnvelope.meta` (SOP 07 § File Format already serializes the meta store).

### Export

Every `exportBackup()` includes the current `meta.theme` value (or omits the row if absent). The envelope's `meta` field is a `Record<MetaKey, unknown>`.

### Import

| Backup variant | Restore behavior |
|---|---|
| v2 with `meta.theme === 'light'` | Set `meta.theme = 'light'` in the local DB. On next boot, app renders in light |
| v2 with `meta.theme === 'dark'` | Same with `'dark'` |
| v2 without `meta.theme` (older v2 build) | Do not touch local `meta.theme` — preserve the local user's preference |
| v1 (no meta block at all) | Do not touch local `meta.theme` — preserve the local user's preference |

### Acceptance

A round-trip backup test: toggle to light → take a backup → clear local db → import the backup → app boots in light. Add as canonical step 9.5 (between current steps 9 and 10) in the verification flow if the team-lead chooses to ratify; otherwise carry as an SOP-14-internal acceptance check.

## 9. Behavioral Rule update

Add to `claude.md`:

> **#12. MUST persist theme choice in `meta.theme`.** The default on a fresh install is `'dark'` (Luxury Editorial). User-toggled values (`'light' | 'dark'`) persist via `db.setMeta('theme', value)` in the same single-writer `<ThemeToggle />` handler. No implicit migration: an absent row stays absent until the user toggles. Backup envelopes carry the theme; restore preserves it.

This appends after #11 (the Tagging Pass gate). The Maintenance Log gets a row dated 2026-05-20 noting the addition. See `claude.md` change in this same Phase 3B kickoff.

## 10. Verification

A short checklist the canonical 13-step flow gets extended with:

**T1.** Cold boot a fresh install. `<html>` has `data-theme="dark"`. Top-right AppBar shows the moon icon. `meta.theme` row absent in IDB.

**T2.** Click the moon. The curtain animation runs ~550 ms. After the animation: `<html data-theme="light" class="">`. `meta.theme === 'light'` in IDB. Tokens visibly inverted (cream canvas, ink text, muted gold).

**T3.** Reload the app. Boot splash paints in light immediately (no dark flash longer than ~30 ms). Home screen renders in light.

**T4.** Toggle back to dark. Curtain runs again. `meta.theme === 'dark'`. Reload — paints dark.

**T5.** Take a backup → clear IDB → import the backup. App reboots in the theme that was active at export.

**T6.** Open Windows "Reduce motion" preference → toggle theme. Animation is instant (no curtain). The functional swap still happens.

**T7.** Boot the TaggingPass on a fresh install (`meta.taggingComplete` absent). The toggle is **not** visible. The pass still respects the active theme (dark by default; if Shon somehow imported a light backup before tagging, the pass renders in light).

If any of T1–T7 fails, this SOP gets a Self-Annealing entry and the fix lands before the 14-related code change is merged.

## 11. Cross-references

- **SOP 02** — `MetaKey` extension to include `'theme'`
- **SOP 07** — Backup envelope carries `meta.theme`
- **SOP 09** — Color token table; light-mode inversions slot into `[data-theme="light"]`
- **SOP 13** — Boot sequence reads theme before first paint; `<ThemeToggle />` mounts inside AppBar
- **SOP 15** — `ThemeToggle` lives at `components/ui/curtain-theme-toggle.tsx`; AppBar at `components/shell/AppBar.tsx`

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. Defines `meta.theme` storage, DOM application surface (`[data-theme]` + `.dark` class), token-inversion contract for light mode, the curtain `<ThemeToggle />` component API + placement rules, the read-before-paint boot order, backup integration, and Behavioral Rule #12. | Initial spec |
| 2026-05-20 | `MetaKey` extended with `'theme'`; `setMeta('theme', value)` validates `'light' \| 'dark'` BEFORE `openDb()` so a bad call costs no IO. `getMeta('theme')` returns `'light' \| 'dark' \| undefined` — absent row stays absent (default = dark, no implicit migration write). Single-writer rule: only `<ThemeToggle />` (via `ThemeContext.setTheme`) writes `meta.theme`. | Backend-coder follow-up to SOP 14 §2 landed. |
| 2026-05-20 | Tailwind v4 light-mode trick documented: override the same `--color-*` variables under `[data-theme="light"]` selector under `@layer base`. `@theme` cannot be conditioned on a runtime selector. Adding `html[data-theme="light"] { color-scheme: light }` flips native scrollbars/form widgets too. | `app/src/styles/index.css` + `tokens.css` updated; cross-referenced from SOP 09. |
| 2026-05-20 | `ThemeContext.tsx` shipped (~90 lines). Hydration: starts at `theme: 'dark'`, `hydrating: true`; `useEffect` reads `getMeta<Theme>('theme')` once and adopts the stored value if `'light' | 'dark'`. On read failure, logs `[theme] hydrate failed` and stays on dark per SOP 14 §7. DOM application: separate `useEffect([theme])` mutates `<html data-theme="...">` AND toggles the `dark` class so both surfaces agree. `setTheme(next)` updates state synchronously then fire-and-forgets `setMeta('theme', next)`; persist failures are logged but the theme stays applied for the session. Cancellation guard against React StrictMode double-mount. | Phase 3A backend-coder card. |
| 2026-05-20 | Behavioral Rule #13 added (DOCX/PDF output is ALWAYS light-theme). `meta.theme` flip is an **app-only** concern. `buildEventDocx()` ignores `meta.theme` entirely. Logo selection inside DOCX always uses `assets/logo.svg`. | Constitution Maintenance Log row 2026-05-20. |
| 2026-05-21 | `AppBar.tsx` still carries a local `useTheme()` shim (1-liner — temporary bridge from before `ThemeContext` shipped). Phase 4 task: swap the import to `'../../contexts/ThemeContext'`. Call signature is identical. | Tracked in `task_plan.md` Phase 4 § Carry-over polish. |
