// SOP 13 § 5 — EventContext (top-level, scoped)
// SOP 11 — Domain invariants enforced here:
//   • INV-01  tableDesignSelections.length ≤ 5
//   • INV-02  signature ⇄ status state machine (any non-status edit on a
//             'signed' event reverts status → 'draft' BUT preserves the
//             signature PNG per INV-02(b) "write-once-not-erasable")
//   • INV-03  dayOfWeek = deriveDayOfWeek(date)
//   • INV-12  selectedAt is set by the lib/context layer, never by the UI
// SOP 07 — auto-snapshot on signature event (status 'draft' → 'signed')
//
// Wraps the three views that touch domain data (`home`, `client-detail`,
// `event-tabs`). Per SOP 13 §5 the context is NOT mounted under `tagging`
// (TaggingPass owns its own state per SOP 12) or `settings`.
//
// Imports are restricted to `react`, the project type module, the lib `db`
// module, and the lib `backup` module. NO `@tauri-apps/*` (Layer 2 rule,
// SOP 13 §2). NO `idb` (always through `db.ts`). Errors are logged through
// `console.error` only — components surface them via the `error` field.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import type { Client, Event, ImageSelection, Signature } from '../types';
import * as db from '../lib/db';
import * as backup from '../lib/backup';

// ===========================================================================
// State + actions
// ===========================================================================

export type EventState = {
  currentClient: Client | null;
  currentEvent: Event | null;
  /** True after an in-memory mutation that has not been persisted yet. */
  unsavedChanges: boolean;
  loading: boolean;
  error: string | null;
};

export type EventAction =
  | { type: 'load-client'; client: Client; event: Event | null }
  | { type: 'create-event-draft' }
  | { type: 'patch-event'; patch: Partial<Event> }
  | { type: 'add-table-selection'; selection: ImageSelection }
  | { type: 'remove-table-selection'; imagePath: string }
  | { type: 'add-chuppah-selection'; selection: ImageSelection }
  | { type: 'remove-chuppah-selection'; imagePath: string }
  | { type: 'sign'; signature: Signature }
  | { type: 'set-loading'; loading: boolean }
  | { type: 'set-error'; error: string | null }
  | { type: 'reset' };

export type EventContextValue = EventState & {
  dispatch: (a: EventAction) => void;
  // Async helpers that wrap dispatch + db calls.
  loadClient: (clientId: string) => Promise<void>;
  saveEvent: () => Promise<void>;
  /**
   * Persist a signature and flip status to 'signed'. Accepts the dual-shape
   * `Signature` so vector strokes are stored verbatim (theme-reactive on
   * read; rasterized to black-on-white in the DOCX export per Behavioral
   * Rule #13). If the current event was never persisted (`id === ''`), this
   * helper transparently saves the draft first so the signature has a row
   * to update — fixing the previously-silent "button does nothing" failure
   * on a fresh draft (Maintenance Log 2026-05-21).
   */
  signEvent: (signature: Signature) => Promise<void>;
  /** INV-01: enforces max 5 selections. */
  toggleTableSelection: (selection: ImageSelection) => void;
  toggleChuppahSelection: (selection: ImageSelection) => void;
};

// ===========================================================================
// Constants
// ===========================================================================

const MAX_TABLE_SELECTIONS = 5 as const;
const ERR_MAX_TABLE_SELECTIONS = 'ניתן לבחור עד 5 עיצובים';
const ERR_NO_CURRENT_EVENT = 'אין אירוע פעיל';
const ERR_SIGN_NO_EVENT = 'לא ניתן לחתום ללא אירוע פעיל';

const initialState: EventState = {
  currentClient: null,
  currentEvent: null,
  unsavedChanges: false,
  loading: false,
  error: null,
};

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Build a minimal `Event` skeleton for a brand-new draft. The `id` is
 * intentionally an empty string until `saveEvent()` calls `db.createEvent`,
 * which generates a uuid v4 (INV-12: lib owns ids and timestamps). The
 * empty-id is the sentinel `saveEvent()` uses to choose create vs update.
 *
 * The skeleton must satisfy `Event` structurally so subsequent `patch-event`
 * calls can mutate fields safely. Date defaults to today (yyyy-mm-dd ISO).
 */
