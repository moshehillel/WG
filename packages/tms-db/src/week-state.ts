import type { WeekStatus } from './types.js';

const EDITABLE: WeekStatus[] = ['draft', 'reopened'];

export function therapistCanEdit(status: WeekStatus): boolean {
  return EDITABLE.includes(status);
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
