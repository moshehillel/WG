import type { MemoryStore } from './memory-store.js';
import type { School, SessionRow, WeeklyPeriod } from './types.js';

/** Normalize signer email for timesheet bin matching. */
export function normalizeSignerEmail(email: string | undefined | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Normalize program type (district/payer) for timesheet bin matching. */
export function normalizeProgramTypeKey(programType: string | undefined | null): string {
  return String(programType || '')
    .trim()
    .toLowerCase();
}

/**
 * School/signer part of a timesheet bin key.
 * Same signer email → same part (Madison: multiple buildings, one signer).
 * Otherwise split by schoolId (GM: different schools / different SignNow recipients).
 */
export function schoolSignerBinPart(
  school: Pick<School, 'id' | 'signerEmail'> | undefined | null,
): string {
  const email = normalizeSignerEmail(school?.signerEmail);
  if (email) return `signer:${email}`;
  const id = String(school?.id || '').trim();
  return id ? `school:${id}` : 'school:';
}

/**
 * Timesheet bin key: program type (district/payer) + school/signer.
 * Different program types (e.g. Island Park UFSD vs Carle Place UFSD) → separate timesheets.
 * Within the same program type, same signer email still merges buildings (Madison).
 */
export function timesheetBinKeyForParts(
  programType: string | undefined | null,
  school: Pick<School, 'id' | 'signerEmail'> | undefined | null,
): string {
  const pt = normalizeProgramTypeKey(programType);
  return `program:${pt}|${schoolSignerBinPart(school)}`;
}

/**
 * Timesheet bin key for a school (no program type).
 * @deprecated Prefer timesheetBinKeyForParts with the child's programType.
 * Kept for callers that only have a school; treats program as empty.
 */
export function timesheetBinKeyForSchool(
  school: Pick<School, 'id' | 'signerEmail'> | undefined | null,
): string {
  return timesheetBinKeyForParts('', school);
}

export function programTypeForStudent(
  student: { programType?: string } | undefined | null,
): string {
  return String(student?.programType || '').trim();
}

export function dominantSchoolIdForSessions(
  store: MemoryStore,
  sessions: SessionRow[],
): string {
  const counts = new Map<string, number>();
  for (const s of sessions) {
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
}

/** Majority student.programType among sessions (first-seen label wins ties). */
export function dominantProgramTypeForSessions(
  store: MemoryStore,
  sessions: SessionRow[],
): string {
  const counts = new Map<string, { n: number; label: string }>();
  for (const s of sessions) {
    const student = store.data.students.find((st) => st.id === s.studentId);
    const label = programTypeForStudent(student);
    if (!label) continue;
    const key = normalizeProgramTypeKey(label);
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { n: 1, label });
  }
  let best = '';
  let bestN = 0;
  for (const { n, label } of counts.values()) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

export function resolveWeekSchoolId(store: MemoryStore, week: WeeklyPeriod): string {
  const stamped = String(week.schoolId || '').trim();
  if (stamped) return stamped;
  return dominantSchoolIdForSessions(store, store.sessionsForWeek(week.id));
}

export function resolveWeekProgramType(store: MemoryStore, week: WeeklyPeriod): string {
  const stamped = String(week.programType || '').trim();
  if (stamped) return stamped;
  return dominantProgramTypeForSessions(store, store.sessionsForWeek(week.id));
}

export function timesheetBinKeyForSession(
  store: MemoryStore,
  session: Pick<SessionRow, 'studentId'>,
): string {
  const student = store.data.students.find((st) => st.id === session.studentId);
  const schoolId = String(student?.schoolId || '').trim();
  const school = schoolId ? store.data.schools.find((sc) => sc.id === schoolId) : undefined;
  return timesheetBinKeyForParts(
    programTypeForStudent(student),
    school || (schoolId ? { id: schoolId, signerEmail: '' } : null),
  );
}

export function timesheetBinKeyForWeek(store: MemoryStore, week: WeeklyPeriod): string {
  const programType = resolveWeekProgramType(store, week);
  const schoolId = resolveWeekSchoolId(store, week);
  if (schoolId) {
    const school = store.data.schools.find((s) => s.id === schoolId);
    if (school) return timesheetBinKeyForParts(programType, school);
  }
  const email = normalizeSignerEmail(week.signerEmail);
  if (email) return timesheetBinKeyForParts(programType, { id: '', signerEmail: email });
  return timesheetBinKeyForParts(programType, null);
}

export function weekMatchesSchoolBin(
  store: MemoryStore,
  week: WeeklyPeriod,
  schoolId: string,
  programType?: string,
): boolean {
  const wantId = String(schoolId || '').trim();
  const wantPt = String(programType || '').trim();
  if (!wantId && !wantPt) return true;

  if (wantPt && !wantId) {
    return (
      normalizeProgramTypeKey(resolveWeekProgramType(store, week)) ===
      normalizeProgramTypeKey(wantPt)
    );
  }

  const school = wantId ? store.data.schools.find((s) => s.id === wantId) : undefined;
  if (wantPt) {
    return (
      timesheetBinKeyForWeek(store, week) ===
      timesheetBinKeyForParts(
        wantPt,
        school || (wantId ? { id: wantId, signerEmail: '' } : null),
      )
    );
  }

  // schoolId only: exact school stamp, or same signer within a compatible program type
  // (do not merge Island Park + Carle Place just because the signer email matches).
  if (resolveWeekSchoolId(store, week) === wantId) return true;
  if (!school) return false;
  const weekSchoolId = resolveWeekSchoolId(store, week);
  const weekSchool = weekSchoolId
    ? store.data.schools.find((s) => s.id === weekSchoolId)
    : undefined;
  if (
    schoolSignerBinPart(weekSchool || { id: weekSchoolId, signerEmail: week.signerEmail }) !==
    schoolSignerBinPart(school)
  ) {
    return false;
  }
  const weekPt = normalizeProgramTypeKey(resolveWeekProgramType(store, week));
  if (!weekPt) return true;
  return store.data.students.some(
    (s) =>
      String(s.schoolId || '').trim() === wantId &&
      normalizeProgramTypeKey(s.programType) === weekPt,
  );
}

/** Weeks that share provider + Monday, optionally narrowed to a school/signer (+ program) bin. */
export function weeksMatchingSchoolBin(
  store: MemoryStore,
  weeks: WeeklyPeriod[],
  schoolId?: string,
  programType?: string,
): WeeklyPeriod[] {
  const sid = String(schoolId || '').trim();
  const pt = String(programType || '').trim();
  if (!sid && !pt) return weeks;
  const matched = weeks.filter((w) => weekMatchesSchoolBin(store, w, sid, pt || undefined));
  if (matched.length) return matched;
  // Legacy unscoped week (no schoolId/programType, no sessions yet) can adopt this scope.
  return weeks.filter(
    (w) =>
      !String(w.schoolId || '').trim() &&
      !String(w.programType || '').trim() &&
      store.sessionsForWeek(w.id).length === 0,
  );
}

/**
 * If a week holds sessions for multiple program-type / signer bins, move secondary bins
 * onto new week rows so each timesheet has one district payer + one SignNow recipient.
 * Preserves the original week for the largest (or stamped) group.
 */
export function splitWeekBySchoolBins(
  store: MemoryStore,
  week: WeeklyPeriod,
  newId: () => string,
): WeeklyPeriod[] {
  const sessions = store.sessionsForWeek(week.id);
  if (sessions.length < 2) {
    const onlySchool =
      String(week.schoolId || '').trim() || dominantSchoolIdForSessions(store, sessions);
    const onlyProgram =
      String(week.programType || '').trim() || dominantProgramTypeForSessions(store, sessions);
    if (
      (onlySchool && week.schoolId !== onlySchool) ||
      (onlyProgram && week.programType !== onlyProgram)
    ) {
      const school = onlySchool ? store.data.schools.find((s) => s.id === onlySchool) : undefined;
      return [
        store.upsertWeek({
          ...week,
          schoolId: onlySchool || week.schoolId,
          programType: onlyProgram || week.programType,
          signerName: school?.signerName || week.signerName,
          signerEmail: school?.signerEmail || week.signerEmail,
        }),
      ];
    }
    return [week];
  }

  const groups = new Map<
    string,
    { schoolId: string; programType: string; sessions: SessionRow[] }
  >();
  for (const s of sessions) {
    const student = store.data.students.find((st) => st.id === s.studentId);
    const schoolId = String(student?.schoolId || '').trim();
    const programType = programTypeForStudent(student);
    const school = schoolId ? store.data.schools.find((sc) => sc.id === schoolId) : undefined;
    const key = timesheetBinKeyForParts(
      programType,
      school || (schoolId ? { id: schoolId, signerEmail: '' } : null),
    );
    const g = groups.get(key);
    if (g) g.sessions.push(s);
    else groups.set(key, { schoolId, programType, sessions: [s] });
  }
  if (groups.size <= 1) {
    const only = [...groups.values()][0];
    const schoolId = only?.schoolId || String(week.schoolId || '').trim();
    const programType = only?.programType || String(week.programType || '').trim();
    if (
      (schoolId && week.schoolId !== schoolId) ||
      (programType && week.programType !== programType)
    ) {
      const school = schoolId ? store.data.schools.find((s) => s.id === schoolId) : undefined;
      return [
        store.upsertWeek({
          ...week,
          schoolId: schoolId || week.schoolId,
          programType: programType || week.programType,
          signerName: school?.signerName || week.signerName,
          signerEmail: school?.signerEmail || week.signerEmail,
        }),
      ];
    }
    return [week];
  }

  // Prefer keeping the group that matches stamped schoolId + programType, else the largest group.
  const stampedSchoolId = String(week.schoolId || '').trim();
  const stampedProgram = String(week.programType || '').trim();
  const stampedSchool = stampedSchoolId
    ? store.data.schools.find((s) => s.id === stampedSchoolId)
    : undefined;
  const stampedKey =
    stampedSchool || stampedSchoolId || stampedProgram
      ? timesheetBinKeyForParts(
          stampedProgram,
          stampedSchool || (stampedSchoolId ? { id: stampedSchoolId, signerEmail: '' } : null),
        )
      : '';
  const ordered = [...groups.entries()].sort((a, b) => {
    if (stampedKey) {
      const aMatch = a[0] === stampedKey;
      const bMatch = b[0] === stampedKey;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
    }
    return b[1].sessions.length - a[1].sessions.length;
  });

  const out: WeeklyPeriod[] = [];
  const [, keep] = ordered[0]!;
  const keepSchool = keep.schoolId
    ? store.data.schools.find((s) => s.id === keep.schoolId)
    : undefined;
  const kept = store.upsertWeek({
    ...week,
    schoolId: keep.schoolId || week.schoolId || '',
    programType: keep.programType || week.programType || '',
    signerName: keepSchool?.signerName || week.signerName,
    signerEmail: keepSchool?.signerEmail || week.signerEmail,
  });
  out.push(kept);

  for (const [, group] of ordered.slice(1)) {
    // Do not split locked/submitted weeks' sessions onto a fresh draft unless original is editable.
    // Still split so admin can send the other program/school sheet; leave status as draft for the new bin.
    const school = group.schoolId
      ? store.data.schools.find((s) => s.id === group.schoolId)
      : undefined;
    const created = store.upsertWeek({
      id: newId(),
      providerId: week.providerId,
      weekStart: week.weekStart,
      schoolId: group.schoolId || '',
      programType: group.programType || '',
      status: 'draft',
      signerName: school?.signerName || '',
      signerEmail: school?.signerEmail || '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
      hhaError: '',
    });
    for (const s of group.sessions) {
      store.upsertSession({ ...s, weekId: created.id });
    }
    out.push(created);
  }
  return out;
}
