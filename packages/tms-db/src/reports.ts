import {
  formatFreqDisplay,
  preferCanonicalProvider,
  providerDisplayNameKey,
} from './caseload-import.js';
import { dueDateStatus } from './due-dates.js';
import {
  isNoChildPlaceholderName,
  assignSessionsToMandates,
  cycleAllowedSessions,
  isMakeupKindMandate,
  mandateDischargedForWeek,
  mandateFrequencyKind,
  monthlyAllowedSessions,
  schoolBillingServiceNameForMandate,
  sessionListedChildName,
  sessionSlotLabel,
  weeklyAllowedSessions,
} from './mandate.js';
import { isoDate, parseDos } from './ids.js';
import { isHhaTransferSession } from './provider-pay.js';
import { schoolCalendarSummary, hasConfiguredSchoolCalendar, schoolCalendarMonFriFallbackWarning, schoolSetupIncomplete } from './school-calendar.js';
import type { HhaTransfer, HhaTransferStatus, Mandate, SessionRow, Student } from './types.js';
import { DEFAULT_ADMIN_NOTE_TAGS, additionalServiceLabel } from './types.js';
import { isSettledHhaTransfer, type MemoryStore } from './memory-store.js';
import {
  normalizeProgramTypeKey,
  normalizeSignerEmail,
  resolveWeekProgramType,
} from './week-school.js';

/**
 * `Child · date begin–end · service: message`.
 * Date stays as stored (YYYY-MM-DD or M/D/YYYY). Service is the session’s
 * service type (or additional-service name) when that field is set.
 * An older label is rebuilt so a stored failure picks up the service
 * without another HHA send.
 */
const HHA_VISIT_LABEL_RE =
  /^(.+?) · ((?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|unknown date)(?:\s+\d{1,2}:\d{2}(?:\s*[ap]m)?(?:\s*[–-]\s*\d{1,2}:\d{2}(?:\s*[ap]m)?)?)?)(?: · (.+?))?: ([\s\S]+)$/i;

function hhaTransferVisitService(
  session?: Pick<SessionRow, 'serviceType' | 'additionalServiceType'> | null,
): string {
  if (!session) return '';
  const extra = additionalServiceLabel(session.additionalServiceType);
  if (extra) return extra;
  return String(session.serviceType || '').trim();
}

export function labelHhaTransferError(
  message: string,
  opts: {
    childName?: string | null;
    session?: Pick<
      SessionRow,
      'dateOfService' | 'beginTime' | 'endTime' | 'serviceType' | 'additionalServiceType'
    > | null;
  },
): string {
  const msg = String(message || '').trim();
  if (!msg) return msg;
  const existing = msg.match(HHA_VISIT_LABEL_RE);
  let body = msg;
  let priorChild = '';
  let priorSlot = '';
  let priorService = '';
  if (existing) {
    priorChild = existing[1].trim();
    priorSlot = existing[2].trim();
    priorService = (existing[3] || '').trim();
    body = existing[4].trim();
  } else if (/^Unknown child:\s+/.test(msg)) {
    priorChild = 'Unknown child';
    body = msg.replace(/^Unknown child:\s+/, '');
  }
  const child = String(opts.childName || '').trim() || priorChild || 'Unknown child';
  const slot = opts.session ? sessionSlotLabel(opts.session as SessionRow) : priorSlot;
  const fromSession = opts.session ? hhaTransferVisitService(opts.session) : '';
  const service = fromSession || priorService;
  const prefix = [child, slot, service].filter(Boolean).join(' · ');
  return `${prefix}: ${body}`;
}

/**
 * Admin "district" label for filters / columns.
 * Caseload imports store the payer/district on student.programType and often leave
 * school.district blank (building-only school rows), so prefer programType.
 */
export function districtLabelForStudent(
  student?: Pick<Student, 'programType'> | null,
  school?: { district?: string } | null,
): string {
  return String(student?.programType || school?.district || '').trim();
}

/** Admin Generate-timesheet picker row: program type (+ signer only when it splits the bin). */
export type TimesheetProgramOption = {
  /** Representative schoolId when multiple signers share a program type; else empty. */
  id: string;
  programType: string;
  signerEmail: string;
  signerName: string;
  label: string;
};

type SignerBucket = {
  schoolId: string;
  signerEmail: string;
  signerName: string;
  schoolName: string;
};

/**
 * Dropdown options for admin "Generate timesheet": one row per program type
 * (district/payer). Buildings that share a signer collapse. Only when the same
 * program has multiple distinct signer emails do we show "Program · Signer".
 * Never lists raw school-building names without a program type.
 */
