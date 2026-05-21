# SOP 05 — Gallery & Image Selection

> Authoritative spec for how Shon and the couple browse the 4.4 GB image library, filter it, and pick images that get embedded in the planning DOCX. Update *before* code changes.

## Purpose

The gallery is the centerpiece of the meeting experience. The couple sees photos at premium quality, filters by category and free text, and picks designs that flow back into the `Event` record (`tableDesignSelections`, `chuppah.designSelections`). Filenames stay in Hebrew; selection is non-destructive (no file copies).

## Source Data

`ImageMetadata[]` produced by SOP 01's scanner. The gallery is **a pure consumer** of that array — it never re-reads the disk on its own. Thumbnails come from the `thumbnails` IndexedDB store (SOP 02).

## Data Flow

```
[Disk]  ──SOP 01 scanCategory──▶  ImageMetadata[]  ──React Context──▶  ImageGallery
                                                                          │
                                  thumbnails store  ──SOP 02 getThumbnail──▶ ImageCard
                                                                          │
                                                         user clicks ─────▶ ImageSelection
                                                                          │
                                                           SOP 02 updateEvent ◀──┘
```

Selection state is owned by `EventContext` (Layer 2). The gallery components are presentational + selection-aware but **never** call `db.ts` directly — they emit `onToggleSelection(image)` callbacks that the context handler resolves into `updateEvent`.

## Component Tree

```
ImageGallery                         (controlled component, top-level)
├── GalleryHeader                    (title, count, clear-selection button)
├── GalleryFilter                    (category chips, search box, video tab toggle)
├── GalleryGrid
│   └── ImageCard × N                (lazy-rendered via IntersectionObserver)
│       ├── thumbnail <img> or video icon
│       ├── selection ring + ✓ badge
│       ├── notes pill (when selection has notes)
│       └── on-click → opens Lightbox
└── Lightbox                         (portal, full-screen, single image at a time)
    ├── full-res <img src={tauriFileSrc(path)}>
    ├── prev / next navigation
    ├── notes textarea (free-text per selection)
    └── select / deselect button
```

## API Surface (`app/src/components/gallery/`)

```typescript
export type GalleryMode =
  | { kind: 'tableDesigns'; max: 5 }     // EventDetailsTab → TableDesignsTab
  | { kind: 'chuppah'; max: 999 };       // ChuppahTab — no hard cap, but Shon usually picks 1-3

export type GalleryProps = {
  mode: GalleryMode;
  images: ImageMetadata[];               // already-scanned, full library
  selections: ImageSelection[];          // current event's selections for this slot
  onToggleSelection: (img: ImageMetadata) => void;
  onUpdateNotes: (path: string, notes: string) => void;
  initialCategory?: ImageCategory;       // default landing category
};

export function ImageGallery(props: GalleryProps): JSX.Element;
```

`onToggleSelection` is a single callback. The component does not enforce `max` itself — it asks the context. The context returns `false` (silently rejected) or `true` (added). The card highlights based on the resulting `selections` prop on next render.

## Filtering Rules

`GalleryFilter` exposes:
1. **Category chips** — **8 fixed categories** from `claude.md` § ImageCategory: the 7 image-folder categories plus the synthetic `כיסא כלה` (which surfaces the 2 loose root JPGs). The active category is single-select. There is also a virtual `הכל` (all) chip that shows the union. The `כיסא כלה` chip is rendered with the same affordance as the others — users do not need to know it's synthetic.
2. **Media tabs** — `תמונות` (images) | `וידאו` (videos). Hard split per `claude.md` rendering rule. Default is `תמונות`. The `וידאו` tab is hidden for categories with zero videos.
3. **Search box** — case-insensitive substring match against `ImageMetadata.name` (Hebrew NFC-normalized on both sides). Empty string = no filter.
4. **Selected-only toggle** — shows only items already in `selections`. Useful at meeting end.

Filters compose via AND. The filter state lives in `GalleryFilter` local state and is reset when the gallery unmounts (i.e., when navigating between tabs). Selections persist because they live in `EventContext`.

## Selection Semantics

Each gallery instance is **scoped to a single slot** in the event:
- `tableDesigns` slot: `event.tableDesignSelections[]` (max 5)
- `chuppah` slot: `event.chuppah.designSelections[]` (no hard cap)

Other galleries (e.g., a future "napkin photos" gallery) follow the same pattern by adding a new `mode.kind`.

When the user toggles an image:
1. The component calls `onToggleSelection(img)`.
2. The context resolves: if already selected → remove; else → add (after `max` check).
3. New selection: `{ imagePath, category, imageName, notes: '', selectedAt: Date.now() }`.
4. The context calls `db.ts updateEvent(eventId, { tableDesignSelections: next })`.
5. React re-renders gallery; the card now shows the ✓ ring.

When the user opens the Lightbox and edits the notes textarea:
1. Debounced 300ms `onUpdateNotes(path, notes)`.
2. Context updates the matching `ImageSelection.notes` and persists.

## Performance Architecture

The library has 874 images. Naively rendering 874 cards locks the browser. The gallery uses three tactics in concert:

