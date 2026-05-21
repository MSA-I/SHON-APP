# SOP 06 — Signature Flow

> Authoritative spec for how the couple signs the planning sheet digitally, how the signature embeds in the DOCX, and how the act of signing transitions the event from `draft` → `signed` (which auto-snapshots a backup). Update *before* code changes.

## Purpose

A handwritten-style signature on a tablet/laptop trackpad replaces the paper signature line in the original Word template. The signature is captured once per event, persists with the event record, and is rendered into the exported DOCX as an `ImageRun`. **No legal claim** is made about non-repudiation — this is a planning sheet, not a binding contract; legality is governed by the venue's separate paper contract referenced in the legal terms block.

## Stack

- **Capture:** `react-signature-canvas` v1.x
- **Encoding:** PNG via `canvas.toDataURL('image/png')`
- **Storage:** in-record on the `Event` (not a separate store) — `event.signature = { dataUrl, signedAt }`
- **Export:** PNG bytes decoded from `dataUrl` → `new ImageRun({ data, transformation })` in the DOCX (SOP 03)

## Schema (from `claude.md`)

```typescript
event.signature: {
  dataUrl: string;     // 'data:image/png;base64,...'
  signedAt: number;    // epoch ms, captured at the moment of confirmation
} | null;
```

The `dataUrl` is opaque to most layers. Only the DOCX builder decodes it.

## Component Surface (`app/src/components/SignaturePad.tsx`)

```typescript
export type SignaturePadProps = {
  initialDataUrl?: string;            // present if editing an existing signature
  onConfirm: (dataUrl: string) => void;
  onCancel?: () => void;
  width?: number;                     // default 600
  height?: number;                    // default 200
};

export function SignaturePad(props: SignaturePadProps): JSX.Element;
```

The component is **uncontrolled** during drawing — the user draws freely, and only on Confirm does `onConfirm` fire with the final PNG data URL. Cancel discards strokes.

## Capture Pipeline

