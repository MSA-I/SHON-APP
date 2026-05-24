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
  ImageRun,
  Paragraph,
  TextRun,
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
const IMG_DIM = {
  logo: { width: 150, height: 50 },
  logoMini: { width: 50, height: 17 },
  designSelection: { width: 300, height: 200 },
  signature: { width: 200, height: 60 },
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Header for body pages.
 * Layout: [logo mini left-aligned]  "שון בלאיש · הפקות" [right-aligned]
 * Gold hairline below the band.
 */
export function headerBand(logoPngBytes: Uint8Array | null): Header {
  const rows: Paragraph[] = [];

  // Logo + brand line (single RTL paragraph with both inline)
  const children: (TextRun | ImageRun)[] = [];
  if (logoPngBytes && logoPngBytes.byteLength > 0) {
    children.push(
      new ImageRun({
        data: logoPngBytes,
        transformation: {
          width: IMG_DIM.logoMini.width,
          height: IMG_DIM.logoMini.height,
        },
      }),
    );
    children.push(
      new TextRun({
        text: '  ',
        rightToLeft: true,
        font: DOCX_TOKENS.fonts.serif,
        size: SIZE.tiny,
      }),
    );
  }
  children.push(
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
      alignment: AlignmentType.RIGHT,
      spacing: { after: 60 },
      children,
    }),
  );

  // Gold hairline
  rows.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
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
 * Layout:
 *   [LOGO centered 300x100]
 *   "שון בלאיש" (Frank Ruhl 24pt gold)
 *   "הפקות" (Heebo 11pt tracked)
 *   ━━━━━ (gold hairline)
 *   [שמות בני הזוג — Frank Ruhl 36pt cream] (אבל DOCX כהה על בהיר per Rule #13)
 *   14.06.2026 · יום ראשון (Frank Ruhl 14pt)
 *   20:00 (Frank Ruhl 12pt)
 *   ❖ (gold ornament)
 *   --- page break ---
 */
export function coverHero(opts: {
  logoPngBytes: Uint8Array | null;
  coupleNames: string;
  dateDisplay: string;
  dayOfWeek: string;
  startTime: string;
}): Paragraph[] {
  const paras: Paragraph[] = [];

  // Logo centered
  if (opts.logoPngBytes && opts.logoPngBytes.byteLength > 0) {
    paras.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 120 },
        children: [
          new ImageRun({
            data: opts.logoPngBytes,
            transformation: {
              width: IMG_DIM.logo.width,
              height: IMG_DIM.logo.height,
            },
          }),
        ],
      }),
    );
  }

  // "שון בלאיש"
  paras.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'שון בלאיש',
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.serif,
          size: SIZE.label,
          color: DOCX_TOKENS.gold,
          bold: true,
        }),
      ],
    }),
  );

  // "הפקות" (uppercase tracked)
  paras.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'הפקות',
          rightToLeft: true,
          font: DOCX_TOKENS.fonts.sans,
          size: SIZE.small,
          color: DOCX_TOKENS.goldMuted,
          allCaps: true,
        }),
      ],
    }),
  );

  // Gold hairline
  paras.push(
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
      spacing: { after: 120 },
    }),
  );

  // Couple names (headline — Behavioral Rule #13: dark ink on white, NOT cream)
  paras.push(
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
  paras.push(
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
  paras.push(
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

  // ❖ ornament
  paras.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 200 },
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

  // No PageBreak here — Section boundaries handle page transitions
  return paras;
}

/**
 * Build a section header (eyebrow + title + gold hairline).
 * Layout:
 *   "SECTION" (Heebo 9pt UPPERCASE TRACKED gold)
 *   "כותרת" (Frank Ruhl 18pt bold ink)
 *   ━━━━━ (gold hairline)
 */
export function sectionHeader(eyebrow: string, title: string): Paragraph[] {
  return [
    // Eyebrow
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
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
      alignment: AlignmentType.RIGHT,
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
      alignment: AlignmentType.RIGHT,
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
  return rows.map(
    (r) =>
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
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
    // Image paragraph
    paras.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
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
          alignment: AlignmentType.RIGHT,
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

  if (opts.signaturePngBytes && opts.signaturePngBytes.byteLength > 0) {
    paras.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
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
      alignment: AlignmentType.RIGHT,
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
      alignment: AlignmentType.RIGHT,
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

