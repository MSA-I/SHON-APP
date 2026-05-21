// SOP: Plans/02-תוכנית-המשך-ל-MVP.md § 5
// SOP: claude.md § Behavioral Rules #3 (Hebrew RTL)
// SOP: components/client/ClientForm.tsx — validation rules
//
// Validation contract under test (mirrors ClientForm.validate()):
//   - coupleNames required (non-empty after trim)
//   - phone required, must match /^0\d{1,2}-?\d{7}$/
//   - email optional; if present, must match basic /^[^@]+@[^@]+\.[^@]+$/
//
// Uses real fake-indexeddb + lib/db (no mocks). createClient is the integration
// hook, so a successful save ends up in IDB and surfaces via onSaved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Required for `act()` to work with React 19's concurrent renderer under
// happy-dom. See react-dom-client warnIfUpdatesNotWrappedWithActDEV.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ClientForm } from '../ClientForm';
import { __resetDbForTests, listClients } from '../../../lib/db';
import type { Client } from '../../../types';

// ---------------------------------------------------------------------------
// Tiny render harness — keeps each test isolated to its own DOM container.
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetDbForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function getByTestId(id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`Missing [data-testid="${id}"]`);
  return el;
}

function getInput(testId: string): HTMLInputElement {
  return getByTestId(testId) as HTMLInputElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  // React's controlled <input> reads from the native setter; bypass via the
  // descriptor so the change event fires through React's synthetic system.
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillField(testId: string, value: string) {
  const input = getInput(testId);
  await act(async () => {
    setInputValue(input, value);
  });
}

async function clickSave() {
  const btn = getByTestId('client-form-save');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // db.createClient → openDb → indexedDB.add resolves over many microtasks
  // under fake-indexeddb. Drain liberally so onSaved has fired by the time
  // the test asserts.
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientForm — required-field validation', () => {
  it('shows the Hebrew "couple names required" error when both fields empty', async () => {
    let saved: Client | null = null;
    await act(async () => {
      root.render(
        <ClientForm
          mode="create"
          onSaved={(c) => {
            saved = c;
          }}
          onCancel={() => {}}
        />,
      );
    });

    await clickSave();

    expect(saved).toBeNull();
    expect(getByTestId('client-form-error').textContent).toBe(
      'נא להזין שמות בני הזוג',
    );
  });

  it('shows the Hebrew "phone required" error when phone is missing', async () => {
    await act(async () => {
      root.render(
        <ClientForm mode="create" onSaved={() => {}} onCancel={() => {}} />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await clickSave();

    expect(getByTestId('client-form-error').textContent).toBe('נא להזין מספר נייד');
  });

  it('treats whitespace-only coupleNames as empty (trimmed)', async () => {
    await act(async () => {
      root.render(
        <ClientForm mode="create" onSaved={() => {}} onCancel={() => {}} />,
      );
    });

    await fillField('client-form-couple-names', '   ');
    await fillField('client-form-phone', '050-1234567');
    await clickSave();

    expect(getByTestId('client-form-error').textContent).toBe(
      'נא להזין שמות בני הזוג',
    );
  });
});

describe('ClientForm — phone format', () => {
  it.each<[string, string]>([
    ['abc', 'מספר נייד לא תקין'],
    ['1234567890', 'מספר נייד לא תקין'], // does not start with 0
    ['050-1234', 'מספר נייד לא תקין'], // too short
    ['050-12345678', 'מספר נייד לא תקין'], // too long after dash
    ['+972-50-1234567', 'מספר נייד לא תקין'], // international form rejected
  ])('rejects %p as invalid phone', async (phoneInput, expectedError) => {
    await act(async () => {
      root.render(
        <ClientForm mode="create" onSaved={() => {}} onCancel={() => {}} />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await fillField('client-form-phone', phoneInput);
    await clickSave();

    expect(getByTestId('client-form-error').textContent).toBe(expectedError);
  });

  it.each<[string, string]>([
    ['no dash', '0501234567'],
    ['with dash', '050-1234567'],
    ['short prefix', '02-1234567'],
  ])('accepts valid phone (%s)', async (_label, phoneInput) => {
    let saved: Client | null = null;
    await act(async () => {
      root.render(
        <ClientForm
          mode="create"
          onSaved={(c) => {
            saved = c;
          }}
          onCancel={() => {}}
        />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await fillField('client-form-phone', phoneInput);
    await clickSave();

    expect(saved).not.toBeNull();
    expect(saved!.phone).toBe(phoneInput);
    // Persisted to IDB.
    const all = await listClients();
    expect(all).toHaveLength(1);
  });
});

describe('ClientForm — email format (optional)', () => {
  it('accepts an empty email', async () => {
    let saved: Client | null = null;
    await act(async () => {
      root.render(
        <ClientForm
          mode="create"
          onSaved={(c) => {
            saved = c;
          }}
          onCancel={() => {}}
        />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await fillField('client-form-phone', '050-1234567');
    await clickSave();

    expect(saved).not.toBeNull();
    expect(saved!.email).toBeUndefined();
  });

  it('rejects a malformed email with the Hebrew error', async () => {
    await act(async () => {
      root.render(
        <ClientForm mode="create" onSaved={() => {}} onCancel={() => {}} />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await fillField('client-form-phone', '050-1234567');
    await fillField('client-form-email', 'not-an-email');
    await clickSave();

    expect(getByTestId('client-form-error').textContent).toBe(
      'כתובת אימייל לא תקינה',
    );
  });

  it('accepts a well-formed email', async () => {
    let saved: Client | null = null;
    await act(async () => {
      root.render(
        <ClientForm
          mode="create"
          onSaved={(c) => {
            saved = c;
          }}
          onCancel={() => {}}
        />,
      );
    });

    await fillField('client-form-couple-names', 'ליאור ודן');
    await fillField('client-form-phone', '050-1234567');
    await fillField('client-form-email', 'liorvedan@example.com');
    await clickSave();

    expect(saved).not.toBeNull();
    expect(saved!.email).toBe('liorvedan@example.com');
  });
});

describe('ClientForm — surface', () => {
  it('renders the Hebrew create-mode title and clean-state cancel button', async () => {
    let cancelled = false;
    await act(async () => {
      root.render(
        <ClientForm
          mode="create"
          onSaved={() => {}}
          onCancel={() => {
            cancelled = true;
          }}
        />,
      );
    });

    expect(container.textContent).toContain('לקוח חדש');

    const cancel = getByTestId('client-form-cancel');
    await act(async () => {
      cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(cancelled).toBe(true);
  });

  it('renders the Hebrew edit-mode title and pre-fills initial values', async () => {
    const initial: Client = {
      id: '11111111-1111-4111-8111-111111111111',
      coupleNames: 'דנה וטל',
      phone: '054-7654321',
      createdAt: 1,
      updatedAt: 1,
    };
    await act(async () => {
      root.render(
        <ClientForm
          mode="edit"
          initial={initial}
          onSaved={() => {}}
          onCancel={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('עריכת לקוח');
    expect(getInput('client-form-couple-names').value).toBe('דנה וטל');
    expect(getInput('client-form-phone').value).toBe('054-7654321');
  });
});
