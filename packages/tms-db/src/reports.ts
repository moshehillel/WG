import { dueDateStatus } from './due-dates.js';
import type { MemoryStore } from './memory-store.js';

export function missingNotes(store: MemoryStore, weekId?: string) {
  const sessions = weekId ? store.sessionsForWeek(weekId) : store.data.sessions;
  return sessions
    .filter((s) => {
      if (s.attendance === 'missed') return false;
      return String(s.notes || '').trim().length < 12;
    })
    .map((s) => {
      const student = store.data.students.find((st) => st.id === s.studentId);
      return {
        sessionId: s.id,
        studentId: s.studentId,
        studentName: student ? `${student.firstName} ${student.lastName}` : s.studentId,
        date: s.dateOfService,
        dateOfService: s.dateOfService,
        weekId: s.weekId,
        notes: s.notes,
      };
    });
}

export function adminWeeksList(store: MemoryStore) {
  return store.data.weeks.map((w) => {
    const provider = store.data.providers.find((p) => p.id === w.providerId);
    return {
      id: w.id,
      weekStart: w.weekStart,
      status: w.status,
      signerName: w.signerName,
      signerEmail: w.signerEmail,
      hhaStatus: w.hhaStatus,
      providerId: w.providerId,
      providerName: provider ? `${provider.firstName} ${provider.lastName}` : w.providerId,
      sessionCount: store.sessionsForWeek(w.id).length,
    };
  });
}

export function lastServiceByStudent(store: MemoryStore) {
  const map = new Map<string, string>();
  for (const s of store.data.sessions) {
    if (s.attendance === 'missed') continue;
    const prev = map.get(s.studentId);
    if (!prev || s.dateOfService > prev) map.set(s.studentId, s.dateOfService);
  }
  return [...map.entries()].map(([studentId, lastDos]) => {
    const student = store.data.students.find((st) => st.id === studentId);
    return {
      studentId,
      name: student ? `${student.firstName} ${student.lastName}` : studentId,
      lastDos,
    };
  });
}

export function dueDateReport(store: MemoryStore, today = new Date()) {
  return store.data.dueDates.map((row) => {
    const student = store.data.students.find((st) => st.id === row.studentId);
    return {
      ...row,
      status: dueDateStatus(row, today),
      studentName: student ? `${student.firstName} ${student.lastName}` : row.studentId,
    };
  });
}

export function dashboard(store: MemoryStore) {
  const weeks = store.data.weeks;
  const count = (status: string) => weeks.filter((w) => w.status === status).length;
  const hhaFail = store.data.hhaTransfers.filter((t) => t.status === 'failed').length;
  const hhaPending = store.data.hhaTransfers.filter((t) => t.status === 'pending' || t.status === 'sent').length;
  return {
    timesheet: {
      draft: count('draft') + count('reopened'),
      submitted: count('submitted'),
      signed: count('signed'),
      locked: count('locked'),
    },
    hha: {
      pending: hhaPending,
      failed: hhaFail,
      confirmed: store.data.hhaTransfers.filter((t) => t.status === 'confirmed').length,
    },
    missingNotes: missingNotes(store).length,
    openAlerts: store.openAlerts().length,
    overdueDueDates: dueDateReport(store).filter((d) => d.status === 'overdue').length,
  };
}
