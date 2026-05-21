# Google Stitch — UI Prompt for the Shon Blaish App

> **How to use this file**
> Open Google Stitch → New project → Paste **only the fenced prompt block below** into the prompt input. Stitch responds best to English directives with verbatim Hebrew copy embedded — that's what's encoded here. Generate, then iterate one variable at a time (color, density, screen). Don't try to fix everything in the first regenerate.
>
> The prompt was built using the **Weblove 5-Line Prompt Formula** (Role · Goal · Style · Sections · Constraints) — see `~/.claude/skills/weblove-ai-prompts/`.
>
> Project context: Hebrew RTL desktop app for a premium wedding/Bar Mitzvah designer (Shon Blaish, Israel). Locked design language is "Luxury Editorial" per `architecture/09-design-tokens.md`.

---

## The Prompt — paste this whole block into Stitch

```
ROLE
Act as a senior product designer specialised in luxury editorial interfaces and Hebrew right-to-left typography. You're working in the spirit of Aesop's print catalogues, Toteme's brand site, and a Wallpaper magazine spread — restrained, confident, no decorative noise.

GOAL
Design a Hebrew right-to-left desktop application for Shon Blaish, a premium wedding and Bar Mitzvah designer in Israel. The app replaces a Word-based client planning workflow. The designer and the engaged couple sit together at a meeting, browse a curated image library, fill out planning details across six tabs, sign on a digital canvas, and export a luxury Word document. There is no mobile, no marketing surface — every pixel is for one user using a 1440x900+ laptop in a quiet design studio.

STYLE
Luxury Editorial — anti-glossy, anti-SaaS.
- Palette: deep ink black #0F0E0C as canvas, cream #F5F0E8 as text, antique gold #C9A961 as the only accent, gold-dark #A88B47 for hover states. Pure white never appears. Pure black never appears. The gold is muted and warm — never neon, never yellow.
- Typography: Frank Ruhl Libre (Hebrew serif) for every headline, Heebo (Hebrew sans) for body and form labels. Headline weight is 500, never 700. Letter-spacing on small uppercase labels is +0.12em. Tabular-lining numerics for dates, times, guest counts.
- Geometry: SHARP CORNERS by default. Border radius is 0px or 2px maximum (only on inputs and buttons). NO rounded cards. NO drop shadows. NO gradients. NO glassmorphism.
- Borders: 1px hairlines in #2A2520. Used sparingly — only where structure requires.
- One signature ornament: ❖ (decorative diamond, U+2756) in gold, used as a section divider. Appears max three places per screen.
- Motion: gallery cards scale 1.0 → 1.02 over 200ms on hover. Buttons reveal a 1px gold underline that animates 0% → 100% width over 150ms. Curtain transition (top-down sweep, 550ms) when toggling theme. Nothing else moves.
- Spacing: generous editorial whitespace. Use 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px / 96px scale. Air around elements is the design.

LANGUAGE & DIRECTION
- All UI strings are Hebrew, with right-to-left flow. Logo and brand mark sit at the inline-end (visually right edge under RTL).
- Mixed-bidi runs: dates render as 14.06.2026 in their natural left-to-right order even inside Hebrew sentences. Phone numbers render as 050-1234567 in natural order. Guest count "350 מוזמנים" reads with 350 visually to the right of the Hebrew word.
- Form fields: Hebrew text inputs flow RTL with cursor on the right. Phone, date, time, and numeric inputs are LTR.

SECTIONS — design these EIGHT screens

Screen 1 — TaggingPass (first-launch only, blocks the rest of the app)
Full-screen single image card centered. Above it: progress label "תויגו 47 / 884" in tiny gold uppercase letterspacing, plus a thin gold progress rule. Below the image: a category radio group labeled "קטגוריה" with eight Hebrew categories ("אולם עיצוב בסיס 2026", "חופות אולם גדול גאמוס", "חופות ריזורט", "חופות שידרוג", "מפות מפיות", "עיצובים שידרוג", "ריזורט בסיס", "כיסא כלה") plus a custom-tag chip input ("תוויות חופשיות") and a notes textarea ("הערות"). Two buttons in the bottom-right (RTL = inline-end): a primary "שמור והבא" with gold underline, and a small secondary "סיים תיוג" that's grey until enough images are tagged. The screen has no top bar, no nav — it's modal-feeling.

Screen 2 — Home / Client list (post-tagging)
Top app bar: 60px tall, ink background, cream text. Logo monogram (SB crown) at the inline-end. Title "שון בלאיש — הפקות" in Frank Ruhl Libre. A circular icon button at the inline-start: light/dark theme toggle (moon icon at rest, curtain animation on click). Below the bar: a primary "+ לקוח חדש" button at the top of the page (NOT in the bar — sits on the canvas with a hairline divider above it). Below that: a 2-column grid of client cards. Each card is a tall portrait card with hairline border:
  - Couple name in Frank Ruhl Libre h2 weight 500
  - Phone number below in Heebo small with tabular numerics
  - Next event date in tiny gold uppercase letterspacing, e.g. "אירוע: 14.06.2026"
  - On hover: 1px gold border + scale 1.02
Empty state when no clients yet: a centered ❖ ornament + "אין לקוחות עדיין" + the new-client CTA.

Screen 3 — ClientForm (modal-style overlay or full screen)
Editorial form layout: each field on its own line, label above input in tiny gold uppercase. Three fields:
  - "שמות בני הזוג" (RTL Hebrew text)
  - "נייד" (LTR, monospace digits, e.g. 050-1234567)
  - "אימייל (אופציונלי)" (LTR)
Bottom-right pair of buttons: primary "שמור" with gold underline; tertiary "ביטול" as plain text.

Screen 4 — Client detail / Event list
Same top bar. Page hero: couple name as large h1, phone + email below in muted cream. ❖ divider. Below: a section "אירועים" with a "+ אירוע חדש" button and a list of event cards (one per row, NOT a grid here):
  - Date in tabular numerics + day-of-week in Hebrew ("יום ראשון")
  - Location ("גאמוס" or "ריזורט")
  - Guest count ("350 מוזמנים")
  - Status pill: "טיוטה" / "חתום" / "הושלם" — pill is a 1px gold outline, no fill.

Screen 5 — Event tabs (the core working surface)
Top bar with breadcrumb "ליאור ודן / אירוע 14.06.2026". Below the bar: a horizontal tab strip with six Hebrew tabs, separated by hairline rules:
  פרטי אירוע · מפיות · עיצובי שולחן · חופה · שדרוגים · סיכום
Active tab has a 2px gold underline. Show the FIRST tab "פרטי אירוע" filled out with these labels (label → input):
  - תאריך → 14.06.2026 (LTR)
  - יום → ראשון (auto-derived, read-only)
  - שעת תחילה → 20:00 (LTR)
  - לוקיישן → toggle between two radio chips "גאמוס" and "ריזורט"
  - כמות מוזמנים → 350 (LTR, tabular)
  - אירוע מעורב → toggle (כן / לא)
  - הערות → multiline textarea ("דגש על פרחים לבנים")
Bottom-right: primary "שמור והמשך" advances to next tab.

Screen 6 — Gallery (the most visual screen, opens from "עיצובי שולחן" or "חופה" tab)
Full-screen modal. Top: category tab strip with all eight categories. Sub-tabs below: "תמונות" / "וידאו". Counter pill in top-left (= inline-start under RTL): "3 / 5 נבחרו" in tiny gold uppercase. The grid: 4 columns of square tiles, 16px gaps. Each tile is just the image, no caption — clean. Selected tiles get a 2px gold border and a small ❖ in the top corner. Hover: scale 1.02, 1px gold border. A bottom-right "חזרה" closes the gallery and applies the selections to the active tab. A search input top-right ("חיפוש לפי שם קובץ") with a subtle magnifier icon.

Screen 7 — Signature (Summary tab final card)
Page renders the FULL summary above the fold (couple name, date, all selections as small thumb strips with their notes), then below: a generous 600x180 signature canvas with a thin gold underline beneath it. Above the canvas: a small label "חתימת הזוג". Below: a date stamp "20 במאי 2026". Two buttons: "ניקוי" tertiary on the inline-start, "אישור וחתימה" primary on the inline-end. After signing, replace the canvas with the captured signature image at the same dimensions and add ❖ to the corner.

Screen 8 — Settings
Editorial single-column layout. Sections separated by ❖ dividers:
  - "גיבוי" — buttons: "ייצוא גיבוי" / "ייבוא גיבוי" / "אפס נתונים מקומיים"
  - "ערכת נושא" — radio "כהה" / "בהיר" (the toggle in the top bar mirrors this)
  - "מידע" — a copyable path field showing the backups folder location, plus a small "Shon Blaish — Event Designer v1.0" footer.

Bonus state for every screen — Light theme variant
After designing the dark variant, generate a SECOND board showing the SAME eight screens in light theme: the canvas becomes #F5F0E8 cream, text becomes #1A1714 ink-dark, gold becomes the slightly muted #A88B47 (gold-dark). Hairlines become #E5DFD3. Everything else holds — same typography, same sharpness, same ❖, same RTL flow. The transition between themes uses a top-down curtain sweep — show one frame of that mid-sweep as a visual reference.

CONSTRAINTS
- Hebrew RTL is mandatory on every screen. Logo always at inline-end (= visually right). NO ml-/mr-/left-/right-/text-left/text-right utilities — use logical properties only.
- Desktop-only. Optimize for 1440x900 and 1920x1080. Do NOT generate mobile breakpoints.
- No drop shadows. No gradients. No glassmorphism. No rounded corners beyond 2px on form inputs and buttons. No emojis. No stock photos in the gallery — use realistic placeholder images that look like wedding-table designs, chuppahs, napkin folds, and wedding chairs (drawn from the eight categories named above).
- Render the actual Hebrew copy provided here verbatim; do NOT translate to English. Mixed-bidi (dates, times, numbers) must read in their natural LTR order even inside Hebrew sentences.
- One ornament motif only: ❖ (U+2756). It appears as section divider, summary corner mark, and selected-tile corner mark. Nowhere else.
- Minimum hit target 44x44px on every interactive element.
- Frank Ruhl Libre and Heebo are the only fonts. No system stack visible anywhere.
- The DOCX export and any PDF derivative are ALWAYS light-theme — that's a print deliverable, not part of the theme switch. (We're only mocking the in-app screens here, but flag the Settings → "ייצוא Word" button so it's clearly a print-bound artifact.)

Tone
Restrained, ceremonial, generous with whitespace. Like a hand-stitched invitation rather than a software product.
```

