/**
 * ClientCard — single-client surface in the home grid.
 *
 * Mirrors the Stitch client_list_dark mockup: hairline border, sharp corners,
 * couple name in Frank Ruhl Libre h2, status pill + next-event date in tiny
 * gold uppercase, footer with "לפרטים" tertiary.
 *
 * SOP 09 §9.6, SOP 16 § Components.
 */

import type { Client, Event } from '../../types';
import { Card, Button } from '../ui';

export interface ClientCardProps {
  client: Client;
  nextEvent: Event | null;
  onClick: () => void;
}

const STATUS_LABEL: Record<Event['status'], string> = {
  draft: 'טיוטה',
  signed: 'חתום',
  completed: 'הושלם',
};

function formatDate(isoDate: string): string {
  // Convert "2026-06-14" -> "14.06.2026" — natural LTR order even inside RTL UI.
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}

export function ClientCard({ client, nextEvent, onClick }: ClientCardProps) {
  const statusLabel = nextEvent ? STATUS_LABEL[nextEvent.status] : 'אין אירוע';
  const eventDate = nextEvent ? formatDate(nextEvent.date) : '—';

  return (
    <Card hover testId={`client-card-${client.id}`} onClick={onClick}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span
            className="font-sans text-label uppercase tracking-[0.12em] text-gold"
            data-testid={`client-card-status-${client.id}`}
          >
            {statusLabel}
          </span>
          <span
            className="font-sans text-small text-gold-dark font-tabular"
            dir="ltr"
          >
            {eventDate}
          </span>
        </div>

        <h3 className="font-serif text-h2 text-cream font-medium leading-tight">
          {client.coupleNames}
        </h3>

        <div className="flex flex-col gap-1 text-cream-muted">
          <span dir="ltr" className="font-sans text-small font-tabular">
            {client.phone}
          </span>
          {client.email ? (
            <span dir="ltr" className="font-sans text-small">
              {client.email}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-2">
          <span className="font-sans text-label uppercase tracking-[0.12em] text-cream-muted">
            סטטוס: {statusLabel}
          </span>
          <Button variant="tertiary" testId={`client-card-open-${client.id}`}>
            לפרטים →
          </Button>
        </div>
      </div>
    </Card>
  );
}
