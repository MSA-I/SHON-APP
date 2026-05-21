# Architecture SOPs (Layer 1)

> **Golden Rule:** If logic changes, update the SOP *before* updating the code.

This directory holds the canonical "how-to" docs for every major feature. They are the authoritative spec — code conforms to them, not the other way around.

## SOPs (Phase 3 Layer 1 — authored as each feature is designed)

| File | Topic |
|---|---|
| `01-image-scanning.md`        | How the app discovers and indexes the image folders |
| `02-indexeddb-persistence.md` | Schema, migrations, CRUD patterns, error contracts |
| `03-document-generation.md`   | DOCX layout, Hebrew RTL via Word, image embedding (replaces planned `03-pdf-generation.md`) |
| `04-rtl-and-fonts.md`         | RTL conventions across screens, font fallbacks, bidi engineering |
| `05-gallery-selection.md`     | Multi-select rules, max-5 cap, notes editing, lightbox flow |
| `06-signature-flow.md`        | Capture → store → embed in DOCX |
| `07-backup-strategy.md`       | JSON envelope, auto-snapshot triggers, 30-rolling retention, restore |
| `08-tauri-filesystem.md`      | Capability scoping, allowlist, asset protocol, CSP, shell |
| `09-design-tokens.md`         | Luxury Editorial visual system: colors, type scale, spacing, motion, ❖ ornament, do/don't gallery |
| `10-ubiquitous-language.md`   | DDD glossary — every Hebrew domain term ↔ English code identifier, with forbidden synonyms |
| `11-domain-invariants.md`     | Business rules `INV-01..INV-12` — what must always hold, where each is enforced |
| `12-image-tagging.md`         | One-time Image Tagging Pass — first-launch gate that walks Shon through every image, never repeats |
| `13-app-shell-routing.md`     | Boot sequence, `AppView` state machine, EventContext scope, error boundaries, reduced-motion plumbing |
| `14-theme-toggle.md`          | Light/Dark theme system — `meta.theme` storage, token inversion, `<ThemeToggle />` curtain animation, boot read-before-paint |
| `15-component-architecture.md`| Phase 3B component layout under `components/{ui,shell,client,event,gallery,signature,tagging}` + `contexts/`, Layer 2 imports rule, test-ID convention |
| `16-stitch-design-baseline.md`| Stitch-generated "Midnight Gilded Editorial" baseline — palette, typography, spacing, components. Mockups live in `.tmp/stitch-mockups/`. Build phase aligns to this. |
| `00-deployment.md`            | Build + ship to Shon's machine (Phase 5 — not yet authored) |

Files appear here only when their corresponding feature is being designed. An empty `architecture/` is correct early in the project.

## Cross-cutting reference

`09-design-tokens.md` is the **visual contract**. Every component, every DOCX run, every Tailwind utility must trace back to a token defined there. Code review uses §9 (do/don't gallery) as its yardstick.