---

## What to do after Stitch generates

### 🥉 Bronze — accept first generation
Pick the strongest of the three boards Stitch returns. Don't tweak yet. Screenshot all 8 screens and paste them into a `.tmp/stitch-mockups-2026-05-20/` folder so we have a visual baseline.

### 🥈 Silver — change ONE variable
After living with the first generation for an hour, decide on the one variable that bothers you most:
- **Density** — too airy or too compact?
- **Gold weight** — too prominent or too quiet?
- **Tab strip placement** — under the bar or floating?
- **Gallery card aspect** — square or portrait?

Regenerate that screen only with one extra line in the constraints (e.g., "make the gallery cards 4:5 portrait, not square").

### 🥇 Gold — portfolio-grade
Once you're happy with the static mockup, commission a custom font subset for the 8 specific Hebrew + Latin glyphs we use in the brand mark, and have the gold accent translated into a custom hex tuned to your monitor (the editorial gold reads slightly different on warm vs cool displays). Bring that into the build phase as the locked palette.

---

## Cross-reference for the build phase

When we move from Stitch mockups to React components, the screens map to these tasks in `task_plan.md`:

| Stitch screen | Maps to task | Component file |
|---|---|---|
| Screen 1 — TaggingPass | #20 (3B) | `components/tagging/TaggingPass.tsx` |
| Screen 2 — Home / Client list | #20 (3B) | `components/client/ClientList.tsx` + `components/shell/AppBar.tsx` |
| Screen 3 — ClientForm | #21 (3B) | `components/client/ClientForm.tsx` |
| Screen 4 — Client detail | #21 (3B) | `components/client/ClientDetail.tsx` |
| Screen 5 — Event tabs | #30-#36 (3C) | `components/event/EventTabs.tsx` + 6 tab files |
| Screen 6 — Gallery | #25 (3B) | `components/gallery/Gallery.tsx` + `Lightbox.tsx` |
| Screen 7 — Signature | #26 (3B) | `components/signature/SignaturePad.tsx` |
| Screen 8 — Settings | #37 (3C) | `components/settings/Settings.tsx` |

The mockup is the **visual contract**. If a future implementation drifts from it, code review (#19v2) catches the drift.

---

## Why this prompt works

- **Tool-aware:** Stitch responds best to multi-screen jobs with explicit screen-by-screen breakdowns. We give it eight, named, with content.
- **Aesthetic-locked:** the palette, fonts, geometry, and motion are pinned in absolute terms (hex codes, font names, pixel values, ornament glyph). Stitch can't drift into "luxury but generic".
- **RTL-explicit:** Hebrew direction, logical properties, and mixed-bidi rules are stated. Stitch tends to flip to LTR by default if you don't insist.
- **Anti-pattern fence:** the constraints list spells out what NOT to do (no shadows, no rounded cards, no gradients, no emojis). This catches Stitch's default SaaS-glossy tendency.
- **Realistic copy:** every label, button, and category appears in actual Hebrew. No `[placeholder]` tokens. The output looks like the real product, not a template.
- **5-Line Formula spine:** Role / Goal / Style / Sections / Constraints — the Weblove canon.
