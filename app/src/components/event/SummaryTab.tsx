// SOP: claude.md § Verification step 4 (the summary tab is what Shon and the
//      couple review together before the signature)
// SOP: architecture/06-signature-flow.md § Capture Pipeline
// SOP: architecture/03-document-generation.md (buildEventDocx)
// SOP: architecture/07-backup-strategy.md (auto-snapshot on signature)
// SOP: architecture/11-domain-invariants.md INV-02 (signature ⇄ status)
//
// Read-only summary view + the SignaturePad. After the couple signs, the
// "ייצוא Word" button builds the DOCX bytes and atomically writes them to
// `events/<event-id>/plan.docx`. Backup roundtrip is fired off in parallel.

import { useMemo, useState, type ReactNode } from 'react';
import { FileDown, FileText, Mail, MessageCircle } from 'lucide-react';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

import { Button } from '../ui/Button';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../../contexts/ToastContext';
import { buildEventDocx } from '../../lib/docx';
import { exportBackup } from '../../lib/backup';
import { getProjectRoot } from '../../lib/config';
import { getEventDirByName, getEventDocxPathByName } from '../../lib/paths';
import { tauriFsExtras, tauriFsProvider } from '../../lib/tauri-fs';
import { downscaleImageToPngWithSize } from '../../lib/images';
import { getSelectedImageBytes, putSelectedImageBytes } from '../../lib/db';
import type { DocxBuildInput, ImageSelection, Signature } from '../../types';

// 600px is the same MAX_WIDTH used by `lib/docx.ts`. Keeping the constant
// duplicated here is cheaper than exporting it (Layer 3 boundary stays
// clean: SummaryTab does not import internal docx symbols).
const SELECTION_BAKE_MAX_WIDTH = 600;

// Module-level cache for the logo PNG bytes (loaded once, reused for every export).
let logoPngBytesCache: Uint8Array | null = null;
let gamosLogoBytesCache: Uint8Array | null = null;

import { ChipLabel, SectionHeader } from './EventDetailsTab';
import { SignaturePad } from '../signature/SignaturePad';
import { TagsDisplay } from './TagsDisplay';
import { SelectionThumbnail } from './SelectionThumbnail';
import { Stagger } from '../../lib/motion/Stagger';

type ExportState =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'done'; path: string }
  | { kind: 'error'; message: string };

