// SOP: claude.md § Data Schemas (LAW)
// SOP: architecture/01-image-scanning.md § ImageMetadata
// SOP: architecture/03-document-generation.md § DocxBuildInput
//
// Single source of truth for the project's TypeScript domain types.
// This module is imported by every layer (lib, contexts, components).
// It MUST NOT import anything from `react`, `framer-motion`, or any UI lib.

// =============================================================================
// Image library
// =============================================================================

export type ImageCategory =
  | 'אולם עיצוב בסיס 2026'
  | 'חופות אולם גדול גאמוס'
  | 'חופות ריזורט'
  | 'חופות שידרוג'
  | 'מפות מפיות'
  | 'עיצובים שידרוג'
  | 'ריזורט בסיס'
  | 'כיסא כלה';

export const IMAGE_CATEGORIES: readonly ImageCategory[] = [
  'אולם עיצוב בסיס 2026',
  'חופות אולם גדול גאמוס',
  'חופות ריזורט',
  'חופות שידרוג',
  'מפות מפיות',
  'עיצובים שידרוג',
  'ריזורט בסיס',
  'כיסא כלה',
] as const;

// SOP 11 § INV-06: exhaustiveness assertion. Drift between the union and the
// runtime array would otherwise slip past tsc. If a category is added/removed
// in one place but not the other, this line fails to compile.
type _AssertImageCategoriesExhaustive =
  Exclude<ImageCategory, (typeof IMAGE_CATEGORIES)[number]> extends never
    ? Exclude<(typeof IMAGE_CATEGORIES)[number], ImageCategory> extends never
      ? true
      : never
    : never;
const _imageCategoriesExhaustive: _AssertImageCategoriesExhaustive = true;
void _imageCategoriesExhaustive;

export type MediaKind = 'image' | 'video';

export type ImageFileType = 'jpg' | 'jpeg' | 'png' | 'webp' | 'mp4' | 'mov';

export type ImageMetadata = {
  /** POSIX-style relative path, e.g. "אולם עיצוב בסיס 2026/שנדליר ורסאצה.JPG" */
  path: string;
  /** Filename without extension, displayable */
  name: string;
  category: ImageCategory;
  kind: MediaKind;
  fileType: ImageFileType;
  sizeBytes: number;
  /** Epoch ms */
  modifiedAt: number;
};

export type ImageSelection = {
  /** Path relative to image root (matches `ImageMetadata.path`) */
  imagePath: string;
  category: ImageCategory;
  /** Displayable filename */
  imageName: string;
  /** Free-text, e.g. "בצבע זהב" */
  notes: string;
  /** Epoch ms */
  selectedAt: number;
};

// =============================================================================
// User-supplied image tags (SOP 12)
//
// Captured exactly once during the one-time Image Tagging Pass on first launch.
// Persisted to IndexedDB store `imageTags` (key=imagePath). The pass is gated
// by `meta.taggingComplete` (MetaKey); once true, the pass is unreachable.
// See: claude.md § Behavioral Rules #11, claude.md § Data Schemas (ImageTag),
//      architecture/12-image-tagging.md.
// =============================================================================

export type ImageTag = {
  /** FK -> ImageMetadata.path; primary key in the imageTags store */
  imagePath: string;
  /** Picked from the existing 8 IMAGE_CATEGORIES; optional — Shon may use only customLabels */
  userCategory?: ImageCategory;
  /** Free-text labels Shon typed (Hebrew); chip-style multi-label */
  customLabels: string[];
  /** Free-text notes (Hebrew) */
  notes: string;
  /** Epoch ms — set by db.ts at write time, never by callers */
  taggedAt: number;
};

// =============================================================================
// Client + Event (persisted to IndexedDB)
// =============================================================================

export type Client = {
  /** uuid v4 */
  id: string;
  /** "שמות בני הזוג" — single combined field, matches the original DOCX */
  coupleNames: string;
  /** נייד */
  phone: string;
  /** אימייל (אופציונלי, לעתיד) */
  email?: string;
  /** Epoch ms */
  createdAt: number;
  updatedAt: number;
};

export type DayOfWeek =
  | 'ראשון'
  | 'שני'
  | 'שלישי'
  | 'רביעי'
  | 'חמישי'
  | 'שישי'
  | 'שבת';

export type EventLocation = 'גאמוס' | 'ריזורט' | (string & {});

export type NapkinColor = 'וורד עתיק' | 'פשתן' | 'אחר' | (string & {});
export type NapkinFabric = 'פניה' | 'סטן' | (string & {});

export type Napkins = {
  color: NapkinColor;
  fabric: NapkinFabric;
  /** Free-text */
  foldType: string;
  /**
   * Optional gallery selections for napkin/linen inspirations.
   * Added 2026-05-21 (Maintenance Log) to give every event tab a gallery
   * picker per the user's directive that the designer must browse images
   * and not just pick from canned color names. Optional for backward
   * compatibility with v1.0 events created before this field existed —
   * an absent field is treated as an empty array by the UI and by db.ts
   * normalization. There is no schema cap; the UI surfaces ∞.
   */
  designSelections?: ImageSelection[];
};