export function buildTimesheetProgramOptions(
  store: MemoryStore,
  providerIds: Iterable<string>,
): TimesheetProgramOption[] {
  const aliasIds = new Set(
    [...providerIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  if (!aliasIds.size) return [];

  const studentIds = new Set(
    store.data.mandates
      .filter((m) => aliasIds.has(String(m.providerId || '').trim()))
      .map((m) => m.studentId),
  );

  /** programKey → { label, bySignerEmail } */
  const byProgram = new Map<
    string,
    { programType: string; bySigner: Map<string, SignerBucket> }
  >();

  const add = (programTypeRaw: string | undefined | null, schoolIdRaw: string | undefined | null) => {
    const programType = String(programTypeRaw || '').trim();
    if (!programType) return;
    const schoolId = String(schoolIdRaw || '').trim();
    const school = schoolId
      ? store.data.schools.find((s) => s.id === schoolId)
      : undefined;
    const signerEmail = String(school?.signerEmail || '').trim();
    const signerKey = normalizeSignerEmail(signerEmail);
    const ptKey = normalizeProgramTypeKey(programType);
    let prog = byProgram.get(ptKey);
    if (!prog) {
      prog = { programType, bySigner: new Map() };
      byProgram.set(ptKey, prog);
    }
    const existing = prog.bySigner.get(signerKey);
    if (existing) {
      if (!existing.schoolId && schoolId) existing.schoolId = schoolId;
      if (!existing.signerName && school?.signerName) {
        existing.signerName = String(school.signerName).trim();
      }
      if (!existing.schoolName && school?.name) {
        existing.schoolName = String(school.name).trim();
      }
      return;
    }
    prog.bySigner.set(signerKey, {
      schoolId,
      signerEmail,
      signerName: String(school?.signerName || '').trim(),
      schoolName: String(school?.name || '').trim(),
    });
  };

  for (const s of store.data.students) {
    if (!studentIds.has(s.id)) continue;
    add(s.programType, s.schoolId);
  }
  for (const w of store.data.weeks) {
    if (!aliasIds.has(String(w.providerId || '').trim())) continue;
    const stamped = String(w.programType || '').trim();
    if (stamped) {
      add(stamped, w.schoolId);
      continue;
    }
    // Legacy week: infer program from session children when stamped programType is empty.
    for (const sess of store.sessionsForWeek(w.id)) {
      const student = store.data.students.find((st) => st.id === sess.studentId);
      if (!student) continue;
      add(student.programType, student.schoolId || w.schoolId);
    }
  }

  const options: TimesheetProgramOption[] = [];
  for (const prog of byProgram.values()) {
    const signed = [...prog.bySigner.entries()].filter(([emailKey]) => Boolean(emailKey));
    const unsigned = prog.bySigner.get('');
    if (signed.length <= 1) {
      const only = signed[0]?.[1] || unsigned;
      options.push({
        id: '',
        programType: prog.programType,
        signerEmail: only?.signerEmail || '',
        signerName: only?.signerName || '',
        label: prog.programType,
      });
      continue;
    }
    for (const [, bucket] of signed) {
      const signerLabel =
        bucket.signerName || bucket.signerEmail || bucket.schoolName || 'Signer';
      options.push({
        id: bucket.schoolId,
        programType: prog.programType,
        signerEmail: bucket.signerEmail,
        signerName: bucket.signerName,
        label: `${prog.programType} · ${signerLabel}`,
      });
    }
  }

  return options.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

/** Per-week HHA transfer rollup (attended, makeup, and payable missed paid absences). */
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
 * One pass over sessions and transfers so dashboard / week list do not
 * rescan the full arrays once per week and once per eligible session.
 * Best-transfer rank matches MemoryStore.transferForSession (lower wins;
 * equal rank keeps the earlier row).
 */
type HhaLookups = {
  sessionsByWeek: Map<string, SessionRow[]>;
  sessionById: Map<string, SessionRow>;
  studentById: Map<string, Student>;
  transferBySession: Map<string, HhaTransfer>;
  transfersByWeek: Map<string, HhaTransfer[]>;
  settledSessionIds: Set<string>;
};

function transferRank(status: string | undefined): number {
  if (status === 'confirmed' || status === 'manual') return 0;
  if (status === 'pending' || status === 'sent') return 1;
  if (status === 'failed') return 2;
  return 3;
}

function buildHhaLookups(store: MemoryStore): HhaLookups {
  const sessionsByWeek = new Map<string, SessionRow[]>();
  const sessionById = new Map<string, SessionRow>();
  for (const s of store.data.sessions || []) {
    sessionById.set(s.id, s);
    const list = sessionsByWeek.get(s.weekId);
    if (list) list.push(s);
    else sessionsByWeek.set(s.weekId, [s]);
  }
  const studentById = new Map<string, Student>();
  for (const st of store.data.students || []) studentById.set(st.id, st);
  const transferBySession = new Map<string, HhaTransfer>();
  const transfersByWeek = new Map<string, HhaTransfer[]>();
  const settledSessionIds = new Set<string>();
  for (const t of store.data.hhaTransfers || []) {
    const prev = transferBySession.get(t.sessionId);
    if (!prev || transferRank(t.status) < transferRank(prev.status)) {
      transferBySession.set(t.sessionId, t);
    }
    const weekRows = transfersByWeek.get(t.weekId);
    if (weekRows) weekRows.push(t);
    else transfersByWeek.set(t.weekId, [t]);
    if (isSettledHhaTransfer(t)) settledSessionIds.add(t.sessionId);
  }
  return {
    sessionsByWeek,
    sessionById,
    studentById,
    transferBySession,
    transfersByWeek,
    settledSessionIds,
  };
}

/**
 * HHA transfers attended, makeup, and paid absences stored as missed.
 * Unpaid misses stay off. Week status must reflect the rows that are sent,
 * not the Sessions column (which includes unpaid misses).
 */
export function weekHhaRollup(
  store: MemoryStore,
  weekId: string,
  lookups?: HhaLookups,
): WeekHhaRollup {
  const sessions = lookups
    ? lookups.sessionsByWeek.get(weekId) || []
    : store.sessionsForWeek(weekId);
  // No-child additional services and paid absences are HHA visits and count toward confirmation.
  const eligibleSessions = sessions.filter((s) => isHhaTransferSession(s));
  let confirmed = 0;
  let failed = 0;
  let pending = 0;
  let unset = 0;
  for (const s of eligibleSessions) {
    const t = lookups ? lookups.transferBySession.get(s.id) : store.transferForSession(s.id);
    const st = t?.status;
    // `manual` is already in HHA without a TMS VisitID. Count it done so the week
    // can leave failed triage, but the session row stays `manual` (not a TMS create).
    if (st === 'confirmed' || st === 'manual') confirmed += 1;
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

/** Attended + makeup count as delivered; missed / paid absence do not. */
function isDeliveredSession(s: SessionRow): boolean {
  return s.attendance === 'attended' || s.attendance === 'makeup';
}

/** Same pool as weekly yellow under-mandate: attended, missed, paid absence. */
function isSubmittedTowardWeeklyProgress(s: SessionRow): boolean {
  return (
    s.attendance === 'attended' ||
    s.attendance === 'missed' ||
    s.attendance === 'paid_absence'
  );
}

/**
 * Weekly progress service column: HHA school billing name
 * (`PT school 30`, `PT school group 30`), not the Related Service label
 * (`Physical Therapy` / `Occupational Therapy`).
 */
function weekProgressServiceLabel(m: Mandate | undefined): string {
  if (!m) return 'Unassigned';
  const stored = String(m.billingServiceName || '').trim();
  if (stored) return stored;
  return schoolBillingServiceNameForMandate(m) || '—';
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
        studentName: sessionListedChildName(
          s,
          student ? `${student.firstName} ${student.lastName}`.trim() : '',
        ),
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
 * Admin weekly progress: child + school billing service + week.
 * - Service column is the HHA billing name (`PT school 30` / `PT school group 30`).
 * - Makeup authorizations (makeup auth and makeup-weekly) are omitted.
 *   Miss-linked makeup visits stay on the regular service row. Unlinked makeups
 *   that exist only on a makeup-authorization row are left out with that row.
 * - Discharged mandates are omitted. Same endOn rule as the child Mandates tab
 *   (endOn on or before today = Discharged), applied to the report week via
 *   mandateDischargedForWeek: endOn on or before that Monday, or endOn <= today
 *   when today falls in the week. A historical week still includes a mandate
 *   discharged after that week. A mandate already ended before the week is out
 *   even if sessions were logged on it.
 * - Every active caseload mandate is listed for each week in range, even with no
 *   sessions (0 delivered, 0%). A mandate that starts after the week is left out.
 * - Sessions delivered % = attended+makeup vs mandate frequency (missed excluded).
 * - Notes posted % = sessions with any note (missed + attended + makeup) vs mandate.
 * - belowMandate / yellow when submitted count is under the mandate — same rule as
 *   weekly yellow warnings: attended, missed, and paid absence all count; makeup does not.
 */
export function weekProgressReport(
  store: MemoryStore,
  opts: { from?: string; to?: string; asOf?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const asOf = String(opts.asOf || '').trim() || easternDateYmd(new Date());
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

  /** Every mandate that got a row for a Monday, so the zero-fill pass skips it. */
  const coveredMandateKeys = new Set<string>();

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
        const missed = assigned.filter(
          (s) => s.attendance === 'missed' || s.attendance === 'paid_absence',
        );
        const sessionsProvided = delivered.length;
        const sessionsSubmitted = assigned.filter(isSubmittedTowardWeeklyProgress).length;
        // Missed + attended + makeup all count once a note/reason text is present.
        const notesPosted = assigned.filter((s) => sessionHasPostedNote(s.notes)).length;
        const notesFollowUp = assigned.filter((s) => !sessionHasPostedNote(s.notes)).length;
        if (!assigned.length && sessionsProvided === 0) return;
        const mandateExpected = mandateExpectedSessions(mandate);
        const sessionsDeliveredPct = pctOfMandate(sessionsProvided, mandateExpected);
        const notesPostedPct = pctOfMandate(notesPosted, mandateExpected);
        // Matches timesheet yellow: a logged miss fills the slot; therapy delivery % stays separate.
        const belowMandate = mandateExpected > 0 && sessionsSubmitted < mandateExpected;
        const provider = mandate
          ? store.data.providers.find((p) => p.id === mandate.providerId)
          : undefined;
        if (mandate) coveredMandateKeys.add(`${week.weekStart}|${mandate.id}`);
        rows.push({
          studentId,
          childName,
          schoolName,
          programType,
          mandateId: mandate?.id || '',
          mandateLabel: weekProgressServiceLabel(mandate),
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

      const progressMandates = mandates.filter(
        (m) => !isMakeupKindMandate(m) && !mandateDischargedForWeek(m, week.weekStart, asOf),
      );
      if (!progressMandates.length) {
        // No caseload mandate → unassigned. Makeup-auth-only and discharged-only children are omitted.
        if (!mandates.length) pushRow(undefined, sessions);
        continue;
      }
      if (progressMandates.length === 1 && mandates.length === 1) {
        pushRow(progressMandates[0], sessions);
        continue;
      }
      const { byMandateId, unmatched } = assignSessionsToMandates(mandates, sessions);
      for (const mandate of progressMandates) {
        const assigned = byMandateId.get(mandate.id) ?? [];
        if (!assigned.length) continue;
        pushRow(mandate, assigned);
      }
      if (unmatched.length) pushRow(undefined, unmatched);
    }
  }

  // Every active caseload mandate shows for each report week, even with no sessions (0%).
  const reportWeekStarts = new Set(weeks.map((w) => w.weekStart));
  const fromDt = from ? parseDos(from) : null;
  const toDt = to ? parseDos(to) : null;
  if (fromDt && toDt) {
    const cursor = new Date(fromDt.getTime());
    while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
    for (let i = 0; i < 104 && cursor.getTime() <= toDt.getTime(); i += 1) {
      reportWeekStarts.add(isoDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  for (const weekStart of reportWeekStarts) {
    const weekEnd = weekEndFromStart(weekStart);
    for (const mandate of store.data.mandates) {
      if (isMakeupKindMandate(mandate)) continue;
      if (mandateDischargedForWeek(mandate, weekStart, asOf)) continue;
      const startOn = parseDos(String(mandate.startOn || ''));
      if (startOn && isoDate(startOn) > weekEnd) continue;
      if (coveredMandateKeys.has(`${weekStart}|${mandate.id}`)) continue;
      const student = store.data.students.find((st) => st.id === mandate.studentId);
      if (!student || isNoChildPlaceholderName(student)) continue;
      const school = store.data.schools.find((sc) => sc.id === student.schoolId);
      const provider = store.data.providers.find((p) => p.id === mandate.providerId);
      const providerWeek = store.data.weeks.find(
        (w) => w.providerId === mandate.providerId && w.weekStart === weekStart,
      );
      const mandateExpected = mandateExpectedSessions(mandate);
      coveredMandateKeys.add(`${weekStart}|${mandate.id}`);
      rows.push({
        studentId: student.id,
        childName: `${student.firstName} ${student.lastName}`.trim() || student.id,
        schoolName: school?.name || '—',
        programType: String(student.programType || '').trim() || '—',
        mandateId: mandate.id,
        mandateLabel: weekProgressServiceLabel(mandate),
        providerName: provider
          ? `${provider.firstName} ${provider.lastName}`.trim() || '—'
          : '—',
        weekId: providerWeek?.id || '',
        weekStart,
        weekEnd,
        weekLabel: `${weekStart} → ${weekEnd}`,
        mandateExpected,
        sessionsProvided: 0,
        sessionsDeliveredPct: 0,
        notesPosted: 0,
        notesPostedPct: 0,
        sessionsMissed: 0,
        notesFollowUp: 0,
        progressPct: 0,
        belowMandate: mandateExpected > 0,
        milestoneProvided: false,
        milestoneNotes: false,
      });
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

export type HhaFailureRow = { sessionId: string; error: string };

/**
 * One row per session whose transfer is still failed. Used by HHA Triage so each
 * session can be marked already in HHA without parsing the joined error blob.
 */
export function weekHhaFailures(store: MemoryStore, weekId: string): HhaFailureRow[] {
  const rows = store.data.hhaTransfers || [];
  const settledSessions = new Set(
    rows.filter((t) => isSettledHhaTransfer(t)).map((t) => t.sessionId),
  );
  const seen = new Set<string>();
  const out: HhaFailureRow[] = [];
  for (const t of rows) {
    if (t.weekId !== weekId || t.status !== 'failed') continue;
    if (settledSessions.has(t.sessionId) || seen.has(t.sessionId)) continue;
    seen.add(t.sessionId);
    const raw = String(t.lastError || '').trim();
    const session = (store.data.sessions || []).find((s) => s.id === t.sessionId);
    const student = session
      ? (store.data.students || []).find((s) => s.id === session.studentId)
      : undefined;
    const childName = student ? `${student.firstName} ${student.lastName}`.trim() : '';
    const error = labelHhaTransferError(
      raw || 'HHA transfer failed (no detail stored).',
      { childName, session },
    );
    out.push({ sessionId: t.sessionId, error });
  }
  return out;
}

/** Live triage text: only currently-failed transfers (ignore stale week.hhaError after -401 heal). */
export function weekHhaErrorFromTransfers(
  store: MemoryStore,
  weekId: string,
  lookups?: HhaLookups,
): string {
  const rows = lookups
    ? lookups.transfersByWeek.get(weekId) || []
    : store.data.hhaTransfers || [];
  const settledSessions = lookups
    ? lookups.settledSessionIds
    : new Set(
        (store.data.hhaTransfers || [])
          .filter((t) => isSettledHhaTransfer(t))
          .map((t) => t.sessionId),
      );
  const transferErrors = rows
    .filter(
      (t) =>
        t.weekId === weekId &&
        t.status === 'failed' &&
        String(t.lastError || '').trim() &&
        !settledSessions.has(t.sessionId),
    )
    .map((t) => {
      const raw = String(t.lastError).trim();
      const session = lookups
        ? lookups.sessionById.get(t.sessionId)
        : (store.data.sessions || []).find((s) => s.id === t.sessionId);
      const student = session
        ? lookups
          ? lookups.studentById.get(session.studentId)
          : (store.data.students || []).find((s) => s.id === session.studentId)
        : undefined;
      const childName = student
        ? `${student.firstName} ${student.lastName}`.trim()
        : '';
      return labelHhaTransferError(raw, { childName, session });
    });
  return transferErrors.length ? [...new Set(transferErrors)].join('\n') : '';
}

export function enrichWeekHhaError<T extends { id: string; hhaStatus: string; hhaError?: string }>(
  store: MemoryStore,
  w: T,
  lookups?: HhaLookups,
): T & { hhaError: string } {
  const allTransfers = lookups ? undefined : store.data.hhaTransfers || [];
  const settledSessions = lookups
    ? lookups.settledSessionIds
    : new Set(
        (allTransfers || []).filter((t) => isSettledHhaTransfer(t)).map((t) => t.sessionId),
      );
  const weekTransfers = lookups
    ? lookups.transfersByWeek.get(w.id) || []
    : (allTransfers || []).filter((t) => t.weekId === w.id);
  const activeFailed = weekTransfers.filter(
    (t) => t.status === 'failed' && !settledSessions.has(t.sessionId),
  );
  const fromTransfers = weekHhaErrorFromTransfers(store, w.id, lookups);
  if (fromTransfers) return { ...w, hhaError: fromTransfers };
  // Transfers exist and none are still-failed → suppress stale week.hhaError (healed -401 or superseded -310).
  if (weekTransfers.length > 0 && activeFailed.length === 0) {
    return { ...w, hhaError: '' };
  }
  // Failed rows without lastError, or legacy week-level fail before transfer rows existed.
  if (activeFailed.length > 0 || w.hhaStatus === 'failed') {
    return { ...w, hhaError: (w.hhaError || '').trim() };
  }
  return { ...w, hhaError: '' };
}

export function adminWeeksList(
  store: MemoryStore,
  opts: { weekStart?: string; name?: string } = {},
) {
  const wantStart = String(opts.weekStart || '').trim();
  const nameQ = String(opts.name || '').trim().toLowerCase();
  let weeks = store.data.weeks || [];
  if (wantStart) {
    weeks = weeks.filter((w) => String(w.weekStart || '').trim() === wantStart);
  }
  const lookups = buildHhaLookups(store);
  const providerById = new Map((store.data.providers || []).map((p) => [p.id, p]));
  const schoolById = new Map((store.data.schools || []).map((s) => [s.id, s]));
  const rows = weeks.map((w) => {
    const provider = providerById.get(w.providerId);
    const enriched = enrichWeekHhaError(store, w, lookups);
    const rollup = weekHhaRollup(store, w.id, lookups);
    // Prefer live transfer rollup so a week is never "confirmed" while failures remain.
    const hhaStatus: HhaTransferStatus =
      rollup.status !== 'none'
        ? rollup.status
        : w.hhaStatus === 'failed' && enriched.hhaError
          ? 'failed'
          : w.hhaStatus || 'none';
    const schoolId =
      String(w.schoolId || '').trim() ||
      (() => {
        const sessions = lookups.sessionsByWeek.get(w.id) || [];
        const counts = new Map<string, number>();
        for (const s of sessions) {
          const student = lookups.studentById.get(s.studentId);
          const sid = String(student?.schoolId || '').trim();
          if (!sid) continue;
          counts.set(sid, (counts.get(sid) || 0) + 1);
        }
        let best = '';
        let bestN = 0;
        for (const [id, n] of counts) {
          if (n > bestN) {
            best = id;
            bestN = n;
          }
        }
        return best;
      })();
    const school = schoolId ? schoolById.get(schoolId) : undefined;
    // District/payer = caseload programType (stamped or inferred); school.district is often blank.
    const programType =
      resolveWeekProgramType(store, w) || String(school?.district || '').trim();
    return {
      id: w.id,
      weekStart: w.weekStart,
      status: w.status,
      schoolId: schoolId || '',
      schoolName: school?.name || '',
      programType,
      district: programType || school?.district || '',
      signerName: w.signerName,
      signerEmail: w.signerEmail,
      signatureRequestStatus: w.signatureRequestStatus || '',
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
  // Provider status Drafts: hide empty draft/reopened weeks left by failed imports.
  // Weeks with imported sessions stay (including later HHA failures). Submitted/signed stay.
  const withSessionsOrNonDraft = rows.filter((row) => {
    const draft = row.status === 'draft' || row.status === 'reopened';
    if (!draft) return true;
    return row.sessionCount > 0;
  });
  if (!nameQ) return withSessionsOrNonDraft;
  return withSessionsOrNonDraft.filter((row) => {
    if (String(row.providerName || '').toLowerCase().includes(nameQ)) return true;
    const sessions = lookups.sessionsByWeek.get(row.id) || [];
    for (const s of sessions) {
      const student = lookups.studentById.get(s.studentId);
      if (!student) continue;
      const full = `${student.firstName || ''} ${student.lastName || ''}`.trim().toLowerCase();
      if (full.includes(nameQ)) return true;
    }
    return false;
  });
}

function mandateProviderIdsForStudent(store: MemoryStore, studentId: string): string[] {
  const ids = new Set<string>();
  for (const m of store.data.mandates) {
    if (m.studentId !== studentId) continue;
    const pid = String(m.providerId || '').trim();
    if (pid) ids.add(pid);
  }
  return [...ids];
}

/**
 * Mandates-tab active rule, with no report week: endOn set and on or before
 * asOf is discharged (`mandateDischargedForWeek` with an empty week start).
 * No end date, or an end date after asOf, is still active.
 */
function studentHasActiveMandate(store: MemoryStore, studentId: string, asOf: string): boolean {
  return store.data.mandates.some(
    (m) => m.studentId === studentId && !mandateDischargedForWeek(m, '', asOf),
  );
}

/** Calendar key so 10/01/2026 sorts after 09/30/2026. */
function dosSortKey(dos: string): string {
  const dt = parseDos(dos);
  return dt ? isoDate(dt) : '';
}

function providerDisplayName(store: MemoryStore, providerId: string): string {
  const provider = providerId
    ? store.data.providers.find((p) => p.id === providerId)
    : undefined;
  if (!provider) return '—';
  return `${provider.firstName} ${provider.lastName}`.trim() || '—';
}

/**
 * No Last DOS yet. One provider stays named. Several providers share this one
 * row as a single combined name — there is no discipline column to split on.
 */
function blankLastDosProvider(store: MemoryStore, studentId: string): {
  providerId: string;
  providerName: string;
} {
  const ids = mandateProviderIdsForStudent(store, studentId);
  if (ids.length === 1) {
    const providerId = ids[0] || '';
    return { providerId, providerName: providerDisplayName(store, providerId) };
  }
  if (ids.length > 1) {
    const names = [
      ...new Set(
        ids
          .map((id) => providerDisplayName(store, id))
          .filter((name) => name && name !== '—'),
      ),
    ].sort((a, b) => a.localeCompare(b));
    return { providerId: '', providerName: names.join(', ') || '—' };
  }
  return { providerId: '', providerName: '—' };
}

function studentTouchesProvider(
  store: MemoryStore,
  studentId: string,
  providerId: string,
  from: string,
  to: string,
): boolean {
  if (mandateProviderIdsForStudent(store, studentId).includes(providerId)) return true;
  for (const s of store.data.sessions) {
    if (s.studentId !== studentId) continue;
    if (s.attendance === 'missed') continue;
    if (!dosInRange(s.dateOfService, from, to)) continue;
    if (sessionProviderId(store, s) === providerId) return true;
  }
  return false;
}

export function lastServiceByStudent(
  store: MemoryStore,
  opts: { from?: string; to?: string; providerId?: string; asOf?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const providerId = String(opts.providerId || '').trim();
  /** This report has no as-of date selector. Active means active as of today. */
  const asOf = String(opts.asOf || '').trim() || easternDateYmd(new Date());
  /**
   * One row per child. Last DOS is the latest attended or makeup date across
   * every mandate, including a discharged mandate. The child is listed only
   * when at least one mandate is still active.
   */
  const map = new Map<string, { studentId: string; providerId: string; lastDos: string; lastKey: string }>();

  for (const s of store.data.sessions) {
    if (s.attendance === 'missed') continue;
    const studentId = String(s.studentId || '').trim();
    if (!studentId) continue;
    if (!dosInRange(s.dateOfService, from, to)) continue;
    const resolvedProviderId = sessionProviderId(store, s);
    const lastKey = dosSortKey(s.dateOfService);
    const prev = map.get(studentId);
    if (!prev || (lastKey && lastKey > prev.lastKey)) {
      map.set(studentId, {
        studentId,
        providerId: resolvedProviderId,
        lastDos: s.dateOfService,
        lastKey,
      });
    }
  }

  for (const student of store.data.students) {
    if (!studentHasActiveMandate(store, student.id, asOf)) continue;
    if (map.has(student.id)) continue;
    map.set(student.id, { studentId: student.id, providerId: '', lastDos: '', lastKey: '' });
  }

  return [...map.values()]
    .filter((row) => studentHasActiveMandate(store, row.studentId, asOf))
    .filter(
      (row) =>
        !providerId || studentTouchesProvider(store, row.studentId, providerId, from, to),
    )
    .map((row) => {
      const student = store.data.students.find((st) => st.id === row.studentId);
      const school = student
        ? store.data.schools.find((sc) => sc.id === student.schoolId)
        : undefined;
      const provider = row.lastDos
        ? { providerId: row.providerId, providerName: providerDisplayName(store, row.providerId) }
        : blankLastDosProvider(store, row.studentId);
      return {
        studentId: row.studentId,
        name: student ? `${student.firstName} ${student.lastName}` : row.studentId,
        providerId: provider.providerId,
        providerName: provider.providerName,
        schoolId: student?.schoolId || '',
        schoolName: school?.name || '—',
        lastDos: row.lastDos,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        dosSortKey(a.lastDos).localeCompare(dosSortKey(b.lastDos)) ||
        a.providerName.localeCompare(b.providerName),
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
  opts: { from?: string; to?: string; providerId?: string; district?: string } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const providerId = String(opts.providerId || '').trim();
  const districtKey = String(opts.district || '')
    .trim()
    .toLowerCase();

  const rows: Array<{
    sessionId: string;
    studentId: string;
    childName: string;
    providerId: string;
    providerName: string;
    schoolName: string;
    district: string;
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

    const student = store.data.students.find((st) => st.id === s.studentId);
    const school = student
      ? store.data.schools.find((sc) => sc.id === student.schoolId)
      : undefined;
    const district = districtLabelForStudent(student, school);
    if (districtKey && district.toLowerCase() !== districtKey) continue;

    const att = String(s.attendance || '').trim() || 'attended';
    if (att === 'attended') attendedOnly += 1;
    else if (att === 'makeup') makeup += 1;
    else if (att === 'missed') missed += 1;
    else other += 1;

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
      district: district || '—',
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
  // Caseload programType is the payer/district; school.district is often blank on imports.
  const districtOptions = [
    ...new Set(
      store.data.students
        .map((st) => {
          const school = store.data.schools.find((sc) => sc.id === st.schoolId);
          return districtLabelForStudent(st, school);
        })
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return {
    from: from || null,
    to: to || null,
    providerId: providerId || null,
    district: opts.district ? String(opts.district).trim() : null,
    totals: {
      attended,
      attendedOnly,
      makeup,
      missed,
      other,
      total,
    },
    rows,
    districtOptions,
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date YYYY-MM-DD in America/New_York. */
export function easternDateYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function easternYmdFromIso(iso: string | undefined): string {
  const raw = String(iso || '').trim();
  if (!raw) return '';
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return '';
  return easternDateYmd(new Date(t));
}

/** `YYYY-MM-DD HH:mm` in America/New_York. */
export function formatEasternDateTime(iso: string | undefined): string {
  const raw = String(iso || '').trim();
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${minute}`;
}

/**
 * Payroll report only. `manual` is settled for triage but TMS did not create a visit
 * and there is no VisitID, so it is not a successful transfer row.
 */
function isTmsRecordedHhaTransfer(t: HhaTransfer): boolean {
  return isSettledHhaTransfer(t) && t.status !== 'manual';
}

/**
 * One successful transfer per session: confirmed beats sent+VisitID.
 * Failed-only sessions are dropped. Leftover failed duplicates are ignored
 * when a settled row exists. Manual already-in-HHA marks are not TMS transfers.
 */
function pickSuccessfulHhaTransfer(list: HhaTransfer[]): HhaTransfer | null {
  const settled = list.filter((t) => isTmsRecordedHhaTransfer(t));
  if (!settled.length) return null;
  const confirmed = settled.filter((t) => t.status === 'confirmed');
  const pool = confirmed.length ? confirmed : settled;
  return [...pool].sort((a, b) => {
    const av = /^\d+$/.test(String(a.hhaVisitId || '').trim()) ? 0 : 1;
    const bv = /^\d+$/.test(String(b.hhaVisitId || '').trim()) ? 0 : 1;
    if (av !== bv) return av - bv;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  })[0];
}

export type HhaTransferReportRow = {
  sessionId: string;
  transferAt: string;
  transferAtDisplay: string;
  visitId: string;
  childName: string;
  providerName: string;
  district: string;
  schoolName: string;
  dateOfService: string;
  time: string;
  attendance: string;
  service: string;
  hhaStatus: string;
};

export type HhaTransfersReportResult =
  | {
      ok: true;
      from: string;
      to: string;
      timezone: 'America/New_York';
      rows: HhaTransferReportRow[];
    }
  | { ok: false; error: string };

/**
 * Admin report: successful HHA transfers whose updatedAt falls on an inclusive
 * America/New_York calendar day in [from, to]. That is the transfer timestamp,
 * not date of service.
 *
 * Transfers are already on the request snapshot (no date GSI). Filter that
 * in-memory list — do not start a second unbounded table scan.
 */
export function hhaTransfersReport(
  store: MemoryStore,
  opts: { from?: string; to?: string } = {},
): HhaTransfersReportResult {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  if (!YMD.test(from) || !YMD.test(to)) {
    return { ok: false, error: 'From and To are required (YYYY-MM-DD).' };
  }
  if (from > to) {
    return { ok: false, error: 'From must be on or before To.' };
  }

  const bySession = new Map<string, HhaTransfer[]>();
  for (const t of store.data.hhaTransfers || []) {
    const sessionId = String(t.sessionId || '').trim();
    if (!sessionId) continue;
    const list = bySession.get(sessionId);
    if (list) list.push(t);
    else bySession.set(sessionId, [t]);
  }

  const rows: HhaTransferReportRow[] = [];
  for (const [sessionId, list] of bySession) {
    const settled = list.filter((t) => isTmsRecordedHhaTransfer(t));
    if (!settled.length) continue;
    const confirmed = settled.filter((t) => t.status === 'confirmed');
    const pool = confirmed.length ? confirmed : settled;
    const inRange = pool.filter((t) => {
      const day = easternYmdFromIso(t.updatedAt);
      return Boolean(day) && day >= from && day <= to;
    });
    if (!inRange.length) continue;
    const chosen = pickSuccessfulHhaTransfer(inRange);
    if (!chosen) continue;

    const session = store.data.sessions.find((s) => s.id === sessionId);
    const week = session
      ? store.data.weeks.find((w) => w.id === session.weekId)
      : store.data.weeks.find((w) => w.id === chosen.weekId);
    const student = session
      ? store.data.students.find((st) => st.id === session.studentId)
      : undefined;
    const school = student?.schoolId
      ? store.data.schools.find((sc) => sc.id === student.schoolId)
      : week?.schoolId
        ? store.data.schools.find((sc) => sc.id === week.schoolId)
        : undefined;
    const providerId = session
      ? sessionProviderId(store, session)
      : String(week?.providerId || '').trim();
    const provider = providerId
      ? store.data.providers.find((p) => p.id === providerId)
      : undefined;
    const begin = String(session?.beginTime || '').trim();
    const end = String(session?.endTime || '').trim();
    const time = begin && end ? `${begin}–${end}` : begin || end;
    const addl = session ? additionalServiceLabel(session.additionalServiceType) : '';
    const service = addl || String(session?.serviceType || '').trim();
    const child = session
      ? sessionListedChildName(
          session,
          student ? `${student.firstName} ${student.lastName}`.trim() : '',
        )
      : '';
    const district =
      districtLabelForStudent(student, school) ||
      String(session?.programType || '').trim() ||
      String(week?.programType || '').trim();

    rows.push({
      sessionId,
      transferAt: String(chosen.updatedAt || ''),
      transferAtDisplay: formatEasternDateTime(chosen.updatedAt),
      visitId: String(chosen.hhaVisitId || '').trim(),
      childName: child || '—',
      providerName: provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || provider.id
        : '—',
      district: district || '—',
      schoolName: school?.name || '—',
      dateOfService: String(session?.dateOfService || '').trim() || '—',
      time: time || '—',
      attendance: String(session?.attendance || '').trim() || '—',
      service: service || '—',
      hhaStatus: chosen.status,
    });
  }

  rows.sort(
    (a, b) =>
      a.transferAt.localeCompare(b.transferAt) ||
      a.childName.localeCompare(b.childName) ||
      a.dateOfService.localeCompare(b.dateOfService),
  );

  return { ok: true, from, to, timezone: 'America/New_York', rows };
}

/**
 * Admin internal notes across providers and children
 * (Admin → Providers/Children → Internal notes; Reports → Internal notes).
 * Filter by note createdAt date (YYYY-MM-DD) and optional providerId (provider-scoped only).
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
      const studentId = String(n.studentId || '').trim();
      if (providerId) {
        // Provider filter: only provider-scoped notes for that provider.
        if (studentId) return false;
        if (n.providerId !== providerId) return false;
      }
      const day = String(n.createdAt || '').slice(0, 10);
      if (from && (!day || day < from)) return false;
      if (to && (!day || day > to)) return false;
      return true;
    })
    .map((n) => {
      const studentId = String(n.studentId || '').trim();
      const student = studentId
        ? store.data.students.find((s) => s.id === studentId)
        : undefined;
      const provider = store.data.providers.find((p) => p.id === n.providerId);
      const author = store.userById(n.authorId) || store.data.users.find((u) => u.id === n.authorId);
      const childName = student
        ? `${student.firstName} ${student.lastName}`.trim() || student.id
        : '';
      const providerName = provider
        ? `${provider.firstName} ${provider.lastName}`.trim() || provider.id
        : n.providerId || '';
      const subjectKind = studentId ? 'child' : 'provider';
      const subjectName = studentId
        ? childName || studentId
        : providerName || n.providerId || '—';
      return {
        id: n.id,
        providerId: n.providerId || '',
        studentId,
        subjectKind,
        subjectName,
        providerName: providerName || (studentId ? '—' : n.providerId || '—'),
        childName: childName || (studentId ? studentId : '—'),
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
      return a.subjectName.localeCompare(b.subjectName);
    });
}

function dueNameBlob(value: string): string {
  return ` ${String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Children at this school whose "Last First" or "First Last" appears in the due-date notes. */
function studentsNamedInDueNotes(store: MemoryStore, schoolId: string, notes: string): Student[] {
  const blob = dueNameBlob(notes);
  if (blob.trim().length < 3) return [];
  const hits: Student[] = [];
  for (const student of store.data.students) {
    if (student.schoolId !== schoolId) continue;
    const first = dueNameBlob(student.firstName).trim();
    const last = dueNameBlob(student.lastName).trim();
    if (first.length < 2 || last.length < 2) continue;
    if (blob.includes(` ${last} ${first} `) || blob.includes(` ${first} ${last} `)) hits.push(student);
  }
  return hits;
}

function dueStudentDisplayName(student: Student): string {
  return [student.firstName, student.middleName, student.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function activeMandateProviderNames(store: MemoryStore, studentId: string, asOf: string): string {
  const names: string[] = [];
  for (const m of store.mandatesForStudent(studentId)) {
    if (mandateDischargedForWeek(m, '', asOf)) continue;
    const provider = resolveMandateProvider(store, m.providerId);
    const name = provider ? `${provider.firstName} ${provider.lastName}`.trim() : '';
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(', ');
}

/** District / payer for a school-level due date (most common child programType, else school.district). */
function districtForSchoolDue(store: MemoryStore, schoolId: string): string {
  const school = store.data.schools.find((s) => s.id === schoolId);
  const counts = new Map<string, { label: string; n: number }>();
  for (const s of store.data.students) {
    if (s.schoolId !== schoolId || isNoChildPlaceholderName(s)) continue;
    const label = String(s.programType || '').trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { label, n: 1 });
  }
  let best: { label: string; n: number } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.label || String(school?.district || '').trim();
}

export function dueDateReport(
  store: MemoryStore,
  today = new Date(),
  opts: {
    from?: string;
    to?: string;
    /** Report view: hide due dates already marked complete. */
    excludeCompleted?: boolean;
    /** Report view: a school-wide due date lists each child at the school, never "school-wide". */
    expandSchoolWide?: boolean;
  } = {},
) {
  const from = String(opts.from || '').trim();
  const to = String(opts.to || '').trim();
  const asOf = easternDateYmd(today);
  const rows = store.data.dueDates.filter((row) => {
    if (from && row.dueOn < from) return false;
    if (to && row.dueOn > to) return false;
    if (opts.excludeCompleted && row.completedAt) return false;
    return true;
  });
  const expanded = rows.flatMap((row) => {
    const school = store.data.schools.find((s) => s.id === row.schoolId);
    const schoolName = school?.name || row.schoolId;
    const status = dueDateStatus(row, today);
    const studentId = String(row.studentId || '').trim();
    const linked = studentId ? store.data.students.find((s) => s.id === studentId) : undefined;
    const named = linked ? [] : studentsNamedInDueNotes(store, row.schoolId, row.notes || '');
    let students = linked ? [linked] : named;
    if (!students.length && opts.expandSchoolWide) {
      students = store.data.students.filter(
        (s) => s.schoolId === row.schoolId && !isNoChildPlaceholderName(s),
      );
    }
    if (!students.length) {
      return [
        {
          ...row,
          status,
          schoolName,
          districtName: districtForSchoolDue(store, row.schoolId),
          studentName: '',
          providerName: '',
        },
      ];
    }
    return students.map((student) => ({
      ...row,
      status,
      schoolName,
      districtName: districtLabelForStudent(student, school),
      studentId: student.id,
      studentName: dueStudentDisplayName(student),
      providerName: activeMandateProviderNames(store, student.id, asOf),
    }));
  });
  return expanded.sort((a, b) => {
    const d = String(a.dueOn || '').localeCompare(String(b.dueOn || ''));
    if (d) return d;
    const s = String(a.schoolName || '').localeCompare(String(b.schoolName || ''));
    if (s) return s;
    return String(a.studentName || '').localeCompare(String(b.studentName || ''));
  });
}

export function dashboard(store: MemoryStore) {
  const weeks = store.data.weeks || [];
  const count = (status: string) => weeks.filter((w) => w.status === status).length;
  // HHA counts only signed/locked weeks — same universe as weekHhaRollup eligible
  // (attended, makeup, and payable missed paid absences). Never count orphan
  // confirmed transfers on draft weeks, or confirmed can exceed eligible on the admin banner.
  let hhaEligible = 0;
  let hhaConfirmed = 0;
  let hhaFailed = 0;
  let hhaPending = 0;
  const lookups = buildHhaLookups(store);
  for (const w of weeks) {
    if (w.status !== 'signed' && w.status !== 'locked') continue;
    const rollup = weekHhaRollup(store, w.id, lookups);
    hhaEligible += rollup.eligible;
    hhaConfirmed += rollup.confirmed;
    hhaFailed += rollup.failed;
    hhaPending += rollup.pending;
  }
  return {
    timesheet: {
      draft: count('draft') + count('reopened'),
      submitted: count('submitted'),
      signed: count('signed'),
      locked: count('locked'),
    },
    hha: {
      pending: hhaPending,
      failed: hhaFailed,
      confirmed: hhaConfirmed,
      eligible: hhaEligible,
    },
    missingNotes: missingNotes(store).length,
    openAlerts: store.openAlerts().length,
    overdueDueDates: dueDateReport(store).filter((d) => d.status === 'overdue').length,
  };
}

function mandateListLine(m: Mandate): { duration: string; frequency: string } {
  const minutes = m.durationMinutes;
  const duration =
    minutes == null || Number.isNaN(Number(minutes)) || String(minutes) === ''
      ? '—'
      : `${minutes} min`;
  const kind = mandateFrequencyKind(m);
  const sessions = m.sessionsPerPeriod ?? m.frequencyPerWeek ?? 0;
  const frequency = formatFreqDisplay(kind, sessions, m.periodSchoolDays || 0);
  const discipline = String(m.discipline || '').trim();
  return {
    duration: discipline ? `${discipline} · ${duration}` : duration,
    frequency: discipline ? `${discipline} · ${frequency}` : frequency,
  };
}

export function adminStudentsList(store: MemoryStore) {
  const schoolById = new Map(store.data.schools.map((sc) => [sc.id, sc]));
  const sessionCountByStudent = new Map<string, number>();
  for (const session of store.data.sessions) {
    const id = String(session.studentId || '').trim();
    if (!id) continue;
    sessionCountByStudent.set(id, (sessionCountByStudent.get(id) || 0) + 1);
  }
  const mandatesByStudent = new Map<string, Mandate[]>();
  for (const mandate of store.data.mandates) {
    const id = String(mandate.studentId || '').trim();
    if (!id) continue;
    const list = mandatesByStudent.get(id);
    if (list) list.push(mandate);
    else mandatesByStudent.set(id, [mandate]);
  }
  return store.data.students
    .filter((s) => !isNoChildPlaceholderName(s))
    .map((s) => {
      const school = schoolById.get(s.schoolId);
      const mandates = mandatesByStudent.get(s.id) || [];
      const lines = mandates.map(mandateListLine);
      return {
        id: s.id,
        firstName: s.firstName,
        middleName: s.middleName || '',
        lastName: s.lastName,
        name: [s.firstName, s.middleName, s.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ') || '—',
        schoolId: s.schoolId,
        schoolName: school?.name || '—',
        grade: s.grade || '',
        dob: s.dob || '',
        programId: s.programId || '',
        programType: s.programType || '',
        mandateCount: mandates.length,
        sessionCount: sessionCountByStudent.get(s.id) || 0,
        durations: lines.map((line) => line.duration),
        frequencies: lines.map((line) => line.frequency),
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
  const schoolCalendar = store.schoolCalendarForSchool(student.schoolId);
  const mandates = store.mandatesForStudent(student.id).map((m) => {
    const provider = resolveMandateProvider(store, m.providerId);
    const kind = mandateFrequencyKind(m);
    const sessionsPerPeriod = m.sessionsPerPeriod ?? m.frequencyPerWeek ?? 0;
    const periodSchoolDays =
      m.periodSchoolDays ??
      (kind === 'school_day_cycle' ? Number(schoolCalendar?.cycleDays) || 6 : 0);
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
  const lookups = buildHhaLookups(store);
  const weeks = store.data.weeks
    .filter((w) => weekIds.includes(w.id))
    .map((w) => enrichWeekHhaError(store, w, lookups));
  const dueDates = dueDateReport(store).filter((d) => d.schoolId === student.schoolId);
  const files = store.filesForStudent(student.id);
  const notes = store.notesForStudent(student.id);
  const extraTags = [...new Set(notes.flatMap((n) => n.tags || []))];
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
    notes,
    noteTagOptions: [...new Set([...DEFAULT_ADMIN_NOTE_TAGS, ...extraTags])],
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
    /** Children at this school (for per-child progress-report due dates). */
    students: students
      .filter((s) => !isNoChildPlaceholderName(s))
      .map((s) => ({
        id: s.id,
        name:
          [s.firstName, s.middleName, s.lastName]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join(' ') || '—',
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
    .map((w) => {
      const enriched = enrichWeekHhaError(store, w);
      const schoolId =
        String(w.schoolId || '').trim() ||
        (() => {
          const sess = store.sessionsForWeek(w.id);
          const counts = new Map<string, number>();
          for (const s of sess) {
            const student = store.data.students.find((st) => st.id === s.studentId);
            const sid = String(student?.schoolId || '').trim();
            if (!sid) continue;
            counts.set(sid, (counts.get(sid) || 0) + 1);
          }
          let best = '';
          let bestN = 0;
          for (const [id, n] of counts) {
            if (n > bestN) {
              best = id;
              bestN = n;
            }
          }
          return best;
        })();
      const school = schoolId
        ? store.data.schools.find((s) => s.id === schoolId)
        : undefined;
      const weekSessions = store.sessionsForWeek(w.id);
      const districtCounts = new Map<string, number>();
      for (const s of weekSessions) {
        const student = store.data.students.find((st) => st.id === s.studentId);
        const sessSchool = student
          ? store.data.schools.find((sc) => sc.id === student.schoolId)
          : undefined;
        const label = districtLabelForStudent(student, sessSchool);
        if (!label) continue;
        districtCounts.set(label, (districtCounts.get(label) || 0) + 1);
      }
      let weekDistrict = '';
      let bestN = 0;
      for (const [label, n] of districtCounts) {
        if (n > bestN) {
          weekDistrict = label;
          bestN = n;
        }
      }
      if (!weekDistrict) weekDistrict = String(school?.district || '').trim();
      return {
        ...enriched,
        schoolId: schoolId || '',
        schoolName: school?.name || '',
        district: weekDistrict,
      };
    });
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const sessions = store.data.sessions
    .filter((s) => weekById.has(s.weekId))
    .map((s) => {
      const w = weekById.get(s.weekId);
      const student = store.data.students.find((st) => st.id === s.studentId);
      const school = student
        ? store.data.schools.find((sc) => sc.id === student.schoolId)
        : undefined;
      return {
        ...s,
        weekStart: w?.weekStart || '',
        weekStatus: w?.status || '',
        schoolId: student?.schoolId || w?.schoolId || '',
        schoolName: school?.name || '',
        district:
          districtLabelForStudent(student, school) ||
          String(s.programType || '').trim() ||
          String(w?.programType || '').trim(),
        studentName: sessionListedChildName(
          s,
          student ? `${student.firstName} ${student.lastName}`.trim() : '',
        ),
      };
    })
    .sort((a, b) => {
      const da = String(a.dateOfService || '');
      const db = String(b.dateOfService || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.beginTime || '').localeCompare(String(a.beginTime || ''));
    });
  // Caseload + session districts so the Sessions filter lists payers even before
  // school.district is backfilled (imports leave it blank).
  const districtOptions = [
    ...new Set([
      ...sessions.map((s) => String(s.district || '').trim()).filter(Boolean),
      ...mandates.flatMap((m) => {
        const student = store.data.students.find((st) => st.id === m.studentId);
        const school = student
          ? store.data.schools.find((sc) => sc.id === student.schoolId)
          : undefined;
        const label = districtLabelForStudent(student, school);
        return label ? [label] : [];
      }),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const timesheetProgramOptions = buildTimesheetProgramOptions(store, aliasIds);
  const files = store.filesForProvider(provider.id);
  const extraTags = [...new Set(notes.flatMap((n) => n.tags || []))];
  return {
    provider,
    user,
    notes,
    mandates,
    weeks,
    sessions,
    districtOptions,
    timesheetProgramOptions,
    files,
    noteTagOptions: [...new Set([...DEFAULT_ADMIN_NOTE_TAGS, ...extraTags])],
    caseloadCount: new Set(mandates.map((m) => m.studentId)).size,
    redirectedFromProviderId: opened.id !== provider.id ? opened.id : undefined,
  };
}
