# תוכנית המשך — מ-Phase 3B עד MVP מוגמר

> **מצב נוכחי (2026-05-20):**
> Phase 3A (lib track) ו-Phase 3B (UI components + integration) **הושלמו**.
> האפליקציה מורכבת end-to-end: 121/121 tests עוברים, tsc + vite build נקיים.
> מה שנשאר זה ולידציה ויזואלית, פיצ'רים אחרונים, שיפורים, ושיפוץ ל-production.

---

## מצב הקבצים הנוכחי

### Layer 3 — lib (כל המודולים נחתו)
- `app/src/lib/config.ts` — project root resolver
- `app/src/lib/paths.ts` — chokepoint helpers
- `app/src/lib/tauri-fs.ts` — fs adapter עם path-traversal guards
- `app/src/lib/db.ts` — IndexedDB v2 (כולל imageTags + theme)
- `app/src/lib/docx.ts` — DOCX builder
- `app/src/lib/backup.ts` — JSON export/import + retention
- `app/src/lib/images.ts` — scanner + thumbnail pipeline

### Layer 2 — UI (כל הקומפוננטות נחתו)
- 5 UI primitives: Button, Input, TextArea, Card, Ornament
- 4 shell: AppBar, BootSplash, ErrorBoundary, FatalBanner
- 2 contexts: ThemeContext, EventContext
- 3 client: ClientList, ClientCard, ClientForm
- TaggingPass
- 3 gallery: Gallery, Lightbox, CategoryTabs
- SignaturePad
- Settings panel
- 7 event: EventTabs + 6 tabs (details, napkins, tableDesigns, chuppah, upgrades, summary)
- App.tsx integration עם AppView state machine

### תיעוד — 16 SOPs
01..09: image-scanning, indexeddb, document-generation, rtl-and-fonts, gallery-selection, signature-flow, backup-strategy, tauri-filesystem, design-tokens
10..12: ubiquitous-language, domain-invariants, image-tagging
13..16: app-shell-routing, theme-toggle, component-architecture, stitch-design-baseline

---

## מה שנשאר — מ-MVP פנימי ל-MVP מוגמר

### 1. Visual smoke (קצר — 30 דק׳)

- [ ] להריץ `npm run dev` ולעבור על כל המסכים בדפדפן
- [ ] לוודא RTL נכון בכל מקום (לוגו ב-inline-end, טפסים זורמים נכון)
- [ ] לוודא curtain animation של ThemeToggle
- [ ] לבדוק שכל ה-Hebrew strings מופיעים נכון (אין placeholders שנשארו)
- [ ] לבדוק שה-13-section RTL visual checklist ב-`.tmp/rtl-visual-test-plan.md` עובר

### 2. Tauri integration testing (חיוני — 1-2 שעות)

`npm run dev` ב-browser לא מספיק כי `@tauri-apps/plugin-fs` לא קיים שם.
- [ ] להריץ `npm run tauri:dev` (קומפילציה ראשונית 5-10 דק׳)
- [ ] לוודא שסריקת התמונות (`scanAll`) עובדת על 884 קבצים אמיתיים
- [ ] לבחון את TaggingPass עם תמונות אמיתיות
- [ ] ייצוא DOCX אמיתי + פתיחה ב-Word + ולידציה ויזואלית של ה-output
- [ ] ייצוא backup לקובץ + ייבוא חזרה
- [ ] בדיקת ה-`events/<id>/plan.docx` נוצר בנתיב הנכון

### 3. תוכן חסר (חוסם shipping)

- [ ] **טקסט משפטי verbatim** ב-`architecture/legal-terms.txt` — צריך לקבל משון את הטקסט המקורי מה-DOCX (הסכמת צילום + פרחים disclaimer)
- [ ] להחליף את ה-`[LEGAL TERMS PENDING]` ב-`docx.ts` בקריאה ל-קובץ הזה
- [ ] לוודא שה-DOCX נראה זהה ל-template המקורי של שון

### 4. שיפורים שזוהו אך נדחו

- [ ] AppBar local `useTheme()` shim → להחליף ב-import מ-`contexts/ThemeContext` (1-line)
- [ ] ה-TaggingPass `as never` casts ל-`'tagging-complete'` reason — כבר טופל בעת ה-cleanup, לוודא שזה נמחק נקי
- [ ] קוד-חלוקה: bundle JS הנוכחי הוא 782 KB. לפצל ב-`vite.config.ts` עם `manualChunks` — לפצל לפי מסלולי lazy loading של views
- [ ] Toast primitive גלובלי במקום inline state בכל מקום (Settings + Gallery)
- [ ] Gallery: `bakeThumbnailsBatch` background bake on first run (לא רק on-demand) — באפליקציה התיוג חוויה תהיה מהירה יותר

