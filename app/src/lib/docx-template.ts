// SOP: architecture/03-document-generation.md (Editorial Magazine template)
// SOP: architecture/04-rtl-and-fonts.md (bidiVisual: true everywhere)
// Schema: claude.md § Behavioral Rule #13 (DOCX output is ALWAYS light-theme)
//
// Layer 3 — pure Editorial template builders for DOCX. The "Editorial Magazine"
// layout approved in the Mockup A mockup (cover page → body pages with header/
// footer + gold accents + RTL hierarchy). Every function returns docx primitives
// (Paragraph[], Table, Header, Footer) ready to be inserted into a Section.
//
// Behavioral Rule #13: DOCX is always light-theme (white page + dark text + gold
// accents). meta.theme (UI-only) never touches these exports. The logo parameter
// is the dark-on-white SVG variant (assets/logo.svg), never the cream variant.

import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
} from 'docx';

// ---------------------------------------------------------------------------
// Design tokens (DOCX hex strings)
// ---------------------------------------------------------------------------

export const DOCX_TOKENS = {
  // Color palette — light theme per Behavioral Rule #13
  ink: '1A1A1A',           // dark body text
  cream: 'F7F2E8',         // unused (dark-mode UI only), kept for cross-ref
  gold: 'C8A872',          // accent + hairlines
  goldMuted: 'D4BD8C',     // label text
  goldHairline: 'C8A872',  // border accent
  pageBg: 'FFFFFF',        // white page

  fonts: {
    serif: 'Frank Ruhl Libre',
    serifFallback: 'David Libre',
    sans: 'Heebo',
    sansFallback: 'Arial',
  },
} as const;

// Sizes in half-points (docx convention: 22 = 11pt, 28 = 14pt, etc.)
const SIZE = {
  tiny: 16,        // 8pt — footer
  small: 18,       // 9pt — eyebrows, captions
  body: 22,        // 11pt — body text
  label: 24,       // 12pt — field labels
  h2: 36,          // 18pt — section heads
  h1: 48,          // 24pt — page title
  headline: 72,    // 36pt — couples names on cover
} as const;

// Image dimensions in points (1pt ≈ 1/72in)
//
// Maintenance Log 2026-05-26: split `logo` into per-brand entries because the
// SB and Gamos source PNGs have different aspect ratios (SB ≈ square crown
// medallion 1:1, Gamos venue mark 1.6:1). Forcing both into the old 3:1 logo
// (150×50) squashed the Gamos artwork until its embedded "GAMOS · אירועים"
// wordmark was illegible.
//
// Maintenance Log 2026-05-26-pm: bumped the cover dimensions because the
// previous values made the SB cell read as a small medallion in a sea of
// white. SB is now 110×110 (square, 1254×1254 source), Gamos is 150×93
// (1.6:1, sized to match the SB long-edge so the two cells visually
// balance side-by-side). `logoMini` (page header) stays 50×17 — that
// rectangle inside the body header is intentional, the SB mini-version
// sits beside the brand-tagline run.
const IMG_DIM = {
  /** SB monogram — square crown medallion (1254×1254 source). */
  logoSb: { width: 110, height: 110 },
  /** Gamos venue mark — natural 1.6:1 (2116×1317). */
  logoGamos: { width: 150, height: 93 },
  /** Page-header mini variant of the SB monogram. Unchanged. */
  logoMini: { width: 50, height: 17 },
  designSelection: { width: 300, height: 200 },
  signature: { width: 200, height: 60 },
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Header for body pages.
 * Layout: centered [logo mini] "שון בלאיש · הפקות"
 *                            "גאמוס · אירועים"   (stacked below, muted)
 *         gold hairline.
 *
 * Maintenance Log 2026-05-26-pm: added the second line per user
 * directive — every body page now carries both brand wordmarks in the
 * running header. The mini logo stays SB-only (Gamos artwork too noisy
 * at 50×17). `bidiVisual: true` preserves Hebrew shaping; only the
 * paragraph block centres on the page.
 */
export function headerBand(logoPngBytes: Uint8Array | null): Header {
  const rows: Paragraph[] = [];

  // Line 1: logo mini + "שון בלאיש · הפקות"
  const lineOne: (TextRun | ImageRun)[] = [];
  if (logoPngBytes && logoPngBytes.byteLength > 0) {
    lineOne.push(
      new ImageRun({
        data: logoPngBytes,
        transformation: {
          width: IMG_DIM.logoMini.width,
          height: IMG_DIM.logoMini.height,
        },
      }),
    );
    lineOne.push(
      new TextRun({
        text: '  ',
        rightToLeft: true,
        font: DOCX_TOKENS.fonts.serif,
        size: SIZE.tiny,
      }),
    );
  }
  lineOne.push(
    new TextRun({
      text: 'שון בלאיש · הפקות',
      rightToLeft: true,
      font: DOCX_TOKENS.fonts.serif,
      size: SIZE.tiny,
      color: DOCX_TOKENS.gold,
    }),
  );
  rows.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: lineOne,
    }),
  );

  // Line 2: "גאמוס · אירועים" (no logo; sits directly under line 1).
  rows.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'גאמוס · אירועים',
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.tiny,
          color: DOCX_TOKENS.goldMuted,
        }),
      ],
    }),
  );

  // Gold hairline
  rows.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      border: {
        bottom: {
          color: DOCX_TOKENS.goldHairline,
          space: 4,
          style: BorderStyle.SINGLE,
          size: 4,
        },
      },
      spacing: { after: 80 },
    }),
  );

  return new Header({ children: rows });
}