function buildDraftEvent(clientId: string): Event {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const isoDate = `${yyyy}-${mm}-${dd}`;
  const ts = Date.now();
  return {
    id: '',
    clientId,
    date: isoDate,
    dayOfWeek: db.deriveDayOfWeek(isoDate),
    startTime: '20:00',
    location: 'גאמוס',
    guestCount: 0,
    isMixed: false,
    notes: '',
    napkins: { color: 'וורד עתיק', fabric: 'סטן', foldType: '' },
    reception: { atResort: false },
    tableDesignSelections: [],
    chairs: { type: 'אבירים', bridalChair: '' },
    chuppah: {
      location: 'אולם',
      type: 'מרובעת',
      fabricDetails: '',
      designSelections: [],
      aisleDetails: '',
    },
    upgrades: { description: '', items: [] },
    signature: null,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * INV-02: when a `signed` event is edited (any field except `status` itself),
 * revert status to `'draft'`. Per SOP 11 INV-02(b), the captured signature
 * PNG is **preserved** ("write-once-not-erasable") — so the user doesn't lose
 * work; the next signature confirm flips status back to `'signed'` reusing
 * the existing PNG.
 *
 * Returns the (possibly status-reverted) merged event.
 */
function applyEditAfterSign(prev: Event, patch: Partial<Event>): Event {
  const editsNonStatusField = Object.keys(patch).some((k) => k !== 'status');
  const wasSigned = prev.status === 'signed';
  let next: Event = { ...prev, ...patch } as Event;
  if (wasSigned && editsNonStatusField && patch.status === undefined) {
    next = { ...next, status: 'draft' };
  }
  return next;
}

// ===========================================================================
// Reducer
// ===========================================================================

export function eventReducer(state: EventState, action: EventAction): EventState {
  switch (action.type) {
    case 'load-client': {
      return {
        ...state,
        currentClient: action.client,
        currentEvent: action.event,
        unsavedChanges: false,
        error: null,
      };
    }

    case 'create-event-draft': {
      if (!state.currentClient) {
        return { ...state, error: 'יש לטעון לקוח לפני יצירת אירוע' };
      }
      return {
        ...state,
        currentEvent: buildDraftEvent(state.currentClient.id),
        unsavedChanges: true,
        error: null,
      };
    }

    case 'patch-event': {
      if (!state.currentEvent) {
        return { ...state, error: ERR_NO_CURRENT_EVENT };
      }
      // INV-01: defensive backstop. UI / toggleTableSelection is the primary
      // gate but a direct patch with > 5 selections is rejected here too.
      const incomingTable = action.patch.tableDesignSelections;
      if (
        incomingTable !== undefined &&
        Array.isArray(incomingTable) &&
        incomingTable.length > MAX_TABLE_SELECTIONS
      ) {
        return { ...state, error: ERR_MAX_TABLE_SELECTIONS };
      }

      // INV-03: if `date` is in the patch, auto-derive `dayOfWeek` and
      // overwrite any caller-supplied value. Mirrors db.ts behavior.
      let resolvedPatch: Partial<Event> = action.patch;
      if (typeof action.patch.date === 'string') {
        try {
          resolvedPatch = {
            ...action.patch,
            dayOfWeek: db.deriveDayOfWeek(action.patch.date),
          };
        } catch (cause) {
          // Invalid ISO → bubble error to UI; leave state unchanged.
          console.error('[EventContext] patch-event: invalid date', cause);
          return { ...state, error: 'תאריך לא תקין' };
        }
      }

      const merged = applyEditAfterSign(state.currentEvent, resolvedPatch);
      return {
        ...state,
        currentEvent: { ...merged, updatedAt: Date.now() },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'add-table-selection': {
      if (!state.currentEvent) return { ...state, error: ERR_NO_CURRENT_EVENT };
      const list = state.currentEvent.tableDesignSelections;
      if (list.some((s) => s.imagePath === action.selection.imagePath)) {
        // No-op if already present.
        return state;
      }
      if (list.length >= MAX_TABLE_SELECTIONS) {
        return { ...state, error: ERR_MAX_TABLE_SELECTIONS };
      }
      const merged = applyEditAfterSign(state.currentEvent, {
        tableDesignSelections: [...list, action.selection],
      });
      return {
        ...state,
        currentEvent: { ...merged, updatedAt: Date.now() },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'remove-table-selection': {
      if (!state.currentEvent) return { ...state, error: ERR_NO_CURRENT_EVENT };
      const list = state.currentEvent.tableDesignSelections;
      const filtered = list.filter((s) => s.imagePath !== action.imagePath);
      if (filtered.length === list.length) return state; // no-op
      const merged = applyEditAfterSign(state.currentEvent, {
        tableDesignSelections: filtered,
      });
      return {
        ...state,
        currentEvent: { ...merged, updatedAt: Date.now() },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'add-chuppah-selection': {
      if (!state.currentEvent) return { ...state, error: ERR_NO_CURRENT_EVENT };
      const list = state.currentEvent.chuppah.designSelections;
      if (list.some((s) => s.imagePath === action.selection.imagePath)) {
        return state;
      }
      const merged = applyEditAfterSign(state.currentEvent, {
        chuppah: {
          ...state.currentEvent.chuppah,
          designSelections: [...list, action.selection],
        },
      });
      return {
        ...state,
        currentEvent: { ...merged, updatedAt: Date.now() },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'remove-chuppah-selection': {
      if (!state.currentEvent) return { ...state, error: ERR_NO_CURRENT_EVENT };
      const list = state.currentEvent.chuppah.designSelections;
      const filtered = list.filter((s) => s.imagePath !== action.imagePath);
      if (filtered.length === list.length) return state; // no-op
      const merged = applyEditAfterSign(state.currentEvent, {
        chuppah: {
          ...state.currentEvent.chuppah,
          designSelections: filtered,
        },
      });
      return {
        ...state,
        currentEvent: { ...merged, updatedAt: Date.now() },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'sign': {
      if (!state.currentEvent) {
        return { ...state, error: ERR_SIGN_NO_EVENT };
      }
      // Maintenance Log 2026-05-21: dual-shape signature; the action carries
      // the full `Signature` (caller decides PNG vs vector). signedAt is
      // owned by the caller (SignaturePad stamps it at confirm time).
      return {
        ...state,
        currentEvent: {
          ...state.currentEvent,
          signature: action.signature,
          status: 'signed',
          updatedAt: Date.now(),
        },
        unsavedChanges: true,
        error: null,
      };
    }

    case 'set-loading':
      return { ...state, loading: action.loading };

    case 'set-error':
      return { ...state, error: action.error };

    case 'reset':
      return { ...initialState };

    default: {
      // Exhaustiveness — every action variant is handled above.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ===========================================================================
// Context
// ===========================================================================

const EventCtx = createContext<EventContextValue | null>(null);

export type EventProviderProps = {
  children: ReactNode;
};

export function EventProvider({ children }: EventProviderProps) {
  const [state, dispatch] = useReducer(eventReducer, initialState);

  // -------------------------------------------------------------------------
  // Async helpers
  // -------------------------------------------------------------------------

  const loadClient = useCallback(async (clientId: string): Promise<void> => {
    dispatch({ type: 'set-loading', loading: true });
    try {
      const client = await db.getClient(clientId);
      if (!client) {
        dispatch({ type: 'set-error', error: 'לקוח לא נמצא' });
        return;
      }
      const events = await db.listEventsByClient(clientId);
      // `listEventsByClient` returns newest-first by `updatedAt`.
      const latest = events.length > 0 ? (events[0] as Event) : null;
      dispatch({ type: 'load-client', client, event: latest });
    } catch (cause) {
      console.error('[EventContext] loadClient failed', cause);
      dispatch({ type: 'set-error', error: 'שגיאה בטעינת הלקוח' });
    } finally {
      dispatch({ type: 'set-loading', loading: false });
    }
  }, []);

  const saveEvent = useCallback(async (): Promise<void> => {
    if (!state.currentEvent) {
      dispatch({ type: 'set-error', error: ERR_NO_CURRENT_EVENT });
      return;
    }
    dispatch({ type: 'set-loading', loading: true });
    try {
      const ev = state.currentEvent;
      let saved: Event;
      if (ev.id && ev.id.length > 0) {
        // Update existing — strip lib-owned fields per db.ts contract.
        const { id: _id, createdAt: _createdAt, ...patch } = ev;
        void _id;
        void _createdAt;
        saved = await db.updateEvent(ev.id, patch);
      } else {
        // Create new — strip id + timestamps; lib generates them.
        const {
          id: _id,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...input
        } = ev;
        void _id;
        void _createdAt;
        void _updatedAt;
        saved = await db.createEvent(input);
      }
      dispatch({ type: 'patch-event', patch: saved });
      // Replace currentEvent wholesale (id + timestamps refreshed).
      // `patch-event` would auto-revert a 'signed' status because of the
      // INV-02 guard, so we go through 'load-client' instead to avoid that
      // side-effect.
      dispatch({
        type: 'load-client',
        client: state.currentClient!,
        event: saved,
      });
    } catch (cause) {
      console.error('[EventContext] saveEvent failed', cause);
      dispatch({ type: 'set-error', error: 'שמירת האירוע נכשלה' });
    } finally {
      dispatch({ type: 'set-loading', loading: false });
    }
  }, [state.currentEvent, state.currentClient]);

  const signEvent = useCallback(
    async (signature: Signature): Promise<void> => {
      if (!state.currentEvent || !state.currentClient) {
        dispatch({ type: 'set-error', error: ERR_SIGN_NO_EVENT });
        return;
      }
      dispatch({ type: 'set-loading', loading: true });
      try {
        // Maintenance Log 2026-05-21: previously this helper silently
        // returned when `currentEvent.id === ''` (a fresh draft created in
        // memory but never persisted via `saveEvent`). The user-visible
        // symptom was "the יישום וחתימה button does nothing". Fix: persist
        // the draft first, then atomically attach the signature in a second
        // tx. Both writes go through `db.createEvent` / `db.updateEvent` so
        // every domain invariant (INV-02 / INV-09 / INV-10) is enforced.
        let eventId = state.currentEvent.id;
        if (!eventId || eventId.length === 0) {
          // Strip lib-owned fields per `db.createEvent` contract.
          const {
            id: _id,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            // INV-02: createEvent rejects status='signed' without a
            // signature. Force draft for the create; the signed transition
            // happens in the updateEvent that follows.
            status: _status,
            signature: _sig,
            ...input
          } = state.currentEvent;
          void _id;
          void _createdAt;
          void _updatedAt;
          void _status;
          void _sig;
          const created = await db.createEvent({
            ...input,
            status: 'draft',
            signature: null,
          });
          eventId = created.id;
        }

        const saved = await db.updateEvent(eventId, {
          signature,
          status: 'signed',
        });
        dispatch({
          type: 'load-client',
          client: state.currentClient,
          event: saved,
        });
        // SOP 07 trigger #1: auto-snapshot on every signature event.
        // Failure here is non-fatal — the signature is already persisted to
        // IDB; the backup file is a redundancy. Log + continue.
        try {
          await backup.exportBackup('signed');
        } catch (cause) {
          console.error('[EventContext] backup.exportBackup failed', cause);
        }
      } catch (cause) {
        console.error('[EventContext] signEvent failed', cause);
        dispatch({ type: 'set-error', error: 'חתימה נכשלה' });
        throw cause;
      } finally {
        dispatch({ type: 'set-loading', loading: false });
      }
    },
    [state.currentEvent, state.currentClient],
  );

  // -------------------------------------------------------------------------
  // Selection toggles (INV-01 enforcement at the context layer)
  // -------------------------------------------------------------------------

  const toggleTableSelection = useCallback(
    (selection: ImageSelection): void => {
      const ev = state.currentEvent;
      if (!ev) {
        dispatch({ type: 'set-error', error: ERR_NO_CURRENT_EVENT });
        return;
      }
      const list = ev.tableDesignSelections;
      const present = list.some((s) => s.imagePath === selection.imagePath);
      if (present) {
        dispatch({
          type: 'remove-table-selection',
          imagePath: selection.imagePath,
        });
        return;
      }
      if (list.length >= MAX_TABLE_SELECTIONS) {
        // INV-01: max 5 — surface the standard Hebrew error.
        dispatch({ type: 'set-error', error: ERR_MAX_TABLE_SELECTIONS });
        return;
      }
      // INV-12: stamp `selectedAt` here so the UI never has to.
      const stamped: ImageSelection = {
        ...selection,
        selectedAt:
          typeof selection.selectedAt === 'number' &&
          selection.selectedAt > 0
            ? selection.selectedAt
            : Date.now(),
      };
      dispatch({ type: 'add-table-selection', selection: stamped });
    },
    [state.currentEvent],
  );

  const toggleChuppahSelection = useCallback(
    (selection: ImageSelection): void => {
      const ev = state.currentEvent;
      if (!ev) {
        dispatch({ type: 'set-error', error: ERR_NO_CURRENT_EVENT });
        return;
      }
      const list = ev.chuppah.designSelections;
      const present = list.some((s) => s.imagePath === selection.imagePath);
      if (present) {
        dispatch({
          type: 'remove-chuppah-selection',
          imagePath: selection.imagePath,
        });
        return;
      }
      const stamped: ImageSelection = {
        ...selection,
        selectedAt:
          typeof selection.selectedAt === 'number' &&
          selection.selectedAt > 0
            ? selection.selectedAt
            : Date.now(),
      };
      dispatch({ type: 'add-chuppah-selection', selection: stamped });
    },
    [state.currentEvent],
  );

  const value = useMemo<EventContextValue>(
    () => ({
      ...state,
      dispatch,
      loadClient,
      saveEvent,
      signEvent,
      toggleTableSelection,
      toggleChuppahSelection,
    }),
    [
      state,
      loadClient,
      saveEvent,
      signEvent,
      toggleTableSelection,
      toggleChuppahSelection,
    ],
  );

  return <EventCtx.Provider value={value}>{children}</EventCtx.Provider>;
}

// ===========================================================================
// Hook
// ===========================================================================

/** Standard "must be inside provider" check — components fail loudly in dev. */
export function useEvent(): EventContextValue {
  const ctx = useContext(EventCtx);
  if (!ctx) {
    throw new Error(
      'useEvent() must be called inside an <EventProvider>. ' +
        'Mount the provider above the consumer (SOP 13 §5).',
    );
  }
  return ctx;
}
