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
