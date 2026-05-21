# SOP 15 — Component Architecture (Phase 3B)

> Authoritative spec for the component layout under `app/src/components/` and `app/src/contexts/`. Update *before* code changes. Companion to:
>
> - `claude.md § Architectural Invariants #1` (3-Layer Architecture — components are Layer 2)
> - SOP 09 (design tokens — every component traces back here)
> - SOP 13 (App shell — what mounts where, AppView state machine)
> - SOP 14 (Theme system — `<ThemeToggle />` lives in `components/ui/`)
> - SOP 12 (TaggingPass — lives in `components/tagging/`)
> - SOP 05 (Gallery — lives in `components/gallery/`)
> - SOP 06 (Signature — lives in `components/signature/`)
> - SOP 10 (Ubiquitous language — Hebrew labels are the law)

## 1. Purpose

Lock the directory layout, naming convention, public-vs-private boundary, test-id convention, and the Layer 2 imports rule **before** Phase 3B starts shipping components. Without this:

1. Two contributors put `ClientCard.tsx` in two different folders. Reviewers can't tell which is canonical.
2. A component drifts into importing `@tauri-apps/plugin-fs` directly, bypassing the lib layer. The 3-layer architecture quietly breaks.
3. The tester's canonical-flow plan references `data-testid="event-tab-napkins"` but the component renders `data-testid="napkinsTab"`. The 13-step verification can't run unattended.

This SOP fixes all three at once.

## 2. Directory layout

```
app/src/
├── components/
│   ├── ui/                          # Headless / generic primitives
│   │   ├── curtain-theme-toggle.tsx # SOP 14 — user-supplied; drops here in 3B
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── TextArea.tsx
│   │   └── Card.tsx
│   ├── shell/                       # App shell — chrome + boundaries
│   │   ├── AppBar.tsx
│   │   ├── BootSplash.tsx
│   │   ├── ErrorBoundary.tsx        # exports both TopLevelBoundary + PerViewBoundary
│   │   ├── FatalBanner.tsx
│   │   ├── SettingsScreen.tsx       # mounted by AppView 'settings'
│   │   └── Toaster.tsx              # portal for transient error/success notifications
│   ├── client/                      # Client domain
│   │   ├── HomeScreen.tsx           # mounted by AppView 'home'
│   │   ├── ClientList.tsx
│   │   ├── ClientCard.tsx
│   │   ├── ClientForm.tsx           # create + edit modes
│   │   └── ClientDetail.tsx         # mounted by AppView 'client-detail'
│   ├── event/                       # Event domain (Phase 3C tabs go here)
│   │   └── EventTabs.tsx            # shell only — tab implementations are 3C
│   ├── gallery/                     # Image gallery + lightbox (SOP 05)
│   │   └── (Phase 3C)
│   ├── signature/                   # Signature canvas (SOP 06)
│   │   └── (Phase 3C)
│   └── tagging/                     # The TaggingPass (SOP 12)
│       └── TaggingPass.tsx          # full-screen, owns its own state per SOP 12
└── contexts/
    ├── EventContext.tsx             # SOP 13 §5 — currentClient / currentEvent / dispatch verbs
    └── ThemeContext.tsx             # SOP 13 §6 + SOP 14 — { theme, prefersReducedMotion }
```

### What lives in each subfolder

#### `components/ui/`

**Domain boundary:** none. These are **headless / generic primitives** — they know nothing about Clients, Events, Hebrew labels, or routing. They take props (label, value, onChange, variant) and render visual primitives. A `Button` here does NOT know about `saveClient`; the `ClientForm` in `components/client/` wires the button up.

Files:
- `curtain-theme-toggle.tsx` — user-supplied component (SOP 14 §5)
- `Button.tsx` — primary / secondary / ghost variants per SOP 09 §9.3 (gold underline grow on hover)
- `Input.tsx` — RTL form input with LTR override for numeric (SOP 09 §9.4)
- `TextArea.tsx` — same, multi-line
- `Card.tsx` — flat, sharp, padding-driven (SOP 09 §9.6)

