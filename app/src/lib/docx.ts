// SOP: architecture/03-document-generation.md
// SOP: architecture/04-rtl-and-fonts.md
// SOP: architecture/11-domain-invariants.md (INV-01 cap @ 5 selections)
// Schema: claude.md § Data Schemas (LAW)
//
// Layer 3 — pure DOCX builder. Data in (DocxBuildInput) → Uint8Array out.
// No FS, no IndexedDB, no Date.now(); the only timestamp used (signedAt) comes
// from the input. Caller writes bytes to disk via tauriFsExtras.atomicWriteFile.
//
// This module's only allowed imports are 'docx' and '../types'. No React, no
// Tauri, no idb. The Constitution's Behavioral Rule #7 (zero external network)
// is upheld by the docx package being a pure JS library shipped via npm.
//
// Bidi pattern (canonical, per SOP 04):
//   - Document.styles.default sets every paragraph bidirectional + alignment
//     RIGHT and every run rightToLeft + Frank Ruhl Libre.
//   - Each Hebrew TextRun re-asserts rightToLeft: true so authoring intent is
//     explicit (Word's bidi resolver respects the run-level flag even if a
//     future style refactor flips a default).
//   - Mixed-bidi lines (Hebrew label + Latin date) are NOT manually segmented;
//     Word handles bidi natively. Verified by the L3v2 POC.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  TextRun,
  convertInchesToTwip,
  type IParagraphOptions,
} from 'docx';

import {
  type DocxBuildInput,
  type ImageSelection,
  LibError,
} from '../types';

// ---------------------------------------------------------------------------
// Luxury Editorial palette (SOP 03 § Color Palette)
// ---------------------------------------------------------------------------

const COLORS = {
  ink: '0F0E0C',
  cream: 'F5F0E8',
  gold: 'C9A961',
  goldDark: 'A88B47',
} as const;

const FONT_HEBREW = 'Frank Ruhl Libre';

// Sizes are in half-points (docx convention): 22 → 11pt, 28 → 14pt, etc.
const SIZE = {
  body: 22,
  small: 18,
  label: 18,
  sectionHead: 28,
  coupleHeadline: 44,
  pageTitle: 56,
} as const;

// Image transformations in points (1pt ≈ 1/72in). Sizes per task brief.
const IMG_DIM = {
  logo: { width: 100, height: 100 },
  designSelection: { width: 250, height: 180 },
  signature: { width: 200, height: 60 },
} as const;

// Maximum table-design selections (INV-01).
const MAX_TABLE_DESIGN_SELECTIONS = 5;

// Verbatim legal block. Until architect populates `architecture/legal-terms.txt`
// with the original DOCX text, the placeholder ships verbatim — never
// fabricated paragraphs. See task #13 progress entry + task brief constraint
// "Do not invent legal text".
const LEGAL_TERMS_VERBATIM = '[LEGAL TERMS PENDING]';

