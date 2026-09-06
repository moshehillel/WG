import type { DueDate, DueKind, Student } from './types.js';

export function dueDateStatus(row: DueDate, today = new Date()): 'upcoming' | 'overdue' | 'done' {
  if (row.completedAt) return 'done';
  const due = new Date(`${row.dueOn}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return 'upcoming';
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (due.getTime() < start) return 'overdue';
  return 'upcoming';
}

export function alertBodyForDue(row: DueDate, schoolLabel: string): string {
  const status = dueDateStatus(row);
  const kind =
    row.kind === 'progress'
      ? 'Progress report'
      : row.kind === 'annual'
        ? 'Annual review'
        : 'Reevaluation';
  if (status === 'overdue') return `${kind} for ${schoolLabel} is overdue (${row.dueOn}).`;
  return `${kind} for ${schoolLabel} is due ${row.dueOn}.`;
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

type LegacyDue = Partial<DueDate> & {
  id?: string;
  studentId?: string;
  schoolId?: string;
  kind?: string;
  dueOn?: string;
  completedAt?: string;
  lastNagOn?: string;
};

function asKind(kind: string | undefined): DueKind {
  return kind === 'annual' || kind === 'reeval' ? kind : 'progress';
}

/**
 * Lift legacy per-student due dates onto schools when unambiguous.
 * - Prefer an existing schoolId.
 * - Map studentId → student's schoolId when present.
 * - Drop rows with no school (do not invent schools/dates).
 * - If the same school+kind has multiple distinct incomplete dueOn values, drop those
 *   (ambiguous — do not pick a date).
 */
export function migrateDueDatesToSchools(
  rows: LegacyDue[] | undefined,
  students: Student[],
): DueDate[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  const byStudent = new Map(students.map((s) => [s.id, s]));
  const lifted: DueDate[] = [];

  for (const row of rows) {
    const schoolId =
      String(row.schoolId || '').trim() ||
      (row.studentId ? String(byStudent.get(String(row.studentId))?.schoolId || '').trim() : '');
    if (!schoolId) continue;
    const dueOn = String(row.dueOn || '').trim();
    if (!dueOn) continue;
    lifted.push({
      id: String(row.id || ''),
      schoolId,
      kind: asKind(row.kind),
      dueOn,
      completedAt: String(row.completedAt || ''),
      lastNagOn: String(row.lastNagOn || ''),
    });
  }

  const incomplete = lifted.filter((r) => !r.completedAt);
  const completed = lifted.filter((r) => r.completedAt);
  const ambiguous = new Set<string>();
  const dueByKey = new Map<string, string>();
  for (const row of incomplete) {
    const key = `${row.schoolId}::${row.kind}`;
    const prev = dueByKey.get(key);
    if (prev && prev !== row.dueOn) ambiguous.add(key);
    else dueByKey.set(key, row.dueOn);
  }

  const seen = new Set<string>();
  const out: DueDate[] = [];
  for (const row of incomplete) {
    const key = `${row.schoolId}::${row.kind}`;
    if (ambiguous.has(key)) continue;
    const dedupe = `${key}::${row.dueOn}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(row.id ? row : { ...row, id: `due-${row.schoolId}-${row.kind}-${row.dueOn}` });
  }
  for (const row of completed) {
    const dedupe = `${row.schoolId}::${row.kind}::${row.dueOn}::done::${row.completedAt}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(row.id ? row : { ...row, id: `due-done-${row.schoolId}-${row.kind}` });
  }
  return out;
}