export function SummaryTab(): ReactNode {
  const ctx = useEvent();
  const { toast } = useToast();
  const ev = ctx.currentEvent;
  const client = ctx.currentClient;
  const [state, setState] = useState<ExportState>({ kind: 'idle' });

  if (!ev) return null;

  const isSigned = ev.signature !== null && ev.status !== 'draft';
  const canExport = isSigned;

  async function onConfirmSignature(sig: Signature) {
    if (!ev) return;
    try {
      // EventContext owns the signature pipeline:
      //   • signEvent(signature) persists via db.updateEvent (creating the
      //     event row first if the draft has no id yet — Maintenance Log
      //     2026-05-21 fix for the silent-button bug), flips status to
      //     'signed', and fires the SOP 07 auto-snapshot.
      await ctx.signEvent(sig);
      toast({ kind: 'success', message: 'החתימה נשמרה' });
    } catch (err) {
      const message = errMessage(err, 'שגיאה בשמירת חתימה');
      setState({ kind: 'error', message });
      toast({ kind: 'error', message });
    }
  }

  async function onOpenFile(docPath: string) {
    try {
      // Use openPath to open the DOCX in the system default app (Word)
      await openPath(docPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[summary] open file failed', err);
      // Fallback: reveal in Explorer so user can double-click manually
      try {
        await revealItemInDir(docPath);
        toast({ kind: 'success', message: 'הקובץ נפתח בסייר' });
      } catch (revealErr) {
        toast({ kind: 'error', message: errMessage(revealErr, 'פתיחת הקובץ נכשלה') });
      }
    }
  }

  async function onExport() {
    if (!ev || !client) return;
    setState({ kind: 'building' });
    try {
      // SOP 03 § Embedded Images + claude.md Behavioral Rule #2: read each
      // selected image in place from the project root, downscale to 600px
      // PNG, persist into the `selectedImageBytes` IDB cache, and hand the
      // bytes to `buildEventDocx`. The cache-first pipeline (2026-05-25)
      // means re-export survives source-file moves and cold-restart, and a
      // re-opened app can rebuild the same DOCX without re-reading the
      // disk.
      const allSelections: ImageSelection[] = [
        ...ev.tableDesignSelections,
        ...ev.chuppah.designSelections,
        ...(ev.napkins.designSelections ?? []),
        ...(ev.upgrades.designSelections ?? []),
      ];
      // Dedupe by imagePath — the same image could (in theory) appear in
      // multiple lists; baking twice would waste both I/O and CPU.
      const uniquePaths = Array.from(
        new Set(allSelections.map((s) => s.imagePath)),
      );

      const root = await getProjectRoot();

      // Per-path cache-first pipeline. Each path tries (1) the IDB cache
      // first, (2) a fresh disk read + bake + persist if the cache misses,
      // and (3) the cache as a final fallback if the disk read failed but
      // we have a previously-baked record. Only paths where ALL stages
      // miss show up in `failed[]`.
      const reads = await Promise.allSettled(
        uniquePaths.map(async (relPath) => {
          // Stage 1: IDB cache hit → reuse without touching disk.
          let cached: Awaited<ReturnType<typeof getSelectedImageBytes>>;
          try {
            cached = await getSelectedImageBytes(relPath);
          } catch {
            cached = undefined;
          }
          if (cached && cached.bytes && cached.bytes.byteLength > 0) {
            return { relPath, bytes: cached.bytes };
          }

          // Stage 2: read from disk + bake to 600px PNG + persist.
          const absPath = joinRootPosix(root, relPath);
          let raw: Uint8Array;
          try {
            raw = await tauriFsProvider.readFile(absPath);
          } catch (diskErr) {
            // Stage 3: disk read failed — was the file moved/deleted? If
            // we have a stale cache entry use it (this is exactly the
            // "files were renamed since selection" case the user asked
            // us to handle); otherwise re-throw so it counts as failed.
            if (cached && cached.bytes && cached.bytes.byteLength > 0) {
              return { relPath, bytes: cached.bytes };
            }
            throw diskErr;
          }

          // Bake to 600px PNG. This is the SAME function `lib/docx.ts`
          // calls internally, so the bytes we persist match what `docx`
          // would have produced — no double-baking on subsequent exports.
          let baked: Awaited<ReturnType<typeof downscaleImageToPngWithSize>>;
          try {
            baked = await downscaleImageToPngWithSize(raw, SELECTION_BAKE_MAX_WIDTH);
          } catch {
            // Canvas pipeline unavailable — pass raw bytes through; docx.ts
            // will gate them with the magic-byte check.
            baked = { bytes: raw };
          }

          // Persist. Don't fail the export on a cache write hiccup —
          // we still have the bytes in memory.
          try {
            await putSelectedImageBytes({
              imagePath: relPath,
              bytes: baked.bytes,
              widthPx: baked.widthPx ?? 0,
              heightPx: baked.heightPx ?? 0,
              sourceModifiedAt: 0,
            });
          } catch {
            // eslint-disable-next-line no-console
            console.warn('[summary] selectedImageBytes write failed', relPath);
          }
          return { relPath, bytes: baked.bytes };
        }),
      );

      const imageBytes = new Map<string, Uint8Array>();
      const failed: string[] = [];
      for (let i = 0; i < reads.length; i += 1) {
        const r = reads[i];
        if (r.status === 'fulfilled') {
          imageBytes.set(r.value.relPath, r.value.bytes);
        } else {
          failed.push(uniquePaths[i]);
        }
      }
      if (failed.length > 0) {
        // SOP 03 forbids silently skipping a chosen image. Block the export
        // and tell the user which file moved/was deleted so they can fix it.
        const preview = failed.slice(0, 3).join(', ');
        const more = failed.length > 3 ? ` (ועוד ${failed.length - 3})` : '';
        setState({
          kind: 'error',
          message: `קריאת תמונות נבחרה נכשלה — ייתכן שהקובץ הועבר או נמחק: ${preview}${more}`,
        });
        return;
      }

      // Load logos (both cached module-level). The SB monogram is rasterized
      // from the SVG; the Gamos venue logo is fetched as PNG bytes verbatim.
      // Both calls are best-effort — if either fails the cover renders the
      // surviving logo (or no logo at all). Per Behavioral Rule #13 the DOCX
      // is always light-theme so we never need to choose a dark variant.
      const [logoPng, gamosLogoPng] = await Promise.all([
        loadLogoPng(),
        loadGamosLogoPng(),
      ]);

      const input: DocxBuildInput = {
        client,
        event: ev,
        selections: {
          tableDesigns: ev.tableDesignSelections,
          chuppah: ev.chuppah.designSelections,
          napkins: ev.napkins.designSelections ?? [],
          upgrades: ev.upgrades.designSelections ?? [],
        },
        signature: ev.signature,
        imageBytes,
        logoPngBytes: logoPng ?? undefined,
        gamosLogoPngBytes: gamosLogoPng ?? undefined,
      };

      const bytes = await buildEventDocx(input);
      // Maintenance Log 2026-05-25: the per-event folder + filename are now
      // human-readable (`<couple-names>_<yyyy-mm-dd>_<id8>`) instead of the
      // bare UUID. Shon asked to be able to browse `events/` and recognize
      // each plan without opening it. `getEventDirByName` is a pure helper
      // over `paths.buildEventFolderBasename` — NFC-normalises Hebrew, strips
      // Windows-forbidden chars, truncates, and disambiguates with the
      // first 8 chars of the eventId so two events for the same couple on
      // the same date never collide.
      const dirInput = {
        coupleNames: client.coupleNames,
        date: ev.date,
        eventId: ev.id,
      };
      const eventDir = await getEventDirByName(dirInput);
      await tauriFsProvider.ensureDir(eventDir);
      const target = await getEventDocxPathByName(dirInput);
      await tauriFsExtras.atomicWriteFile(target, bytes);

      // SOP 07: any auto-snapshot is fired off in the background — failures here
      // do NOT mask a successful DOCX write.
      void exportBackup('signed').catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[summary] backup snapshot failed', err);
      });

      setState({ kind: 'done', path: target });

      // Best-effort: open the file in the system default app (Word). Failure is
      // non-fatal — the user can use the "פתח קובץ" button below.
      void openPath(target).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[summary] auto-open failed', err);
      });

      toast({ kind: 'success', message: 'מסמך Word נוצר בהצלחה' });
    } catch (err) {
      const message = errMessage(err, 'יצירת המסמך נכשלה');
      setState({ kind: 'error', message });
      toast({ kind: 'error', message });
    }
  }

  return (
    <div data-testid="event-panel-summary-form" className="flex flex-col gap-12">
      <SectionHeader title="סיכום" />

      {/* Stagger the summary blocks (with their dividers in-between) so the
          sign-off page reveals as a ceremony rather than a wall of text.
          Step 0.1 = 100ms; 12 children → 1.2s budget. Reduced-motion → all
          appear together (Stagger handles this internally). */}
      <Stagger step={0.1} className="flex flex-col gap-12">
      {/* ── Client block ──────────────────────────────────────────────── */}
      <SummaryBlock label="לקוח">
        <KeyValue k="שמות בני הזוג" v={client?.coupleNames ?? '—'} />
        <KeyValue k="נייד" v={client?.phone ?? '—'} ltr />
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Event details ─────────────────────────────────────────────── */}
      <SummaryBlock label="פרטי אירוע">
        <KeyValue k="תאריך" v={ev.date} ltr />
        <KeyValue k="יום בשבוע" v={ev.dayOfWeek} />
        <KeyValue k="שעת תחילה" v={ev.startTime} ltr />
        <KeyValue k="מתחם" v={ev.location} />
        <KeyValue k="כמות מוזמנים" v={String(ev.guestCount)} ltr />
        <KeyValue k="אירוע מעורב" v={ev.isMixed ? 'כן' : 'לא'} />
        {ev.notes.trim() && <KeyValue k="הערות" v={ev.notes} />}
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Napkins + reception ───────────────────────────────────────── */}
      <SummaryBlock label="מפיות וקבלת פנים">
        <KeyValue k="בד" v={ev.napkins.fabric} />
        <KeyValue k="קיפול" v={ev.napkins.foldType || '—'} />
        <KeyValue k="קבלת פנים ריזורט" v={ev.reception.atResort ? 'כן' : 'לא'} />
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Table designs ─────────────────────────────────────────────── */}
      <SummaryBlock label={`עיצובי שולחן (${ev.tableDesignSelections.length})`}>
        <SelectionsGrid items={ev.tableDesignSelections} />
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Chuppah ───────────────────────────────────────────────────── */}
      <SummaryBlock label="חופה">
        <KeyValue k="סוג" v={ev.chuppah.type} />
        <KeyValue k="מיקום" v={ev.chuppah.location} />
        {ev.chuppah.fabricDetails.trim() && (
          <KeyValue k="פירוט בדים" v={ev.chuppah.fabricDetails} />
        )}
        {ev.chuppah.aisleDetails.trim() && (
          <KeyValue k="שדרה" v={ev.chuppah.aisleDetails} />
        )}
        <SelectionsGrid items={ev.chuppah.designSelections} />
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Upgrades ──────────────────────────────────────────────────── */}
      <SummaryBlock label="שדרוגים">
        {ev.upgrades.description.trim() && (
          <KeyValue k="תיאור" v={ev.upgrades.description} />
        )}
        {ev.upgrades.items.length > 0 && (
          <ul className="flex flex-wrap gap-2 mt-2">
            {ev.upgrades.items.map((item, idx) => (
              <li
                key={`${item}-${idx}`}
                className="inline-flex items-center border border-border-subtle px-3 py-1 text-small text-cream"
              >
                {item}
              </li>
            ))}
          </ul>
        )}
      </SummaryBlock>

      <HairlineDivider />

      {/* ── Tags slot — union of every tab's selections (Maintenance Log 2026-05-21).
            Always rendered (even when empty) so the summary view stays in
            visual lockstep with the other tabs. ─────────────────────────── */}
      <TagsDisplay
        selections={[
          ...ev.tableDesignSelections,
          ...ev.chuppah.designSelections,
          ...(ev.napkins.designSelections ?? []),
          ...(ev.upgrades.designSelections ?? []),
        ]}
        testIdSuffix="summary"
      />
      </Stagger>

      {/* ❖ marks the single ceremonial boundary into the sign-off moment. */}
      <Divider />

      {/* ── Signature pad ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <ChipLabel>חתימה</ChipLabel>
        <SignaturePad
          initialSignature={ev.signature}
          onConfirm={(sig) => onConfirmSignature(sig)}
        />
      </div>

      {/* ── Export DOCX ───────────────────────────────────────────────── */}
      <div className="flex flex-col items-end gap-3">
        <Button
          variant="primary"
          onClick={onExport}
          disabled={!canExport || state.kind === 'building'}
          testId="export-docx-button"
          icon={<FileDown size={16} aria-hidden="true" />}
        >
          {state.kind === 'building' ? 'מייצא…' : 'ייצוא Word'}
        </Button>
        {!canExport && (
          <p className="text-tiny text-cream-muted">
            יש להחתים את בני הזוג לפני ייצוא המסמך.
          </p>
        )}
        {state.kind === 'done' && (
          <>
            <p
              className="text-small text-gold-dark"
              dir="ltr"
              data-testid="export-docx-success"
            >
              ✓ {state.path}
            </p>
            {/* Share row — appears only after a successful export. mailto:
                opens the OS default mail client; wa.me opens WhatsApp Web /
                Desktop. Both are best-effort: WhatsApp Web URL API has no
                attachment slot, so we also reveal the file in Explorer so
                Shon can drag it into the WhatsApp window. The opener plugin
                scope (capabilities/default.json) restricts URLs to the
                two schemes + the events/** path. */}
            <div
              className="flex flex-row-reverse gap-3 mt-2"
              data-testid="export-share-row"
            >
              <Button
                variant="primary"
                onClick={() => onOpenFile(state.path)}
                testId="open-file-button"
                icon={<FileText size={16} aria-hidden="true" />}
              >
                פתח קובץ
              </Button>
              <Button
                variant="primary"
                onClick={() => onShareEmail(state.path)}
                testId="share-email-button"
                icon={<Mail size={16} aria-hidden="true" />}
              >
                שלח באימייל
              </Button>
              <Button
                variant="primary"
                onClick={() => onShareWhatsApp(state.path)}
                testId="share-whatsapp-button"
                icon={<MessageCircle size={16} aria-hidden="true" />}
              >
                שלח בוואטסאפ
              </Button>
            </div>
          </>
        )}
        {state.kind === 'error' && (
          // Designer-Reviewer P0 + A11y-Gate fix: gold (success/peak
          // accent) is the wrong semantic for an error message. The
          // theme-aware --danger token darkens on light canvas so the
          // 4.5:1 WCAG AA body-text ratio holds in both themes.
          <p
            role="alert"
            className="text-small"
            style={{ color: 'var(--danger)' }}
            data-testid="export-docx-error"
          >
            {state.message}
          </p>
        )}
      </div>
    </div>
  );

  // ── Share handlers ────────────────────────────────────────────────────
  // Both run after a successful export, so `ev` and `client` are guaranteed
  // populated (the buttons sit inside the `state.kind === 'done'` branch).

  async function onShareEmail(docPath: string) {
    if (!ev || !client) return;
    const subject = `סיכום אירוע — ${client.coupleNames} ${ev.date}`;
    const body = [
      `שלום ${client.coupleNames},`,
      '',
      'מצורף סיכום פרטי האירוע שלכם.',
      `מיקום הקובץ במחשב: ${docPath}`,
      '',
      'אשמח לאשר קבלה.',
      '',
      'בברכה,',
      'שון בלאיש — הפקות',
    ].join('\n');
    const to = client.email ?? '';
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await openUrl(url);
      // Reveal the DOCX in Explorer so the user can drag it into the
      // mail client (mailto: has no attachment slot).
      void revealItemInDir(docPath).catch(() => {
        /* non-fatal — Explorer reveal is a convenience, not a contract */
      });
    } catch (err) {
      toast({ kind: 'error', message: errMessage(err, 'פתיחת לקוח האימייל נכשלה') });
    }
  }

  async function onShareWhatsApp(docPath: string) {
    if (!ev || !client) return;
    const phone = normalizeIsraeliPhone(client.phone);
    const text = [
      `שלום ${client.coupleNames},`,
      'מצורף סיכום פרטי האירוע שלכם.',
      'בברכה, שון בלאיש — הפקות',
    ].join('\n');
    // wa.me requires an internationalised number (no '+', no dashes); when
    // the client phone is malformed we fall back to the chooser endpoint
    // (no `phone=` segment) so the user can pick a chat manually.
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    try {
      await openUrl(url);
      // WhatsApp Web/Desktop has no URL-level attachment API. Reveal the
      // file in Explorer so Shon can drag it into the chat window.
      void revealItemInDir(docPath).catch(() => {
        /* non-fatal */
      });
      toast({
        kind: 'success',
        message: 'גרור את הקובץ מ-Explorer לחלון WhatsApp',
      });
    } catch (err) {
      toast({ kind: 'error', message: errMessage(err, 'פתיחת WhatsApp נכשלה') });
    }
  }
}