// Whitelist of chuppah type literals (INV-08). The schema constrains this at
// compile time; the runtime guard exists for backup-restore where input is
// untrusted.
const CHUPPAH_TYPE_LITERALS = new Set([
  'מרובעת',
  'עגולה',
  'שקופה',
  'אובלית',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a `.docx` for the given client + event.
 *
 * Pure: no filesystem, no DB, no network, no `Date.now()`. The caller is
 * responsible for writing the returned bytes to
 * `events/<event-id>/plan.docx` via the tauri-fs atomic write helper.
 *
 * Throws `LibError` with code:
 *   - `DOCX_IMAGE_EMBED` if an `ImageSelection.imagePath` referenced from
 *     `event.tableDesignSelections` or `event.chuppah.designSelections` is not
 *     present in `input.imageBytes`. We never silently skip a chosen image.
 *   - `DOCX_BUILD` for any other failure (Packer errors, malformed input).
 */
export async function buildEventDocx(
  input: DocxBuildInput,
): Promise<Uint8Array> {
  try {
    assertInput(input);

    const children: Paragraph[] = [];

    // 1. Header (logo) — embedded inline at the top of the body. SOP 03 puts
    //    the brand block at the top; we prefer an inline image (when provided)
    //    over a true Word "Header" because inline is simpler, prints
    //    identically, and doesn't require a Header reference id.
    if (input.logoPngBytes && input.logoPngBytes.byteLength > 0) {
      children.push(buildLogoParagraph(input.logoPngBytes));
    }
    children.push(brandWordmark());
    children.push(brandTagline());
    children.push(divider());

    // 2. Title + couple block
    children.push(pageTitle('תכנון אירוע'));
    children.push(ornament());
    children.push(rtlPara({
      spacing: { after: 60 },
      children: [labelRun('שמות בני הזוג', SIZE.label)],
    }));
    children.push(rtlPara({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: input.client.coupleNames,
          rightToLeft: true,
          font: FONT_HEBREW,
          size: SIZE.coupleHeadline,
          color: COLORS.ink,
          bold: true,
        }),
      ],
    }));
    children.push(divider());

    // 3. Event details
    children.push(sectionHeading('פרטי האירוע'));
    children.push(fieldRow('תאריך', formatIsoDate(input.event.date)));
    children.push(fieldRow('יום', input.event.dayOfWeek));
    children.push(fieldRow('שעת תחילה', input.event.startTime));
    children.push(fieldRow('לוקיישן', input.event.location));
    // Numbers are rendered as natural digits inside the bidi paragraph; Word's
    // bidi resolver keeps `350` reading L→R inside an RTL line.
    children.push(fieldRow('כמות מוזמנים', String(input.event.guestCount)));
    children.push(fieldRow('אירוע מעורב', input.event.isMixed ? 'כן' : 'לא'));
    if (input.event.notes && input.event.notes.trim().length > 0) {
      children.push(rtlPara({
        spacing: { before: 100, after: 80 },
        children: [
          labelRun('הערות:  ', SIZE.label),
          valueRun(input.event.notes, SIZE.body),
        ],
      }));
    }
    children.push(divider());

    // 4. Napkins
    children.push(sectionHeading('מפות ומפיות'));
    children.push(fieldRow('צבע מפיות', input.event.napkins.color));
    children.push(fieldRow('סוג בד', input.event.napkins.fabric));
    children.push(fieldRow('סוג קיפול', input.event.napkins.foldType));
    // INV-04: when color === 'אחר', render the free-text witness explicitly so
    // a venue ordering napkins always sees the detail. The witness lives in
    // foldType (preferred) or falls back to event.notes.
    if (input.event.napkins.color === 'אחר') {
      const witness =
        (input.event.napkins.foldType && input.event.napkins.foldType.trim()) ||
        (input.event.notes && input.event.notes.trim()) ||
        '';
      if (witness.length > 0) {
        children.push(rtlPara({
          spacing: { after: 80 },
          children: [
            labelRun('פירוט צבע מותאם:  ', SIZE.label),
            valueRun(witness, SIZE.body),
          ],
        }));
      }
    }
    children.push(divider());

    // 5. Reception (only when at-resort)
    if (input.event.reception.atResort) {
      children.push(sectionHeading('קבלת פנים'));
      children.push(rtlPara({
        spacing: { after: 240 },
        children: [valueRun('מתקיימת בריזורט (למעלה)', SIZE.body)],
      }));
      children.push(divider());
    }

    // 6. Table design selections (cap at 5 — INV-01)
    if (input.selections.tableDesigns.length > 0) {
      children.push(sectionHeading('עיצובי שולחן'));
      const cappedDesigns = input.selections.tableDesigns.slice(
        0,
        MAX_TABLE_DESIGN_SELECTIONS,
      );
      cappedDesigns.forEach((sel, idx) => {
        children.push(...buildSelectionBlock(sel, idx + 1, input.imageBytes, IMG_DIM.designSelection));
      });
      children.push(divider());
    }

    // 7. Chairs
    children.push(sectionHeading('כיסאות'));
    children.push(fieldRow('סוג כיסאות', input.event.chairs.type));
    if (input.event.chairs.bridalChair && input.event.chairs.bridalChair.trim().length > 0) {
      children.push(fieldRow('כיסא כלה', input.event.chairs.bridalChair));
    }
    children.push(divider());

    // 8. Chuppah
    children.push(sectionHeading('חופה'));
    if (!CHUPPAH_TYPE_LITERALS.has(input.event.chuppah.type)) {
      // INV-08: persisted Hebrew literals must remain Hebrew. Defensive only —
      // the union type prevents this at compile time.
      throw new LibError(
        `Unknown chuppah type literal: "${input.event.chuppah.type}"`,
        { code: 'DOCX_BUILD' },
      );
    }
    children.push(fieldRow('סוג חופה', input.event.chuppah.type));
    children.push(fieldRow('מיקום', input.event.chuppah.location));
    if (input.event.chuppah.fabricDetails && input.event.chuppah.fabricDetails.trim().length > 0) {
      children.push(fieldRow('בדים', input.event.chuppah.fabricDetails));
    }
    if (input.selections.chuppah.length > 0) {
      input.selections.chuppah.forEach((sel, idx) => {
        children.push(...buildSelectionBlock(sel, idx + 1, input.imageBytes, IMG_DIM.designSelection));
      });
    }
    if (input.event.chuppah.aisleDetails && input.event.chuppah.aisleDetails.trim().length > 0) {
      children.push(fieldRow('שדרה לחופה', input.event.chuppah.aisleDetails));
    }
    children.push(divider());

    // 9. Upgrades
    children.push(sectionHeading('שדרוגים'));
    if (input.event.upgrades.description && input.event.upgrades.description.trim().length > 0) {
      children.push(rtlPara({
        spacing: { after: 160 },
        children: [valueRun(input.event.upgrades.description, SIZE.body)],
      }));
    }
    // SOP 09 §6 ornament rule: the bullet glyph is the gold ❖, prefixed
    // verbatim because docx's `bullet` numbering style ships with a default
    // disc — we want the brand mark instead.
    input.event.upgrades.items
      .filter((item) => item && item.trim().length > 0)
      .forEach((item) => {
        children.push(rtlPara({
          spacing: { after: 80 },
          indent: { start: 360 },
          children: [
            new TextRun({
              text: '❖  ',
              rightToLeft: true,
              font: FONT_HEBREW,
              size: SIZE.body,
              color: COLORS.gold,
            }),
            valueRun(item, SIZE.body),
          ],
        }));
      });
    children.push(divider());

    // 10. Signature block (image + line + date stamp)
    children.push(sectionHeading('חתימה'));
    if (input.signature) {
      children.push(buildSignatureImageParagraph(input.signature.dataUrl));
    }
    children.push(rtlPara({
      spacing: { before: 60, after: 120 },
      border: {
        top: { color: COLORS.gold, space: 8, style: BorderStyle.SINGLE, size: 6 },
      },
      children: [
        new TextRun({
          text: 'חתימת הזוג: ____________________________',
          rightToLeft: true,
          font: FONT_HEBREW,
          size: SIZE.body,
          color: COLORS.ink,
        }),
      ],
    }));
    if (input.signature) {
      children.push(rtlPara({
        spacing: { before: 60, after: 80 },
        children: [
          new TextRun({
            text: 'תאריך חתימה: ' + formatEpochToDisplayDate(input.signature.signedAt),
            rightToLeft: true,
            font: FONT_HEBREW,
            size: SIZE.small,
            color: COLORS.goldDark,
          }),
        ],
      }));
    }

    // 11. Legal terms (verbatim — see LEGAL_TERMS_VERBATIM constant)
    children.push(divider());
    children.push(rtlPara({
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: 'תנאים',
          rightToLeft: true,
          font: FONT_HEBREW,
          size: SIZE.body,
          color: COLORS.gold,
          bold: true,
        }),
      ],
    }));
    children.push(rtlPara({
      spacing: { after: 240, line: 320 },
      children: [
        new TextRun({
          text: LEGAL_TERMS_VERBATIM,
          rightToLeft: true,
          font: FONT_HEBREW,
          size: SIZE.small,
          color: COLORS.ink,
        }),
      ],
    }));

    // ---- Document assembly ----
    const doc = new Document({
      creator: 'שון בלאיש - הפקות',
      title: `תכנון אירוע - ${input.client.coupleNames}`,
      description: 'מסמך תכנון אירוע',
      styles: {
        default: {
          document: {
            run: { font: FONT_HEBREW, rightToLeft: true },
            paragraph: { alignment: AlignmentType.RIGHT },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(0.8),
                right: convertInchesToTwip(0.9),
                bottom: convertInchesToTwip(0.8),
                left: convertInchesToTwip(0.9),
              },
              size: { orientation: PageOrientation.PORTRAIT },
            },
          },
          children,
        },
      ],
    });

    // Packer.toBlob is the browser-friendly path (no Buffer dependency). We
    // need a Uint8Array for the Tauri write API, so unwrap the Blob.
    const blob = await Packer.toBlob(doc);
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  } catch (err) {
    if (err instanceof LibError) throw err;
    throw new LibError(
      err instanceof Error ? `DOCX build failed: ${err.message}` : 'DOCX build failed',
      { code: 'DOCX_BUILD', cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function assertInput(input: DocxBuildInput): void {
  if (!input || !input.client || !input.event) {
    throw new LibError('DocxBuildInput missing client or event', {
      code: 'DOCX_BUILD',
    });
  }
  if (!input.imageBytes || typeof input.imageBytes.get !== 'function') {
    throw new LibError('DocxBuildInput.imageBytes must be a Map', {
      code: 'DOCX_BUILD',
    });
  }
  if (!input.selections || !Array.isArray(input.selections.tableDesigns) || !Array.isArray(input.selections.chuppah)) {
    throw new LibError('DocxBuildInput.selections malformed', {
      code: 'DOCX_BUILD',
    });
  }
}

function rtlPara(opts: IParagraphOptions): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    ...opts,
  });
}

