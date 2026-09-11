import type { MemoryStore } from './memory-store.js';
import type { School, SessionRow, WeeklyPeriod } from './types.js';

/** Normalize signer email for timesheet bin matching. */
export function normalizeSignerEmail(email: string | undefined | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * Timesheet bin key for a school.
 * Same signer email → same bin (Madison: multiple buildings, one signer).
 * Otherwise split by schoolId (GM: different schools / different SignNow recipients).
 */
export function timesheetBinKeyForSchool(
  school: Pick<School, 'id' | 'signerEmail'> | undefined | null,
): string {
  const email = normalizeSignerEmail(school?.signerEmail);
  if (email) return `signer:${email}`;
  const id = String(school?.id || '').trim();
  return id ? `school:${id}` : 'school:';
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

export function resolveWeekSchoolId(store: MemoryStore, week: WeeklyPeriod): string {
  const stamped = String(week.schoolId || '').trim();
  if (stamped) return stamped;
  return dominantSchoolIdForSessions(store, store.sessionsForWeek(week.id));
}

export function timesheetBinKeyForWeek(store: MemoryStore, week: WeeklyPeriod): string {
  const schoolId = resolveWeekSchoolId(store, week);
  if (schoolId) {
    const school = store.data.schools.find((s) => s.id === schoolId);
    if (school) return timesheetBinKeyForSchool(school);
  }
  const email = normalizeSignerEmail(week.signerEmail);
  if (email) return `signer:${email}`;
  return 'school:';
}

export function weekMatchesSchoolBin(
  store: MemoryStore,
  week: WeeklyPeriod,
  schoolId: string,
): boolean {
  const wantId = String(schoolId || '').trim();
  if (!wantId) return true;
  const school = store.data.schools.find((s) => s.id === wantId);
  if (!school) {
    return resolveWeekSchoolId(store, week) === wantId;
  }
  return timesheetBinKeyForWeek(store, week) === timesheetBinKeyForSchool(school);
}

/** Weeks that share provider + Monday, optionally narrowed to a school/signer bin. */
export function weeksMatchingSchoolBin(
  store: MemoryStore,
  weeks: WeeklyPeriod[],
  schoolId?: string,
): WeeklyPeriod[] {
  const sid = String(schoolId || '').trim();
  if (!sid) return weeks;
  const matched = weeks.filter((w) => weekMatchesSchoolBin(store, w, sid));
  if (matched.length) return matched;
  // Legacy unscoped week (no schoolId, no sessions yet) can adopt this school.
  return weeks.filter((w) => !String(w.schoolId || '').trim() && store.sessionsForWeek(w.id).length === 0);
}

/**
 * If a week holds sessions for multiple signer/school bins, move secondary bins
 * onto new week rows so each timesheet has one SignNow recipient.
 * Preserves the original week for the largest (or first) group.
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
    if (onlySchool && week.schoolId !== onlySchool) {
      const school = store.data.schools.find((s) => s.id === onlySchool);
      return [
        store.upsertWeek({
          ...week,
          schoolId: onlySchool,
          signerName: school?.signerName || week.signerName,
          signerEmail: school?.signerEmail || week.signerEmail,
        }),
      ];
    }
    return [week];
  }

  const groups = new Map<string, { schoolId: string; sessions: SessionRow[] }>();
  for (const s of sessions) {
    const student = store.data.students.find((st) => st.id === s.studentId);
    const schoolId = String(student?.schoolId || '').trim();
    const school = schoolId ? store.data.schools.find((sc) => sc.id === schoolId) : undefined;
    const key = timesheetBinKeyForSchool(school || (schoolId ? { id: schoolId, signerEmail: '' } : null));
    const g = groups.get(key);
    if (g) g.sessions.push(s);
    else groups.set(key, { schoolId, sessions: [s] });
  }
  if (groups.size <= 1) {
    const only = [...groups.values()][0];
    const schoolId = only?.schoolId || String(week.schoolId || '').trim();
    if (schoolId && week.schoolId !== schoolId) {
      const school = store.data.schools.find((s) => s.id === schoolId);
      return [
        store.upsertWeek({
          ...week,
          schoolId,
          signerName: school?.signerName || week.signerName,
          signerEmail: school?.signerEmail || week.signerEmail,
        }),
      ];
    }
    return [week];
  }

  // Prefer keeping the group that matches stamped schoolId, else the largest group.
  const stamped = String(week.schoolId || '').trim();
  const stampedSchool = stamped ? store.data.schools.find((s) => s.id === stamped) : undefined;
  const stampedKey = stampedSchool
    ? timesheetBinKeyForSchool(stampedSchool)
    : stamped
      ? `school:${stamped}`
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
    signerName: keepSchool?.signerName || week.signerName,
    signerEmail: keepSchool?.signerEmail || week.signerEmail,
  });
  out.push(kept);

  for (const [, group] of ordered.slice(1)) {
    // Do not split locked/submitted weeks' sessions onto a fresh draft unless original is editable.
    // Still split so admin can send the other school's sheet; leave status as draft for the new bin.
    const school = group.schoolId
      ? store.data.schools.find((s) => s.id === group.schoolId)
      : undefined;
    const created = store.upsertWeek({
      id: newId(),
      providerId: week.providerId,
      weekStart: week.weekStart,
      schoolId: group.schoolId || '',
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
