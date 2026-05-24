// SOP: claude.md § Data Schemas (ImageCategory, ImageTag)
// User directive 2026-05-24 — per-category vocabulary schema for tag-based
// gallery filtering and manual tagging UI.
//
// Layer 3 — pure deterministic library. Imports only from '../types'.
//
// Public surface:
//   • CATEGORY_SCHEMA — canonical per-category dimension definitions
//   • allowedLabelsFor(category) → Set<string>
//   • normalizeFabric(s) → string

import { type ImageCategory } from '../types';

// ===========================================================================
// Schema
// ===========================================================================

export type DimensionDef = {
  /** Dimension name (Hebrew), e.g. "צבע", "סוג", "סגנון", "פלטה" */
  name: string;
  /** Allowed values (Hebrew) for this dimension */
  values: readonly string[];
};

export type CategorySchemaEntry = {
  dimensions: readonly DimensionDef[];
};

export const CATEGORY_SCHEMA: Record<ImageCategory, CategorySchemaEntry> = {
  'מפות מפיות': {
    dimensions: [
      {
        name: 'צבע',
        values: [
          'ירוק זית',
          'ורוד',
          'זהב',
          'לבן',
          'שמנת',
          'שחור',
          'אפור',
          'כחול נייבי',
          'בורדו',
          'ברונזה',
          'סגול',
          'אדום',
          'כתום',
          'חום',
          'וורד עתיק',
          'נחושת',
          'פוקסיה',
          'טורקיז',
        ],
      },
      {
        name: 'בד',
        values: ['סטן', 'פנייה', 'פשתן'],
      },
      {
        name: 'תוכן צילום',
        values: ['קיפול בקרבת צלחת', 'פריסה כללית'],
      },
    ],
  },

  'חופות אולם גדול גאמוס': {
    dimensions: [
      {
        name: 'סוג',
        values: ['מרובעת', 'עגולה'],
      },
      {
        name: 'סגנון',
        values: ['זרים', 'שזיף', 'וילון נופל', 'קלאסי', 'מודרני'],
      },
    ],
  },

  'חופות ריזורט': {
    dimensions: [
      {
        name: 'סוג',
        values: ['מרובעת', 'עגולה'],
      },
      {
        name: 'סגנון',
        values: ['פרחים', 'וילון', 'מינימליסטי'],
      },
    ],
  },

  'חופות שידרוג': {
    dimensions: [
      {
        name: 'סוג',
        values: ['מרובעת', 'עגולה', 'שקופה'],
      },
      {
        name: 'סגנון',
        values: ['זרים', 'וילון', 'גלאם', 'רומנטי'],
      },
    ],
  },

  'אולם עיצוב בסיס 2026': {
    dimensions: [
      {
        name: 'אלמנט מרכזי',
        values: [
          'שנדליר',
          'פרחים',
          'נרות',
          'מפיות',
          'סידורי שולחן',
          'תפריט',
          'נוף כללי',
          'תאורה',
          'מרכז שולחן',
          'חנוכייה',
        ],
      },
      {
        name: 'דגם',
        values: [
          'קלאסי',
          'מודרני',
          'רומנטי',
          'גלאם',
          'מינימליסטי',
          'וינטג\'',
          'פרחוני',
          'ניטרלי',
        ],
      },
    ],
  },

  'עיצובים שידרוג': {
    dimensions: [
      {
        name: 'פלטה',
        values: [
          'זהב',
          'נחושת',
          'ורוד-וזהב',
          'שחור-לבן',
          'ירוק-עץ',
          'פסטל',
          'מטאלי',
        ],
      },
      {
        name: 'אלמנט בולט',
        values: ['תקרת פרחים', 'מסלול', 'במה', 'אקווה', 'תקרת בדים', 'קרקע אורגנית'],
      },
    ],
  },

  'ריזורט בסיס': {
    dimensions: [
      {
        name: 'צבע דומיננטי',
        values: [
          'ירוק',
          'כחול',
          'לבן',
          'שמנת',
          'זהב',
          'ורוד',
          'אפור',
          'כחול נייבי',
          'שחור',
          'בורדו',
          'אדום',
          'חום',
          'סגול',
          'טורקיז',
          'נחושת',
        ],
      },
      {
        name: 'תוכן צילום',
        values: ['חופה', 'שולחן', 'מסלול', 'מבט אווירי'],
      },
    ],
  },

  'כיסא כלה': {
    dimensions: [
      {
        name: 'מיקום',
        values: ['בחוץ', 'באולם'],
      },
    ],
  },
};

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the set of allowed labels for the given category (union of all
 * dimension values). Useful for validating auto-tag output or filtering
 * existing customLabels against the canonical vocabulary.
 */
export function allowedLabelsFor(cat: ImageCategory): Set<string> {
  const set = new Set<string>();
  for (const dim of CATEGORY_SCHEMA[cat].dimensions) {
    for (const v of dim.values) set.add(v);
  }
  return set;
}

/**
 * Normalize fabric alias "פניה" → "פנייה". The user's napkin form input
 * predates the schema and writes "פניה". The auto-tag filename dictionary
 * already spelled it correctly; this function unifies the two sources when
 * reading legacy event data.
 */
export function normalizeFabric(s: string): string {
  if (s === 'פניה') return 'פנייה';
  return s;
}

// ===========================================================================
// Exhaustiveness assertion (mirrors INV-06 from types/index.ts)
// ===========================================================================

type _AssertExhaustive = Record<ImageCategory, CategorySchemaEntry>;
const _check: _AssertExhaustive = CATEGORY_SCHEMA;
void _check;
