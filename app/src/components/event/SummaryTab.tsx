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
import { FileDown, Mail, MessageCircle } from 'lucide-react';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

import { Button } from '../ui/Button';
import { useEvent } from '../../contexts/EventContext';
import { useToast } from '../../contexts/ToastContext';
import { buildEventDocx } from '../../lib/docx';
import { exportBackup } from '../../lib/backup';
import { getProjectRoot } from '../../lib/config';
import { getEventDir, getEventDocxPath } from '../../lib/paths';
import { tauriFsExtras, tauriFsProvider } from '../../lib/tauri-fs';
import type { DocxBuildInput, ImageSelection, Signature } from '../../types';

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

  async function onExport() {
    if (!ev || !client) return;
    setState({ kind: 'building' });
    try {
      // SOP 03 § Embedded Images + claude.md Behavioral Rule #2: read each
      // selected image in place from the project root and hand the bytes to
      // buildEventDocx. docx.ts throws DOCX_IMAGE_EMBED on any missing entry
      // ("we never silently skip a chosen image"), so failed reads must be
      // surfaced to the user before docx.ts is called.
      const allSelections: ImageSelection[] = [
        ...ev.tableDesignSelections,
        ...ev.chuppah.designSelections,
      ];
      // Dedupe by imagePath — the same image could (in theory) appear in both
      // lists; reading twice would be wasted I/O.
      const uniquePaths = Array.from(
        new Set(allSelections.map((s) => s.imagePath)),
      );

      const root = await getProjectRoot();
      const reads = await Promise.allSettled(
        uniquePaths.map(async (relPath) => {
          const absPath = joinRootPosix(root, relPath);
          const bytes = await tauriFsProvider.readFile(absPath);
          return { relPath, bytes };
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

      const input: DocxBuildInput = {
        client,
        event: ev,
        selections: {
          tableDesigns: ev.tableDesignSelections,
          chuppah: ev.chuppah.designSelections,
        },
        signature: ev.signature,
        imageBytes,
      };

      const bytes = await buildEventDocx(input);
      // Maintenance Log 2026-05-21: ensure the events/<id>/ directory exists
      // before atomicWriteFile. The Tauri FS plugin does NOT auto-create
      // parent directories — without this mkdir, the .tmp write fails on
      // first-time export with "atomicWriteFile failed". `tauriFsProvider.
      // ensureDir` runs `mkdir -p` (recursive: true) inside the project root.
      const eventDir = await getEventDir(ev.id);
      await tauriFsProvider.ensureDir(eventDir);
      const target = await getEventDocxPath(ev.id);
      await tauriFsExtras.atomicWriteFile(target, bytes);

      // SOP 07: any auto-snapshot is fired off in the background — failures here
      // do NOT mask a successful DOCX write.
      void exportBackup('signed').catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[summary] backup snapshot failed', err);
      });

      setState({ kind: 'done', path: target });
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
        <KeyValue k="צבע" v={ev.napkins.color} />
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
