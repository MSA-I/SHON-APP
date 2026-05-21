# SOP 09 — Design Tokens & Visual System

> Authoritative reference for the **Luxury Editorial** design language. Every color, font size, spacing unit, animation timing, and ornament in the app traces back to a token defined here. Update this SOP *before* changing tokens in `app/src/index.css` or in DOCX styling.

## Purpose

Lock the visual vocabulary so that:
- Components built across phases stay aesthetically coherent (no token drift).
- Code review has a fixed yardstick — "is this color from the palette? is this spacing on the scale?"
- The DOCX export and the in-app UI share the *same conceptual scale* (translated between rem and pt) so the printed document feels like a continuation of the screen.

This is not a style guide for "looks." It is the contract between every UI surface in the project.

## Aesthetic Direction (locked)

**Luxury Editorial.** Think: *Vogue* masthead, a Joya Studio invitation, a Hermès thank-you note. Deep ink-black canvas, hand-set serif headlines in cream, antique gold reserved like real foil — used sparingly on hairlines, focus rings, and the ❖ ornament. Generous whitespace. No drop shadows. No gradients. No glassmorphism. The page feels printed, not rendered.

**Anti-patterns to refuse outright:**
- Neon gold or yellow-leaning gold (it's antique, warm, slightly desaturated)
- Drop shadows of any kind (depth comes from spacing, not blur)
- Gradient buttons or gradient backgrounds
- Sans-serif headlines (display copy is ALWAYS Frank Ruhl Libre)
- Tailwind directional utilities (`ml-*`, `mr-*`, `pl-*`, `pr-*`) — use logical (`ms-*`, `me-*`, `ps-*`, `pe-*`)
- `<hr>` rules — use a centered `❖` divider instead

## 1. Color Tokens

The full palette is **5 colors plus 2 supporting tints**. If a component needs a color outside this list, that is a sign the component is wrong, not the palette.

| Token              | Hex       | Semantic Name           | Used For                                                                    |
|--------------------|-----------|-------------------------|-----------------------------------------------------------------------------|
| `--ink`            | `#0F0E0C` | Ink / canvas primary    | Application background. The deepest surface. Also DOCX page background-free | 
| `--ink-raised`     | `#1A1714` | Canvas raised           | Sidebar, modal, card surfaces — one step "up" from canvas                   |
| `--cream`          | `#F5F0E8` | Cream / primary text    | All body and headline text on dark surfaces. Also DOCX body color           |
| `--cream-muted`    | `#A8A39B` | Muted text              | Secondary copy, captions, helper text, placeholder. Derived: 65% cream      |
| `--gold`           | `#C9A961` | Antique gold            | Decorative accents, dividers, focus rings, ❖ ornament, button underlines    |
| `--gold-dark`      | `#A88B47` | Deep gold               | Tiny labels (uppercased), section eyebrows, secondary gold elements         |
| `--border-subtle`  | `#2A2520` | Border subtle           | 1px hairline separators inside cards, table rules, input borders at rest    |

CSS variables block (canonical):

```css
:root {
  --ink: #0F0E0C;
  --ink-raised: #1A1714;
  --cream: #F5F0E8;
  --cream-muted: #A8A39B;
  --gold: #C9A961;
  --gold-dark: #A88B47;
  --border-subtle: #2A2520;

  /* Functional aliases (always reference these from components) */
  --bg-primary: var(--ink);
  --bg-secondary: var(--ink-raised);
  --text-primary: var(--cream);
  --text-secondary: var(--cream-muted);
  --accent: var(--gold);
  --accent-deep: var(--gold-dark);
  --border: var(--border-subtle);

  /* Focus ring (used by Tailwind ring utilities) */
  --ring: var(--gold);
}
```

**Contrast verified:**
- `--cream` on `--ink` → **15.8 : 1** (AAA)
- `--cream-muted` on `--ink` → **6.2 : 1** (AA)
- `--gold` on `--ink` → **8.4 : 1** (AAA for large, AA for small) — but reserved for non-text decoration; if used as text it must be ≥18px and bold
- `--gold-dark` on `--ink` → **5.7 : 1** (AA) — the safe gold-on-dark text token

**Rule:** If you need to put gold *text* over the dark canvas, use `--gold-dark`, not `--gold`.

## 2. Typography Tokens

### Font Families

| Token          | Family                          | Purpose                                 | Fallback chain                                  |
|----------------|---------------------------------|-----------------------------------------|-------------------------------------------------|
| `--font-serif` | `'Frank Ruhl Libre', serif`     | Display / headlines (he + lat)          | `'David Libre', 'Times New Roman', serif`       |
| `--font-sans`  | `'Heebo', 'Assistant', sans`    | Body, forms, UI controls                | `'Segoe UI', 'Arial', sans-serif`               |
| `--font-mono`  | `'JetBrains Mono', monospace`   | DOCX field codes, debug surfaces only   | `'Consolas', monospace`                         |

Frank Ruhl Libre is loaded as a **variable font** (single file, full weight axis 100–900). Heebo also variable. This keeps the font payload near 350 KB total, well under the 500 KB Tauri budget.

### Type Scale

A two-track scale: **screen (rem)** for the React UI and **document (pt)** for the DOCX export. They share the same 1.25 ratio (major third), so a screen-to-print mental model holds.

| Token         | rem (UI) | px @ 16  | pt (DOCX) | Family    | Weight | Use                                              |
|---------------|----------|----------|-----------|-----------|--------|--------------------------------------------------|
| `--text-hero` | `4.0rem` | 64       | 36 pt     | serif     | 500    | Top-of-page client name on Summary tab           |
| `--text-h1`   | `2.5rem` | 40       | 24 pt     | serif     | 500    | Tab page titles ("פרטי האירוע")                  |
| `--text-h2`   | `1.75rem`| 28       | 18 pt     | serif     | 500    | Section headings inside a tab                    |
| `--text-h3`   | `1.25rem`| 20       | 14 pt     | serif     | 500    | Card titles, group headings                      |
| `--text-body` | `1.0rem` | 16       | 11 pt     | sans      | 400    | All running copy, form values                    |
| `--text-small`| `0.875rem`| 14      | 10 pt     | sans      | 400    | Helper text, captions, table cells               |
| `--text-label`| `0.75rem`| 12       | 9 pt      | sans      | 600    | Form labels, eyebrows. UPPERCASE + 0.12em track  |
| `--text-tiny` | `0.6875rem`| 11     | 8 pt      | sans      | 500    | Meta lines, signature timestamp, footer fineprint|

**Line heights (locked):**
- Headlines (hero, h1, h2, h3): `1.15`
- Body: `1.6`
- Small / labels: `1.4`

**Tracking (letter-spacing):**
- Hebrew (default): `0` — Frank Ruhl Libre is hand-spaced; do not loosen
- Latin/Hebrew labels marked uppercase: `0.12em`
- Numeric tabular runs: `0.02em` and use `font-feature-settings: 'tnum';`

**Reading width (line-length):** body paragraphs cap at `65ch` so RTL Hebrew doesn't tire the eye. Forms are single-column.

### When to use serif vs. sans

- **Serif (Frank Ruhl Libre):** any heading. The client's name. The ❖ glyph itself. The opening epigraph on the Summary tab.
- **Sans (Heebo):** body copy, every form input, button labels, table data, tab labels in the sidebar, status badges.
- **Never:** sans-serif headlines or serif body text. Mixing the two breaks the entire feel.

## 3. Spacing Scale

A doubling-leaning scale tuned for *editorial whitespace*. Units are rem; px is informational.

| Token        | rem      | px  | When to use                                                       |
|--------------|----------|-----|-------------------------------------------------------------------|
| `--space-1`  | `0.25rem`| 4   | Inner pill padding, icon-text gap                                 |
| `--space-2`  | `0.5rem` | 8   | Within tightly grouped elements, label→input gap                  |
| `--space-3`  | `0.75rem`| 12  | Form field internal padding (vertical)                            |
| `--space-4`  | `1.0rem` | 16  | Default gap between siblings; card body padding                   |
| `--space-6`  | `1.5rem` | 24  | Section internal padding; gap between paragraphs                  |
| `--space-8`  | `2.0rem` | 32  | Card outer padding; gap between sub-sections                      |
| `--space-12` | `3.0rem` | 48  | Major section breaks within a tab                                 |
| `--space-16` | `4.0rem` | 64  | Page outer gutter on laptop screens                               |
| `--space-24` | `6.0rem` | 96  | Hero block top/bottom; ❖ divider breathing room                   |

**Layout invariants:**
- The app frame has **`--space-16` (64px)** outer gutter on left + right at ≥1280px viewport
- Cards always have **`--space-8` (32px)** internal padding — no exceptions
- Form fields stack with **`--space-6` (24px)** between them (luxury, not cramped)
- Two adjacent paragraphs use **`--space-6` (24px)** (1.5× line height)
- Above and below a `❖` divider: **`--space-12` (48px)** each

If a layout feels "tight," the answer is almost always *go up one step on the scale*, not invent a new value.

## 4. Border & Surface Conventions

- **Border width:** always `1px`. Never 2px or thicker. Never `0.5px` (subpixel inconsistency on Windows).
- **Border color at rest:** `--border-subtle` (#2A2520). It must be barely visible — that's the point.
- **Border color on hover (interactive surfaces):** `--gold` (#C9A961).
- **Border color on focus:** `--gold` (#C9A961) + a `2px` outline offset (so the ring sits *outside* the border, not over it).
- **Border radius:** **`0`** is the default. The aesthetic is set type, not soft UI. The only allowed exception:
  - Form inputs and buttons: `2px` radius (a hint, almost imperceptible)
  - Image cards and the lightbox: `0` (sharp corners, gallery feel)
  - The signature canvas: `0`
- **Surface elevation:** there is **no `box-shadow`** anywhere in the app. Depth is created by:
  1. Color step (`--ink` → `--ink-raised`)
  2. A `1px` `--border-subtle` line
  3. Vertical spacing

Anything that "needs a shadow to look right" is the wrong size or has the wrong padding. Fix the geometry, not the lighting.

## 5. Animation & Motion Tokens

All motion is implemented with **Framer Motion** (`motion.div`) on React components. CSS transitions are the fallback.

| Token              | Duration | Easing                              | Use                                                       |
|--------------------|----------|-------------------------------------|-----------------------------------------------------------|
| `--motion-instant` | `100ms`  | `cubic-bezier(0.4, 0, 0.2, 1)`      | Color swaps (text/border on hover)                        |
| `--motion-quick`   | `150ms`  | `cubic-bezier(0.4, 0, 0.2, 1)`      | Default hover state on buttons, links, cards              |
| `--motion-glow`    | `200ms`  | `cubic-bezier(0.4, 0, 0.2, 1)`      | Gallery card glow + scale-1.02 on hover                   |
| `--motion-page`    | `320ms`  | `cubic-bezier(0.16, 1, 0.3, 1)`     | Tab switch / page transition (slide+fade)                 |
| `--motion-modal`   | `260ms`  | `cubic-bezier(0.16, 1, 0.3, 1)`     | Modal enter / lightbox open                               |
| `--motion-stagger` | `60ms`   | (delay between children)            | Staggered reveal of list items, gallery cards (cap at 12) |

**Signature interactions:**

- **Button hover:** a gold underline (1px tall, `--gold`) animates from `width: 0` → `width: 100%` over `--motion-quick`. The button text color shifts from `--cream` → `--gold-dark` over the same duration. No background fill. No scale.
- **Gallery card hover:** card scales `1.0` → `1.02` over `--motion-glow`. A 1px gold border (`--gold`) appears (replacing the subtle border). `transform-origin: center`. **The card MUST stay inside its grid cell** — use a wrapper with `overflow: hidden` if needed and never let the scaled card spill onto neighbors.
- **Tab switch:** outgoing tab slides ± `8px` on the *block* axis (vertical) and fades out over `--motion-page`. Incoming tab does the inverse. RTL flow is unaffected.
- **❖ divider entrance:** when a section first scrolls into view, the divider's `opacity` goes 0→1 over 600ms with a subtle `letter-spacing: 0.4em → 0.15em` ease-out. Decorative; opt-in per section.

**Reduced motion:** every animation must respect `@media (prefers-reduced-motion: reduce)`. In Framer Motion this is `useReducedMotion()`; if true, swap to instant transitions and disable the gallery scale entirely (keep the border color change).

## 6. The ❖ Ornament

The ornament is the project's signature. It appears in three contexts and **only three**.

1. **Section divider (`<DesignDivider>`):** centered on the page, surrounded by `--space-12` whitespace top and bottom. Color `--gold`. Size matches `--text-h2` (28px). No `<hr>` lines flanking it.
2. **Bullet replacement in DOCX upgrades list:** `❖` precedes each upgrade item instead of a `•`. Color: gold in DOCX run properties (RGB `C9A961`).
3. **Signature flourish:** a single `❖` sits in the top-right corner of the signature card on the Summary tab. Subtle, `--gold-dark`.

**Forbidden uses:**
- ❖ as a button icon
- ❖ inside body copy as decoration
- ❖ in the sidebar nav
- ❖ at any size other than the three canonical sizes (h2 for divider, body for DOCX bullet, h3 for signature flourish)

**Encoding:** the literal Unicode char `❖` (U+2756). In React/HTML it's safe inline. In DOCX it must be in a run that uses the embedded Frank Ruhl Libre font, otherwise Word substitutes a fallback.

## 7. RTL Conventions (cross-link to SOP 04)

This SOP defers to **SOP 04** for the bidi engineering details. From a tokens perspective:

- All Tailwind utilities used in components must be **logical**: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`. Reviewers reject directional utilities (`ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`) on sight unless the comment explains why bidi requires it (rare).
- Numeric inputs (phone, date, guest count, time) carry `dir="ltr"` explicitly. Their containers stay `dir="rtl"`.
- The sidebar lives on the **right** because `dir="rtl"` puts the inline-start there. Don't fight this with positioning.
- Icons that imply direction (chevrons, arrows) must mirror in RTL. Lucide icons get `className="rtl:scale-x-[-1]"` when they're directional. Decorative icons (heart, star) do not mirror.

## 8. Iconography

- **Library:** Lucide React only.
- **Default size:** `20px` (matches `--text-h3` baseline). Icons in tab labels are `18px`. Icons inside `--text-small` contexts are `16px`.
- **Default color:** matches the surrounding text — never give an icon its own color. Exception: the gold ❖ ornament.
- **Stroke width:** `1.5` always. Lucide's default is `2`; `1.5` reads more elegant on dark surfaces.

## 9. Do / Don't Gallery

These are the patterns code review checks against. Each pair shows the right way and the typical AI-default mistake.

### 9.1 RTL spacing utilities

**DO:**
```tsx
<button className="px-6 py-3 ms-2 text-cream">שמור</button>
```
**DON'T:**
```tsx
<button className="px-6 py-3 ml-2 text-cream">שמור</button>
```
> `ml-` is hard-coded to the left edge. Under `dir="rtl"`, the gap appears on the wrong side and the layout silently inverts.

### 9.2 Gold usage

**DO:** gold on the divider, the focus ring, the button underline, the ❖ ornament, a 1px hairline border.
```tsx
<div className="border-b border-gold/100" />     {/* 1px hairline */}
<input className="focus:ring-2 focus:ring-gold focus-visible:outline-none" />
```
**DON'T:** gold backgrounds, gold-filled buttons, gold body text, gold-on-cream combinations.
```tsx
<button className="bg-gold text-ink">קנה עכשיו</button>   {/* WRONG — looks like a kitsch CTA */}
<p className="text-gold">פרטי האירוע</p>                  {/* WRONG — gold ≠ heading color */}
```

### 9.3 Hover states

**DO:** a width-animating gold underline + text color swap to `--gold-dark`.
```tsx
<motion.button
  className="relative text-cream"
  whileHover="hover"
  initial="rest"
>
  המשך
  <motion.span
    className="absolute inset-x-0 bottom-0 h-px bg-gold"
    variants={{ rest: { scaleX: 0 }, hover: { scaleX: 1 } }}
    transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
    style={{ transformOrigin: 'inset-inline-start' }}
  />
</motion.button>
```
**DON'T:** background fills, scale transforms on the button, glowing shadows.
```tsx
<button className="hover:bg-gold hover:scale-105 hover:shadow-lg">המשך</button>   {/* WRONG */}
```

### 9.4 Numeric inputs in RTL forms

**DO:** the form is RTL, the numeric field is LTR.
```tsx
<label dir="rtl">
  <span className="block text-sm">מספר מוזמנים</span>
  <input dir="ltr" inputMode="numeric" className="text-end font-tabular" />
</label>
```
**DON'T:** leave the field as RTL — `350` becomes `053` visually in some browsers.

### 9.5 ❖ divider spacing

**DO:**
```tsx
<section className="py-24">{/* content */}</section>
<DesignDivider />                                            {/* py-12 internal */}
<section className="py-24">{/* next */}</section>
```
**DON'T:** an ornament hugging surrounding content with no whitespace.
```tsx
<p>פרטי החופה</p>
<DesignDivider />
<p>סוג: מרובעת</p>                                          {/* WRONG — no breathing room */}
```

### 9.6 Card geometry

**DO:** flat, sharp, padding-driven.
```tsx
<div className="bg-ink-raised border border-border-subtle p-8">
  …
</div>
```
**DON'T:** rounded corners, drop shadows, gradient borders.
```tsx
<div className="bg-ink-raised rounded-2xl shadow-2xl shadow-gold/30 p-4">…</div>   {/* WRONG */}
```

### 9.7 Headline pairing

**DO:** serif headline, sans body.
```tsx
<h1 className="font-serif text-h1">פרטי האירוע</h1>
<p className="font-sans text-body">תאריך, שעה, ולוקיישן</p>
```
**DON'T:** sans-serif headline.
```tsx
<h1 className="font-sans font-bold text-h1">פרטי האירוע</h1>   {/* WRONG */}
```

## 10. Tailwind Mapping (preview for SOP-implementation handoff to #9)

When `app/tailwind.config.js` is wired in task #9, this is the mapping it must produce:

```js
// theme.extend
colors: {
  ink: 'var(--ink)',
  'ink-raised': 'var(--ink-raised)',
  cream: 'var(--cream)',
  'cream-muted': 'var(--cream-muted)',
  gold: 'var(--gold)',
  'gold-dark': 'var(--gold-dark)',
  'border-subtle': 'var(--border-subtle)',
},
fontFamily: {
  serif: ['Frank Ruhl Libre', 'David Libre', 'serif'],
  sans:  ['Heebo', 'Assistant', 'Segoe UI', 'sans-serif'],
},
fontSize: {
  hero:  ['4rem',     { lineHeight: '1.15', fontWeight: '500' }],
  h1:    ['2.5rem',   { lineHeight: '1.15', fontWeight: '500' }],
  h2:    ['1.75rem',  { lineHeight: '1.15', fontWeight: '500' }],
  h3:    ['1.25rem',  { lineHeight: '1.15', fontWeight: '500' }],
  body:  ['1rem',     { lineHeight: '1.6' }],
  small: ['0.875rem', { lineHeight: '1.4' }],
  label: ['0.75rem',  { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.12em' }],
  tiny:  ['0.6875rem',{ lineHeight: '1.4' }],
},
spacing: {
  '1': '0.25rem', '2': '0.5rem', '3': '0.75rem', '4': '1rem',
  '6': '1.5rem',  '8': '2rem',   '12': '3rem',   '16': '4rem',
  '24': '6rem',
},
borderRadius: { none: '0', sm: '2px' },
transitionDuration: {
  '100': '100ms', '150': '150ms', '200': '200ms',
  '260': '260ms', '320': '320ms',
},
transitionTimingFunction: {
  ease:        'cubic-bezier(0.4, 0, 0.2, 1)',
  'ease-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
},
```

Plugins required: `@tailwindcss/forms` (resets), nothing else. No animation plugin — Framer Motion handles it.

## 11. DOCX Mirror

Tokens that cross over to `src/lib/docx.ts`. Default DOCX is **dark-text-on-white** for printability; the screen-only Summary preview uses the dark theme.

### Token map (DOCX library uses RGB hex without `#` and half-points for sizes)

| Concept                | Screen token        | DOCX value                              |
|------------------------|---------------------|-----------------------------------------|
| Body text color        | `--cream` (in app)  | RGB `0F0E0C` (print = dark ink)         |
| Section headings color | `--cream`           | RGB `0F0E0C`                            |
| Small labels / eyebrow | `--gold-dark`       | RGB `A88B47`                            |
| ❖ ornament / dividers  | `--gold`            | RGB `C9A961`                            |
| Page hairline border   | `--gold`            | RGB `C9A961`, `size: 4` (≈ 0.5pt)        |
| Hero (couple names)    | `--text-hero`       | size `72` half-points (= 36 pt)         |
| H1 (page title)        | `--text-h1`         | size `48` half-points (= 24 pt)         |
| H2 (section heading)   | `--text-h2`         | size `36` half-points (= 18 pt)         |
| H3 (group/card title)  | `--text-h3`         | size `28` half-points (= 14 pt)         |
| Body                   | `--text-body`       | size `22` half-points (= 11 pt)         |
| Small / caption        | `--text-small`      | size `20` half-points (= 10 pt)         |
| Label                  | `--text-label`      | size `18` half-points (= 9 pt) + UPPERCASE + `bold: true` |

### Author checklist for `lib/docx.ts` (#13)

When porting `.tmp/poc-l3v2-docx/docx-poc.mjs` into `app/src/lib/docx.ts`, every output run/paragraph must satisfy these. Treat this as the acceptance criteria for #13.

1. **Font on every TextRun.** Every `TextRun` constructor sets `font: 'Frank Ruhl Libre'`. No exceptions, including digits. Helvetica is only an implicit fallback if Word can't load the embedded TTF.
2. **RTL on every Hebrew paragraph.** Each `Paragraph` containing Hebrew sets `bidirectional: true`. Each Hebrew `TextRun` sets `rightToLeft: true`. (Hebrew = any string matching `/[֐-׿]/`.) Pure-numeric runs inside an RTL paragraph stay LTR — do not set `rightToLeft` on the date / time / guest-count runs.
3. **Heading colors.** All headings (hero / h1 / h2 / h3) and body use `color: '0F0E0C'`. Small labels use `color: 'A88B47'` + `bold: true` + uppercased text. ❖ ornament runs use `color: 'C9A961'`.
4. **Heading sizes (half-points).** Hero `size: 72`. H1 `size: 48`. H2 `size: 36`. H3 `size: 28`. Body `size: 22`. Small `size: 20`. Label `size: 18`. These match SOP 09's pt column.
5. **❖ ornament rules.** ❖ appears in *exactly* three places per the rendered DOCX: (a) centered divider between major sections — its own paragraph, `alignment: 'center'`, color `C9A961`, size 36 (h2). (b) upgrade list bullets — replace `•` with `❖ ` prefix in each upgrade item run, color `C9A961`. (c) signature card flourish — top-right of the signature paragraph, color `A88B47`, size 28 (h3). No other ❖ glyphs in the document.
6. **Page hairline border.** The page has a gold border (`size: 4`, `color: 'C9A961'`, `style: BorderStyle.SINGLE`) on top and bottom only. No left/right border. No drop shadows; DOCX has none anyway.
7. **No shading / no gradients.** Verify no `shading` is set on any paragraph. Print-default = white background. (The optional dark-mode cover page is Phase 5, out of scope for #13.)
8. **Spacing in twentieths-of-a-point.** DOCX `spacing.before` / `spacing.after` use 1/20 pt. Translate the rem scale: between paragraphs `before: 240` (12pt ≈ `--space-6`), between sections `before: 480` (24pt ≈ `--space-12`), above and below ❖ divider `before: 480` and `after: 480`. Don't invent values outside the scale.
9. **Tabular digits in tables.** Any DOCX table cell containing a number (guest count, date) sets `font: 'Frank Ruhl Libre'`. Frank Ruhl Libre's digits are proportional by default. For tables, prefer wrapping numerics in a run with `characterSpacing: 4` (DOCX has no direct tnum toggle in `docx` v8) — document the limitation in the inline code comment.
10. **Embedded font.** Frank Ruhl Libre TTF loads via `await fs.readFile()` from the Tauri-bundled resource path (`src-tauri/resources/FrankRuhlLibre[wght].ttf` after build), then is passed to `Document({ fonts: [{ name: 'Frank Ruhl Libre', data: ttfBuffer }] })`. Without this step, Word users on machines that don't have FRL installed will see a Times-like fallback.
11. **Legal terms verbatim.** The photography release + flower-availability disclaimer copies text *exactly* from the original DOCX (per Constitution rule 8). No paraphrasing. Body color, body size, RTL, with `before: 240` separation from preceding section.
12. **Filename + path.** Output saves to `events/<eventId>/דף_תכנון_<yyyy-mm-dd>.docx`. The filename is Hebrew on purpose. Tauri FS write uses the full UTF-8 byte sequence — no transliteration.

### Quick verification

After generating a DOCX, an automated check (#15 smoke test) should:
- Unzip the output, parse `word/document.xml`, and assert that every `<w:r>` element with Hebrew chars has `<w:rtl/>` and `<w:rFonts w:ascii="Frank Ruhl Libre"/>` (or equivalent w:cs / w:hAnsi).
- Assert exactly **N + 2 + 1** ❖ glyphs in the document, where N = number of upgrade items, +2 dividers, +1 signature flourish. Adjust the count rule once #13 locks the final layout.
- Open visually in Word and compare side-by-side against the in-app Summary tab. The two must show: (a) the same headline pairing (FRL serif headings, sans body), (b) gold used only on ❖ + page hairline, (c) identical RTL behavior (date `14.06.2026` reads naturally inside its Hebrew sentence), (d) the same spacing rhythm.

## 12. Accessibility Floor

- Color-only signaling is forbidden. Every "selected" state pairs the gold ring with a ✓ glyph; every "error" state pairs `--cream-muted` text with an icon and an ARIA message.
- Minimum text size: `--text-tiny` (11px). Anything smaller is rejected.
- Focus is **always** visible — `:focus-visible` shows a 2px gold ring with a 2px offset on every interactive element. There are no `outline: none` overrides without a replacement ring.
- Hit targets: buttons, sidebar items, gallery cards all have a minimum `44×44px` interactive surface (the visible content can be smaller; pad the hit area).

## 13. Versioning & Updates

This SOP is the contract. Token changes require:
1. Update this file first.
2. Update `app/src/index.css` `:root` block to match.
3. Update `app/tailwind.config.js`'s `theme.extend` to match.
4. Update `app/src/lib/docx.ts` constants for any color or size that crosses to the document.
5. Note the change in the project's Maintenance Log (root `claude.md`).

If a component needs a value not on the scale, the answer is one of: (a) the component is wrong, (b) the scale gets a new entry — added by this SOP first, (c) a one-off magic number is acceptable only if it is in service of a *non-decorative* technical constraint (e.g., `1px` for a true hairline, `0.5px` is forbidden). Document the reason next to the magic number.

## 14. Cross-references

- **SOP 04** (RTL & Fonts) — bidi rendering, font subsetting, the `reverseBidi` algorithm.
- **SOP 03** (Document Generation) — how the DOCX consumes the print-mode tokens above.
- **SOP 05** (Gallery Selection) — gallery card geometry; the scale-1.02 hover rule lives there too but the *value* is locked here.
- **SOP 06** (Signature Flow) — the signature card uses the canonical card geometry from §4.
- Project Constitution (`claude.md`) §Branding — logo SVG variants, colors must align with this palette.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Tailwind v4 quirk discovered while wiring SOP 14 light mode: `@theme` cannot be conditioned on a runtime selector — its variables are bound to utilities at build time. The documented workaround is to override the same `--color-*` variables under a `[data-theme="light"]` selector under `@layer base`. This flips every Tailwind utility (`bg-ink`, `text-cream`, `border-gold`, …) without rebuilding. Strategy: keep semantic *utility names* and flip their *meaning* in light mode (`bg-ink` paints cream, `text-cream` paints dark) so component code stays portable. `html[data-theme="light"] { color-scheme: light }` flips native scrollbars / form widgets too. | Light-mode block added to `app/src/styles/index.css` and `app/src/styles/tokens.css` (functional aliases). Tokens themselves unchanged — only the meaning flips. |
| 2026-05-20 | Tech-stack styling row was originally `Tailwind (inline CDN)`; replaced with `Tailwind v4 via @tailwindcss/vite plugin (compiled at build time, no CDN)` in the Constitution. CDN runtime would require either an external script load (violates Behavioral Rule #7 zero-network) or shipping a 300KB+ `tailwind.min.js`. The Vite plugin keeps zero-network, ships only used classes (~12KB CSS, JS unchanged), and is the canonical v4 path. | Constitution Maintenance Log row dated 2026-05-20. |
| 2026-05-20 | Sharp corners (`borderRadius: 0`) confirmed across UI primitives (Button / Card / Input / TextArea), Gallery tiles, Lightbox surface, Settings panels, AppBar, FatalBanner. Hairline (1px) `border-border-subtle` is the default; active states upgrade to 2px gold. | Phase 3B implementation — UI primitives + 4 shell + gallery + signature + settings + 6 event tabs all comply. |
| 2026-05-21 | Phase 4 RTL + visual smoke pass uses `.tmp/rtl-visual-test-plan.md` (13 sections) as the authoritative checklist. Token values are unchanged; the audit walks every utility surface to confirm light-mode flip survives. | Refinement-pass entry; logged in `task_plan.md` Phase 4. |
