# SOP 10 — Ubiquitous Language Glossary

> Authoritative Hebrew↔English vocabulary for the Shon Blaish event-design domain. Every code identifier, every UI label, every DOCX section traces back to a row in this table. **The schemas in `claude.md` are law; this SOP only documents the binding between the Hebrew the user speaks and the English the code uses.**
>
> **Update rule.** Add a row when a new domain term enters the Constitution. Never silently rename an identifier — if a term changes, update `claude.md`, then this SOP, then the code, in that order.

## Why this SOP exists

Shon and the couple speak Hebrew at the meeting. The codebase is English (TypeScript identifiers, file names, doc-strings). Without a locked glossary, two failure modes appear:

1. **Vocabulary drift in code.** A future contributor writes `bridalParty` instead of `coupleNames`, or `clearChuppah` instead of the literal `'שקופה'`, and the schema fragments.
2. **Translation drift in UI/DOCX.** A label says `שמות החתן והכלה` while the data model says `coupleNames` (which deliberately rejects the bride/groom split). The user notices the mismatch immediately.

This glossary is the single yardstick code review uses: **if a term is not in this table, it is not part of the domain.**

## Reading the table

- **Hebrew term** — what Shon says out loud. This is also the literal string value where the schema is a Hebrew union (e.g. `'וורד עתיק'`, `'מרובעת'`).
- **Code identifier** — the English name used in `app/src/types/index.ts`, `app/src/lib/*.ts`, and component props. Strings inside the code remain Hebrew where the schema mandates a Hebrew literal — only the *identifier* is English.
- **Definition** — one line that Shon would recognize as describing what they mean.
- **Where it appears** — schema field path · UI screen · DOCX section. This is the audit trail.
- **Forbidden synonyms** — names that **must not** appear in the codebase. Code review rejects them on sight.

---

## 1. Aggregate roots & top-level entities

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| לקוח | `Client` | A couple registered in the system (one record per couple, identified by phone). | Schema `Client` · ClientList screen · DOCX header block | `Customer`, `Couple` (as a type name), `User` |
| אירוע | `Event` | One wedding/Bar-Mitzvah engagement. Each `Client` may have many `Event`s. | Schema `Event` · Event tabs · DOCX body | `Wedding`, `Engagement`, `Booking`, `Job` |
| תמונה (בגלריה) | `ImageMetadata` | One discovered file in the on-disk library. Read-only — the app never mutates source images. | SOP 01 · `ImageMetadata` type · Gallery grid | `Photo`, `Asset`, `MediaItem`, `Picture` |
| בחירה | `ImageSelection` | A single image the couple picked for an event slot, with optional notes. | `Event.tableDesignSelections`, `Event.chuppah.designSelections` · Gallery selection · DOCX embedded images | `Pick`, `Choice`, `Favorite`, `Bookmark` |
| חתימה | `Signature` | The PNG produced by `react-signature-canvas` at meeting end. | `Event.signature` · Summary tab · DOCX signature line | `Autograph`, `Stamp`, `Seal` |
| גיבוי | `BackupEnvelope` | A point-in-time JSON snapshot of all Clients + Events. | SOP 07 · `BackupEnvelope` type · Settings panel | `Snapshot` (as type name — fine as a noun, but not as the code identifier), `Dump`, `Export` |

## 2. `Client` field-level vocabulary

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| שמות בני הזוג | `coupleNames` | Single combined string with both partners' names. **Deliberate single field, not split.** | `Client.coupleNames` · ClientForm · DOCX "שמות בני הזוג" row | `bridalParty`, `partners`, `brideName`, `groomName`, `partner1`, `partner2`, `names` |
| נייד | `phone` | Mobile number. Indexed in IndexedDB (`byPhone`). | `Client.phone` · ClientForm · `findClientByPhone` | `mobile`, `cellphone`, `tel`, `contactNumber` |
| אימייל | `email` | Optional email address. **Reserved for future use** — currently not a meeting input. | `Client.email` (optional) | `mail`, `emailAddress`, `contactEmail` |

