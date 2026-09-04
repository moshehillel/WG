import {
  formatFreqDisplay,
  preferCanonicalProvider,
  providerDisplayNameKey,
} from './caseload-import.js';
import { dueDateStatus } from './due-dates.js';
import { assignSessionsToMandates, mandateFrequencyKind } from './mandate.js';
import { isoDate, parseDos } from './ids.js';
import { schoolCalendarSummary } from './school-calendar.js';
import type { Mandate, SessionRow } from './types.js';
import { DEFAULT_ADMIN_NOTE_TAGS } from './types.js';
import type { MemoryStore } from './memory-store.js';

/** Same bar as missing-notes: short / empty notes do not count as posted. */
export function sessionHasPostedNote(notes: string | undefined): boolean {
  return String(notes || '').trim().length >= 12;
}

function isProvidedSession(s: SessionRow): boolean {
  return s.attendance === 'attended' || s.attendance === 'makeup';
}

function mandateLabel(m: Mandate | undefined): string {
  if (!m) return 'Unassigned';
  const svc = (m.serviceType || m.discipline || 'Mandate').trim();
  const ratio = m.ratioGroup ? ' group' : ' individual';
  return `${svc}${m.serviceType ? '' : ratio}`.trim() || 'Mandate';
}

function weekEndFromStart(weekStart: string): string {
  const dt = parseDos(weekStart);
  if (!dt) return weekStart;
  dt.setUTCDate(dt.getUTCDate() + 6);
  return isoDate(dt);
}

function payProgressPct(sessionsProvided: number, notesPosted: number): 0 | 50 | 100 {
  if (sessionsProvided <= 0) return 0;
  if (notesPosted >= sessionsProvided) return 100;
  return 50;
}

function dosInRange(dos: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const dt = parseDos(dos);
  if (!dt) return false;
  const iso = isoDate(dt);
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function missingNotes(
  store: MemoryStore,
  weekId?: string,
  opts: { from?: string; to?: string; includeMissed?: boolean } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const includeMissed = opts.includeMissed === true;
  const sessions = weekId ? store.sessionsForWeek(weekId) : store.data.sessions;
  return sessions
    .filter((s) => {
      if (!includeMissed && s.attendance === 'missed') return false;
      if (!dosInRange(s.dateOfService, from, to)) return false;
      if (s.attendance === 'missed') return true;
      return !sessionHasPostedNote(s.notes);
    })
    .map((s) => {
      const student = store.data.students.find((st) => st.id === s.studentId);
      const week = store.data.weeks.find((w) => w.id === s.weekId);
      return {
        sessionId: s.id,
        studentId: s.studentId,
        studentName: student ? `${student.firstName} ${student.lastName}` : s.studentId,
        date: s.dateOfService,
        dateOfService: s.dateOfService,
        weekId: s.weekId,
        weekStart: week?.weekStart || '',
        attendance: s.attendance,
        notes: s.notes,
        reason:
          s.attendance === 'missed'
            ? 'Missed session — follow up if a note is still needed'
            : 'Session note missing or too short',
      };
    });
}

/**
 * Admin pay-tracking rows: child + mandate + week.
 * - Sessions provided = attended + makeup (missed excluded).
 * - Notes posted = provided sessions with a real note (≥12 chars).
 * - Progress: 0% none · 50% provided · 100% notes posted for all provided.
 */
export function weekProgressReport(
  store: MemoryStore,
  opts: { from?: string; to?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const weeks = store.data.weeks
    .filter((w) => {
      if (from && w.weekStart < from) return false;
      if (to && w.weekStart > to) return false;
      return Boolean(w.weekStart);
    })
    .slice()
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.id.localeCompare(b.id));

  const rows: Array<{
    studentId: string;
    childName: string;
    schoolName: string;
    mandateId: string;
    mandateLabel: string;
    providerName: string;
    weekId: string;
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
    sessionsProvided: number;
    notesPosted: number;
    sessionsMissed: number;
    notesFollowUp: number;
    progressPct: 0 | 50 | 100;
    milestoneProvided: boolean;
    milestoneNotes: boolean;
  }> = [];

  for (const week of weeks) {
    const weekSessions = store.sessionsForWeek(week.id);
    if (!weekSessions.length) continue;
    const byStudent = new Map<string, SessionRow[]>();
    for (const s of weekSessions) {
      const list = byStudent.get(s.studentId) ?? [];
      list.push(s);
      byStudent.set(s.studentId, list);
    }

    for (const [studentId, sessions] of byStudent) {
      const student = store.data.students.find((st) => st.id === studentId);
      const school = student
        ? store.data.schools.find((sc) => sc.id === student.schoolId)
        : undefined;
      const childName = student
        ? `${student.firstName} ${student.lastName}`.trim() || studentId
        : studentId;
      const schoolName = school?.name || '—';
      const mandates = store.mandatesForStudent(studentId);

      const pushRow = (
        mandate: Mandate | undefined,
        assigned: SessionRow[],
      ) => {
        const provided = assigned.filter(isProvidedSession);
        const missed = assigned.filter((s) => s.attendance === 'missed');
        const sessionsProvided = provided.length;
        const notesPosted = provided.filter((s) => sessionHasPostedNote(s.notes)).length;
        const notesFollowUp =
          provided.filter((s) => !sessionHasPostedNote(s.notes)).length + missed.length;
        if (!assigned.length && sessionsProvided === 0) return;
        const progressPct = payProgressPct(sessionsProvided, notesPosted);
        const provider = mandate
          ? store.data.providers.find((p) => p.id === mandate.providerId)
          : undefined;
        rows.push({
          studentId,
          childName,
          schoolName,
          mandateId: mandate?.id || '',
          mandateLabel: mandateLabel(mandate),
          providerName: provider
            ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
            : '—',
          weekId: week.id,
          weekStart: week.weekStart,
          weekEnd: weekEndFromStart(week.weekStart),
          weekLabel: `${week.weekStart} → ${weekEndFromStart(week.weekStart)}`,
          sessionsProvided,
          notesPosted,
          sessionsMissed: missed.length,
          notesFollowUp,
          progressPct,
          milestoneProvided: progressPct >= 50,
          milestoneNotes: progressPct >= 100,
        });
      };

      if (!mandates.length) {
        pushRow(undefined, sessions);
        continue;
      }
      if (mandates.length === 1) {
        pushRow(mandates[0], sessions);
        continue;
      }
      const { byMandateId, unmatched } = assignSessionsToMandates(mandates, sessions);
      for (const mandate of mandates) {
        const assigned = byMandateId.get(mandate.id) ?? [];
        if (!assigned.length) continue;
        pushRow(mandate, assigned);
      }
      if (unmatched.length) pushRow(undefined, unmatched);
    }
  }

  rows.sort(
    (a, b) =>
      a.weekStart.localeCompare(b.weekStart) ||
      a.childName.localeCompare(b.childName) ||
      a.mandateLabel.localeCompare(b.mandateLabel),
  );
  return rows;
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
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
        : w.providerId?.trim()
          ? w.providerId
          : '—',
      sessionCount: store.sessionsForWeek(w.id).length,
    };
  });
}