function labelRun(text: string, size: number = SIZE.label): TextRun {
  return new TextRun({
    text,
    rightToLeft: true,
    font: FONT_HEBREW,
    size,
    color: COLORS.goldDark,
  });
}

function valueRun(text: string, size: number = SIZE.body): TextRun {
  return new TextRun({
    text,
    rightToLeft: true,
    font: FONT_HEBREW,
    size,
    color: COLORS.ink,
  });
}

function fieldRow(label: string, value: string): Paragraph {
  return rtlPara({
    spacing: { after: 80 },
    children: [labelRun(label + ':  ', SIZE.label), valueRun(value, SIZE.body)],
  });
}

function divider(): Paragraph {
  return rtlPara({
    border: {
      bottom: { color: COLORS.gold, space: 4, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { before: 120, after: 240 },
  });
}

function ornament(): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 200 },
    children: [
      new TextRun({
        text: '◆ ◆ ◆',
        font: FONT_HEBREW,
        size: SIZE.small,
        color: COLORS.gold,
      }),
    ],
  });
}

function sectionHeading(text: string): Paragraph {
  return rtlPara({
    spacing: { before: 120, after: 160 },
    children: [
      new TextRun({
        text,
        rightToLeft: true,
        font: FONT_HEBREW,
        size: SIZE.sectionHead,
        color: COLORS.gold,
        bold: true,
      }),
    ],
  });
}

