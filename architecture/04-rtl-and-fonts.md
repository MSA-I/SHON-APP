# SOP 04 — RTL Hebrew & Fonts

> **Self-Annealing notes from Phase 2 L3 POC.** Update before changing related code.

## Stack Decisions (verified)

- **PDF generation**: `pdf-lib` v1.17 + `@pdf-lib/fontkit` v1.1
- **Hebrew font**: Frank Ruhl Libre (variable, OFL license, ~178KB). Source: `https://github.com/google/fonts/raw/main/ofl/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf`
- **Font subset**: `embedFont(bytes, { subset: true })` to keep PDFs small
- **Fallback (Latin/digits)**: `StandardFonts.Helvetica` (built-in, no embed)

## Hebrew RTL Rendering Pattern

`pdf-lib` is bidi-unaware: it draws glyphs strictly left-to-right at increasing x. To render Hebrew correctly we use a manual bidi reverser:

```js
function reverseBidi(str) {
  const reversed = Array.from(str).reverse().join('');
  // Re-reverse contiguous LTR runs (digits, Latin, punctuation between them)
  return reversed.replace(/[0-9A-Za-z.\-:/+@()_]+/g, (m) =>
    Array.from(m).reverse().join('')
  );
}
```

To anchor RTL text at a right edge:

```js
function drawRTL(page, text, { rightX, y, font, size, color }) {
  const reversed = reverseBidi(text);
  const width = font.widthOfTextAtSize(reversed, size);
  page.drawText(reversed, { x: rightX - width, y, font, size, color });
}
```

## Gotchas (failures encountered, never repeat)

### 1. `WinAnsi cannot encode "❖"` — symbols outside Latin-1
**Symptom:** `Error: WinAnsi cannot encode "❖" (0x2756)` thrown by `StandardFontEmbedder`.
**Cause:** Helvetica's WinAnsi encoding doesn't include U+2756.
**Fix:** Don't draw decorative Unicode symbols with standard fonts. Either:
- (a) Draw the shape as a primitive (rotated rect = diamond), OR
- (b) Use the embedded Hebrew font (Frank Ruhl Libre supports many symbols), OR
- (c) Embed the SVG logo as a rasterized PNG.
**Chosen for app:** option (a) for inline decorations, option (c) for the corporate logo.

### 2. Naive reversal breaks numbers
**Symptom:** `14.06.2026` rendered as `6202.60.41`.
**Cause:** Reversing the entire string also reverses digit runs.
**Fix:** Two-pass reverse — reverse everything, then re-reverse contiguous LTR runs (digits, Latin letters, common punctuation). See `reverseBidi` above.

### 3. Bidi punctuation neutrality (WONTFIX for now)
A colon directly attached to a Hebrew label (`תאריך:`) renders with the colon on the RTL-leading side after reversal. Native Hebrew typography places the colon at the *visual* end of the label, which is on the LEFT. After `reverseBidi`, this happens to be correct because the colon stays in its codepoint position. **Do not** add special bidi handling for colons unless we observe bugs.

### 4. Date inside RTL paragraph gets digit-pair-flipped — known limitation
**Symptom:** `תאריך חתימה: 20.05.2026` rendered as `... 02.50.2026` while the same date in a separate field rendered correctly as `14.06.2026`.
**Cause:** When the entire string is reversed first, then the regex re-reverses the LTR run, the *position* of the LTR run inside the line is now the mirror position from where it started. For a date that originally sat at the *end* of a Hebrew sentence (rightmost in source order), it ends up at the *start* of the reversed string — and the second-pass re-reversal flips the digit groups again because they're contiguous through the periods.

**Fix planned for `app/src/lib/pdf.ts`:** instead of regex-based two-pass bidi, segment the source string into runs FIRST (RTL run / LTR run / RTL run …) and reverse only RTL runs in place, then reverse the *order* of the runs. Pseudocode:

```js
function bidiSegment(str) {
  // Split into [{kind:'rtl'|'ltr', text}, …] runs by character class
  // Reverse each rtl run's chars; keep ltr runs intact
  // Reverse the run array
  // Concat
}
```

For the L3/L4 POCs we accept the current limitation — most PDF lines do not mix RTL+LTR in arbitrary positions. The full bidi segmenter is a Phase-3 task tracked in `task_plan.md`.

## Fonts to Embed in App

| Font | Use | Source |
|---|---|---|
| Frank Ruhl Libre (variable) | Hebrew headings + body | `https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@300..900` |
| Heebo (variable) | Hebrew UI body / forms | `https://fonts.googleapis.com/css2?family=Heebo:wght@100..900` |
| Helvetica (Standard) | Digits/Latin in PDF | Built into `pdf-lib` |

App bundles fonts in `public/fonts/`. The PDF tool uses **only Frank Ruhl Libre** for both Hebrew and digits to keep one consistent appearance — Helvetica is the runtime fallback if Frank Ruhl ever fails to load.

## App-Side RTL CSS Rules

- `<html dir="rtl" lang="he">` at the root
- Tailwind: use logical properties (`ms-`, `me-`, `ps-`, `pe-`) instead of `ml-`, `mr-`, etc.
- Form inputs: `dir="rtl"` explicit
- Numeric inputs (phone, date, guest count): `dir="ltr"` so digits behave naturally inside otherwise-RTL forms

## Self-Annealing Notes

The four gotchas above (`§ Gotchas` 1–4) are themselves the original self-annealing log from the L3 POC; the table below tracks lessons learned **after** the POC closed.

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Decision recorded: app-side rendering switched to DOCX (`docx` v8). Word/LibreOffice handles RTL bidi natively, so the manual `reverseBidi` segmenter is no longer load-bearing for production output. The PDF path is "Save as PDF" from Word. | L3v2 POC at `.tmp/poc-l3v2-docx/` proved DOCX is cleaner; pdf-lib path retired. |
| 2026-05-20 | App-side RTL CSS rules locked: every component uses logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `inset-inline-*`) — no `ml-*`/`mr-*`/`pl-*`/`pr-*` anywhere. Numeric runs (phone, date, time, guest count, file paths in Settings) flip to `dir="ltr"` + `font-tabular`. | Reviewer enforcement during Phase 3B; AppBar / Settings / Gallery / SignaturePad / EventTabs all comply. |
| 2026-05-21 | Phase 4 RTL visual checklist (`.tmp/rtl-visual-test-plan.md`, 13 sections) is the canonical pre-ship visual gate. | Refinement-pass entry point; executed via `npm run dev`. |