export function lastServiceByStudent(
  store: MemoryStore,
  opts: { from?: string; to?: string; providerId?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const providerId = String(opts.providerId || '').trim();
  /** studentId|providerId → last DOS (provider from session week or mandate). */
  const map = new Map<string, { studentId: string; providerId: string; lastDos: string }>();

  for (const s of store.data.sessions) {
    if (s.attendance === 'missed') continue;
    if (!dosInRange(s.dateOfService, from, to)) continue;
    const week = store.data.weeks.find((w) => w.id === s.weekId);
    let resolvedProviderId = String(week?.providerId || '').trim();
    if (!resolvedProviderId) {
      const mandate = store.data.mandates.find(
        (m) => m.studentId === s.studentId && m.providerId,
      );
      resolvedProviderId = String(mandate?.providerId || '').trim();
    }
    if (providerId && resolvedProviderId !== providerId) continue;
    const key = `${s.studentId}|${resolvedProviderId || '_'}`;
    const prev = map.get(key);
    if (!prev || s.dateOfService > prev.lastDos) {
      map.set(key, {
        studentId: s.studentId,
        providerId: resolvedProviderId,
        lastDos: s.dateOfService,
      });
    }
  }

  return [...map.values()]
    .map((row) => {
      const student = store.data.students.find((st) => st.id === row.studentId);
      const school = student
        ? store.data.schools.find((sc) => sc.id === student.schoolId)
        : undefined;
      const provider = row.providerId
        ? store.data.providers.find((p) => p.id === row.providerId)
        : undefined;
      return {
        studentId: row.studentId,
        name: student ? `${student.firstName} ${student.lastName}` : row.studentId,
        providerId: row.providerId,
        providerName: provider
          ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
          : '—',
        schoolId: student?.schoolId || '',
        schoolName: school?.name || '—',
        lastDos: row.lastDos,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.providerName.localeCompare(b.providerName) ||
        a.lastDos.localeCompare(b.lastDos),
    );
}

export function dueDateReport(store: MemoryStore, today = new Date(), opts: { from?: string; to?: string } = {}) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  return store.data.dueDates
    .filter((row) => {
      if (from && row.dueOn < from) return false;
      if (to && row.dueOn > to) return false;
      return true;
    })
    .map((row) => {
    const school = store.data.schools.find((s) => s.id === row.schoolId);
    return {
      ...row,
      status: dueDateStatus(row, today),
      schoolName: school?.name || row.schoolId,
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

export function adminStudentsList(store: MemoryStore) {
  return store.data.students
    .map((s) => {
      const school = store.data.schools.find((sc) => sc.id === s.schoolId);
      const mandates = store.mandatesForStudent(s.id);
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        name: `${s.firstName} ${s.lastName}`.trim() || '—',
        schoolId: s.schoolId,
        schoolName: school?.name || '—',
        grade: s.grade || '',
        dob: s.dob || '',
        programId: s.programId || '',
        programType: s.programType || '',
        mandateCount: mandates.length,
        sessionCount: store.data.sessions.filter((x) => x.studentId === s.id).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function adminStudentDetail(store: MemoryStore, studentId: string) {
  const student = store.data.students.find((s) => s.id === studentId);
  if (!student) return null;
  const school = store.data.schools.find((s) => s.id === student.schoolId);
  const mandates = store.mandatesForStudent(student.id).map((m) => {
    const provider = store.data.providers.find((p) => p.id === m.providerId);
    const kind = mandateFrequencyKind(m);
    const sessionsPerPeriod = m.sessionsPerPeriod ?? m.frequencyPerWeek ?? 0;
    const periodSchoolDays = m.periodSchoolDays ?? (kind === 'school_day_cycle' ? 6 : 0);
    return {
      ...m,
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || m.providerId || '—'
        : m.providerId || '—',
      freqDisplay: formatFreqDisplay(kind, sessionsPerPeriod, periodSchoolDays),
      ratioLabel: m.ratioGroup ? 'Group' : 'Individual',
    };
  });
  const providerMap = new Map<string, { id: string; name: string }>();
  for (const m of mandates) {
    const id = String(m.providerId || '').trim();
    if (!id || providerMap.has(id)) continue;
    providerMap.set(id, {
      id,
      name: m.providerName || id,
    });
  }
  const assignedProviders = [...providerMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sessions = store.data.sessions
    .filter((s) => s.studentId === student.id)
    .map((s) => {
      const week = store.data.weeks.find((w) => w.id === s.weekId);
      return {
        ...s,
        weekStart: week?.weekStart || '',
        weekStatus: week?.status || '',
      };
    });
  const weekIds = [...new Set(sessions.map((s) => s.weekId))];
  const weeks = store.data.weeks.filter((w) => weekIds.includes(w.id));
  const dueDates = dueDateReport(store).filter((d) => d.schoolId === student.schoolId);
  const files = store.filesForStudent(student.id);
  const schoolCalendar = store.schoolCalendarForSchool(student.schoolId);
  return {
    student,
    school: school || null,
    schoolName: school?.name || '—',
    schoolCalendar: schoolCalendar || null,
    schoolCalendarSummary: schoolCalendarSummary(schoolCalendar),
    assignedProviders,
    mandates,
    sessions,
    weeks,
    dueDates,
    files,
  };
}

export function adminSchoolDetail(store: MemoryStore, schoolId: string) {
  const school = store.data.schools.find((s) => s.id === schoolId);
  if (!school) return null;
  const calendar = store.schoolCalendarForSchool(schoolId) ?? null;
  const dueDates = dueDateReport(store).filter((d) => d.schoolId === schoolId);
  const students = store.data.students.filter((s) => s.schoolId === schoolId);
  return {
    school,
    calendar,
    schoolCalendarSummary: schoolCalendarSummary(calendar || undefined),
    dueDates,
    studentCount: students.length,
  };
}

export function adminProviderDetail(store: MemoryStore, providerId: string) {
  const id = String(providerId || '').trim();
  const opened =
    store.data.providers.find((p) => p.id === id) ||
    store.data.providers.find((p) => p.userId === id);
  if (!opened) return null;

  // Duplicate provider rows with the same display name used to split caseload:
  // children showed the name, but the linked login profile had 0 children.
  // Count/list mandates across same-name aliases; prefer the linked profile as canonical.
  const nameKey = providerDisplayNameKey(opened);
  const sameName = nameKey
    ? store.data.providers.filter((p) => providerDisplayNameKey(p) === nameKey)
    : [opened];
  const canonical = preferCanonicalProvider(sameName) || opened;
  const aliasIds = new Set(sameName.map((p) => p.id));
  // Return the canonical (linked) profile when the admin opened an orphan twin.
  const provider = canonical;
  const user =
    (provider.userId ? store.userById(provider.userId) : undefined) ||
    store.data.users.find((u) => u.providerId === provider.id) ||
    null;
  const notes = store.notesForProvider(provider.id);
  const mandates = store.data.mandates
    .filter((m) => aliasIds.has(String(m.providerId || '').trim()))
    .map((m) => {
      const student = store.data.students.find((s) => s.id === m.studentId);
      return {
        ...m,
        // Present as belonging to the canonical provider for edit/delete UX.
        providerId: provider.id,
        studentName: student ? `${student.firstName} ${student.lastName}`.trim() : m.studentId,
      };
    });
  const weeks = store.data.weeks.filter((w) => aliasIds.has(w.providerId) || w.providerId === provider.id);
  const files = store.filesForProvider(provider.id);
  const extraTags = [...new Set(notes.flatMap((n) => n.tags || []))];
  return {
    provider,
    user,
    notes,
    mandates,
    weeks,
    files,
    noteTagOptions: [...new Set([...DEFAULT_ADMIN_NOTE_TAGS, ...extraTags])],
    caseloadCount: new Set(mandates.map((m) => m.studentId)).size,
    redirectedFromProviderId: opened.id !== provider.id ? opened.id : undefined,
  };
}