function pageTitle(text: string): Paragraph {
  return rtlPara({
    spacing: { before: 120, after: 80 },
    children: [
      new TextRun({
        text,
        rightToLeft: true,
        font: FONT_HEBREW,
        size: SIZE.pageTitle,
        color: COLORS.ink,
        bold: true,
      }),
    ],
  });
}

function brandWordmark(): Paragraph {
  return rtlPara({
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: 'שון בלאיש',
        rightToLeft: true,
        font: FONT_HEBREW,
        size: 32,
        color: COLORS.ink,
        bold: true,
      }),
    ],
  });
}

function brandTagline(): Paragraph {
  return rtlPara({
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: 'הפקות',
        rightToLeft: true,
        font: FONT_HEBREW,
        size: SIZE.small,
        color: COLORS.gold,
      }),
    ],
  });
}

function buildLogoParagraph(logoPngBytes: Uint8Array): Paragraph {
  // Right-aligned logo per RTL editorial convention.
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 120 },
    children: [
      new ImageRun({
        data: logoPngBytes,
        transformation: { width: IMG_DIM.logo.width, height: IMG_DIM.logo.height },
      }),
    ],
  });
}

function buildSelectionBlock(
  selection: ImageSelection,
  index: number,
  imageBytes: Map<string, Uint8Array>,
  dim: { width: number; height: number },
): Paragraph[] {
  const bytes = imageBytes.get(selection.imagePath);
  if (!bytes || bytes.byteLength === 0) {
    throw new LibError(
      `Missing image bytes for selection: "${selection.imagePath}"`,
      { code: 'DOCX_IMAGE_EMBED', path: selection.imagePath },
    );
  }

  const block: Paragraph[] = [];

  // Caption row: "1. <imageName>" + optional italic notes.
  const captionChildren: TextRun[] = [
    new TextRun({
      text: `${index}.  `,
      rightToLeft: true,
      font: FONT_HEBREW,
      size: SIZE.body,
      color: COLORS.goldDark,
    }),
    valueRun(selection.imageName, SIZE.body),
  ];
  if (selection.notes && selection.notes.trim().length > 0) {
    captionChildren.push(
      new TextRun({
        text: '   — ' + selection.notes,
        rightToLeft: true,
        font: FONT_HEBREW,
        size: SIZE.small,
        color: COLORS.goldDark,
        italics: true,
      }),
    );
  }
  block.push(rtlPara({
    spacing: { before: 120, after: 80 },
    children: captionChildren,
  }));

  // Image row.
  block.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 160 },
    children: [
      new ImageRun({
        data: bytes,
        transformation: { width: dim.width, height: dim.height },
      }),
    ],
  }));

  return block;
}