### 1. Virtualization
- Use `react-window` or a hand-rolled `IntersectionObserver` grid.
- Render only cards within ~2 viewport heights of the scrollport.
- Card size is fixed (240×160 + padding) so virtualization math is trivial.

### 2. Thumbnail-only in grid
- `<img src={blobUrl}>` where `blobUrl = URL.createObjectURL(thumbnailRecord.blob)`.
- Full-res only loads on Lightbox open via `convertFileSrc(absolutePath)` (Tauri).
- Revoke object URLs on card unmount to avoid leaks.

### 3. Pre-warmed thumbnail cache
- At app boot (after SOP 01 scan completes), the app pre-fetches all `thumbnails` in the active category. ~26 cards × 25KB = ~650KB — instantaneous on a local DB.
- Switching category triggers another batch fetch. Cancellable via `AbortController`.

Empirical target: **scrolling at 60fps** through `מפות מפיות` (520 images). Verified in Phase 3 step 16 (Performance baseline).

## Hebrew Path Display

- Card label: `ImageMetadata.name` (filename without extension), rendered RTL.
- Lightbox header: `category / name`, both Hebrew, RTL.
- Tooltip / aria-label: `name`. Screen readers should announce the Hebrew filename verbatim.
- File paths are never shown in the UI — only the human-readable `name`.

## Empty States

| Situation | Display |
|---|---|
| Library not scanned yet | Skeleton grid + "סורק את ספריית התמונות…" |
| Active category has 0 items after filters | "אין התאמות לחיפוש" + clear-filter button |
| `וידאו` tab in a category with 0 videos | Tab is hidden entirely; `תמונות` is the only tab |
| `selections` is empty when entering Summary | Empty cell + "טרם נבחרו עיצובים" |

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Thumbnail blob missing in IndexedDB | `getThumbnail` returns undefined | Show generic placeholder; trigger one-shot regenerate via SOP 01 |
| Source image deleted between scan and Lightbox open | `<img>` `onerror` | Show "התמונה לא נמצאה" message in Lightbox; offer to remove from selections |
| Hebrew filename URL-encoding error | thumbnail load 404 | Re-encode segments with `encodeURIComponent` per segment; retry once |
| User picks a 6th `tableDesign` (over `max`) | Context returns `false` | Subtle toast: "ניתן לבחור עד 5 עיצובים"; no card flash |
| Lightbox opens during scan stream | Image not yet in `images[]` | Disable card click until scan reports its category as complete |

## Accessibility

- All cards have `role="button"`, keyboard-focusable, Enter/Space toggles selection.
- `aria-pressed={isSelected}` on each card.
- Lightbox is a `role="dialog" aria-modal="true"` with focus trap.
- Esc closes Lightbox. Arrow keys navigate prev/next.
- All labels and aria-text are Hebrew strings (the user is a Hebrew speaker).

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft locks slot scoping (`tableDesigns` vs `chuppah`) and confirms thumbnails-in-grid + full-res-in-lightbox split | Initial spec |
| 2026-05-20 | Gallery shipped with no `<Toast>` primitive; cap-exceed (6th selection on `tableDesigns`) is silently no-op'd at the gallery layer. The reducer's INV-01 still throws `ניתן לבחור עד 5 עיצובים` so EventContext consumers see the canonical error. | Documented in the gallery progress entry; Toast primitive is a Phase-4 follow-up. |
| 2026-05-20 | Selection-counter test-id locked as `selection-counter` (used by both Gallery top bar and `TableDesignsTab` counter pill). | SOP 15 §6 canonical test-ID list. |
| 2026-05-21 | Lazy thumbnails: each `<Tile>` calls `images.getOrBakeThumbnail(image)` in `useEffect`, wraps the resulting `Blob` with `URL.createObjectURL`, and revokes on unmount/dependency-change. Videos render the `וידאו` placeholder; bake errors render an `×` placeholder. | Phase 3B implementation; matches SOP 05 § Performance Architecture #2. |
| 2026-05-21 | `bakeThumbnailsBatch` background-on-first-run is queued for Phase 4 so the TaggingPass + first-meeting gallery feel hot. | Refinement-pass entry; tracked in `task_plan.md` Phase 4. |

## Verification (planned)

The gallery has no standalone POC; it is integration-tested via Phase 3 step 15 (smoke test) and step 27 (visual smoke test). Local acceptance gates:
- Open `מפות מפיות` (520 images), scroll top→bottom in < 1s with no jank
- Filter `שולחן זהב` returns matching items in < 100ms
- Select 5 items in `tableDesigns`, attempt 6th → rejected with toast
- Open Lightbox, add Hebrew notes, close, reopen → notes persist via IndexedDB

End-to-end acceptance is gated by the **canonical 13-step flow** in `claude.md § Verification`. This SOP underwrites step 4's "עיצובי שולחן" sub-step (open gallery → select 3 from `אולם עיצוב בסיס 2026` with Hebrew notes, counter shows 3/5) and step 4's "חופה" sub-step (select 1 image from `חופות ריזורט`). The Performance Gate 12 (gallery first-paint ≤ 1s + 60fps scroll on `מפות מפיות`) is owned here.
