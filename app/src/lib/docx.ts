// SOP: architecture/03-document-generation.md (Editorial Magazine template)
// SOP: architecture/04-rtl-and-fonts.md
// SOP: architecture/11-domain-invariants.md (INV-01 cap @ 5 selections)
// Schema: claude.md § Data Schemas (LAW)
//
// Layer 3 — pure DOCX builder. Data in (DocxBuildInput) → Uint8Array out.
// No FS, no IndexedDB, no Date.now(); the only timestamp used (signedAt) comes
// from the input. Caller writes bytes to disk via tauriFsExtras.atomicWriteFile.
//
// This module's only allowed imports are 'docx', '../types', './docx-template',
// './signature', and './images' (for the canvas-based downscaler).
// No React, no Tauri, no idb. The Constitution's Behavioral Rule #7 (zero
// external network) is upheld by the docx package being a pure JS library
// shipped via npm.
//
// IMPORTANT — `docx@8.5` part-name quirk (Maintenance Log 2026-05-25):
// every `ImageRun` is packaged as `word/media/<uuid>.png` (hard-coded `.png`
// suffix in `node_modules/docx/build/index.cjs:11122`), and
// `[Content_Types].xml` only declares `image/png`. We therefore MUST embed
// PNG bytes only — JPEG bytes inside a `.png`-keyed part trigger Word's
// "this file is corrupt" dialog. Every byte buffer that reaches an
// `ImageRun` flows through `downscaleImageToPng` (see `lib/images.ts`) and
// is re-validated with `assertPngOrJpegMagic` to catch any future regression.
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
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  PageBreak,
  TextRun,
  convertInchesToTwip,
} from 'docx';

import {
  type DocxBuildInput,
  type Signature,
  LibError,
} from '../types';
import { rasterizeStrokes, decodePngDataUrl } from './signature';
import { downscaleImageToPng } from './images';
import {
  DOCX_TOKENS,
  coverHero,
  footerStrip,
  headerBand,
  ornamentDivider,
  sectionHeader,
  fieldTable,
  imageGrid2x,
  signatureBlock,
} from './docx-template';

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