/**
 * Build a Footer for body pages.
 * Layout: centered "שון בלאיש · הפקות" (gold, tiny). No page numbers (per mockup).
 */
export function footerStrip(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: 'שון בלאיש · הפקות',
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.serif,
            size: SIZE.tiny,
            color: DOCX_TOKENS.gold,
          }),
        ],
      }),
    ],
  });
}

/**
 * Build the cover hero page (page 1).
 *
 * Maintenance Log 2026-05-26 — dual-wordmark refactor:
 *   When both SB and Gamos logos are provided, the cover renders a 2-cell
 *   no-border `Table` with each logo + its own wordmark stacked vertically:
 *
 *     ┌────────────────┬────────────────┐
 *     │   [GAMOS PNG]  │   [SB PNG]     │   (visual L → R; under bidiVisual
 *     │                │                │    the DOM order is SB cell first
 *     │     גאמוס      │   שון בלאיש    │    so it reads R-to-L: SB right,
 *     │    אירועים     │     הפקות      │    Gamos left.)
 *     └────────────────┴────────────────┘
 *
 *   When only SB is provided, the table degrades to a single full-width cell
 *   with the SB logo + שון בלאיש / הפקות wordmark — preserving the legacy
 *   single-logo cover.
 *
 * Then the rest of the cover continues as Paragraphs:
 *   ━━━━━ (gold hairline)
 *   [שמות בני הזוג — Frank Ruhl 36pt ink, per Rule #13]
 *   14.06.2026 · יום ראשון (Frank Ruhl 11pt)
 *   20:00 (Frank Ruhl 12pt)
 *   ❖ (gold ornament)
 *
 * Cover spacing is also tightened (logo before:120, ornament after:80) so
 * the section can host the event-details block on the same page.
 */
