/**
 * ClientForm — modal-style form for creating/editing a client.
 *
 * SOP 16 § Components (sharp 1px gold border, 48px padding modal card).
 * INV-08: Hebrew literals stay Hebrew.
 * Validation:
 *  - coupleNames: required, non-empty after trim.
 *  - phone: required, matches /^0\d{1,2}-?\d{7}$/.
 *  - email: optional; if present, basic /^[^@]+@[^@]+\.[^@]+$/.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button, Input, Ornament } from '../ui';
import * as db from '../../lib/db';
import type { Client } from '../../types';

export interface ClientFormProps {
  mode: 'create' | 'edit';
  initial?: Client;
  onSaved: (c: Client) => void;
  onCancel: () => void;
}

const PHONE_RE = /^0\d{1,2}-?\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ClientForm({ mode, initial, onSaved, onCancel }: ClientFormProps) {
  const [coupleNames, setCoupleNames] = useState(initial?.coupleNames ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validate = (): string | null => {
    if (!coupleNames.trim()) return 'נא להזין שמות בני הזוג';
    if (!phone.trim()) return 'נא להזין מספר נייד';
    if (!PHONE_RE.test(phone.trim())) return 'מספר נייד לא תקין';
    if (email.trim() && !EMAIL_RE.test(email.trim())) return 'כתובת אימייל לא תקינה';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      let saved: Client;
      if (mode === 'edit' && initial) {
        saved = await db.updateClient(initial.id, {
          coupleNames: coupleNames.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
        });
      } else {
        saved = await db.createClient({
          coupleNames: coupleNames.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
        });
      }
      onSaved(saved);
    } catch (e) {
      console.error('[ClientForm] save failed', e);
      setError('שמירה נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80"
      data-testid="client-form-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.div
        data-testid="client-form"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
        className="bg-ink border border-gold rounded-none p-12 w-full max-w-[600px] mx-6"
      >
        <h2 className="font-serif text-h2 text-cream text-center">
          {mode === 'create' ? 'לקוח חדש' : 'עריכת לקוח'}
        </h2>
        <Ornament size="medium" variant="divider" />

        <div className="flex flex-col gap-6">
          <Input
            label="שמות בני הזוג"
            value={coupleNames}
            onChange={setCoupleNames}
            dir="rtl"
            placeholder="לדוגמה: ליאור ודן"
            testId="client-form-couple-names"
          />
          <Input
            label="נייד"
            value={phone}
            onChange={setPhone}
            type="tel"
            dir="ltr"
            placeholder="050-1234567"
            testId="client-form-phone"
          />
          <Input
            label="אימייל (אופציונלי)"
            value={email}
            onChange={setEmail}
            type="email"
            dir="ltr"
            placeholder="example@domain.com"
            testId="client-form-email"
          />

          {error ? (
            <div
              data-testid="client-form-error"
              className="text-small font-sans"
              style={{ color: '#c44' }}
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between mt-12">
          <Button
            variant="tertiary"
            onClick={onCancel}
            disabled={saving}
            testId="client-form-cancel"
          >
            ביטול
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={saving}
            testId="client-form-save"
          >
            {saving ? 'שומר…' : 'שמור'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