// ---------------------------------------------------------------------------
// Layout helpers (file-private)
// ---------------------------------------------------------------------------

function SummaryBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <ChipLabel>{label}</ChipLabel>
      <div className="bg-ink-raised border border-border-subtle p-6 flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

function KeyValue({
  k,
  v,
  ltr = false,
}: {
  k: string;
  v: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-tiny text-gold-dark uppercase min-w-[10ch]">
        {k}
      </span>
      <span
        className="text-body text-cream"
        dir={ltr ? 'ltr' : undefined}
        style={ltr ? { fontFeatureSettings: "'tnum' 1, 'lnum' 1" } : undefined}
      >
        {v}
      </span>
    </div>
  );
}

function SelectionsGrid({ items }: { items: ImageSelection[] }) {
  // Memoise group-by-category for stable render order in the summary.
  const groups = useMemo(() => groupByCategory(items), [items]);

  if (items.length === 0) {
    return <p className="text-small text-cream-muted">לא נבחרו תמונות.</p>;
  }
  return (
    <div className="flex flex-col gap-4 mt-2">
      {groups.map(([cat, list]) => (
        <div key={cat} className="flex flex-col gap-2">
          <span className="text-tiny text-gold-dark uppercase">{cat}</span>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {list.map((sel) => (
              <li
                key={sel.imagePath}
                className="bg-ink border border-border-subtle p-2 flex flex-col gap-1"
              >
                <SelectionThumbnail
                  imagePath={sel.imagePath}
                  imageName={sel.imageName}
                />
                <span className="text-small text-cream truncate" dir="auto">
                  {sel.imageName}
                </span>
                {sel.notes.trim() && (
                  <span className="text-tiny text-cream-muted" dir="auto">
                    {sel.notes}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Designer-Reviewer P0 (SummaryTab #3): the SummaryTab originally rendered
 * `❖` between every block (7 instances), which diluted the gold "peak" so it
 * read as texture instead of accent. We now keep a single ceremonial ❖ only
 * at the top of the summary (`Divider`) and use a quiet hairline rule between
 * blocks (`HairlineDivider`). Gold appears once per page — the way it should.
 */
function Divider() {
  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <span className="font-serif text-h2 text-gold">❖</span>
    </div>
  );
}

function HairlineDivider() {
  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <span className="block w-12 h-px bg-border-subtle" />
    </div>
  );
}

function groupByCategory(
  items: ImageSelection[],
): Array<[string, ImageSelection[]]> {
  const acc = new Map<string, ImageSelection[]>();
  for (const item of items) {
    const list = acc.get(item.category) ?? [];
    list.push(item);
    acc.set(item.category, list);
  }
  return Array.from(acc.entries());
}

/**
 * Join the project root with an `ImageSelection.imagePath` (relative POSIX).
 * Mirrors the lib-internal `joinPosix` shape used by `images.ts`/`paths.ts`:
 * trims a trailing slash from the root and a leading slash from the rel path,
 * NFC-normalizes Hebrew. The defense-in-depth `assertInsideRoot` guard inside
 * `tauriFsProvider.readFile` is what actually enforces the boundary.
 */
function joinRootPosix(root: string, relPath: string): string {
  const r = root.replace(/\/+$/, '');
  const p = relPath.replace(/^\/+/, '').normalize('NFC');
  return `${r}/${p}`;
}

function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

/**
 * Normalise an Israeli phone number for the wa.me URL.
 *   "050-1234567"   -> "972501234567"
 *   "+972501234567" -> "972501234567"
 *   "0501234567"    -> "972501234567"
 *   ""              -> ""  (caller falls back to the chooser endpoint)
 *
 * wa.me requires the international number with no leading '+', dashes,
 * spaces, or parens. Israeli locals beginning with '0' have the '0'
 * stripped and replaced with the country code '972'. Anything we can't
 * confidently normalise is rejected by returning ''.
 */
function normalizeIsraeliPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  // Anything else (already-international foreign number, malformed, etc.)
  // is returned as-is — wa.me will reject and fall through to the chooser.
  return digits;
}

/**
 * Load the logo SVG (assets/logo.svg) and rasterize it to a PNG Uint8Array.
 * The result is cached module-level so repeated exports reuse the same bytes.
 *
 * Steps:
 *   1. Fetch the SVG via a relative URL (the Vite bundler serves assets/ as /assets/).
 *   2. Parse the SVG string to extract the viewBox dimensions.
 *   3. Create an offscreen canvas SCALED TO THE SVG's NATURAL ASPECT
 *      (Maintenance Log 2026-05-26-pm: previously hardcoded 300×100,
 *      which baked the square 1254×1254 SB monogram into a 100×100
 *      block surrounded by 200px of white padding — when the docx cell
 *      then rendered the PNG at 80×80, only ~27% of the cell was the
 *      mark itself, the rest was white. Fix: bake the canvas at the
 *      SVG's actual ratio so the resulting PNG is "all monogram".)
 *   4. Draw the SVG into an Image element and render it onto the canvas.
 *   5. Convert canvas → PNG dataURL → Uint8Array.
 *
 * Falls back to `null` (no logo) if any step fails (fetch error, parse error,
 * canvas unavailable in the WebView2 runtime, etc.). The caller (buildEventDocx)
 * gracefully skips the logo when `logoPngBytes` is null.
 */
async function loadLogoPng(): Promise<Uint8Array | null> {
  if (logoPngBytesCache !== null) return logoPngBytesCache;

  try {
    // Behavioral Rule #13: DOCX is always light-theme → use logo.svg (dark on white).
    // Maintenance Log 2026-05-26: corrected the URL from `/assets/logo.svg` to
    // `/logo.svg` — the file is at `app/public/logo.svg`, which Vite serves at
    // the site root. The previous URL silently 404'd, so every prior export
    // shipped without the SB monogram.
    const svgResp = await fetch('/logo.svg');
    if (!svgResp.ok) return null;
    const svgText = await svgResp.text();

    // Extract viewBox from the SVG to preserve aspect ratio
    const vbMatch = /viewBox=["']([^"']+)["']/.exec(svgText);
    let svgW = 1254; // fallback from the actual SVG
    let svgH = 1254;
    if (vbMatch) {
      const parts = vbMatch[1].split(/\s+/);
      if (parts.length === 4) {
        svgW = parseFloat(parts[2]) || svgW;
        svgH = parseFloat(parts[3]) || svgH;
      }
    }

    // Bake the canvas at the SVG's natural aspect with a fixed long-edge.
    // 600px on the long edge gives Word plenty of pixels to render the
    // monogram crisply at any reasonable embedded size.
    const longEdge = 600;
    const aspect = svgW / svgH;
    const targetW = aspect >= 1 ? longEdge : Math.round(longEdge * aspect);
    const targetH = aspect >= 1 ? Math.round(longEdge / aspect) : longEdge;

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // White background per Behavioral Rule #13.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);

    // Create an Image element to hold the SVG.
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);

    // Wait for the image to load.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG load failed'));
      img.src = svgUrl;
    });

    // Draw the SVG to fill the canvas — the canvas already matches the
    // SVG's aspect, so no padding is needed.
    ctx.drawImage(img, 0, 0, targetW, targetH);

    URL.revokeObjectURL(svgUrl);

    // Convert canvas → PNG dataURL → Uint8Array
    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const base64 = dataUrl.slice(comma + 1);
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      arr[i] = bin.charCodeAt(i);
    }

    logoPngBytesCache = arr;
    return arr;
  } catch {
    return null;
  }
}

/**
 * Load the Gamos venue logo as a PNG byte buffer for DOCX embedding.
 *
 * The asset lives at `app/public/assets/gamos-logo.png` (bundled into the
 * Tauri build per the 2026-05-26 brand directive — see claude.md). Unlike
 * `loadLogoPng`, no SVG → canvas rasterisation is needed because the source
 * is already PNG. We still gate the bytes with a magic-byte check so a
 * future asset swap can't sneak a non-PNG past `docx@8.5`'s PNG-only part
 * naming (Maintenance Log 2026-05-25).
 *
 * Returns `null` on any failure (asset missing, fetch error, magic-byte
 * mismatch). The DOCX cover gracefully falls back to single-logo layout.
 */
async function loadGamosLogoPng(): Promise<Uint8Array | null> {
  if (gamosLogoBytesCache !== null) return gamosLogoBytesCache;

  try {
    const resp = await fetch('/assets/gamos-logo.png');
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    const bytes = new Uint8Array(buffer);
    // PNG magic: 89 50 4E 47
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      // eslint-disable-next-line no-console
      console.warn('[summary] gamos logo is not a PNG');
      return null;
    }
    gamosLogoBytesCache = bytes;
    return bytes;
  } catch {
    return null;
  }
}