export function coverHero(opts: {
  logoPngBytes: Uint8Array | null;
  /** Optional Gamos venue logo. Drives the dual-wordmark layout. */
  gamosLogoPngBytes?: Uint8Array | null;
  coupleNames: string;
  dateDisplay: string;
  dayOfWeek: string;
  startTime: string;
}): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  const hasSb = !!(opts.logoPngBytes && opts.logoPngBytes.byteLength > 0);
  const hasGamos = !!(
    opts.gamosLogoPngBytes && opts.gamosLogoPngBytes.byteLength > 0
  );

  if (hasSb || hasGamos) {
    out.push(
      buildLogoBrandTable({
        sbBytes: hasSb ? opts.logoPngBytes! : null,
        gamosBytes: hasGamos ? opts.gamosLogoPngBytes! : null,
      }),
    );
  }

  // Gold hairline under the brand cluster.
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      border: {
        bottom: {
          color: DOCX_TOKENS.goldHairline,
          space: 4,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      spacing: { before: 80, after: 120 },
    }),
  );

  // Couple names (headline — Behavioral Rule #13: dark ink on white).
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: opts.coupleNames,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.headline,
          color: DOCX_TOKENS.ink,
          bold: true,
        }),
      ],
    }),
  );

  // Date + day of week
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `${opts.dateDisplay} · יום ${opts.dayOfWeek}`,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.body,
          color: DOCX_TOKENS.ink,
        }),
      ],
    }),
  );

  // Time
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: opts.startTime,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.label,
          color: DOCX_TOKENS.ink,
        }),
      ],
    }),
  );

  // ❖ ornament — tightened bottom spacing to leave room for the
  // event-details block that now lives in the same section (Phase X).
  out.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 80 },
      children: [
        new TextRun({
          text: '❖',
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.h2,
          color: DOCX_TOKENS.gold,
        }),
      ],
    }),
  );

  return out;
}

/**
 * Compose the SB + Gamos brand block as a 2-cell no-border table.
 * Each cell carries the logo image + its own wordmark stack (brand line +
 * tagline). When only `sbBytes` is present, returns a single-cell variant.
 *
 * Cell order in the DOM is [SB, Gamos]; under `bidiVisual: true` this maps
 * visually to "SB right, Gamos left" — Hebrew reading order.
 */
function buildLogoBrandTable(opts: {
  sbBytes: Uint8Array | null;
  gamosBytes: Uint8Array | null;
}): Table {
  const cellPlans: Array<{
    logoBytes: Uint8Array;
    logoWidth: number;
    logoHeight: number;
    brand: string;
    tagline: string;
  }> = [];

  if (opts.sbBytes) {
    cellPlans.push({
      logoBytes: opts.sbBytes,
      logoWidth: IMG_DIM.logoSb.width,
      logoHeight: IMG_DIM.logoSb.height,
      brand: 'שון בלאיש',
      tagline: 'הפקות',
    });
  }
  if (opts.gamosBytes) {
    cellPlans.push({
      logoBytes: opts.gamosBytes,
      logoWidth: IMG_DIM.logoGamos.width,
      logoHeight: IMG_DIM.logoGamos.height,
      brand: 'גאמוס',
      tagline: 'אירועים',
    });
  }

  // 50/50 if both, otherwise full-width.
  const cellWidthPct = cellPlans.length === 2 ? 50 : 100;
  const cells = cellPlans.map((plan) =>
    buildBrandCell({ ...plan, widthPct: cellWidthPct }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        height: { value: convertInchesToTwip(1.4), rule: HeightRule.AUTO },
        // `cantSplit` keeps the brand block on one page if the row would
        // otherwise straddle a page break.
        cantSplit: true,
        children: cells,
      }),
    ],
  });
}

/**
 * Build one brand cell: logo image (centered) + brand line + tagline.
 */
function buildBrandCell(opts: {
  logoBytes: Uint8Array;
  logoWidth: number;
  logoHeight: number;
  brand: string;
  tagline: string;
  widthPct: number;
}): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    width: { size: opts.widthPct, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            data: opts.logoBytes,
            transformation: {
              width: opts.logoWidth,
              height: opts.logoHeight,
            },
          }),
        ],
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: opts.brand,
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.serif,
            size: SIZE.label,
            color: DOCX_TOKENS.gold,
            bold: true,
          }),
        ],
      }),
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: opts.tagline,
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.sans,
            size: SIZE.small,
            color: DOCX_TOKENS.goldMuted,
            allCaps: true,
          }),
        ],
      }),
    ],
  });
}

/**
 * Build a section header (eyebrow + title + gold hairline).
 * Layout:
 *   "SECTION" (Heebo 9pt UPPERCASE TRACKED gold)
 *   "כותרת" (Frank Ruhl 18pt bold ink)
 *   ━━━━━ (gold hairline)
 */