**Adding a new ui primitive:** the threshold is "would three different domain components (client + event + gallery) want to use this?" If yes, it's `ui/`. If not, it lives in the domain folder that uses it.

#### `components/shell/`

**Domain boundary:** the app frame and error handling. Components here render the top-level chrome that wraps every view, plus the boot/error surfaces.

Files:
- `AppBar.tsx` — top bar with brand mark, page title, back button, ThemeToggle. RTL: brand right, theme toggle left (inline-end)
- `BootSplash.tsx` — SOP 13 §3 boot loading state
- `ErrorBoundary.tsx` — exports `TopLevelBoundary` + `PerViewBoundary` (SOP 13 §7)
- `FatalBanner.tsx` — dead-end fatal screen (SOP 13 §7)
- `SettingsScreen.tsx` — Settings view (backup ייצוא / ייבוא buttons, "אפס נתונים מקומיים", absolute path display per SOP 08 § Permission Model)
- `Toaster.tsx` — react-portal-mounted toast queue; consumed via `useToast()` hook re-exported from `contexts/EventContext.tsx`

#### `components/client/`

**Domain boundary:** Client aggregate root and the home/client-detail views.

Files:
- `HomeScreen.tsx` — mounted when `view.kind === 'home'`. Renders AppBar + ClientList + "לקוח חדש" CTA. Subscribes to `listClients()`.
- `ClientList.tsx` — pure presentation; takes `clients: Client[]` + `onClientClick(id)`. No `db.ts` calls.
- `ClientCard.tsx` — single card; takes `client: Client` + `onClick`. Renders `coupleNames`, `phone`, `updatedAt`.
- `ClientForm.tsx` — create + edit, controlled by `view.kind === 'home'` modal state OR inline within `ClientDetail`. Calls `EventContext.saveClient(...)`.
- `ClientDetail.tsx` — mounted when `view.kind === 'client-detail'`. Renders AppBar + client info + EventList + "אירוע חדש" CTA. Subscribes to `listEventsByClient(clientId)`.

**Why `HomeScreen` lives here, not in `shell/`:** it's the Client list view — its primary content is Client domain data. Reviewers should look here first when asking "where's the home page?".

#### `components/event/`

**Domain boundary:** Event aggregate root.

Files (Phase 3B):
- `EventTabs.tsx` — the shell that hosts the 6 tab panels (פרטי אירוע, מפות ומפיות, עיצובי שולחן, חופה, שדרוגים, סיכום). 3B ships only the shell + tab strip; the panel implementations are Phase 3C.

The 6 tab panels (`EventDetailsTab.tsx`, `NapkinsTab.tsx`, `TableDesignsTab.tsx`, `ChuppahTab.tsx`, `UpgradesTab.tsx`, `SummaryTab.tsx`) are Phase 3C. **Do NOT spec them here.**

#### `components/gallery/` — Phase 3C

Folder created (empty placeholder file allowed) so SOP 05's component-tree diagram has a home. Phase 3C ships:
- `ImageGallery.tsx` (top-level controlled component)
- `GalleryHeader.tsx`
- `GalleryFilter.tsx`
- `GalleryGrid.tsx`
- `ImageCard.tsx`
- `Lightbox.tsx`

Out of scope for Phase 3B.

#### `components/signature/` — Phase 3C

Phase 3C ships:
- `SignaturePad.tsx` (per SOP 06 § Component Surface)

Out of scope for Phase 3B.

#### `components/tagging/`

**Domain boundary:** the SOP 12 one-time gate. Self-contained — does not import from `client/` or `event/`.

Files:
- `TaggingPass.tsx` — full-screen component. Receives `onComplete: () => void` from the shell (which dispatches `GO_HOME`). Owns its own internal state (current cursor, in-progress card form values). Calls `lib/db.ts` `putImageTag` / `completeTaggingPass` / `countImageTags` directly (allowed — TaggingPass is a Layer 2 view, db.ts is Layer 3).

#### `contexts/`

