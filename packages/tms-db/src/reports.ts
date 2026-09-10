import {
  formatFreqDisplay,
  preferCanonicalProvider,
  providerDisplayNameKey,
} from './caseload-import.js';
import { dueDateStatus } from './due-dates.js';
import {
  assignSessionsToMandates,
  cycleAllowedSessions,
  mandateFrequencyKind,
  monthlyAllowedSessions,
  weeklyAllowedSessions,
} from './mandate.js';
import { isoDate, parseDos } from './ids.js';
import { schoolCalendarSummary, hasConfiguredSchoolCalendar, schoolCalendarMonFriFallbackWarning, schoolSetupIncomplete } from './school-calendar.js';
import type { HhaTransferStatus, Mandate, SessionRow } from './types.js';
import { DEFAULT_ADMIN_NOTE_TAGS } from './types.js';
import type { MemoryStore } from './memory-store.js';

/** Per-week HHA transfer rollup (attended/makeup only — misses are not HHA-eligible). */
export type WeekHhaRollup = {
  sessionCount: number;
  eligible: number;
  confirmed: number;
  failed: number;
  pending: number;
  unset: number;
  status: HhaTransferStatus;
};

/**
 * HHA only transfers attended/makeup sessions. Week status must reflect those rows,
 * not the Sessions column (which includes misses).
 */
export function weekHhaRollup(store: MemoryStore, weekId: string): WeekHhaRollup {
  const sessions = store.sessionsForWeek(weekId);
  const eligibleSessions = sessions.filter(isDeliveredSession);
  let confirmed = 0;
  let failed = 0;
  let pending = 0;
  let unset = 0;
  for (const s of eligibleSessions) {
    const t = store.transferForSession(s.id);
    const st = t?.status;
    if (st === 'confirmed') confirmed += 1;
    else if (st === 'failed') failed += 1;
    else if (st === 'pending' || st === 'sent') pending += 1;
    else unset += 1;
  }
  let status: HhaTransferStatus = 'none';
  if (failed > 0) status = 'failed';
  else if (eligibleSessions.length > 0 && confirmed === eligibleSessions.length) status = 'confirmed';
  else if (confirmed > 0 || pending > 0) status = 'pending';
  return {
    sessionCount: sessions.length,
    eligible: eligibleSessions.length,
    confirmed,
    failed,
    pending,
    unset,
    status,
  };
}

/** Same bar as missing-notes: empty notes do not count as posted; short notes do. */
export function sessionHasPostedNote(notes: string | undefined): boolean {
  return String(notes || '').trim().length > 0;
}

/** Attended + makeup count as delivered; missed does not. */
function isDeliveredSession(s: SessionRow): boolean {
  return s.attendance === 'attended' || s.attendance === 'makeup';
}

function mandateLabel(m: Mandate | undefined): string {
  if (!m) return 'Unassigned';
  const svc = (m.serviceType || m.discipline || 'Mandate').trim();
  const ratio = m.ratioGroup ? ' group' : ' individual';
  return `${svc}${m.serviceType ? '' : ratio}`.trim() || 'Mandate';
}

/** Expected session count for progress % (weekly / cycle / monthly mandate frequency). */
export function mandateExpectedSessions(mandate: Mandate | undefined): number {
  if (!mandate) return 0;
  const weekly = weeklyAllowedSessions(mandate);
  if (weekly != null) return weekly > 0 ? weekly : 0;
  const kind = mandateFrequencyKind(mandate);
  if (kind === 'monthly') return monthlyAllowedSessions(mandate);
  if (kind === 'school_day_cycle') return cycleAllowedSessions(mandate);
  return Number(mandate.frequencyPerWeek) || Number(mandate.sessionsPerPeriod) || 0;
}

/** Cap at 100; 0 expected → 0% when nothing delivered, else 100 when any work exists. */
export function pctOfMandate(count: number, expected: number): number {
  if (expected <= 0) return count > 0 ? 100 : 0;
  return Math.min(100, Math.round((Math.max(0, count) / expected) * 100));
}

function weekEndFromStart(weekStart: string): string {
  const dt = parseDos(weekStart);
  if (!dt) return weekStart;
  dt.setUTCDate(dt.getUTCDate() + 6);
  return isoDate(dt);
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
            : 'Session note missing',
      };
    });
}