function buildSignatureImageParagraph(dataUrl: string): Paragraph {
  // dataUrl is "data:image/png;base64,XXXX". Strip the prefix and decode.
  const bytes = decodeDataUrlPng(dataUrl);
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 240, after: 60 },
    children: [
      new ImageRun({
        data: bytes,
        transformation: {
          width: IMG_DIM.signature.width,
          height: IMG_DIM.signature.height,
        },
      }),
    ],
  });
}

function decodeDataUrlPng(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new LibError('Signature dataUrl missing payload separator', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }
  const header = dataUrl.slice(0, comma);
  if (!/^data:image\/png(;[^,]*)?$/i.test(header)) {
    throw new LibError('Signature dataUrl is not a PNG', {
      code: 'DOCX_IMAGE_EMBED',
    });
  }
  const b64 = dataUrl.slice(comma + 1);
  // `atob` is available in Tauri's WebView2 context (DOM lib in tsconfig).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Date helpers (no Date.now() — only deterministic conversions)
// ---------------------------------------------------------------------------

/** Convert ISO `yyyy-mm-dd` → display `dd.mm.yyyy`. */
function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Convert epoch ms → display `dd.mm.yyyy`. Pure (UTC-stable; the local-clock
 *  "today" used at signature time was already fixed in `signedAt`). */
function formatEpochToDisplayDate(epochMs: number): string {
  const d = new Date(epochMs);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}
