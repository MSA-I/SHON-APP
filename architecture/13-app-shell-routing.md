# SOP 13 — App Shell & Routing

> Authoritative spec for how the React app boots, decides what to render, and orchestrates top-level navigation between the Tagging Pass, Home, Client detail, Event tabs, and Settings. Update *before* code changes. Companion to:
>
> - `claude.md § Behavioral Rules #11` (TaggingPass gate) and `#12` (theme persistence)
> - SOP 02 § Object Stores (`meta` store + `MetaKey` write-rules)
> - SOP 12 § 6 Routing rule (the gate's contract with the shell)
> - SOP 14 (theme system — applied at boot here)
> - SOP 15 (component layout — what `<App />` mounts)

## 1. Purpose

Lock the boot sequence and the top-level state machine that drives every screen Shon ever sees. Without a single owned shell, three failure modes appear:

1. **Flicker.** A naive `useEffect(() => openDb(), [])` paints the home screen for ~80 ms before the gate decision lands → Shon glimpses an empty client list, then is yanked into the Tagging Pass. Behavioral Rule #11 reads "before the home screen renders" — flicker violates the spirit of that rule.
2. **Theme flash.** The `<html>` element renders in dark mode, hydrates, then flips to light because `meta.theme === 'light'` was read async. Cream surfaces flash black for ~120 ms.
3. **Routing drift.** Each tab/component invents its own back-button logic, three different "are you sure you want to discard?" prompts appear, and the shell's `unsavedChanges` knowledge fragments.

This SOP collapses all three into one boot funnel and one state machine.

## 2. Stack

- **No router library.** This is a single-window desktop app with a fixed surface (TaggingPass → Home → Client detail → Event tabs → Settings). `react-router` is overkill and adds a `history` API the Tauri WebView2 doesn't need.
- **State machine:** a single `AppView` discriminated union held in `App.tsx` via `useReducer`. Transitions are explicit verbs (`goHome`, `openClient`, `openEvent`, `openSettings`, `goBack`) — no string-based path concatenation anywhere.
- **Top-level contexts:** `ThemeContext` (always mounted, wraps everything) and `EventContext` (mounted only for views that need event/client editing — `home`, `client-detail`, `event-tabs`).
- **Animation:** Framer Motion `<AnimatePresence mode="wait">` for view transitions; `useReducedMotion` hook drives a global feature flag.
- **Imports:** the shell imports ONLY from `lib/`, `contexts/`, `components/`, and `framer-motion`. **Never** from `@tauri-apps/*` directly (Layer 2 rule, SOP 15 §5) or from `idb` directly.

## 3. Boot sequence

The sequence is **strictly serial** — the shell does not paint anything except the boot splash until step 4 resolves.

```
main.tsx
   └── ReactDOM.createRoot(...).render(<App />)
            │
            ▼
       <App />        ← initial state: { view: 'boot', theme: undefined }
            │
            │ useEffect on mount (runs ONCE, never re-runs):
            │
            ├─① openDb()                         (lib/db.ts)
            │       └── triggers v1→v2 migration if needed (SOP 02 § Migration Policy)
            │
            ├─② getMeta<'light'|'dark'>('theme')   ← read first
            │       └── apply to <html> BEFORE branch decision (no flash, see SOP 14 §6)
            │
            ├─③ getMeta<boolean>('taggingComplete')
            │
            └─④ branch:
                    if taggingComplete === true   →  dispatch({ type: 'GO_HOME' })
                    else (false | undefined)      →  dispatch({ type: 'GO_TAGGING' })
```

### Boot loading state

While steps 1–3 run (~50–120 ms on Shon's machine), the shell renders `<BootSplash />`:

- Full-bleed `bg-ink`.
- Cream SB monogram (logo-light.svg) centered.
- A single ❖ glyph (gold, `text-h2`) below the monogram, rotating slowly (one revolution / 2.4 s, linear). Reduced-motion swaps the rotation for a static glyph at 0.6 opacity.
- No copy. No spinner. No "loading…" text.
- Stays on screen for at least **80 ms** even if step 4 resolves faster — this prevents a sub-frame flash on cold boot. Implemented as a `Promise.all([initBoot(), wait(80)])`.

If any of steps 1–3 throws, the splash is replaced by `<FatalBanner />` (see § 6 Error boundaries).

### What MUST NOT happen during boot

- No render of `<HomeScreen />`, `<ClientForm />`, or `<TaggingPass />` before step 4. The reducer's initial `view: 'boot'` enforces this.
- No call to `lib/images.ts` `scanAll()`. The image scan is a side-effect of `view === 'home'` first mounting, NOT of boot. (Rationale: if the gate sends Shon to `<TaggingPass />`, scan still happens — it's a TaggingPass dependency, not a Home dependency. The order is: gate decides → branch component mounts → branch component triggers its own scan via EventContext.)
- No call to `backup.ts` anything.
- No subscription to `window` resize / focus / online events.

## 4. AppView state machine

A discriminated union held in `App.tsx`:

```typescript
type AppView =
  | { kind: 'boot' }
  | { kind: 'tagging' }
  | { kind: 'home' }
  | { kind: 'client-detail'; clientId: string }
  | { kind: 'event-tabs'; clientId: string; eventId: string; tab: EventTabId }
  | { kind: 'settings' };

type EventTabId =
  | 'details' | 'napkins' | 'tableDesigns' | 'chuppah' | 'upgrades' | 'summary';
```

### Allowed transitions

| From                | Verb                       | To                   | Notes                                                                      |
|---------------------|----------------------------|----------------------|----------------------------------------------------------------------------|
| `boot`              | `GO_TAGGING`               | `tagging`            | Gate decided `taggingComplete !== true`                                    |
| `boot`              | `GO_HOME`                  | `home`               | Gate decided `taggingComplete === true`                                    |
| `tagging`           | `GO_HOME`                  | `home`               | **One-way.** SOP 12 `completeTaggingPass()` resolved + flag flipped        |
| `home`              | `OPEN_CLIENT(clientId)`    | `client-detail`      | Card click on `<ClientList />`                                             |
| `home`              | `OPEN_SETTINGS`            | `settings`           | AppBar Settings icon                                                       |
| `client-detail`     | `OPEN_EVENT(eventId, tab)` | `event-tabs`         | Default `tab = 'details'`                                                  |
| `client-detail`     | `GO_BACK`                  | `home`               | AppBar back arrow                                                          |
| `event-tabs`        | `SET_TAB(tab)`             | `event-tabs`         | Tab switching inside the event editor — same kind, different `tab` field  |
| `event-tabs`        | `GO_BACK`                  | `client-detail`      | Guarded by `unsavedChanges` confirm (see § 5)                              |
| `settings`          | `GO_BACK`                  | `home`               |                                                                            |
| any non-`tagging`   | `OPEN_TAGGING`             | (rejected)           | **Forbidden.** TaggingPass is unreachable post-completion (Behavioral #11) |

The reducer **rejects** any unknown verb via `LibError({ code: 'SHELL_INVALID_TRANSITION' })`. Reducer is pure; logging is the boundary's job.

### Why `kind`, not string paths

Strings invite typos (`/clients/abc123/event`), parameters get lost (`?tab=napkins` forgotten on a re-render), and `useLocation` becomes a sync surface across the tree. The discriminated union puts every transition through `tsc` at compile time — adding a new view requires editing the union AND every `switch (view.kind)` site, both of which TypeScript surfaces immediately.

### Persistence

`AppView` is **NOT** persisted. On every boot the shell starts at `boot` → branches to `tagging` or `home` based on `taggingComplete`. Deep-linking (e.g. "open this event next time") is out of MVP scope.

## 5. EventContext (top-level, scoped)

`EventContext` wraps the three views that touch domain data: `home`, `client-detail`, `event-tabs`. It is **not** mounted under `tagging` (the pass owns its own state per SOP 12) or `settings` (read-only meta operations only).

### Provided values

```typescript
type EventContextValue = {
  // Currently-open client + event (drives the AppBar title + back-button targets)
  currentClient: Client | null;
  currentEvent: Event | null;

  // Dirty-state tracking — drives the GO_BACK confirm-dialog
  unsavedChanges: boolean;

  // SOP 10 § 12 dispatch verbs (already locked)
  // (these route to lib/db.ts under the hood)
  saveClient: (input: ClientInput) => Promise<Client>;
  deleteClient: (id: string) => Promise<void>;
  saveEvent: (input: EventInput) => Promise<Event>;
  deleteEvent: (id: string) => Promise<void>;
  setStatus: (eventId: string, next: EventStatus) => Promise<void>;
  setSignature: (eventId: string, sig: Signature) => Promise<void>;

  // Selection helpers (consumed by ChuppahTab + TableDesignsTab via SOP 05 contracts)
  toggleSelection: (slot: 'tableDesigns' | 'chuppah', img: ImageMetadata) => void;
  updateNotes: (slot: 'tableDesigns' | 'chuppah', path: string, notes: string) => void;
};
```

### Rules

- `currentClient` and `currentEvent` are derived from `AppView` — when `view.kind === 'event-tabs'`, the context resolves them via `db.getClient(view.clientId)` + `db.getEvent(view.eventId)` and caches on the value object. When `view` changes, the context re-resolves.
- `unsavedChanges` is set to `true` by tab forms on first edit; reset to `false` after a successful save or on navigation away with a "discard" confirm.
- Errors from `saveClient` / `saveEvent` propagate as toast notifications via a separate `<Toaster />` portal (SOP 15 §3 — `components/shell/`).
- `EventContext` does not own image scanning. The `ImageMetadata[]` cache is a separate `ImageContext` introduced in Phase 3C (out of scope for this SOP).

### When `currentClient` / `currentEvent` is `null`

- `view.kind === 'home'` — both null. The home screen lists all clients via `listClients()`.
- `view.kind === 'client-detail'` — `currentClient` resolved, `currentEvent` null.
- `view.kind === 'event-tabs'` — both resolved.
- `view.kind === 'settings'` — both null (no scope).

## 6. Theme state (top-level)

Per SOP 14, the shell owns theme as top-level state. Two concerns the shell handles (the rest is in SOP 14):

1. **Read at boot, before first paint** (step 2 of § 3). The boot effect:
   ```typescript
   const stored = await getMeta<'light' | 'dark'>('theme');
   const theme = stored ?? 'dark';   // default = dark (Luxury Editorial)
   document.documentElement.dataset.theme = theme;
   document.documentElement.classList.toggle('dark', theme === 'dark');
   ```
   Both `data-theme="..."` AND the `dark` class must be applied **synchronously** in the same microtask, BEFORE the reducer dispatches `GO_HOME` / `GO_TAGGING`. SOP 09 tokens key off `[data-theme="light"]` / `[data-theme="dark"]` in `tokens.css`; Tailwind v4's `darkMode: 'class'` keys off the `.dark` class. Both must agree.

2. **Persist on toggle.** When the user clicks `<ThemeToggle />` (mounted in AppBar), the click handler:
   ```typescript
   const next = current === 'dark' ? 'light' : 'dark';
   document.documentElement.dataset.theme = next;
   document.documentElement.classList.toggle('dark', next === 'dark');
   await setMeta('theme', next);     // single-writer rule (SOP 14 §1)
   ```
   The DOM mutation is sync (no await), so the curtain animation in the toggle component runs against the new tokens immediately. The `setMeta` write is fire-and-forget from the user's perspective — failure is logged but the theme stays applied (next boot would revert).

## 7. Error boundaries

Two layers, in this exact nesting:

```
<TopLevelBoundary>
  <ThemeContext.Provider>
    <EventContext.Provider>             {/* mounted only for non-tagging non-settings views */}
      <PerViewBoundary>
        <CurrentView />                  {/* TaggingPass | HomeScreen | ClientDetail | EventTabs | Settings */}
      </PerViewBoundary>
    </EventContext.Provider>
  </ThemeContext.Provider>
</TopLevelBoundary>
```

### `<TopLevelBoundary>`

Catches errors from boot effects (failed `openDb`, missing project root, capability denial). Renders `<FatalBanner />`:

- Cream SB monogram, then the user-facing message in Hebrew: `"שגיאה קריטית — נסה לפתוח שוב את האפליקציה."`
- Below: a small `<details>` block (collapsed by default) with the full `LibError.code` + `error.message` + `error.stack`. So Shon can copy-paste to the developer if needed.
- A single primary button: `"נסה שוב"` — calls `window.location.reload()`. (We don't try to recover in-process; a fresh boot is more reliable than partial state.)
- No theme toggle, no AppBar — this is the dead-end screen.

The fatal banner is the canonical "SOP 08 § Failure Modes" surface — every lib-layer panic flows here.

### `<PerViewBoundary>`

Catches errors from a single view's render path (e.g. a corrupt event record blowing up `EventTabs`). Renders a small retry card:

- ❖ ornament (gold).
- Hebrew copy: `"משהו השתבש בטעינת המסך."` + the `LibError.code` if available.
- Button: `"חזור למסך הבית"` — dispatches `GO_HOME`.

The per-view boundary does NOT remount the EventContext provider. It assumes the context is healthy and only the view's own render is broken. If the context itself errored, the top-level boundary catches first.

## 8. Reduced-motion

The shell exposes `prefersReducedMotion` via `useReducedMotion()` (Framer Motion's hook) and passes it down through `ThemeContext`. Components query `useTheme()` and receive `{ theme, prefersReducedMotion }` together — they should never call `useReducedMotion()` themselves.

When `prefersReducedMotion === true`:
- Boot splash glyph stops rotating (SOP 13 §3).
- View-transition slide+fade swaps to instant (SOP 09 § Animation `--motion-page` collapses to 0 ms).
- Curtain animation in `<ThemeToggle />` swaps to instant theme swap (SOP 14 §4).
- Gallery card hover scale disables (SOP 09 §5 Signature interactions — already specified, the shell honors it).

The flag is reactive — if Shon toggles "reduce motion" in Windows during a session, the next render picks up the new value (`useReducedMotion` is event-driven internally).

## 9. RTL anchor

Already established in `app/index.html`:

```html
<html lang="he" dir="rtl" data-theme="dark">
```

The shell does not re-set `dir` or `lang` at runtime. The boot effect mutates `data-theme` only.

If Shon's Windows display language is non-Hebrew, this still applies — the app is Hebrew-only by design (Behavioral Rule #3). No locale switcher.

## 10. App.tsx evolution (current → 3B target)

The current `App.tsx` is the smoke surface from #9 — it exercises every Luxury Editorial token at a glance but has no routing or state. Phase 3B replaces it with the shell described above.

### Before (current, post-#9)

```tsx
// Smoke surface — exercises tokens. No db, no router, no state.
export default function App() {
  return (<main className="min-h-screen bg-ink text-cream">…</main>);
}
```

### After (Phase 3B target)

```tsx
import { useEffect, useReducer } from 'react';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { openDb, getMeta, setMeta } from './lib/db';
import { ThemeProvider } from './contexts/ThemeContext';
import { EventProvider } from './contexts/EventContext';
import { TopLevelBoundary, PerViewBoundary } from './components/shell/ErrorBoundary';
import { BootSplash } from './components/shell/BootSplash';
import { TaggingPass } from './components/tagging/TaggingPass';
import { HomeScreen } from './components/client/HomeScreen';
import { ClientDetail } from './components/client/ClientDetail';
import { EventTabs } from './components/event/EventTabs';
import { SettingsScreen } from './components/shell/SettingsScreen';

type AppView = /* see § 4 */;
type Action = { type: 'GO_HOME' } | { type: 'GO_TAGGING' } | … ;

function reducer(state: AppView, action: Action): AppView { /* exhaustive switch */ }

export default function App() {
  const [view, dispatch] = useReducer(reducer, { kind: 'boot' });
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await openDb();
      const stored = await getMeta<'light' | 'dark'>('theme');
      const theme = stored ?? 'dark';
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');

      const taggingComplete = await getMeta<boolean>('taggingComplete');
      // Honor the 80ms minimum splash so the cold-boot doesn't sub-frame-flash.
      await wait(80);
      if (cancelled) return;
      dispatch({ type: taggingComplete === true ? 'GO_HOME' : 'GO_TAGGING' });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <TopLevelBoundary>
      <ThemeProvider initial="dark" prefersReducedMotion={prefersReducedMotion}>
        {view.kind === 'boot' && <BootSplash />}
        {view.kind === 'tagging' && (
          <PerViewBoundary onReset={() => dispatch({ type: 'GO_HOME' })}>
            <TaggingPass onComplete={() => dispatch({ type: 'GO_HOME' })} />
          </PerViewBoundary>
        )}
        {view.kind !== 'boot' && view.kind !== 'tagging' && (
          <EventProvider view={view} dispatch={dispatch}>
            <PerViewBoundary onReset={() => dispatch({ type: 'GO_HOME' })}>
              <AnimatePresence mode="wait">
                {view.kind === 'home' && <HomeScreen key="home" dispatch={dispatch} />}
                {view.kind === 'client-detail' && <ClientDetail key={`c-${view.clientId}`} {...view} dispatch={dispatch} />}
                {view.kind === 'event-tabs' && <EventTabs key={`e-${view.eventId}`} {...view} dispatch={dispatch} />}
                {view.kind === 'settings' && <SettingsScreen key="settings" dispatch={dispatch} />}
              </AnimatePresence>
            </PerViewBoundary>
          </EventProvider>
        )}
      </ThemeProvider>
    </TopLevelBoundary>
  );
}
```

The frontend-designer + backend-coder split this skeleton across multiple PRs in 3B. This SOP locks the shape; component-level details belong to SOP 15.

## 11. Performance budget

| Phase | Budget | Mechanism |
|---|---|---|
| Cold boot → BootSplash visible | ≤ 50 ms | Tauri WebView2 paints `<html>` from `index.html` immediately; React hydrates and paints `BootSplash` on first frame |
| BootSplash → first interactive view | ≤ 200 ms | openDb (~30ms) + 2× getMeta (~5ms each) + 80ms minimum splash + 1 React render |
| AppView transition (e.g. home → client-detail) | ≤ 100 ms wall-clock | `AnimatePresence mode="wait"` + 320ms slide+fade (motion overlap is intentional, not a budget violation) |
| Theme toggle | ≤ 16 ms (1 frame) for visual swap | DOM mutation sync; setMeta async in background |

The "Cold-start ≤ 3 s" canonical verification gate (claude.md § Verification step 11) is the union of all above + the home screen's first paint of the client list.

## 12. Failure modes

| Mode | Cause | Recovery |
|---|---|---|
| `openDb()` rejects | Quota exhausted, IDB blocked | TopLevelBoundary → FatalBanner. User clicks "נסה שוב" → reload |
| `getMeta('taggingComplete')` rejects | Corrupt meta row | Treat as `false` (cautious default — sends user through pass) + `console.error`. Pass on resume re-derives from existing imageTags |
| `getMeta('theme')` rejects | Corrupt meta row | Default to `'dark'`. Do not `setMeta('theme', 'dark')` — keep the user's intent unchanged |
| TaggingPass throws mid-pass | Bug in card render | PerViewBoundary catches, retry card, "חזור למסך הבית" forbidden (TaggingPass is the only view → button instead reloads) |
| EventContext save throws | Lib-layer LibError | Toast notification, user stays on view, `unsavedChanges` remains true |
| AppView hits unknown verb | Programming error | Reducer throws `LibError(SHELL_INVALID_TRANSITION)` → TopLevelBoundary |

## 13. Cross-references

- **SOP 02** — `MetaKey` write-rules: `'theme'` joins `taggingComplete` etc. (backend-coder follow-up)
- **SOP 09** — design tokens applied via `[data-theme]`; reduced-motion rules
- **SOP 12** — TaggingPass gate, completion contract that flips `meta.taggingComplete` and dispatches `GO_HOME` upstream
- **SOP 14** — theme system, the curtain toggle component, light-mode token block
- **SOP 15** — component layout, what files mount where

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. Defines the boot funnel, AppView state machine, EventContext scope, theme bootstrapping, error boundaries, reduced-motion plumbing, and `App.tsx` evolution path for Phase 3B. | Initial spec |
| 2026-05-20 | Phase 3B `App.tsx` integration shipped per § 10 evolution sketch. Five views wired (`boot` / `tagging` / `home` / `client-detail` / `event-tabs` / `settings`) with `ThemeProvider` + `EventProvider` + `ErrorBoundary` at root. Boot reads `meta.taggingComplete` and routes to TaggingPass or Home. AppBar with theme toggle. Floating nav. ClientDetail wires `loadClient → EventTabs`. | 121/121 tests still green; vite build clean (782 KB JS gz 232 KB). |
| 2026-05-20 | Pre-mount theme apply (read `meta.theme` BEFORE first paint) confirmed as the cure for FOWT (~30 ms flash). `ThemeProvider` only handles post-mount changes; the boot effect is the pre-mount sync apply. The two are complementary. | SOP 14 alignment; landed with `ThemeContext.tsx`. |
| 2026-05-20 | `EventContext` scope confirmed: provider mounted at app root (cheaper than mount/unmount per view, simpler React tree). The `unsavedChanges` flag is the canonical input for the `GO_BACK` confirm-dialog. `unsavedChanges` resets on `loadClient` and on successful `saveEvent`. | Phase 3B implementation; differs from initial sketch which scoped the provider per-view. |
| 2026-05-21 | Phase 4 task: split the 782 KB JS bundle along the AppView lazy-load boundaries via `manualChunks` in `vite.config.ts`. Settings + EventTabs are obvious lazy candidates (not boot-critical). | Tracked in `task_plan.md` Phase 4 § Carry-over polish. |