export type Reception = {
  /** קבלת פנים ריזורט - למעלה? */
  atResort: boolean;
};

export type ChairType = 'אבירים' | (string & {});

export type Chairs = {
  type: ChairType;
  /** פירוט כיסא כלה */
  bridalChair: string;
};

export type ChuppahLocation = 'בריכה' | 'אולם';
export type ChuppahType = 'מרובעת' | 'עגולה' | 'שקופה' | 'אובלית';

export type Chuppah = {
  location: ChuppahLocation;
  type: ChuppahType;
  /** "עם בדי וילון לבנים נשפכים" */
  fabricDetails: string;
  /** תמונות חופה נבחרות */
  designSelections: ImageSelection[];
  /** שדרה לחופה */
  aisleDetails: string;
};

export type Upgrades = {
  /** Free-text */
  description: string;
  /** Bullet points */
  items: string[];
  /**
   * Optional gallery selections for upgrade inspirations.
   * Added 2026-05-21 (Maintenance Log). Same backward-compatibility and
   * sizing rules as `Napkins.designSelections`.
   */
  designSelections?: ImageSelection[];
};

/**
 * A single ink stroke captured from `react-signature-canvas`. `points` is a
 * dense polyline in canvas-pixel space; `width` is the requested stroke width
 * (the SVG renderer drives the visible thickness from this value, but the
 * actual pen-pressure-derived widths are not preserved — re-tinting was the
 * only reason vector strokes were introduced, not pressure fidelity).
 *
 * Ratified 2026-05-21 (Maintenance Log) so signatures can re-color with the
 * active UI theme. Theme-reactive ink is a Behavioral Rule #12 corollary: the
 * couple's signature must remain visible when Shon flips dark↔light during a
 * meeting.
 */
export type SignatureStroke = {
  points: { x: number; y: number }[];
  width: number;
};

/**
 * Captured signature. Two storage shapes coexist (Maintenance Log 2026-05-21):
 *
 *   • `kind: 'png'` — legacy / read-only. The original `react-signature-canvas`
 *     toDataURL() output baked at capture time on a dark canvas with cream ink.
 *     Existing data in IndexedDB has NO `kind` field; readers MUST normalize
 *     `{ dataUrl, signedAt }` → `{ kind: 'png', dataUrl, signedAt }` on the
 *     way OUT (see `lib/db.ts.normalizeSignature`). No migration write is
 *     performed; old data stays old (Behavioral Rule "don't touch old data").
 *
 *   • `kind: 'vector'` — preferred for all NEW signatures. Strokes are stored
 *     verbatim from `react-signature-canvas.toData()`; render-time logic
 *     re-paints them with `currentColor` so the ink follows the theme. DOCX
 *     export rasterizes them to black-on-white per Behavioral Rule #13.
 */
export type Signature =
  | {
      kind: 'png';
      /** base64 PNG (`data:image/png;base64,…`) from `react-signature-canvas` */
      dataUrl: string;
      /** Epoch ms */
      signedAt: number;
    }
  | {
      kind: 'vector';
      /** Strokes in canvas-pixel space. Replays via SVG <polyline>/<path>. */
      strokes: SignatureStroke[];
      /** Capture-time canvas width (for re-render aspect ratio). */
      width: number;
      /** Capture-time canvas height. */
      height: number;
      /** Epoch ms */
      signedAt: number;
    };

export type EventStatus = 'draft' | 'signed' | 'completed';

export type Event = {
  /** uuid v4 */
  id: string;
  /** FK -> Client.id */
  clientId: string;
  /** ISO yyyy-mm-dd */
  date: string;
  dayOfWeek: DayOfWeek;
  /** "20:00" */
  startTime: string;
  location: EventLocation;
  guestCount: number;
  /** אירוע מעורב */
  isMixed: boolean;
  notes: string;

  napkins: Napkins;
  reception: Reception;
  /** עד 5 בחירות */
  tableDesignSelections: ImageSelection[];
  chairs: Chairs;
  chuppah: Chuppah;
  upgrades: Upgrades;
  signature: Signature | null;

  status: EventStatus;
  /** Epoch ms */
  createdAt: number;
  updatedAt: number;
};

// =============================================================================
// Filesystem provider (Layer 3 abstraction)
// SOP: architecture/01-image-scanning.md § Filesystem provider abstraction
// =============================================================================

export type FsDirEntry = {
  name: string;
  isFile: boolean;
};

export type FsStat = {
  size: number;
  /** Epoch ms */
  mtimeMs: number;
};