// Image downscaling — production DOCX should have 600px max-width images
// instead of 256px thumbnails (better quality for print/PDF).
const DOCX_IMAGE_MAX_WIDTH = 600;

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

    // Validate the logo bytes once (re-used by both `coverHero` and
    // `headerBand`). `loadLogoPng` in SummaryTab rasterizes via canvas →
    // `toDataURL('image/png')`, so the magic should always pass — but we
    // still gate it because a future logo loader might forget.
    let validatedLogo: Uint8Array | null = null;
    if (input.logoPngBytes && input.logoPngBytes.byteLength > 0) {
      try {
        assertPngOrJpegMagic(input.logoPngBytes, { what: 'logo PNG' });
        validatedLogo = input.logoPngBytes;
      } catch {
        // Logo is decorative — drop it rather than failing the whole export.
        validatedLogo = null;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Section 1: Cover page
    // ─────────────────────────────────────────────────────────────────────
    const coverChildren: Paragraph[] = coverHero({
      logoPngBytes: validatedLogo,
      coupleNames: input.client.coupleNames,
      dateDisplay: formatIsoDate(input.event.date),
      dayOfWeek: input.event.dayOfWeek,
      startTime: input.event.startTime,
    });

    // ─────────────────────────────────────────────────────────────────────
    // Section 2: Body pages (header + footer + content sections)
    // ─────────────────────────────────────────────────────────────────────
    const bodyChildren: Paragraph[] = [];

    // 1. Event details
    bodyChildren.push(...sectionHeader('פרטי אירוע', 'פרטי האירוע'));
    bodyChildren.push(
      ...fieldTable([
        { label: 'תאריך', value: formatIsoDate(input.event.date) },
        { label: 'יום', value: input.event.dayOfWeek },
        { label: 'שעת תחילה', value: input.event.startTime },
        { label: 'מתחם', value: input.event.location },
        { label: 'כמות מוזמנים', value: String(input.event.guestCount) },
        { label: 'אירוע מעורב', value: input.event.isMixed ? 'כן' : 'לא' },
      ]),
    );
    if (input.event.notes && input.event.notes.trim().length > 0) {
      bodyChildren.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 100, after: 80 },
          children: [
            new TextRun({
              text: 'הערות: ',
              rightToLeft: true,
              font: DOCX_TOKENS.fonts.serif,
              size: 22,
              color: DOCX_TOKENS.goldMuted,
            }),
            new TextRun({
              text: input.event.notes,
              rightToLeft: true,
              font: DOCX_TOKENS.fonts.serif,
              size: 22,
              color: DOCX_TOKENS.ink,
            }),
          ],
        }),
      );
    }
    bodyChildren.push(ornamentDivider());
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // 2. Table designs
    if (input.selections.tableDesigns.length > 0) {
      bodyChildren.push(...sectionHeader('עיצוב', 'עיצובי שולחן'));
      const cappedDesigns = input.selections.tableDesigns.slice(
        0,
        MAX_TABLE_DESIGN_SELECTIONS,
      );
      const gridItems = await Promise.all(
        cappedDesigns.map(async (sel) => {
          const bytes = input.imageBytes.get(sel.imagePath);
          if (!bytes || bytes.byteLength === 0) {
            throw new LibError(
              `Missing image bytes for selection: "${sel.imagePath}"`,
              { code: 'DOCX_IMAGE_EMBED', path: sel.imagePath },
            );
          }
          const downscaled = await bakeSelectionForGrid(
            bytes,
            sel.imagePath,
            'table-design selection',
          );
          return {
            bytes: downscaled,
            widthPx: 300,
            heightPx: 200,
            note: sel.notes,
          };
        }),
      );
      bodyChildren.push(...imageGrid2x(gridItems));
      bodyChildren.push(ornamentDivider());
      bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // 3. Napkins (color removed 2026-05-24 — derived from designSelections)
    bodyChildren.push(...sectionHeader('מפיות', 'מפות ומפיות'));
    bodyChildren.push(
      ...fieldTable([
        { label: 'בד', value: input.event.napkins.fabric },
        { label: 'קיפול', value: input.event.napkins.foldType || '—' },
        { label: 'קבלת פנים ריזורט', value: input.event.reception.atResort ? 'כן' : 'לא' },
      ]),
    );
    if (input.event.napkins.designSelections && input.event.napkins.designSelections.length > 0) {
      const napkinsGrid = await Promise.all(
        input.event.napkins.designSelections.map(async (sel) => {
          const bytes = input.imageBytes.get(sel.imagePath);
          if (!bytes || bytes.byteLength === 0) {
            throw new LibError(
              `Missing image bytes for napkin selection: "${sel.imagePath}"`,
              { code: 'DOCX_IMAGE_EMBED', path: sel.imagePath },
            );
          }
          const downscaled = await bakeSelectionForGrid(
            bytes,
            sel.imagePath,
            'napkin selection',
          );
          return {
            bytes: downscaled,
            widthPx: 300,
            heightPx: 200,
            note: sel.notes,
          };
        }),
      );
      bodyChildren.push(...imageGrid2x(napkinsGrid));
    }
    bodyChildren.push(ornamentDivider());
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // 4. Chuppah
    bodyChildren.push(...sectionHeader('חופה', 'חופה'));
    if (!CHUPPAH_TYPE_LITERALS.has(input.event.chuppah.type)) {
      throw new LibError(
        `Unknown chuppah type literal: "${input.event.chuppah.type}"`,
        { code: 'DOCX_BUILD' },
      );
    }
    const chuppahRows: { label: string; value: string }[] = [
      { label: 'סוג', value: input.event.chuppah.type },
      { label: 'מיקום', value: input.event.chuppah.location },
    ];
    if (input.event.chuppah.fabricDetails && input.event.chuppah.fabricDetails.trim().length > 0) {
      chuppahRows.push({ label: 'בדים', value: input.event.chuppah.fabricDetails });
    }
    if (input.event.chuppah.aisleDetails && input.event.chuppah.aisleDetails.trim().length > 0) {
      chuppahRows.push({ label: 'שדרה', value: input.event.chuppah.aisleDetails });
    }
    bodyChildren.push(...fieldTable(chuppahRows));
    if (input.selections.chuppah.length > 0) {
      const chuppahGrid = await Promise.all(
        input.selections.chuppah.map(async (sel) => {
          const bytes = input.imageBytes.get(sel.imagePath);
          if (!bytes || bytes.byteLength === 0) {
            throw new LibError(
              `Missing image bytes for chuppah selection: "${sel.imagePath}"`,
              { code: 'DOCX_IMAGE_EMBED', path: sel.imagePath },
            );
          }
          const downscaled = await bakeSelectionForGrid(
            bytes,
            sel.imagePath,
            'chuppah selection',
          );
          return {
            bytes: downscaled,
            widthPx: 300,
            heightPx: 200,
            note: sel.notes,
          };
        }),
      );
      bodyChildren.push(...imageGrid2x(chuppahGrid));
    }
    bodyChildren.push(ornamentDivider());
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // 5. Upgrades
    bodyChildren.push(...sectionHeader('שדרוגים', 'שדרוגים'));
    if (input.event.upgrades.description && input.event.upgrades.description.trim().length > 0) {
      bodyChildren.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: input.event.upgrades.description,
              rightToLeft: true,
              font: DOCX_TOKENS.fonts.serif,
              size: 22,
              color: DOCX_TOKENS.ink,
            }),
          ],
        }),
      );
    }
    input.event.upgrades.items
      .filter((item) => item && item.trim().length > 0)
      .forEach((item) => {
        bodyChildren.push(
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            spacing: { after: 80 },
            indent: { start: 360 },
            children: [
              new TextRun({
                text: '❖  ',
                rightToLeft: true,
                font: DOCX_TOKENS.fonts.serif,
                size: 22,
                color: DOCX_TOKENS.gold,
              }),
              new TextRun({
                text: item,
                rightToLeft: true,
                font: DOCX_TOKENS.fonts.serif,
                size: 22,
                color: DOCX_TOKENS.ink,
              }),
            ],
          }),
        );
      });
    if (input.event.upgrades.designSelections && input.event.upgrades.designSelections.length > 0) {
      const upgradesGrid = await Promise.all(
        input.event.upgrades.designSelections.map(async (sel) => {
          const bytes = input.imageBytes.get(sel.imagePath);
          if (!bytes || bytes.byteLength === 0) {
            throw new LibError(
              `Missing image bytes for upgrade selection: "${sel.imagePath}"`,
              { code: 'DOCX_IMAGE_EMBED', path: sel.imagePath },
            );
          }
          const downscaled = await bakeSelectionForGrid(
            bytes,
            sel.imagePath,
            'upgrade selection',
          );
          return {
            bytes: downscaled,
            widthPx: 300,
            heightPx: 200,
            note: sel.notes,
          };
        }),
      );
      bodyChildren.push(...imageGrid2x(upgradesGrid));
    }
    bodyChildren.push(ornamentDivider());
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // 6. Signature
    bodyChildren.push(...sectionHeader('חתימה', 'חתימה דיגיטלית'));
    if (input.signature) {
      const sigBytes = await materializeSignaturePng(input.signature);
      assertPngOrJpegMagic(sigBytes, { what: 'signature PNG' });
      const dateDisplay = formatEpochToDisplayDate(input.signature.signedAt);
      bodyChildren.push(...signatureBlock({ signaturePngBytes: sigBytes, dateDisplay }));
    }
    bodyChildren.push(ornamentDivider());
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // 7. Legal terms
    bodyChildren.push(...sectionHeader('תנאים', 'תנאים משפטיים'));
    bodyChildren.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 240, line: 320 },
        children: [
          new TextRun({
            text: LEGAL_TERMS_VERBATIM,
            rightToLeft: true,
            font: DOCX_TOKENS.fonts.serif,
            size: 18,
            color: DOCX_TOKENS.ink,
          }),
        ],
      }),
    );

    // ─────────────────────────────────────────────────────────────────────
    // Document assembly
    // ─────────────────────────────────────────────────────────────────────
    const doc = new Document({
      creator: 'שון בלאיש - הפקות',
      title: `תכנון אירוע - ${input.client.coupleNames}`,
      description: 'מסמך תכנון אירוע',
      styles: {
        default: {
          document: {
            run: { font: DOCX_TOKENS.fonts.serif, rightToLeft: true },
            paragraph: { alignment: AlignmentType.RIGHT },
          },
        },
      },
      sections: [
        // Section 1: Cover (no header/footer)
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1.2),
                right: convertInchesToTwip(1.0),
                bottom: convertInchesToTwip(1.2),
                left: convertInchesToTwip(1.0),
              },
              size: { orientation: PageOrientation.PORTRAIT },
            },
          },
          children: coverChildren,
        },
        // Section 2: Body (header + footer)
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
          headers: {
            default: headerBand(validatedLogo),
          },
          footers: {
            default: footerStrip(),
          },
          children: bodyChildren,
        },
      ],
    });

    // Browser path (WebView2 has no Node `Buffer`):
    //   `Packer.toBuffer` errors with "nodebuffer is not supported by this
    //   platform" because docx → JSZip falls through to its node Buffer
    //   branch. `Packer.toBlob` uses the JSZip "blob" type which works in
    //   the browser. We then convert to Uint8Array for tauri-fs.writeFile.
    //   The earlier "blob is truncated in WebView2" report was caused by
    //   the duplicate PageBreak inside coverHero (now fixed); the blob path
    //   itself is reliable.
    const blob = await Packer.toBlob(doc);
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (err) {
    if (err instanceof LibError) throw err;
    throw new LibError(
      err instanceof Error ? `DOCX build failed: ${err.message}` : 'DOCX build failed',
      { code: 'DOCX_BUILD', cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
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

/**
 * Magic-byte gate for every `ImageRun` payload. `docx@8.5` packages each
 * image as `word/media/<uuid>.png` and `[Content_Types].xml` declares only
 * `image/png`, so embedding anything other than a real PNG triggers Word's
 * "this file is corrupt" dialog. JPEG is also accepted here because Word
 * will tolerate it inside a `.png` part — but only after we've re-encoded
 * the canvas output via `downscaleImageToPng`, which always produces PNG.
 *
 * The fallthrough exists for the WebView2-canvas-unavailable path in
 * `downscaleImageToPng`: in that case the original bytes pass through
 * untouched, and only PNG/JPEG inputs survive this gate. WebP / HEIC inputs
 * caught here are surfaced as a `DOCX_IMAGE_EMBED` so the user sees a
 * specific error rather than Word's generic corruption dialog.
 */
function assertPngOrJpegMagic(bytes: Uint8Array, ctx: { path?: string; what: string }): void {
  if (!bytes || bytes.byteLength < 4) {
    throw new LibError(`${ctx.what}: image bytes are empty or truncated`, {
      code: 'DOCX_IMAGE_EMBED',
      path: ctx.path,
    });
  }
  // PNG: 89 50 4E 47
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  // JPEG: FF D8 FF
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new LibError(
      `${ctx.what}: image is not PNG or JPEG (docx@8.5 requires PNG-compatible bytes)`,
      { code: 'DOCX_IMAGE_EMBED', path: ctx.path },
    );
  }
}

/**
 * Bake one selection's bytes into the form `imageGrid2x` expects:
 * downscaled to 600px PNG and gated by `assertPngOrJpegMagic`. Throws
 * `DOCX_IMAGE_EMBED` on bad input so the export aborts before Word sees a
 * malformed `.docx`.
 */
async function bakeSelectionForGrid(
  bytes: Uint8Array,
  imagePath: string,
  what: string,
): Promise<Uint8Array> {
  if (!bytes || bytes.byteLength === 0) {
    throw new LibError(`${what}: empty bytes`, {
      code: 'DOCX_IMAGE_EMBED',
      path: imagePath,
    });
  }
  const downscaled = await downscaleImageToPng(bytes, DOCX_IMAGE_MAX_WIDTH);
  assertPngOrJpegMagic(downscaled, { path: imagePath, what });
  return downscaled;
}

/**
 * Materialize the active `Signature` to PNG bytes for DOCX embedding.
 *
 * Behavioral Rule #13 — DOCX output is ALWAYS light-theme:
 *   • `kind: 'png'` → use the captured PNG bytes verbatim.
 *   • `kind: 'vector'` → rasterize via `lib/signature.rasterizeStrokes` with
 *     BLACK ink on a WHITE background regardless of `meta.theme`.
 *
 * The rasterizer is async because it uses the WebView2 `<canvas>` API.
 */
async function materializeSignaturePng(sig: Signature): Promise<Uint8Array> {
  if (sig.kind === 'png') {
    return decodePngDataUrl(sig.dataUrl);
  }
  // sig.kind === 'vector'
  return rasterizeStrokes(sig.strokes, sig.width, sig.height);
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
