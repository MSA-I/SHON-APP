---
name: Midnight Gilded Editorial
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3938'
  surface-container-lowest: '#0f0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2b2a29'
  surface-container-highest: '#363434'
  on-surface: '#e6e2e0'
  on-surface-variant: '#ccc6bd'
  inverse-surface: '#e6e2e0'
  inverse-on-surface: '#313030'
  outline: '#959088'
  outline-variant: '#4a4640'
  surface-tint: '#cac6c2'
  primary: '#cac6c2'
  on-primary: '#32302e'
  primary-container: '#0f0e0c'
  on-primary-container: '#7e7b77'
  inverse-primary: '#605e5b'
  secondary: '#cac6be'
  on-secondary: '#32302b'
  secondary-container: '#494741'
  on-secondary-container: '#b9b5ad'
  tertiary: '#e4c278'
  on-tertiary: '#3f2e00'
  tertiary-container: '#150d00'
  on-tertiary-container: '#947835'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e6e2de'
  primary-fixed-dim: '#cac6c2'
  on-primary-fixed: '#1d1b19'
  on-primary-fixed-variant: '#484644'
  secondary-fixed: '#e7e2da'
  secondary-fixed-dim: '#cac6be'
  on-secondary-fixed: '#1d1c17'
  on-secondary-fixed-variant: '#494741'
  tertiary-fixed: '#ffdf9b'
  tertiary-fixed-dim: '#e4c278'
  on-tertiary-fixed: '#251a00'
  on-tertiary-fixed-variant: '#5a4302'
  background: '#141313'
  on-background: '#e6e2e0'
  surface-variant: '#363434'
typography:
  display-lg:
    fontFamily: Frank Ruhl Libre
    fontSize: 48px
    fontWeight: '500'
    lineHeight: '1.1'
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Frank Ruhl Libre
    fontSize: 32px
    fontWeight: '500'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Frank Ruhl Libre
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Heebo
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Heebo
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm-caps:
    fontFamily: Heebo
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.12em
  data-tabular:
    fontFamily: Heebo
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1'
spacing:
  base: 8px
  container-margin: 64px
  gutter: 24px
  section-gap: 80px
  hairline: 1px
---

## Brand & Style

This design system is built for an elite, high-end editorial experience, specifically tailored for the Hebrew language and RTL layout. The brand personality is authoritative, intellectual, and deeply sophisticated. It draws inspiration from the **Minimalism** and **High-Contrast** movements, specifically focusing on the "Dark Mode" luxury aesthetic common in premium watchmaking or high-fashion digital journals.

The emotional response should be one of "quiet luxury"—exclusive, calm, and expensive. By utilizing a deep ink-black canvas and sharp, hairline geometry, the UI recedes into the background, allowing content to feel like a curated exhibit. There is no room for decorative fluff; every pixel must serve a functional and aesthetic purpose.

## Colors