export type FsProvider = {
  readDir: (path: string) => Promise<FsDirEntry[]>;
  stat: (path: string) => Promise<FsStat>;
  readFile: (path: string) => Promise<Uint8Array>;
  /** Write bytes to disk (events/<id>/plan.docx, backups/, signature.png) */
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  /** Convert an absolute disk path to a URL the WebView can load */
  toFileSrc: (path: string) => string;
  /** mkdir -p */
  ensureDir: (path: string) => Promise<void>;
};

// =============================================================================
// Backup envelope (SOP: claude.md § Backup Policy, SOP 07, SOP 12)
//
// Bumped 1 → 2 on 2026-05-20 with the introduction of ImageTag[]. v1 backups
// remain importable: the importer fills `imageTags = []` and forces
// `meta.taggingComplete = false`, sending the user back through the SOP 12 pass.
// =============================================================================

export const BACKUP_SCHEMA_VERSION = 2 as const;

export type BackupEnvelope = {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  /** Epoch ms (consistent with Client/Event timestamps; ISO derivable for display). */
  exportedAt: number;
  clients: Client[];
  events: Event[];
  /** SOP 12: user-supplied tags captured during the one-time tagging pass. */
  imageTags: ImageTag[];
};

// =============================================================================
// DOCX builder input (SOP: architecture/03-document-generation.md)
// =============================================================================

export type DocxBuildInput = {
  client: Client;
  event: Event;
  selections: {
    tableDesigns: ImageSelection[];
    chuppah: ImageSelection[];
  };
  signature: Signature | null;
  /** Bytes for embedded images, keyed by `ImageSelection.imagePath` */
  imageBytes: Map<string, Uint8Array>;
  /** Contents of assets/logo.svg (rasterized PNG bytes preferred for embedding) */
  logoPngBytes?: Uint8Array;
};

// =============================================================================
// Structured errors
//
// Lib modules NEVER throw bare strings or Error("..."). They throw a
// `LibError` (or subclass) with a stable `code` so callers can branch.
// =============================================================================

export type LibErrorCode =
  // Filesystem
  | 'FS_READ_DIR'
  | 'FS_STAT'
  | 'FS_READ_FILE'
  | 'FS_WRITE_FILE'
  | 'FS_ENSURE_DIR'
  // Image library
  | 'IMG_NOT_FOUND'
  | 'IMG_CATEGORY_MISSING'
  | 'IMG_DECODE'
  | 'IMG_THUMBNAIL'
  // IndexedDB
  | 'DB_OPEN'
  | 'DB_TX'
  | 'DB_NOT_FOUND'
  | 'DB_CONFLICT'
  // DOCX
  | 'DOCX_BUILD'
  | 'DOCX_IMAGE_EMBED'
  // Backup
  | 'BACKUP_PARSE'
  | 'BACKUP_SCHEMA_MISMATCH'
  | 'BACKUP_WRITE'
  | 'BACKUP_RESTORE';

export type LibErrorDetails = {
  code: LibErrorCode;
  /** Optional path / id that the error pertains to */
  path?: string;
  id?: string;
  cause?: unknown;
};

export class LibError extends Error {
  readonly code: LibErrorCode;
  readonly path?: string;
  readonly id?: string;
  readonly cause?: unknown;

  constructor(message: string, details: LibErrorDetails) {
    super(message);
    this.name = 'LibError';
    this.code = details.code;
    this.path = details.path;
    this.id = details.id;
    this.cause = details.cause;
  }
}

// =============================================================================
// Filesystem layout constants (SOP: architecture/08-tauri-filesystem.md)
// =============================================================================
//
// PROJECT_ROOT is resolved at RUNTIME by `app/src/lib/config.ts`. It is NOT a
// compile-time constant because (a) on a fresh install on a different drive
// letter the hardcoded path would break boot, and (b) we want one chokepoint
// the security audit (#17) can validate.
//
// To get the absolute path of an event document or backup, use the helpers in
// `app/src/lib/paths.ts` (created in #10):
//   - `getEventDir(eventId)`        → "<root>/events/<eventId>"
//   - `getEventDocxPath(eventId)`   → "<root>/events/<eventId>/plan.docx"
//   - `getBackupsDir()`             → "<root>/backups"
//   - `getBackupPath(filename)`     → "<root>/backups/<filename>"

/** Subfolder where generated event documents live. Stable across installs. */
export const EVENTS_DIRNAME = 'events' as const;

/** Subfolder for rolling JSON backups. Stable across installs. */
export const BACKUPS_DIRNAME = 'backups' as const;

/** Filename of every generated DOCX inside `events/<id>/`. Stable. */
export const EVENT_DOCX_FILENAME = 'plan.docx' as const;

/** Default project root for first-run / development. Production reads from runtime config. */
export const DEFAULT_PROJECT_ROOT = 'C:/Users/sara/Desktop/שון בלאיש' as const;