1. User reaches the Summary tab; the SignaturePad renders inline (no modal — the canvas is part of the page).
2. The user draws on the 600×200 canvas with a stylus, mouse, or trackpad.
3. The pad shows a "נקה" (clear) button, an "אשר חתימה" (confirm) primary button, and a "בטל" (cancel) text button.
4. On Confirm:
   a. Read PNG via `signaturePadRef.toDataURL('image/png')` (already trimmed to bounding box if `signaturePadRef.getTrimmedCanvas()` is used).
   b. The Summary tab's handler:
      - Computes `signedAt = Date.now()`
      - Calls `db.updateEvent(eventId, { signature: { dataUrl, signedAt }, status: 'signed' })`
      - **Auto-snapshots a backup** (SOP 07 backup trigger #1)
      - Optionally renders the DOCX immediately if the user clicked "חתום וייצא"
5. The pad re-renders read-only, showing the captured signature with a small "שנה חתימה" button beside it.

## Status Transition

`Event.status` flow:

```
draft  ── (user signs)         ──▶  signed
signed ── (user opens for edit)──▶  draft       (signature is preserved but status reverts)
signed ── (Shon marks finished)──▶  completed   (after the meeting; manual)
```

**Rule:** the *only* way to set `status = 'signed'` is via the signature handler. There is no UI to flip status manually to `signed`. This guarantees `status === 'signed' ⇒ event.signature !== null`.

If the user re-opens an event after signing and edits any field, the status reverts to `draft` and a non-blocking warning appears: "החתימה נשמרה אך הסטטוס שונה ל'טיוטה'. יש לחתום שוב לפני ייצוא סופי." The signature image is preserved in the record (so the user doesn't lose their work) but the event must be re-confirmed.

## DOCX Embedding

```typescript
// In app/src/lib/docx.ts buildEventDocx
if (input.signature) {
  const pngBytes = decodeDataUrl(input.signature.dataUrl); // Uint8Array
  doc.addParagraph(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [
      new ImageRun({
        data: pngBytes,
        transformation: { width: 200, height: 60 },  // points
      }),
    ],
  }));
  doc.addParagraph(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({
        text: `תאריך חתימה: ${formatHebrewDate(input.signature.signedAt)}`,
        rightToLeft: true,
        font: 'Frank Ruhl Libre',
        size: 20,
        color: '0F0E0C',
      }),
    ],
  }));
}
```

If `event.signature === null`, the DOCX falls back to a paper-style signature line (`חתימת הזוג: ____________________`) — useful for printing a blank planning sheet.

POC L4 (`.tmp/poc-l4-signature/`) verified end-to-end: synthesized PNG → embed in PDF at 200×60pt. The DOCX path uses the same `ImageRun` shape.

## Storage Considerations

- A typical signature canvas (600×200, mostly transparent) is **5-15 KB** as PNG.
- It lives inside `event.signature.dataUrl` as a base64 string (~ +33% size). Acceptable.
- The same data url is **also written as `signature.png` to disk** when the DOCX is exported, so the user has a standalone PNG (see `claude.md` File Layout). This is a one-shot side-effect of export, not a sync.

## Hebrew Date Formatting

```typescript
function formatHebrewDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}
```

We deliberately use `dd.mm.yyyy` (the format used in the original DOCX), not `Intl.DateTimeFormat('he-IL')`, because Hebrew locale formatting on Windows produces inconsistent strings.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| User tries to confirm an empty canvas | `signaturePadRef.isEmpty()` is true | Confirm button is disabled until first stroke |
| `toDataURL` throws (canvas tainted, OOM) | thrown | Show toast "לא ניתן ללכוד את החתימה — נסה שוב"; do not advance status |
| `updateEvent` rejects after capture | promise rejection | Revert UI to unsigned state; show error; signature is NOT lost (kept in component state until success) |
| Auto-backup fails after sign succeeds | SOP 07 throws | Sign succeeds anyway; failure surfaced via the app log channel (`console.warn` + the in-memory `LibError` ring buffer) and visible in Settings panel as "גיבוי אחרון נכשל". The lib does not write to `progress.md`. |
| User signs then status edited mid-meeting | `updateEvent` patch includes any non-signature field while status === 'signed' | Status auto-reverts to `draft`; warning toast displayed |
| PNG bytes corrupt on DOCX export | `decodeDataUrl` throws | Skip embedded signature; render paper-style fallback line; emit warning to UI |

## Accessibility

- The pad is keyboard-inaccessible by definition (drawing requires a pointer). Provide a clear escape: a focusable "דלג על חתימה" link sets `signature = null` and keeps `status = 'draft'`. The user can still export the DOCX with a paper signature line.
- The captured signature image carries `alt="חתימת הזוג"` in the post-confirm read-only view.
- A `aria-live="polite"` region announces "חתימה נשמרה" on confirm.

## Privacy

- Signatures are personally identifying. They live only in IndexedDB and on the local disk under `events/<id>/signature.png`. They are included in JSON backups (SOP 07).
- **Never** transmit signatures off-machine. There is no telemetry path.
- Deletion of a `Client` cascades to its events and removes the signatures along with them.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | POC L4 confirmed PNG embedding in pdf-lib; same `ImageRun` shape works in `docx` v8 | Initial spec |
| 2026-05-20 | Locked the rule: `status='signed'` is reachable only via signature confirm, guaranteeing the invariant `signed ⇒ signature !== null` | Initial spec |
| 2026-05-20 | Lib-boundary fix: auto-backup failure must surface via app log channel, not via lib writes to `progress.md` (mirrors SOP 02 fix) | Updated Failure Modes row |
| 2026-05-20 | `SignaturePad` shipped with the call signature `onConfirm(dataUrl, signedAt)` — a deliberate **superset** of the SOP's `onConfirm(dataUrl)`. The `signedAt` second arg is stamped at confirm time and consumed atomically by `EventContext.signEvent` so `event.signature = { dataUrl, signedAt }` + status flip happen in one IndexedDB write. INV-02 (`signed ⇒ signature !== null`) preserved. | Phase 3B implementation; flagged in the SignaturePad progress entry. |
| 2026-05-20 | React 19 dropped the global `JSX` namespace; `react-signature-canvas` v1.0.5 typed `canvasProps` as `React.CanvasHTMLAttributes<HTMLCanvasElement>` which (in this TS version) rejects `data-*` literal keys. | Documented escape hatch: a single targeted `as CanvasHTMLAttributes<...>` cast on the `canvasProps` literal. |
| 2026-05-20 | `EventContext.signEvent(dataUrl)` is the SINGLE caller that flips `status: 'draft' → 'signed'` and triggers `backup.exportBackup('signed')`. UI must never call `db.updateEvent({status:'signed'})` directly — the backup snapshot would be skipped. | Reviewer rule; landed with `EventContext.tsx`. |
| 2026-05-21 | Phase 3B SummaryTab integrates `<SignaturePad>` with `EventContext.signEvent`; the export button is `disabled` until status flips to `'signed'`. The 13-step canonical-flow E2E test (`.tmp/canonical-flow-plan.md`) is the planned acceptance. | Refinement entry; `signature-pad` test-IDs locked (`-canvas`, `-image`, `-clear`, `-edit`, `-confirm`, `-cancel`, `-date`). |
| 2026-05-21 | User: "באזור של חתימת בני הזוג אם אני משנה ממצב כהה או למצב בהיר אז החתימה צריכה להיות נראית לעין". The legacy PNG signature was baked with a single fixed ink color (cream on dark) and disappeared when the theme flipped. | `Signature` schema is now a discriminated union of `kind: 'png'` (legacy, read-only) and `kind: 'vector'` (new captures). Vector strokes are stored verbatim from `react-signature-canvas.toData()` (`SignatureStroke[]`) and re-rendered via inline SVG with `stroke="currentColor"` so the ink follows `meta.theme`. No migration write — old data stays old per claude.md "don't touch old data" rule; `lib/signature.ts.normalizeSignature` adapts legacy `{dataUrl, signedAt}` → `{kind:'png', …}` on every read. New test-ID `-svg` complements the existing `-image`. |
| 2026-05-21 | User: "כפתור יישום וחתימה … לא עובד". Root cause: `EventContext.signEvent` early-returned with an in-memory `set-error` dispatch when `currentEvent.id === ''` (a fresh draft never persisted via `saveEvent`). The user saw the button do nothing because the error was never surfaced. | `signEvent` now creates the event row first (with `status:'draft', signature:null` to satisfy INV-02) when the id is empty, then attaches the signature in a second `db.updateEvent` tx. Errors are re-thrown so the UI can surface them via the global `<ToastProvider>`. SummaryTab calls `useToast().toast({...})` on both success and failure paths. |
| 2026-05-21 | DOCX rasterization split into `lib/signature.rasterizeStrokes()`. `kind:'png'` signatures embed verbatim; `kind:'vector'` rasterize to **black ink on white** via an offscreen `<canvas>` regardless of `meta.theme` — the explicit codification of Behavioral Rule #13 ("DOCX output is ALWAYS light-theme") at the rasterization seam. `docx.ts.materializeSignaturePng()` is the single chokepoint; it ignores the active UI theme. | Domain invariant added by reference: any future signature kind MUST decide its own black-on-white rasterization path here. |

## Verification (planned)

Phase 3 step 25 (SignaturePad component) + step 35 (SummaryTab integration). Local acceptance gates:
- Empty canvas → Confirm disabled
- Stroke + Confirm → status flips to `signed`, backup snapshot appears in `backups/`
- Edit any field after signing → status reverts to `draft`, warning shown, signature preserved
- Export DOCX → opens in Word with the signature image at 200×60pt above a Hebrew date line

End-to-end acceptance is gated by the **canonical 13-step flow** in `claude.md § Verification`. This SOP underwrites step 4's "סיכום" sub-step (review summary → sign on canvas → click "ייצוא Word"), step 6's signature embedding check ("Signature image rendered above signature line"), and step 7's auto-backup trigger ("File `backup_<timestamp>.json` was auto-created on signature").