export function sectionHeader(eyebrow: string, title: string): Paragraph[] {
  // Maintenance Log 2026-05-26: flipped to CENTER per the editorial-magazine
  // target. `bidirectional: true` preserves Hebrew shaping; only the
  // paragraph block centres on the page.
  return [
    // Eyebrow
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({
          text: eyebrow,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.sans,
          size: SIZE.small,
          color: DOCX_TOKENS.goldMuted,
          allCaps: true,
        }),
      ],
    }),
    // Title
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: title,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.h2,
          color: DOCX_TOKENS.ink,
          bold: true,
        }),
      ],
    }),
    // Gold hairline
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      border: {
        bottom: {
          color: DOCX_TOKENS.goldHairline,
          space: 4,
          style: BorderStyle.SINGLE,
          size: 4,
        },
      },
      spacing: { after: 120 },
    }),
  ];
}

/**
 * Build a field list (label: value pairs as simple Paragraphs).
 * Simpler than a Table for inline RTL bidi text. Each row is a paragraph with
 * inline TextRuns: label (gold) + separator + value (dark ink).
 */
export function fieldTable(
  rows: { label: string; value: string }[],
): Paragraph[] {
  // Maintenance Log 2026-05-26: flipped to CENTER per the editorial-magazine
  // target. Each row stays as a label + value paragraph (not an actual
  // table); the centred paragraph block lays the pairs out under the
  // section header in a single column.
  return rows.map(
    (r) =>
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: `${r.label}: `,
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.serif,
            size: SIZE.body,
            color: DOCX_TOKENS.goldMuted,
          }),
          new TextRun({
            text: r.value,
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.serif,
            size: SIZE.body,
            color: DOCX_TOKENS.ink,
          }),
        ],
      }),
  );
}

/**
 * Build a 2-column image grid (Paragraph[] containing images + captions).
 * Each item: { bytes, widthPx, heightPx, note }.
 * Layout: sequential paragraphs with images right-aligned + captions below.
 */
export function imageGrid2x(
  items: { bytes: Uint8Array; widthPx: number; heightPx: number; note: string }[],
): Paragraph[] {
  const paras: Paragraph[] = [];

  for (const item of items) {
    // Image paragraph — centred to match the editorial-magazine target.
    paras.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            data: item.bytes,
            transformation: {
              width: item.widthPx,
              height: item.heightPx,
            },
          }),
        ],
      }),
    );

    // Caption paragraph (if note exists)
    if (item.note.trim()) {
      paras.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 120 },
          children: [
            new TextRun({
              text: item.note,
              rightToLeft: true,
              font: DOCX_TOKENS.fonts.serif,
              size: SIZE.small,
              color: DOCX_TOKENS.goldMuted,
              italics: true,
            }),
          ],
        }),
      );
    }
  }

  return paras;
}

/**
 * Build a signature block (image + line + date).
 */
export function signatureBlock(opts: {
  signaturePngBytes: Uint8Array | null;
  dateDisplay: string;
}): Paragraph[] {
  const paras: Paragraph[] = [];

  // Maintenance Log 2026-05-26: every paragraph in the signature block is
  // centred to match the editorial-magazine target.
  if (opts.signaturePngBytes && opts.signaturePngBytes.byteLength > 0) {
    paras.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [
          new ImageRun({
            data: opts.signaturePngBytes,
            transformation: {
              width: IMG_DIM.signature.width,
              height: IMG_DIM.signature.height,
            },
          }),
        ],
      }),
    );
  }

  // Signature line
  paras.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 120 },
      border: {
        top: {
          color: DOCX_TOKENS.gold,
          space: 8,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      children: [
        new TextRun({
          text: 'חתימת הזוג: ____________________________',
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.body,
          color: DOCX_TOKENS.ink,
        }),
      ],
    }),
  );

  // Date stamp
  paras.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 80 },
      children: [
        new TextRun({
          text: 'תאריך חתימה: ' + opts.dateDisplay,
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.small,
          color: DOCX_TOKENS.goldMuted,
        }),
      ],
    }),
  );

  return paras;
}

/**
 * ❖ ornament divider (centered, gold).
 */
export function ornamentDivider(): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 100 },
    children: [
      new TextRun({
        text: '❖',
        font: DOCX_TOKENS.fonts.serif,
        size: SIZE.h2,
        color: DOCX_TOKENS.gold,
      }),
    ],
  });
}