Files:
- `ThemeContext.tsx` — provider + `useTheme()` hook. Exposes `{ theme: 'light' | 'dark', setTheme: (next) => void, prefersReducedMotion: boolean }`. Mounts at the top of `<App />` per SOP 13 §7.
- `EventContext.tsx` — provider + `useEvent()` hook. Exposes the `EventContextValue` from SOP 13 §5. Mounts conditionally (not for `view.kind === 'tagging'` or `boot`). Also re-exports a `useToast()` hook so domain components can fire user-visible errors.

## 3. Public exports vs private internals

Each subfolder has a single `index.ts` re-export barrel. Components consumed across subfolders go through the barrel; internal helpers do not.

### `components/ui/index.ts`

```typescript
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Input } from './Input';
export type { InputProps } from './Input';
export { TextArea } from './TextArea';
export type { TextAreaProps } from './TextArea';
export { Card } from './Card';
export type { CardProps } from './Card';
export { CurtainThemeToggle } from './curtain-theme-toggle';
export type { ThemeToggleProps } from './curtain-theme-toggle';
```

### `components/shell/index.ts`

```typescript
export { AppBar } from './AppBar';
export { BootSplash } from './BootSplash';
export { TopLevelBoundary, PerViewBoundary } from './ErrorBoundary';
export { FatalBanner } from './FatalBanner';
export { SettingsScreen } from './SettingsScreen';
export { Toaster } from './Toaster';
```

### `components/client/index.ts`

```typescript
export { HomeScreen } from './HomeScreen';
export { ClientList } from './ClientList';
export { ClientCard } from './ClientCard';
export { ClientForm } from './ClientForm';
export type { ClientFormProps } from './ClientForm';
export { ClientDetail } from './ClientDetail';
```

(`event/`, `gallery/`, `signature/`, `tagging/` follow the same pattern.)

### Imports between subfolders

- `components/client/ClientForm.tsx` imports `Button`, `Input` via `from '../ui'` (the barrel).
- `components/client/HomeScreen.tsx` imports `AppBar` via `from '../shell'`.
- `components/event/EventTabs.tsx` imports `AppBar` via `from '../shell'`.

Direct cross-folder imports that bypass the barrel (e.g. `from '../shell/AppBar'`) are forbidden — reviewer rejects on sight. The barrel is the public surface.

### What's "private"

A file is private if no other subfolder imports it via the barrel. Helper utilities (`useFormState.ts`, `validateClientInput.ts`) live alongside the component that uses them and are NOT re-exported. If a second component in a different subfolder needs them, they get promoted to a top-level `app/src/hooks/` or `app/src/utils/` directory in a follow-up — not silently re-exported from the original barrel.

## 4. Naming convention

### Files

- **Components:** `PascalCase.tsx` (e.g. `ClientList.tsx`, `EventTabs.tsx`).
- **Contexts:** `PascalCase.tsx` ending in `Context` (e.g. `EventContext.tsx`).
- **Hooks:** `useCamelCase.ts` (e.g. `useFormState.ts`).
- **Plain helpers:** `camelCase.ts` (e.g. `validateClientInput.ts`).
- **Type-only files:** `*.types.ts` (e.g. `event-tabs.types.ts`) — only when types are shared across multiple files in the same subfolder.
- **Index barrels:** `index.ts` — re-exports only, no logic.

### Exports

- **Named exports always.** Default exports forbidden. (Easier rename refactors, easier `tsc` enforcement.)
- **One component per file.** Tiny inline subcomponents are allowed if they're only used in the same file (e.g. a `<RowLabel>` inside `ClientForm.tsx`); they are NOT exported.
- **Type exports** colocated: `export { X }` and `export type { XProps }` live in the same file as the component.

### Hebrew strings

UI strings stay Hebrew, inline in JSX. Per Behavioral Rule #3 + SOP 10, the Hebrew vocabulary is the user-facing law:

```tsx
<button>שמור</button>                       // ✅ Hebrew, inline
<Button label="שמור" />                     // ✅ Hebrew prop value
<Button label={t('save')} />                // ❌ no i18n layer in MVP
```

There is no `t()` function, no JSON translation file, no `useTranslation()` hook. The app is Hebrew-only by design. If a future v1.x adds English support, this SOP gets a Self-Annealing entry and the i18n layer slots in then.

### Component prop names

