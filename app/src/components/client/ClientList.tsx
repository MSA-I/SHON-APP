/**
 * ClientList — home screen post-tagging.
 *
 * Mirrors Stitch client_list_dark mockup: page title, ❖ divider, subtitle,
 * 2-column grid of ClientCards, "+ פרויקט חדש" button.
 *
 * SOP 13 § AppView 'home' renders this.
 * SOP 16 § Layout & Spacing — 64px outer margins, 24px gutter.
 */

import { useEffect, useState, useCallback } from 'react';
import * as db from '../../lib/db';
import type { Client, Event } from '../../types';
import { Button, Ornament } from '../ui';
import { ClientCard } from './ClientCard';
import { ClientForm } from './ClientForm';

export interface ClientListProps {
  onClientSelect: (clientId: string) => void;
}

type ClientWithNext = { client: Client; nextEvent: Event | null };

export function ClientList({ onClientSelect }: ClientListProps) {
  const [clients, setClients] = useState<ClientWithNext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await db.listClients();
      const enriched: ClientWithNext[] = await Promise.all(
        list.map(async (c) => {
          const events = await db.listEventsByClient(c.id);
          // Pick the upcoming event (earliest date >= today), else most recent.
          const today = new Date().toISOString().slice(0, 10);
          const upcoming = events
            .filter((e) => e.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          const fallback = events.sort((a, b) => b.date.localeCompare(a.date))[0];
          return { client: c, nextEvent: upcoming ?? fallback ?? null };
        }),
      );
      // Sort: clients with upcoming events first, then by name
      enriched.sort((a, b) => {
        if (a.nextEvent && !b.nextEvent) return -1;
        if (!a.nextEvent && b.nextEvent) return 1;
        return a.client.coupleNames.localeCompare(b.client.coupleNames, 'he');
      });
      setClients(enriched);
    } catch (e) {
      console.error('[ClientList] load failed', e);
      setError('טעינת הלקוחות נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClientCreated = (c: Client) => {
    setShowForm(false);
    void load();
    onClientSelect(c.id);
  };

  return (
    <div data-testid="client-list" className="px-16 py-12">
      <div className="flex flex-col items-end gap-2">
        <h1 className="font-serif text-hero text-cream">לקוחות פרימיום</h1>
        <p className="font-sans text-body text-cream-muted">
          רשימת לקוחות ואירועים קרובים.
        </p>
      </div>

      <Ornament size="large" variant="divider" />

      {loading ? (
        <div
          data-testid="client-list-loading"
          className="text-center text-cream-muted font-sans py-24"
        >
          טוען לקוחות…
        </div>
      ) : error ? (
        <div
          data-testid="client-list-error"
          role="alert"
          className="text-center font-sans py-24"
          style={{ color: '#c44' }}
        >
          {error}
        </div>
      ) : clients.length === 0 ? (
        <div
          data-testid="empty-state-clients"
          className="flex flex-col items-center gap-6 py-24"
        >
          <Ornament size="large" />
          <p className="font-serif text-h2 text-cream">אין לקוחות עדיין</p>
          <p className="font-sans text-body text-cream-muted">
            התחל בלקוח הראשון שלך
          </p>
          <Button
            variant="primary"
            onClick={() => setShowForm(true)}
            testId="client-list-add-empty"
          >
            + לקוח חדש
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6">
            {clients.map(({ client, nextEvent }) => (
              <ClientCard
                key={client.id}
                client={client}
                nextEvent={nextEvent}
                onClick={() => onClientSelect(client.id)}
              />
            ))}
          </div>

          <div className="flex items-center justify-center mt-12">
            <Button
              variant="primary"
              onClick={() => setShowForm(true)}
              testId="client-list-add"
            >
              + פרויקט חדש
            </Button>
          </div>
        </>
      )}

      {showForm ? (
        <ClientForm
          mode="create"
          onSaved={handleClientCreated}
          onCancel={() => setShowForm(false)}
        />
      ) : null}
    </div>
  );
}
