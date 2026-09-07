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
 * Import PDFs / add new sessions (including on signed/locked weeks).
 * Existing processed sessions stay immutable — use therapistCanMutateExistingSession.
 */
export function therapistCanImportOrAddServices(status: WeekStatus): boolean {
  return EDITABLE.includes(status) || status === 'submitted' || weekIsProcessed(status);
}

/**
 * Edit or delete an existing session row.
 * Draft/reopened: yes. Submitted: additional-services only (enforced in router).
 * Signed/locked: therapists cannot touch existing rows (admins may).
 */
export function therapistCanMutateExistingSession(
  status: WeekStatus,
  opts?: { isAdmin?: boolean },
): boolean {
  if (opts?.isAdmin) return true;
  if (weekIsProcessed(status)) return false;
  return therapistCanEdit(status) || status === 'submitted';
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