## 3. `Event` field-level vocabulary — top of record

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| תאריך | `date` | ISO `yyyy-mm-dd`. The day the event takes place. | `Event.date` · EventDetailsTab · DOCX details block | `eventDate`, `weddingDate`, `when` |
| יום | `dayOfWeek` | Hebrew weekday literal: `'ראשון' \| 'שני' \| ... \| 'שבת'`. **Auto-derived from `date`** (invariant — see SOP 11 §3). | `Event.dayOfWeek` · EventDetailsTab (read-only display) · DOCX details block | `day`, `weekday`, `dow` |
| שעת תחילה | `startTime` | `"HH:MM"` (24h). | `Event.startTime` · EventDetailsTab · DOCX details block | `time`, `startsAt`, `eventTime`, `hour` |
| לוקיישן | `location` | Venue. Two canonical literals `'גאמוס' \| 'ריזורט'`; free-text fallback allowed. | `Event.location` · EventDetailsTab · DOCX details block | `venue`, `place`, `where`, `site` |
| כמות מוזמנים | `guestCount` | Integer headcount. | `Event.guestCount` · EventDetailsTab · DOCX details block | `attendees`, `guests`, `headcount`, `peopleCount` |
| אירוע מעורב | `isMixed` | Boolean. `true` = mixed-gender seating; `false` = separated. | `Event.isMixed` · EventDetailsTab · DOCX details block | `mixed`, `unisex`, `isUnseparated`, `coed` |
| הערות | `notes` | Free-text scratchpad on the event itself. | `Event.notes` · EventDetailsTab · DOCX details block | `comments`, `remarks`, `description`, `memo` |
| סטטוס | `status` | `'draft' \| 'signed' \| 'completed'`. State machine — see SOP 11 §2. | `Event.status` · everywhere | `state`, `phase`, `stage` |

## 4. `Napkins` block

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| מפות ומפיות | `Napkins` (block) | Tablecloth + napkin specification. | `Event.napkins` · NapkinsTab · DOCX napkins section | `Linens`, `TableLinen`, `Cloths` |
| צבע | `napkins.color` | Canonical literals `'וורד עתיק' \| 'פשתן' \| 'אחר'`; free-text fallback allowed. **`'אחר'` requires `foldType` or notes** (invariant — SOP 11 §4). | `Event.napkins.color` · NapkinsTab · DOCX napkins row | `napkinColor`, `clothColor` |
| וורד עתיק | `'וורד עתיק'` (literal) | Antique-rose color option. | `napkins.color` · NapkinsTab dropdown | `antiquePink`, `antique_rose`, `vintageRose` (these are forbidden as **code values**; the literal stays Hebrew) |
| פשתן | `'פשתן'` (literal) | Linen color option. | `napkins.color` · NapkinsTab dropdown | `linen` (as a code value) |
| אחר | `'אחר'` (literal) | "Other" — escape hatch with required free-text in `foldType` or event `notes`. | `napkins.color` · NapkinsTab dropdown | `other`, `custom`, `misc` (as code values) |
| בד | `napkins.fabric` | Canonical literals `'פניה' \| 'סטן'`; free-text fallback allowed. | `Event.napkins.fabric` · NapkinsTab · DOCX napkins row | `cloth`, `material`, `fabricType` |
| פניה | `'פניה'` (literal) | Faux-silk panné fabric. | `napkins.fabric` | `panne`, `fauxSilk` (as code values) |
| סטן | `'סטן'` (literal) | Satin fabric. | `napkins.fabric` | `satin` (as code value) |
| סוג קיפול | `foldType` | Free-text fold style description. | `Event.napkins.foldType` · NapkinsTab · DOCX napkins row | `fold`, `foldStyle`, `napkinFold` |

## 5. `Reception` block

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| קבלת פנים | `Reception` (block) | Pre-ceremony reception spec. | `Event.reception` · NapkinsTab (sub-section) · DOCX reception row | `Welcome`, `PreEvent`, `Cocktail` |
| קבלת פנים ריזורט - למעלה? | `reception.atResort` | Boolean. `true` = upstairs at the Resort; `false` = elsewhere. | `Event.reception.atResort` · NapkinsTab toggle · DOCX reception row | `upstairs`, `atVenue`, `isResort`, `topLevel` |