/**
 * Admin weekly progress: child + mandate + week.
 * - Sessions delivered % = attended+makeup vs mandate frequency (missed excluded).
 * - Notes posted % = sessions with any note (missed + attended + makeup) vs mandate.
 * - belowMandate / yellow when delivered count is under the mandate.
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
    programType: string;
    mandateId: string;
    mandateLabel: string;
    providerName: string;
    weekId: string;
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
    mandateExpected: number;
    sessionsProvided: number;
    sessionsDeliveredPct: number;
    notesPosted: number;
    notesPostedPct: number;
    sessionsMissed: number;
    notesFollowUp: number;
    /** @deprecated alias of sessionsDeliveredPct for older clients */
    progressPct: number;
    belowMandate: boolean;
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
      const programType = String(student?.programType || '').trim() || '—';
      const mandates = store.mandatesForStudent(studentId);

      const pushRow = (
        mandate: Mandate | undefined,
        assigned: SessionRow[],
      ) => {
        const delivered = assigned.filter(isDeliveredSession);
        const missed = assigned.filter((s) => s.attendance === 'missed');
        const sessionsProvided = delivered.length;
        // Missed + attended + makeup all count once a note/reason text is present.
        const notesPosted = assigned.filter((s) => sessionHasPostedNote(s.notes)).length;
        const notesFollowUp = assigned.filter((s) => !sessionHasPostedNote(s.notes)).length;
        if (!assigned.length && sessionsProvided === 0) return;
        const mandateExpected = mandateExpectedSessions(mandate);
        const sessionsDeliveredPct = pctOfMandate(sessionsProvided, mandateExpected);
        const notesPostedPct = pctOfMandate(notesPosted, mandateExpected);
        const belowMandate = mandateExpected > 0 && sessionsProvided < mandateExpected;
        const provider = mandate
          ? store.data.providers.find((p) => p.id === mandate.providerId)
          : undefined;
        rows.push({
          studentId,
          childName,
          schoolName,
          programType,
          mandateId: mandate?.id || '',
          mandateLabel: mandateLabel(mandate),
          providerName: provider
            ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
            : '—',
          weekId: week.id,
          weekStart: week.weekStart,
          weekEnd: weekEndFromStart(week.weekStart),
          weekLabel: `${week.weekStart} → ${weekEndFromStart(week.weekStart)}`,
          mandateExpected,
          sessionsProvided,
          sessionsDeliveredPct,
          notesPosted,
          notesPostedPct,
          sessionsMissed: missed.length,
          notesFollowUp,
          progressPct: sessionsDeliveredPct,
          belowMandate,
          milestoneProvided: sessionsDeliveredPct >= 100,
          milestoneNotes: notesPostedPct >= 100,
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

export function enrichWeekHhaError<T extends { id: string; hhaStatus: string; hhaError?: string }>(
  store: MemoryStore,
  w: T,
): T & { hhaError: string } {
  const transferErrors = (store.data.hhaTransfers || [])
    .filter((t) => t.weekId === w.id && t.status === 'failed' && t.lastError)
    .map((t) => t.lastError);
  const hhaError =
    (w.hhaError || '').trim() ||
    (transferErrors.length ? [...new Set(transferErrors)].join('\n') : '');
  return { ...w, hhaError };
}

export function adminWeeksList(store: MemoryStore) {
  return (store.data.weeks || []).map((w) => {
    const provider = (store.data.providers || []).find((p) => p.id === w.providerId);
    const enriched = enrichWeekHhaError(store, w);
    const rollup = weekHhaRollup(store, w.id);
    // Prefer live transfer rollup so a week is never "confirmed" while failures remain.
    const hhaStatus: HhaTransferStatus =
      rollup.status !== 'none'
        ? rollup.status
        : w.hhaStatus === 'failed' && enriched.hhaError
          ? 'failed'
          : w.hhaStatus || 'none';
    return {
      id: w.id,
      weekStart: w.weekStart,
      status: w.status,
      signerName: w.signerName,
      signerEmail: w.signerEmail,
      hhaStatus,
      hhaError: enriched.hhaError,
      hhaConfirmed: rollup.confirmed,
      hhaFailed: rollup.failed,
      hhaPending: rollup.pending,
      hhaEligible: rollup.eligible,
      providerId: w.providerId,
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
        : w.providerId?.trim()
          ? w.providerId
          : '—',
      /** All sessions (attended + missed + makeup). HHA uses hhaEligible only. */
      sessionCount: rollup.sessionCount,
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

function sessionProviderId(store: MemoryStore, s: SessionRow): string {
  const week = store.data.weeks.find((w) => w.id === s.weekId);
  let resolved = String(week?.providerId || '').trim();
  if (!resolved) {
    const mandate = store.data.mandates.find(
      (m) => m.studentId === s.studentId && m.providerId,
    );
    resolved = String(mandate?.providerId || '').trim();
  }
  return resolved;
}

/**
 * Admin Session notes report: attended vs missed totals for a dateOfService range.
 * Attended includes makeup (same delivered bar as weekly progress / HHA).
 */
export function sessionNotesReport(
  store: MemoryStore,
  opts: { from?: string; to?: string; providerId?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const providerId = String(opts.providerId || '').trim();

  const rows: Array<{
    sessionId: string;
    studentId: string;
    childName: string;
    providerId: string;
    providerName: string;
    schoolName: string;
    dateOfService: string;
    attendance: string;
    beginTime: string;
    endTime: string;
    notesPosted: boolean;
  }> = [];

  let attendedOnly = 0;
  let makeup = 0;
  let missed = 0;
  let other = 0;

  for (const s of store.data.sessions) {
    if (!dosInRange(s.dateOfService, from, to)) continue;
    const resolvedProviderId = sessionProviderId(store, s);
    if (providerId && resolvedProviderId !== providerId) continue;

    const att = String(s.attendance || '').trim() || 'attended';
    if (att === 'attended') attendedOnly += 1;
    else if (att === 'makeup') makeup += 1;
    else if (att === 'missed') missed += 1;
    else other += 1;

    const student = store.data.students.find((st) => st.id === s.studentId);
    const school = student
      ? store.data.schools.find((sc) => sc.id === student.schoolId)
      : undefined;
    const provider = resolvedProviderId
      ? store.data.providers.find((p) => p.id === resolvedProviderId)
      : undefined;
    rows.push({
      sessionId: s.id,
      studentId: s.studentId,
      childName: student
        ? `${student.firstName} ${student.lastName}`.trim() || s.studentId
        : s.studentId,
      providerId: resolvedProviderId,
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || provider.id
        : '—',
      schoolName: school?.name || '—',
      dateOfService: s.dateOfService,
      attendance: att,
      beginTime: s.beginTime || '',
      endTime: s.endTime || '',
      notesPosted: sessionHasPostedNote(s.notes),
    });
  }

  rows.sort(
    (a, b) =>
      a.dateOfService.localeCompare(b.dateOfService) ||
      a.childName.localeCompare(b.childName) ||
      a.providerName.localeCompare(b.providerName),
  );

  const attended = attendedOnly + makeup;
  const total = attended + missed + other;
  return {
    from: from || null,
    to: to || null,
    providerId: providerId || null,
    totals: {
      attended,
      attendedOnly,
      makeup,
      missed,
      other,
      total,
    },
    rows,
  };
}

/**
 * Admin internal notes across providers (Admin → Providers → Internal notes).
 * Filter by note createdAt date (YYYY-MM-DD) and optional providerId.
 */
export function adminInternalNotesReport(
  store: MemoryStore,
  opts: { from?: string; to?: string; providerId?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const providerId = String(opts.providerId || '').trim();
  return store.data.adminNotes
    .filter((n) => {
      if (providerId && n.providerId !== providerId) return false;
      const day = String(n.createdAt || '').slice(0, 10);
      if (from && (!day || day < from)) return false;
      if (to && (!day || day > to)) return false;
      return true;
    })
    .map((n) => {
      const provider = store.data.providers.find((p) => p.id === n.providerId);
      const author = store.userById(n.authorId) || store.data.users.find((u) => u.id === n.authorId);
      return {
        id: n.id,
        providerId: n.providerId,
        providerName: provider
          ? `${provider.firstName} ${provider.lastName}`.trim() || provider.id
          : n.providerId || '—',
        body: n.body || '',
        tags: Array.isArray(n.tags) ? n.tags : [],
        createdAt: n.createdAt || '',
        authorId: n.authorId || '',
        authorName: author
          ? String(author.displayName || author.email || '').trim() || author.id
          : n.authorId || '—',
      };
    })
    .sort((a, b) => {
      const ca = String(a.createdAt || '');
      const cb = String(b.createdAt || '');
      if (ca !== cb) return cb.localeCompare(ca);
      return a.providerName.localeCompare(b.providerName);
    });
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
  const weeks = store.data.weeks || [];
  const transfers = store.data.hhaTransfers || [];
  const count = (status: string) => weeks.filter((w) => w.status === status).length;
  const hhaFail = transfers.filter((t) => t.status === 'failed').length;
  const hhaPending = transfers.filter((t) => t.status === 'pending' || t.status === 'sent').length;
  // Eligible = attended/makeup on signed/locked weeks (same set HHA can transfer).
  const hhaEligible = weeks
    .filter((w) => w.status === 'signed' || w.status === 'locked')
    .reduce((n, w) => n + weekHhaRollup(store, w.id).eligible, 0);
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
      confirmed: transfers.filter((t) => t.status === 'confirmed').length,
      eligible: hhaEligible,
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

function resolveMandateProvider(store: MemoryStore, providerId: string) {
  const rawId = String(providerId || '').trim();
  if (!rawId) return undefined;
  const raw = store.data.providers.find((p) => p.id === rawId);
  if (!raw) return undefined;
  const nameKey = providerDisplayNameKey(raw);
  const sameName = nameKey
    ? store.data.providers.filter((p) => providerDisplayNameKey(p) === nameKey)
    : [raw];
  return preferCanonicalProvider(sameName) || raw;
}

export function adminStudentDetail(store: MemoryStore, studentId: string) {
  const student = store.data.students.find((s) => s.id === studentId);
  if (!student) return null;
  const school = store.data.schools.find((s) => s.id === student.schoolId);
  const mandates = store.mandatesForStudent(student.id).map((m) => {
    const provider = resolveMandateProvider(store, m.providerId);
    const kind = mandateFrequencyKind(m);
    const sessionsPerPeriod = m.sessionsPerPeriod ?? m.frequencyPerWeek ?? 0;
    const periodSchoolDays = m.periodSchoolDays ?? (kind === 'school_day_cycle' ? 6 : 0);
    return {
      ...m,
      // Link/display the canonical (linked) profile when duplicates share a name.
      providerId: provider?.id || '',
      // Never show a provider name without a resolvable providerId.
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || provider.id
        : '—',
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
      name: m.providerName && m.providerName !== '—' ? m.providerName : id,
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
  const weeks = store.data.weeks
    .filter((w) => weekIds.includes(w.id))
    .map((w) => enrichWeekHhaError(store, w));
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
  const configured = hasConfiguredSchoolCalendar(calendar);
  const setup = schoolSetupIncomplete(school, calendar);
  return {
    school,
    calendar,
    schoolCalendarSummary: schoolCalendarSummary(calendar || undefined),
    calendarConfigured: configured,
    calendarFallbackWarning: configured
      ? ''
      : schoolCalendarMonFriFallbackWarning(school.name),
    addressConfigured: !setup.missingAddress,
    setupIncomplete: setup.incomplete,
    setupMissingCalendar: setup.missingCalendar,
    setupMissingAddress: setup.missingAddress,
    setupIncompleteMessage: setup.message,
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
  const weeks = store.data.weeks
    .filter((w) => aliasIds.has(w.providerId) || w.providerId === provider.id)
    .map((w) => enrichWeekHhaError(store, w));
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const sessions = store.data.sessions
    .filter((s) => weekById.has(s.weekId))
    .map((s) => {
      const w = weekById.get(s.weekId);
      const student = store.data.students.find((st) => st.id === s.studentId);
      return {
        ...s,
        weekStart: w?.weekStart || '',
        weekStatus: w?.status || '',
        studentName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : s.studentId,
      };
    })
    .sort((a, b) => {
      const da = String(a.dateOfService || '');
      const db = String(b.dateOfService || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.beginTime || '').localeCompare(String(a.beginTime || ''));
    });
  const files = store.filesForProvider(provider.id);
  const extraTags = [...new Set(notes.flatMap((n) => n.tags || []))];
  return {
    provider,
    user,
    notes,
    mandates,
    weeks,
    sessions,
    files,
    noteTagOptions: [...new Set([...DEFAULT_ADMIN_NOTE_TAGS, ...extraTags])],
    caseloadCount: new Set(mandates.map((m) => m.studentId)).size,
    redirectedFromProviderId: opened.id !== provider.id ? opened.id : undefined,
  };
}