- Event handlers: `onSave`, `onCancel`, `onClick`, `onToggle` — never `handleSave` (that's the consumer's name for its handler).
- Boolean props: `isOpen`, `isPrimary`, `isLoading` — prefixed.
- Render-prop / children-as-function: `children: (state) => ReactNode` — used sparingly.

## 5. Layer 2 imports rule (CRITICAL)

The 3-layer architecture (Constitution Architectural Invariant #1) lives or dies by this rule:

> **Components NEVER import `@tauri-apps/*` or `idb` directly. They go through Layer 3 (`app/src/lib/`) only.**

### Allowed imports for Layer 2 (components + contexts)

| Source | Allowed? | Why |
|---|---|---|
| `'react'`, `'react-dom'` | Yes | Framework |
| `'framer-motion'` | Yes | Animation per SOP 09 |
| `'lucide-react'` | Yes | Icons per SOP 09 §8 |
| `'react-signature-canvas'` | Yes (only in `components/signature/`) | Per SOP 06 |
| `'../lib/db'`, `'../lib/images'`, `'../lib/docx'`, `'../lib/backup'`, `'../lib/paths'`, `'../lib/config'`, `'../lib/tauri-fs'` | Yes | Layer 3 — the canonical dependency direction |
| `'../types'` | Yes | Schema types |
| `'../contexts/*'` | Yes | Sibling context |
| `'../components/*'` | Yes (via barrels) | Sibling component |
| `'@tauri-apps/api/*'`, `'@tauri-apps/plugin-fs'`, `'@tauri-apps/plugin-dialog'` | **NO** | Layer 3-only |
| `'idb'`, `'uuid'`, `'docx'`, `'react-signature-canvas'` outside its folder | **NO** | Layer 3-only |

### Why

- **Testability:** `lib/` is testable with `fake-indexeddb` + injected providers (already proven in #15). Components are testable with `@testing-library/react` against mocked context values. Mixing the two layers makes either test approach harder.
- **Capability scoping (SOP 08):** Only `lib/tauri-fs.ts` knows about Tauri's plugin permissions. If components import `@tauri-apps/*` directly, the security audit can't trust the capability JSON as the single chokepoint.
- **Migration insurance:** if Tauri 3 changes its API surface, the change footprint is `lib/tauri-fs.ts` only. Components stay untouched.

### Reviewer enforcement

A trivial Grep at code review time:

```
rg -l "@tauri-apps" app/src/components/ app/src/contexts/   # must return ZERO results
rg -l "from 'idb'" app/src/components/ app/src/contexts/    # must return ZERO results
```

Any match is an automatic block. The lib layer is the only place where these strings legitimately appear (currently `tauri-fs.ts:10-22` and `db.ts:24-28`).

## 6. Test-ID convention

The tester's canonical-flow plan needs deterministic selectors. Every interactive surface gets a `data-testid` attribute. The naming rule:

| Element type | `data-testid` format | Example |
|---|---|---|
| List of records | `<entity>-list` | `data-testid="client-list"` |
| Single card in a list | `<entity>-card-<id>` | `data-testid="client-card-abc123"` |
| Form | `<entity>-form` | `data-testid="client-form"` |
| Form field | `<entity>-field-<key>` | `data-testid="client-field-coupleNames"` |
| Tab in event tabs | `event-tab-<key>` | `data-testid="event-tab-napkins"` |
| Tab panel content | `event-panel-<key>` | `data-testid="event-panel-napkins"` |
| Button (primary action) | `<verb>-<entity>-button` | `data-testid="save-client-button"` |
| Counter / indicator | `<context>-counter` | `data-testid="selection-counter"` |
| Modal | `<entity>-modal` | `data-testid="confirm-discard-modal"` |
| Toggle | `<context>-toggle` | `data-testid="theme-toggle"` |

### Locked test-IDs (canonical flow uses these — components MUST emit them)

These match the tester's existing canonical-flow plan. Adding or renaming requires a Self-Annealing entry to this SOP first:

- `data-testid="client-list"` — `<ClientList />` root
- `data-testid="new-client-button"` — "לקוח חדש" CTA on HomeScreen
- `data-testid="client-form"` — `<ClientForm />` root
- `data-testid="client-field-coupleNames"` — שמות בני הזוג input
- `data-testid="client-field-phone"` — נייד input
- `data-testid="save-client-button"` — שמור in ClientForm
- `data-testid="new-event-button"` — "אירוע חדש" CTA on ClientDetail
- `data-testid="event-tab-details"` — פרטי אירוע tab (3C)
- `data-testid="event-tab-napkins"` — מפות ומפיות tab (3C)
- `data-testid="event-tab-tableDesigns"` — עיצובי שולחן tab (3C)
- `data-testid="event-tab-chuppah"` — חופה tab (3C)
- `data-testid="event-tab-upgrades"` — שדרוגים tab (3C)
- `data-testid="event-tab-summary"` — סיכום tab (3C)
- `data-testid="selection-counter"` — "3/5" indicator on the gallery (3C)
- `data-testid="theme-toggle"` — `<ThemeToggle />` (the user-supplied component receives this via the `testId` prop)
- `data-testid="signature-pad"` — `<SignaturePad />` (3C)
- `data-testid="export-docx-button"` — "ייצוא Word" (3C)
- `data-testid="settings-button"` — Settings entry on AppBar
- `data-testid="export-backup-button"` — ייצוא גיבוי
- `data-testid="import-backup-button"` — ייבוא גיבוי
- `data-testid="reset-data-button"` — אפס נתונים מקומיים
- `data-testid="tagging-pass"` — `<TaggingPass />` root (SOP 12)
- `data-testid="tagging-counter"` — "47 / 884" counter inside TaggingPass
- `data-testid="tagging-save-next"` — "שמור והבא"
- `data-testid="tagging-finish"` — "סיים תיוג"

## 7. Phase boundary (3B vs 3C)

This SOP scopes Phase 3B's component output. Concretely 3B ships:

| Folder | Phase 3B ships | Phase 3C adds |
|---|---|---|
| `ui/` | All 5 primitives (`Button`, `Input`, `TextArea`, `Card`, `curtain-theme-toggle`) | (none — the surface is locked) |
| `shell/` | `AppBar`, `BootSplash`, `ErrorBoundary`, `FatalBanner`, `SettingsScreen`, `Toaster` | (none) |
| `client/` | All 5 (`HomeScreen`, `ClientList`, `ClientCard`, `ClientForm`, `ClientDetail`) | (none) |
| `event/` | `EventTabs.tsx` (tab strip shell only — empty panels) | All 6 tab panels |
| `gallery/` | folder placeholder | All gallery components per SOP 05 |
| `signature/` | folder placeholder | `SignaturePad.tsx` per SOP 06 |
| `tagging/` | `TaggingPass.tsx` (full implementation per SOP 12 §4) | (none — pass is one-shot) |
| `contexts/` | `ThemeContext.tsx`, `EventContext.tsx` | (additional context as 3C tabs require) |

The line is: **Phase 3B ships every surface needed to navigate the app's structure, plus the TaggingPass.** Phase 3C fills in the editing-tabs implementations and the gallery/signature features.

## 8. Cross-references

- **claude.md § Architectural Invariants #1** — the 3-layer rule is the law this SOP enforces
- **SOP 09** — every visual element traces back to a token here
- **SOP 13** — what `<App />` mounts; AppView state machine
- **SOP 14** — `<ThemeToggle />` API; lives in `components/ui/`
- **SOP 12** — `<TaggingPass />` lives in `components/tagging/`
- **SOP 05** — `<ImageGallery />` and friends live in `components/gallery/` (3C)
- **SOP 06** — `<SignaturePad />` lives in `components/signature/` (3C)
- **SOP 10** — Hebrew vocabulary used in JSX strings is the law

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. Defines `components/{ui,shell,client,event,gallery,signature,tagging}` + `contexts/` layout, naming convention, public-vs-private barrel rule, the Layer 2 imports rule (no `@tauri-apps/*` / no `idb` direct imports outside `lib/`), and the canonical test-ID list aligned with the tester's flow plan. | Initial spec |
| 2026-05-20 | All 7 component subfolders (`ui/`, `shell/`, `client/`, `tagging/`, `gallery/`, `signature/`, `settings/`, `event/`) shipped during Phase 3B. Layer 2 imports rule held throughout — `@tauri-apps/*` and `idb` appear ONLY in `app/src/lib/`. UI primitives (Button / Input / TextArea / Card / Ornament) use only `react` + `framer-motion`. | Phase 3B close; reviewer enforced via `rg`. |
| 2026-05-20 | Test-ID convention extended in practice with subdomain prefixes that were not in the initial table: `signature-pad-{canvas,image,clear,edit,confirm,cancel,date}`, `gallery-card-${i}`, `gallery-search`, `gallery-confirm`, `gallery-cancel`, `kind-tab-{image,video}`, `category-chip-${name}`, `gallery-loading|empty`, `tagging-{pass,counter,save-next,finish,notes,custom-input,custom-labels}`, `tagging-category-<cat>`, `event-tab-{details,napkins,tableDesigns,chuppah,upgrades,summary}`, `event-panel-{key}`, `event-field-date`, `event-field-startTime`, `napkin-color-{value}`, `chuppah-type-{value}`, `upgrades-item-{idx}`, `save-and-continue-button`, `export-docx-{button,success,error}`, `selection-counter`, `settings-{export,import,import-input,reset,theme-dark,theme-light,backups-dir,copy-path,toast}`. The tester's canonical-flow plan should be reconciled against this final list before Phase 4 closes. | Phase 3B parallel-agent swarm; logged in the per-component progress entries. |
| 2026-05-20 | `_stubs.tsx` pattern landed in `components/event/` because Gallery + SignaturePad were authored in a parallel agent. The stubs render placeholder modals + emit a deterministic 1×1 PNG so `signEvent → status='signed' → DOCX export` stays exercise-able during 3B. | Phase 4 cleanup task: delete `app/src/components/event/_stubs.tsx` and redirect imports in `TableDesignsTab.tsx` + `ChuppahTab.tsx` to the real `components/gallery/` + `components/signature/` barrels. Tracked in `task_plan.md`. |
| 2026-05-20 | `Settings.tsx` ships with inline button primitives (`PrimaryButton`, `DangerButton`, `TertiaryButton`, `ThemeChip`) because UI primitives + Settings landed in the same parallel swarm. Behavior + test-IDs stay identical; they use the locked Tailwind tokens so the light-mode flip works without changes. | Phase 4 cleanup: swap to `<Button variant="primary">` from `components/ui/Button`. Logged in `task_plan.md` Phase 4 § Carry-over polish. |
| 2026-05-21 | UI-component test files do not yet exist (`ClientForm.test.tsx`, `EventTabs.test.tsx`, `TaggingPass.test.tsx`). Phase 3B explicitly defers component tests to the canonical-flow E2E plan + targeted component tests in Phase 4 / v1.1. | Tracked in `task_plan.md` Phase 4 § Tests still missing. |
| 2026-05-21 | `EventDetailsTab.tsx` rebuilt (Agent A, Phase 4 polish). Stripped all inline lucide icons from inputs (Calendar/Clock looked broken against the v4 tokens). Date is now a dual-control: native `<input type="date">` for the OS calendar **plus** a free-typed `dd/MM/yyyy` Hebrew shadow that round-trips to the same canonical ISO; `dayOfWeek` is now an overridable `<select>` of the seven Hebrew weekdays (snaps to derive(date) on date change, then editable) — INV-03 relaxed accordingly: a `dayOfWeek`-only patch is preserved by both `EventContext` and `db.updateEvent` (which only auto-derives when `date` itself is in the patch). Guest-count uses the `Input` primitive flanked by `−` / `+` stepper buttons, clamped 10–1000 in steps of 10; native ↑/↓ still work. Start-time stays native `<input type="time">`. New test-IDs: `event-field-date-text`, `event-field-guestCount-row`, `event-field-guestCount-{inc,dec}`. | Logged here; INV-03 row in SOP 11 should be re-stated by the next domain-invariants pass to read "auto-snapped default, manually overridable in UI; persistence is preserved on a `dayOfWeek`-only patch." |