The palette is intentionally restricted to evoke a sense of timelessness.
- **Canvas (#0F0E0C):** A deep, ink-like black used for the entire background. This creates a high-contrast environment where light text feels illuminated.
- **Text (#F5F0E8):** A soft cream rather than pure white, reducing eye strain and adding a vintage, high-quality paper feel.
- **Antique Gold (#C9A961):** Reserved for primary actions, subtle accents, and section dividers. It is the singular mark of luxury within the system.
- **Hairline (#2A2520):** A warm, dark brown-grey used for structural borders, ensuring the interface is organized without being loud.

## Typography

The typography system relies on the interplay between a classic serif and a functional sans-serif, optimized for RTL Hebrew readability.

- **Headlines:** Use **Frank Ruhl Libre**. The weight is set to 500 to maintain a delicate but firm presence. The high contrast of the serif strokes is the primary "ornament" of the UI.
- **Body & Forms:** Use **Heebo**, a modern sans-serif that ensures clarity on screens. 
- **Labels:** Small labels use Heebo with bold weights and a expanded letter-spacing of 0.12em to create an architectural, "label-like" feel.
- **Numeric Data:** Dates and counts must use tabular numerics to ensure alignment in lists, particularly when mixing LTR numbers with RTL text.

## Layout & Spacing

This design system uses a **Fixed Grid** model for desktop, centered on the screen to evoke the feeling of a printed book page. 

- **Alignment:** Strictly RTL (Right-to-Left). Navigation, text-alignment, and icon placement start from the right.
- **Bidi Support:** While the UI is RTL, numeric strings (dates/prices) should retain LTR ordering where appropriate for international standard compatibility.
- **Grid:** A 12-column grid with generous 64px outer margins. 
- **Rhythm:** Vertical rhythm is controlled by an 8px baseline. Large gaps (80px+) are used between major editorial sections to emphasize whitespace as a luxury asset.

## Elevation & Depth

This system intentionally rejects modern depth techniques like shadows, gradients, or blurs. It is a strictly "Flat" system that uses **Tonal Hairlines** and **Typography** to establish hierarchy.

- **Hairline Dividers:** Use 1px #2A2520 lines to separate header, footer, and sidebar elements.
- **Z-Index Strategy:** Layers do not float. If a modal or dropdown is required, it should be a hard-edged box with a 1px Antique Gold border, appearing to sit directly on top of the canvas with no shadow.
- **Section Dividers:** Use the minimalist gold ornament ❖ (U+2756) centered horizontally between major content blocks.

## Shapes

The shape language is **Sharp**. Rounded corners are strictly prohibited to maintain the editorial, architectural aesthetic. 

- **Corner Radius:** 0px for all buttons, cards, and input fields. 
- **Visual Weight:** Distinction is made through border thickness. While most lines are 1px, active states may use a 2px hairline for emphasis.

## Components

- **Buttons:** Sharp 0px corners. Primary buttons feature an Antique Gold border and Cream text. Hover state triggers a subtle scale (1.02) and changes the border to Gold-Dark. Text-only buttons utilize a Gold underline that animates from the center-out.
- **Input Fields:** Bottom-border only (hairline #2A2520). Labels sit above the field in `label-sm-caps`. Focus state changes the bottom border to Antique Gold.
- **Chips/Tags:** Sharp rectangular boxes with a 1px hairline border. No background fill.
- **Cards:** Defined by a single 1px hairline border or simply by whitespace. Images within cards should have no rounding.
- **Dividers:** 1px width #2A2520 lines. For major thematic breaks, use the ❖ symbol in Antique Gold.
- **Navigation:** RTL oriented. Primary links use Frank Ruhl Libre. Active links are marked by a static 1px Gold underline.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Stitch baseline mockups under `.tmp/stitch-mockups/.../` are the visual source of truth for Phase 3B. Each component progress entry references the mirrored screen (e.g. `gallery_dark/screen.png`, `tagging_pass_dark/screen.png`, `event_tabs_dark/`, `signature_dark/screen.png`). Where the brief and the mockup disagree, the **mockup wins** (logical-flow is the rule that survives a future light-mode flip). | Logged in the gallery progress entry footnotes. |
| 2026-05-20 | Phase 3B implementation honored every Brand & Style rule end-to-end: sharp 0px corners on every primitive, 1px hairlines for everything except 2px gold for active states, no shadows, no gradients, no rounded images, no serif body / no sans-serif headlines. AppBar / Settings / Gallery / Lightbox / Event tabs / SignaturePad / TaggingPass all comply. | Phase 3B close; cross-checked against SOP 09. |
| 2026-05-21 | Phase 4 visual smoke (`npm run dev` + the 13-section RTL checklist at `.tmp/rtl-visual-test-plan.md`) is the canonical pre-ship visual gate. Token values + SOP 16 baseline are unchanged; the audit walks every surface to confirm the live UI still matches the locked baseline. | Refinement-pass entry; tracked in `task_plan.md` Phase 4 § Visual smoke. |
| 2026-05-21 | Phase 4 token consolidation pass (Agent B). Tokens are now ADDITIVE-only — every name shipped before this pass (ink, ink-raised, cream, cream-muted, gold, gold-dark, border-subtle, text-hero, text-h1..h3, text-body, text-small, text-label, text-tiny, spacing-1..24, motion-*, ease-*) is LOCKED because ~28 components reference them via Tailwind utilities (`bg-ink`, `text-cream`, `border-gold`, ...). New surface-elevation tier (`--surface-lowest #0F0E0E`, `--surface-low #1C1B1B`, `--surface #201F1F`, `--surface-bright #2B2A29`) maps the stitch `surface-container-*` family without disturbing the legacy aliases — emitted as Tailwind utilities (`bg-surface-low`, etc.) and inverted under `[data-theme="light"]` to white-on-cream. Additive type step `text-display: 3rem / -0.01em / 500` matches the stitch `display-lg` page-hero treatment (hero stays at 4rem reserved for splash). Letter-spacing tokens `--tracking-display: -0.01em` + `--tracking-caps: 0.12em` are now first-class. Stronger separator `--outline / --color-outline #4A4640` is the brighter sibling of `--border-subtle` for sticky header rules. `--shadow-flat: none` is documented as a token so the SOP-09 "no shadows" rule is machine-checkable. `Card` gained a `raised` boolean (32px padding + `bg-surface-low` fill) matching the stitch event-tab form-container; `Button` switched its tertiary underline `transformOrigin` from invalid `inset-inline-start` to `center` per DESIGN.md "center-out" growth, and both variants gained explicit caps tracking. Inputs/TextArea/Ornament were verified token-correct, no logic change. Build: `tsc --noEmit` clean, `npm run build` clean (CSS 30.86 KB / 7.01 KB gzip). | Phase 4 housekeeping; the design system now has a 4-tier surface elevation, a display-scale step, and explicit shadow contract — all behind Tailwind v4 utility classes so light-mode flips automatically via the `[data-theme="light"]` block. |