## 6. `tableDesignSelections` slot

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| עיצובי שולחן | `tableDesignSelections` | Up to 5 picked images describing the table styling. **Hard cap of 5** (invariant — SOP 11 §1). | `Event.tableDesignSelections` · TableDesignsTab · DOCX numbered 1..5 list | `tableStyles`, `tablePicks`, `centerpieces`, `tableLooks` |

## 7. `Chairs` block

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| כיסאות | `Chairs` (block) | Chair selection for the seated dinner. | `Event.chairs` · ChairsTab · DOCX chairs section | `Seats`, `Seating` |
| סוג כיסאות | `chairs.type` | Canonical literal `'אבירים'`; free-text fallback allowed. | `Event.chairs.type` · ChairsTab · DOCX chairs row | `chairType`, `seatType`, `chairModel` |
| אבירים | `'אבירים'` (literal) | "Knights" chair model. | `chairs.type` | `knights`, `knight_chair` (as code values) |
| כיסא כלה | `chairs.bridalChair` (free-text) **and** `'כיסא כלה'` (synthetic image category) | (a) Free-text description of the bridal chair styling. (b) The synthetic 8th `ImageCategory` that absorbs the 2 loose root JPGs (`כסא כלה בחוץ בסיס.jpg`, `כסא כלה בתוך האולם.jpg`). **Note the spelling distinction:** the field/text uses "כיסא" (with י); the source filenames use "כסא" (without י). The category label in the union is "כיסא כלה" — code that compares filenames must NFC-normalize but must not auto-correct the spelling drift. | `Event.chairs.bridalChair` · ChairsTab · DOCX chairs row · also `ImageCategory` value `'כיסא כלה'` · Gallery category chip | `brideChair`, `bridalSeat`, `kallahChair`, `bride_seat` |

## 8. `Chuppah` block

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| חופה | `Chuppah` (block) | The wedding canopy specification. | `Event.chuppah` · ChuppahTab · DOCX chuppah section | `Canopy`, `WeddingCanopy`, `Huppah` (alt transliteration — forbidden in code) |
| מיקום החופה | `chuppah.location` | Strict literals `'בריכה' \| 'אולם'`. | `Event.chuppah.location` · ChuppahTab · DOCX chuppah row | `chuppahLocation`, `where`, `placement` |
| בריכה | `'בריכה'` (literal) | "Pool" — outdoor poolside placement. | `chuppah.location` | `pool`, `outdoor`, `poolside` (as code values) |
| אולם | `'אולם'` (literal) | "Hall" — indoor hall placement. | `chuppah.location` | `hall`, `indoor` (as code values) |
| סוג החופה | `chuppah.type` | Strict literals `'מרובעת' \| 'עגולה' \| 'שקופה' \| 'אובלית'`. **No free-text fallback** — these are the *only* allowed shapes. | `Event.chuppah.type` · ChuppahTab · DOCX chuppah row | `chuppahType`, `shape`, `square \| round \| clear \| oval` (as code values — these would create a parallel English vocabulary; **forbidden**) |
| מרובעת | `'מרובעת'` (literal) | Square chuppah. | `chuppah.type` | `square` (as code value) |
| עגולה | `'עגולה'` (literal) | Round chuppah. | `chuppah.type` | `round`, `circular` (as code values) |
| שקופה | `'שקופה'` (literal) | Transparent / acrylic chuppah. | `chuppah.type` | `clear`, `transparent`, `acrylic`, `glass` (as code values) |
| אובלית | `'אובלית'` (literal) | Oval chuppah. | `chuppah.type` | `oval`, `ellipse` (as code values) |
| בדים | `chuppah.fabricDetails` | Free-text describing drapery. | `Event.chuppah.fabricDetails` · ChuppahTab · DOCX chuppah row | `drapes`, `curtains`, `linens` |
| תמונות חופה נבחרות | `chuppah.designSelections` | Picked images of chuppah designs. **No hard cap** but typically 1–3. | `Event.chuppah.designSelections` · ChuppahTab gallery · DOCX chuppah images | `chuppahPics`, `canopySelections` |
| שדרה לחופה | `chuppah.aisleDetails` | Free-text describing the aisle approach (e.g., gravel, runners). | `Event.chuppah.aisleDetails` · ChuppahTab · DOCX chuppah row | `aisle`, `walkway`, `path` |

