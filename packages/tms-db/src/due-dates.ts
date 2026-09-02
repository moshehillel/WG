import type { DueDate } from './types.js';

export function dueDateStatus(row: DueDate, today = new Date()): 'upcoming' | 'overdue' | 'done' {
  if (row.completedAt) return 'done';
  const due = new Date(`${row.dueOn}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return 'upcoming';
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (due.getTime() < start) return 'overdue';
  return 'upcoming';
}

export function alertBodyForDue(row: DueDate, studentLabel: string): string {
  const status = dueDateStatus(row);
  const kind =
    row.kind === 'progress'
      ? 'Progress report'
      : row.kind === 'annual'
        ? 'Annual review'
        : 'Reevaluation';
  if (status === 'overdue') return `${kind} for ${studentLabel} is overdue (${row.dueOn}).`;
  return `${kind} for ${studentLabel} is due ${row.dueOn}.`;
}

export function daysUntilDue(dueOn: string, today = new Date()): number | null {
  const due = new Date(`${dueOn}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due.getTime() - start) / 86400000);
}

/** Nag from 14 days before due until marked complete. */
export function shouldNagDue(row: { completedAt: string; dueOn: string }, today = new Date()): boolean {
  if (row.completedAt) return false;
  const days = daysUntilDue(row.dueOn, today);
  if (days == null) return false;
  return days <= 14;
}

export function nagKey(dueId: string, today = new Date()): string {
  return `nag:${dueId}:${today.toISOString().slice(0, 10)}`;
}
