import type { WeekStatus } from './types.js';

const EDITABLE: WeekStatus[] = ['draft', 'reopened'];

export function therapistCanEdit(status: WeekStatus): boolean {
  return EDITABLE.includes(status);
}

/** Signed / locked weeks — existing sessions are immutable; new rows may still be added. */
export function weekIsProcessed(status: WeekStatus): boolean {
  return status === 'signed' || status === 'locked';
}

/**
 * Import PDFs / add new sessions.
 * Only while the week is editable (draft/reopened). Submitted (awaiting signature)
 * and signed/locked weeks are fully locked for therapists — cancel approval or ask
 * an admin to reopen first.
 */
export function therapistCanImportOrAddServices(status: WeekStatus): boolean {
  return EDITABLE.includes(status);
}

/**
 * Edit or delete an existing session row.
 * Draft/reopened: yes. Submitted / signed / locked: therapists cannot (admins may).
 */
export function therapistCanMutateExistingSession(
  status: WeekStatus,
  opts?: { isAdmin?: boolean },
): boolean {
  if (opts?.isAdmin) return true;
  return therapistCanEdit(status);
}

export function afterSubmit(status: WeekStatus): WeekStatus {
  if (status === 'reopened' || status === 'draft') return 'submitted';
  return status;
}

export function afterSigned(status: WeekStatus): WeekStatus {
  if (status === 'submitted' || status === 'reopened') return 'signed';
  return status;
}

export function afterLock(status: WeekStatus): WeekStatus {
  if (status === 'signed' || status === 'submitted') return 'locked';
  return status;
}

/** Admin reopen of a locked week. */
export function afterReopen(status: WeekStatus): WeekStatus | null {
  if (status !== 'locked' && status !== 'signed') return null;
  return 'reopened';
}

export type SignatureRequestAction = 'cancel' | 'retrieve';

export type SignatureRequestEndPlan =
  | { ok: true; noop: true; message: string }
  | { ok: true; noop: false }
  | { ok: false; status: 409; message: string };

/**
 * Whether staff can cancel or retrieve an open school signature request.
 * Does not call SignNow. A completed signature is refused here so the caller
 * does not void it. A second cancel/retrieve of the same outcome is a no-op.
 */
export function planSignatureRequestEnd(
  week: { status: WeekStatus; signatureRequestStatus?: string | null },
  action: SignatureRequestAction,
): SignatureRequestEndPlan {
  const sig = String(week.signatureRequestStatus || '')
    .trim()
    .toLowerCase();
  if (week.status === 'signed' || week.status === 'locked' || sig === 'completed') {
    return {
      ok: false,
      status: 409,
      message:
        'This timesheet is already signed. The signature request can no longer be cancelled or retrieved.',
    };
  }
  if (action === 'cancel' && sig === 'cancelled') {
    return { ok: true, noop: true, message: 'This signature request is already cancelled.' };
  }
  if (action === 'retrieve' && sig === 'retrieved') {
    return { ok: true, noop: true, message: 'This signature request was already retrieved.' };
  }
  if (action === 'retrieve' && sig === 'cancelled') {
    return { ok: false, status: 409, message: 'This signature request was already cancelled.' };
  }
  if (action === 'cancel' && sig === 'retrieved') {
    return { ok: false, status: 409, message: 'This signature request was already retrieved.' };
  }
  if (week.status !== 'submitted') {
    return { ok: false, status: 409, message: 'There is no open signature request on this week.' };
  }
  return { ok: true, noop: false };
}
