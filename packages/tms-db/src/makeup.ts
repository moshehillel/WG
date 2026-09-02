import type { SessionRow } from './types.js';

export function unusedMissedForStudent(
  allSessions: SessionRow[],
  studentId: string,
): SessionRow[] {
  const used = new Set(
    allSessions.filter((s) => s.makeupOfSessionId).map((s) => s.makeupOfSessionId),
  );
  return allSessions.filter(
    (s) => s.studentId === studentId && s.attendance === 'missed' && !used.has(s.id),
  );
}

export function validateMakeup(row: SessionRow, allSessions: SessionRow[]): string | null {
  if (row.attendance !== 'makeup') return null;
  if (!row.makeupOfSessionId) {
    return 'Makeup is only allowed when tied to a documented missed session.';
  }
  const missed = allSessions.find((s) => s.id === row.makeupOfSessionId);
  if (!missed || missed.attendance !== 'missed') {
    return 'Makeup must point at a missed session that exists.';
  }
  if (missed.studentId !== row.studentId) {
    return 'Makeup must be for the same student as the missed session.';
  }
  const taken = allSessions.find(
    (s) => s.id !== row.id && s.makeupOfSessionId === row.makeupOfSessionId,
  );
  if (taken) return 'That missed session already has a makeup.';
  return null;
}