## 9. `Upgrades` block

| Hebrew term | Code identifier | Definition | Where it appears | Forbidden synonyms |
|---|---|---|---|---|
| שדרוגים | `Upgrades` (block) | Optional add-ons described in free text + bullet list. **Descriptive only — no pricing logic** (Behavioral Rule #4). | `Event.upgrades` · UpgradesTab · DOCX upgrades section | `Addons`, `Extras`, `Premium`, `Bonuses` |
| תיאור שדרוגים | `upgrades.description` | Long-form free text. | `Event.upgrades.description` · UpgradesTab · DOCX upgrades section | `summary`, `text` |
| פריטי שדרוג | `upgrades.items` | `string[]` of bullet points. | `Event.upgrades.items` · UpgradesTab · DOCX upgrades bullets | `upgradesList`, `bullets`, `extras` |

## 10. `ImageCategory` literals

The 8 strict literals in `claude.md § ImageCategory`. **No English parallel vocabulary.** Code that switches on category does so over the Hebrew literals.

| Literal | Disk source | Notes |
|---|---|---|
| `'אולם עיצוב בסיס 2026'` | folder | Hall base designs, 26 images |
| `'חופות אולם גדול גאמוס'` | folder | Big-hall chuppahs at Gamos, 27+4 |
| `'חופות ריזורט'` | folder | Resort chuppahs, 27 |
| `'חופות שידרוג'` | folder | Premium chuppah upgrades, 24+2 |
| `'מפות מפיות'` | folder | Tablecloths & napkins, 520 |
| `'עיצובים שידרוג'` | folder | Premium design upgrades, 159+1 |
| `'ריזורט בסיס'` | folder | Resort base designs, 91+3 |
| `'כיסא כלה'` | **synthetic** — absorbs 2 loose root JPGs | Ratified 2026-05-20 (see `claude.md` Maintenance Log). The label uses "כיסא"; the underlying filenames use "כסא". |

**Forbidden:** any English alias (`hallBase2026`, `resortChuppahs`, `napkinsCategory`, …). The category is its Hebrew string. `IMAGE_CATEGORIES` (in `types/index.ts`) is the only allowed enumeration.

## 11. Cross-cutting nouns (status, kinds, paths)

| Hebrew term | Code identifier | Definition | Forbidden synonyms |
|---|---|---|---|
| טיוטה | `'draft'` (status literal) | An event still being edited. | `wip`, `inProgress`, `editing` |
| חתום | `'signed'` (status literal) | Couple has signed; auto-snapshot has been written. | `confirmed`, `locked`, `final` |
| הושלם | `'completed'` (status literal) | Manually marked done after the meeting. | `done`, `archived`, `closed` |
| תמונות (טאב) | `kind: 'image'` | The images sub-tab in a gallery view. | `pictures`, `photos` |
| וידאו (טאב) | `kind: 'video'` | The videos sub-tab; hidden when category has 0 videos. | `videos`, `clips`, `movies` |
| סוג קובץ | `fileType` | One of `'jpg' \| 'jpeg' \| 'png' \| 'webp' \| 'mp4' \| 'mov'`. | `extension`, `ext`, `format` |
| נתיב | `path` | POSIX-style relative path from project root. **Always relative**, never absolute, in `ImageMetadata`/`ImageSelection`. | `filepath`, `location`, `uri`, `url` |

## 12. Process verbs (used in lib + UI handlers)

| Hebrew term | Code identifier | Definition | Forbidden synonyms |
|---|---|---|---|
| לסרוק | `scanCategory` / `scanAll` | Walk a folder and emit `ImageMetadata[]`. | `index`, `discover`, `crawl` |
| לבחור / לבטל בחירה | `onToggleSelection` | Add or remove an `ImageSelection` from a slot. | `pick`, `choose`, `select` (as the toggling verb in code) |
| לחתום | (signature confirm handler) | Capture PNG → write to `Event.signature` → set `status='signed'` → trigger backup. | `sign`, `commit`, `finalize` (as the *handler* name; the literal status `'signed'` is canonical) |
| לייצא Word | `buildEventDocx` | Produce the `.docx` bytes from `DocxBuildInput`. | `generatePDF`, `exportDocument`, `renderDoc` |
| לייצא גיבוי | `exportBackup` | Write a JSON envelope to `backups/`. | `dumpBackup`, `saveBackup`, `snapshot` |
| לשחזר | `importBackup` | Read a JSON envelope and merge or overwrite IndexedDB. | `restore`, `loadBackup` (verbs) — `importBackup` is canonical |
| לאפס נתונים מקומיים | (Settings reset action) | Clear IndexedDB. Required by Verification step 9. | `wipe`, `clear`, `reset` (as a function name; the *button label* is the Hebrew phrase) |

---

## Forbidden vocabulary — quick-reject list

If any of these strings appears in `app/src/**`, code review rejects the patch:

```
bridalParty | partners | brideName | groomName | partner1 | partner2
square | round | clear | oval                    (as parallel chuppah type names)
antiquePink | linen | satin | panne              (as parallel napkin values)
hall | pool | indoor | outdoor                   (as parallel chuppah locations)
hallBase2026 | resortChuppahs | napkinsCategory  (as parallel image-category names)
Photo | Asset | MediaItem                        (as type aliases of ImageMetadata)
Customer | User                                  (as type aliases of Client)
Wedding | Booking | Job                          (as type aliases of Event)
Pick | Choice | Favorite | Bookmark              (as type aliases of ImageSelection)
```

This list is non-exhaustive; the **table is the source of truth**. If a term is not in §1–§12, it is not domain vocabulary.

## How to extend this glossary

1. The new term enters `claude.md` (Constitution) first — schema or Behavioral Rule.
2. Add a row to the relevant section here. Choose the code identifier *once* and lock it.
3. Open a forbidden-synonyms check: list at least 2–3 names that would have been plausible but are now outlawed.
4. Reference `SOP 10` in the related lib/component PR description so reviewers know the term is bound.

## Self-Annealing Notes

| Date | Issue | Fix |
|---|---|---|
| 2026-05-20 | Initial draft. Locks all Hebrew↔English bindings for the Phase 3 lib track and the upcoming component track. Forbidden-synonym lists derived from common English defaults a contributor might reach for. | Initial spec |
| 2026-05-20 | Drift audit (#18) Section B: forbidden-synonym grep returns 0 hits across `app/src/lib/**` and `app/src/types/**`. Apparent matches for `round` / `clear` / `pool` are unrelated (`Math.round`, IDB `store.clear()`, "promise-pool" comments) — none as schema values. INV-08 holds. | Phase 3A acceptance gate cleared. |
| 2026-05-20 | Components inline Hebrew strings — there is **no `t()` function, no JSON translation file, no `useTranslation()` hook**. The app is Hebrew-only by design. If a future v1.x adds English support, this SOP gets a Self-Annealing entry and the i18n layer slots in then. | SOP 15 §4 naming convention. |
| 2026-05-21 | Phase 4: re-run #18 forbidden-synonym sweep across the Phase 3B UI tree (`app/src/components/**` + `app/src/contexts/**`) before ship. Lib-layer audit was clean; UI strings have not been formally audited yet because they were authored in parallel. | Refinement-pass entry; tracked in `task_plan.md` Phase 4 § Tests / drift-watch. |

## Verification

This SOP is verified by **drift-watch checklist** `.tmp/domain-audit-18-checklist.md` (run as Task #18 after the lib track lands). The checklist greps `app/src/**` for forbidden synonyms, compares `IMAGE_CATEGORIES` to `claude.md § ImageCategory`, and walks every schema field to confirm one row in this glossary covers it.