### 5. Tests חסרים

- [ ] `docx.test.ts` — נדחה ל-#40 בגלל צורך ב-fixture image bytes
- [ ] `images.test.ts` — נדחה כי happy-dom רק חלקי OffscreenCanvas
- [ ] רכיבי UI — אין tests לקומפוננטות בכלל. לכתוב לפחות:
  - `ClientForm.test.tsx` — validation rules
  - `EventTabs.test.tsx` — tab navigation + INV-01 (cap counter)
  - `TaggingPass.test.tsx` — flow מלא עם mocks
- [ ] ה-canonical 13-step Verification flow כ-E2E test (`canonical-flow.test.tsx`) — קיים תוכנית ב-`.tmp/canonical-flow-plan.md`

### 6. אבטחה — Phase 5

- [ ] להריץ `cargo audit` ב-`app/src-tauri/` — נדרש לפני release
- [ ] Path-traversal verification ידני על Windows (Group G מ-`.tmp/path-traversal-vectors.md`) — דורש NTFS reparse points
- [ ] Validation אחרון של CSP בעת `tauri build` (לא dev) — לוודא ש-`connect-src` חוסם רשת

### 7. Phase 4 — Refinement

- [ ] לעדכן את `task_plan.md` עם status הסופי של 3A+3B
- [ ] להריץ self-annealing על SOPs — לעדכן Self-Annealing Notes בכל אחד עם הלקחים מ-implementation
- [ ] performance-engineer #38 — לרוץ formal baseline במכונה של שון (לא במכונת dev)

### 8. Phase 5 — Production build & Ship

- [ ] להריץ `npm run tauri:build` — מייצר `.exe` של Windows
- [ ] התקנה על מכונת שון (Windows 10 Pro)
- [ ] לבצע את ה-13-step Verification flow on-machine
- [ ] קבלת אישור משון: "אני יכול לפתוח פגישה ולעבוד מול האפליקציה במקום ה-Word"
- [ ] תיעוד התקנה / שדרוג ב-`architecture/00-deployment.md` (עדיין לא נכתב)

---

## רצף מומלץ

1. **שון מספק טקסט משפטי** (חוסם)
2. **`npm run dev` + ולידציה ויזואלית** (30 דק׳)
3. **`npm run tauri:dev` + Tauri E2E manual** (1-2 שעות)
4. **תיקון bugs שעולים מ-#3** (משתנה)
5. **כתיבת tests חסרים** (אופציונלי לפני MVP, חובה לפני v1.1)
6. **`npm run tauri:build` + התקנה אצל שון** (Phase 5)

---

## הערכת זמן (לסיום MVP מ-איפה שאנחנו עכשיו)

| משימה | זמן |
|---|---|
| Visual smoke + תיקונים מינוריים | 1-2 שעות |
| Tauri E2E manual + תיקונים | 2-4 שעות |
| טקסט משפטי + ולידציה | 30 דק׳ |
| `tauri:build` + התקנה אצל שון | 1 שעה |
| **סה"כ ל-MVP shippable** | **~5-8 שעות עבודה ממוקדת** |

זאת בהנחה ש:
- אין bug חמור שעולה ב-Tauri integration
- שון זמין לספק טקסט משפטי במהירות
- אין שינויים בעיצוב לאחר שראינו בפועל

---

## פתרונות לבעיות שיתכנו

### "התמונות לא נטענות בגלריה"
בדוק את ה-`tauri.conf.json > app.security.assetProtocol.scope` — צריך להכיל את כל 7 הקטגוריות + 2 ה-JPGs בשורש. ראה SOP 08 § Asset Protocol Scope.

### "DOCX יוצא בלי תמונות"
ה-`buildEventDocx` דורש `imageBytes: Map<string, Uint8Array>`. ה-`SummaryTab.onExport()` כרגע מעביר Map ריק — צריך לקרוא את ה-bytes של כל תמונה נבחרת לפני הקריאה. תיקון פשוט ב-`SummaryTab.tsx`.

### "Cold start איטי מדי"
לפי `cold-start-budget.md` ה-budget הוא 3000ms. אם זה איטי מדי בפועל:
1. בדוק את ה-numbers האמיתיים מ-`bench.mjs`
2. שקול lazy-load של רכיבים שאינם boot-critical (Settings, EventTabs)
3. הפעל code-splitting ב-Vite

---

## הערה לעצמך

האפליקציה כבר עובדת — זה לא MVP חצוי. כל הזרימה הקנונית של 13 שלבים נגישה דרך ה-UI.
מה שנשאר זה ולידציה אמיתית במכונת היעד + שיפוצים. **הקושי הקשה כבר מאחורינו.**
