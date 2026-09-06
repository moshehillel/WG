import type { Discipline, FrequencyKind, Mandate, MandateKind, SessionRow } from './types.js';

export function parseFrequencyPerWeek(raw: string): number | null {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const x = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(?:\/\s*)?(?:week|wk|weekly)?/);
  if (x) return Number(x[1]);
  const times = s.match(/(\d+(?:\.\d+)?)\s*(?:times|x)\s*(?:per|a|\/)?\s*(?:week|wk|weekly)/);
  if (times) return Number(times[1]);
  const slash = s.match(/(\d+)\s*\/\s*(?:week|wk)/);
  if (slash) return Number(slash[1]);
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Number(bare[1]);
  return null;
}

export function disciplineFromServiceType(serviceType: string): Discipline | '' {
  const s = String(serviceType || '').toUpperCase();
  if (/\bSLP\b|\bSPEECH\b|\bLANGUAGE\b/.test(s)) return 'SLP';
  if (/\bOT\b|\bOCCUPATIONAL\b/.test(s)) return 'OT';
  if (/\bPT\b|\bPHYSICAL\b/.test(s)) return 'PT';
  return '';
}

export function mandateFrequencyKind(mandate: Mandate | undefined): FrequencyKind {
  if (!mandate) return 'weekly';
  return mandate.frequencyKind || 'weekly';
}

/**
 * Weekly over-check allowance. Returns null for school_day_cycle mandates —
 * those are not coerced into frequencyPerWeek and skip the weekly over-check.
 */
export function weeklyAllowedSessions(mandate: Mandate | undefined): number | null {
  if (!mandate) return 0;
  if (mandateFrequencyKind(mandate) === 'school_day_cycle') return null;
  return Number(mandate.frequencyPerWeek) || 0;
}

export function sessionLooksGroup(serviceType: string): boolean | null {
  const s = String(serviceType || '');
  if (/\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(s)) return true;
  if (/\bindividual\b|\b1\s*:\s*1\b/i.test(s)) return false;
  return null;
}

export function mandateKindOf(mandate: Mandate | undefined): MandateKind {
  if (!mandate) return 'regular';
  if (mandate.mandateKind === 'makeup_auth') return 'makeup_auth';
  if (/\bmakeup\b|make[\s-]?up/i.test(mandate.serviceType || '')) return 'makeup_auth';
  return 'regular';
}

export function isMakeupAuthMandate(mandate: Mandate | undefined): boolean {
  return mandateKindOf(mandate) === 'makeup_auth';
}

/** Makeup linked to a prior missed session does not consume the weekly mandate. */
export function makeupExemptFromWeeklyMandate(session: SessionRow): boolean {
  return session.attendance === 'makeup' && Boolean(session.makeupOfSessionId);
}

/** True when a session can count against this mandate (discipline + ratio when known). */
export function sessionMatchesMandate(session: SessionRow, mandate: Mandate): boolean {
  const sessDisc = disciplineFromServiceType(session.serviceType);
  if (mandate.discipline && sessDisc && mandate.discipline !== sessDisc) return false;
  const sessGroup = sessionLooksGroup(session.serviceType);
  if (sessGroup != null && sessGroup !== Boolean(mandate.ratioGroup)) return false;
  return true;
}

/**
 * Assign each session to at most one mandate for the student (prefer exact ratio match).
 * Unmatched sessions are returned separately.
 */
export function assignSessionsToMandates(
  mandates: Mandate[],
  sessions: SessionRow[],
): { byMandateId: Map<string, SessionRow[]>; unmatched: SessionRow[] } {
  const byMandateId = new Map<string, SessionRow[]>();
  for (const m of mandates) byMandateId.set(m.id, []);
  const unmatched: SessionRow[] = [];

  for (const s of sessions) {
    const candidates = mandates.filter((m) => sessionMatchesMandate(s, m));
    if (!candidates.length) {
      unmatched.push(s);
      continue;
    }
    const sessGroup = sessionLooksGroup(s.serviceType);
    let preferred = candidates[0];
    if (s.attendance === 'makeup' && !s.makeupOfSessionId) {
      // Unlinked makeups consume leftover makeup-auth; miss-linked makeups do not.
      preferred =
        candidates.find((m) => isMakeupAuthMandate(m)) ||
        candidates.find((m) => Boolean(m.ratioGroup) === Boolean(sessGroup)) ||
        candidates[0];
    } else if (s.attendance === 'makeup' && s.makeupOfSessionId) {
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && Boolean(m.ratioGroup) === Boolean(sessGroup)) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    } else if (sessGroup != null) {
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && Boolean(m.ratioGroup) === sessGroup) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    } else if (candidates.length > 1) {
      // No ratio signal — prefer individual when both exist so group slots aren't double-spent.
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && !m.ratioGroup) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    }
    byMandateId.get(preferred.id)!.push(s);
  }
  return { byMandateId, unmatched };
}

export interface MandateCheck {
  used: number;
  allowed: number;
  over: boolean;
  under: boolean;
  message: string;
  /** When true, weekly over-check was skipped (cycle frequency). */
  skippedWeekly?: boolean;
}

export type MandateCheckOpts = {
  /** Child display name for clear over/under messages. */
  studentLabel?: string;
  /** e.g. "PT individual" when multiple mandates share a student. */
  serviceLabel?: string;
};

/** True when the row is an eval / report / consult / meeting (not a caseload visit). */
export function isAdditionalServiceSession(session: SessionRow): boolean {
  return Boolean(session.additionalServiceType);
}

/** Date + begin–end for error copy (uses DOS / times as stored on the row). */
export function sessionSlotLabel(session: SessionRow): string {
  const dos = String(session.dateOfService || '').trim() || 'unknown date';
  const begin = String(session.beginTime || '').trim();
  const end = String(session.endTime || '').trim();
  if (begin && end) return `${dos} ${begin}–${end}`;
  if (begin) return `${dos} ${begin}`;
  return dos;
}

function sessionsCountingTowardWeekly(weekSessions: SessionRow[]): SessionRow[] {
  return weekSessions.filter(
    (s) =>
      !isAdditionalServiceSession(s) &&
      s.attendance === 'attended' &&
      !makeupExemptFromWeeklyMandate(s),
  );
}

function whoLabel(opts: MandateCheckOpts): string {
  const name = String(opts.studentLabel || '').trim();
  const service = String(opts.serviceLabel || '').trim();
  if (name && service) return `${name} (${service})`;
  if (name) return name;
  if (service) return service;
  return 'this child';
}

function overMandateMessage(
  opts: MandateCheckOpts,
  counted: SessionRow[],
  used: number,
  allowed: number,
  kind: 'weekly' | 'makeup_auth',
): string {
  const who = whoLabel(opts);
  const slots = counted.map(sessionSlotLabel).filter(Boolean).join('; ');
  const slotBit = slots ? ` session(s) on ${slots}.` : '';
  if (kind === 'makeup_auth') {
    return (
      `This exceeds the makeup authorization for ${who}:${slotBit} ` +
      `Authorization allows ${allowed} leftover makeup session(s); this would make it ${used}.`
    );
  }
  return (
    `This exceeds the mandate for ${who}:${slotBit} ` +
    `Mandate allows ${allowed} session(s) per week; this upload would make it ${used}.`
  );
}

function resolveStudentLabel(
  studentId: string,
  names?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  if (!names) return '';
  if (names instanceof Map) return String(names.get(studentId) || '').trim();
  return String((names as Record<string, string>)[studentId] || '').trim();
}

/** Attended counts toward the delivery week. Missed does not. Makeup linked to a missed session does not. */
export function checkMandate(
  mandate: Mandate | undefined,
  weekSessions: SessionRow[],
  allSessions: SessionRow[] = weekSessions,
  opts: MandateCheckOpts = {},
): MandateCheck {
  if (isMakeupAuthMandate(mandate) && mandate) {
    const allowed = Number(mandate.sessionsPerPeriod ?? mandate.frequencyPerWeek) || 0;
    // Only unlinked makeups consume the leftover pool; miss-linked makeups do not.
    const pool = allSessions.filter(
      (s) =>
        s.studentId === mandate.studentId &&
        !isAdditionalServiceSession(s) &&
        s.attendance === 'makeup' &&
        !s.makeupOfSessionId,
    );
    const used = pool.length;
    const over = allowed > 0 && used > allowed;
    return {
      used,
      allowed,
      over,
      under: allowed > 0 && used < allowed,
      message: over
        ? overMandateMessage(opts, pool, used, allowed, 'makeup_auth')
        : allowed > 0 && used < allowed
          ? `Makeup authorization${opts.studentLabel ? ` for ${opts.studentLabel}` : ''}: ${used} of ${allowed} leftover makeup session(s).`
          : '',
    };
  }

  const counted = sessionsCountingTowardWeekly(weekSessions);
  const used = counted.length;

  if (!mandate) {
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      message: opts.studentLabel
        ? `No mandate on file for ${opts.studentLabel}.`
        : 'No mandate on file for this student.',
    };
  }

  const allowedOrSkip = weeklyAllowedSessions(mandate);
  if (allowedOrSkip === null) {
    const n = mandate.sessionsPerPeriod ?? 0;
    const days = mandate.periodSchoolDays || 6;
    const who = opts.studentLabel ? ` for ${opts.studentLabel}` : '';
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      skippedWeekly: true,
      message: `Cycle mandate${who} (${n} / ${days} school days) — weekly over-check skipped.`,
    };
  }

  const allowed = allowedOrSkip;
  if (allowed <= 0) {
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      message: opts.studentLabel
        ? `No mandate on file for ${opts.studentLabel}.`
        : 'No mandate on file for this student.',
    };
  }
  const over = used > allowed;
  const under = used < allowed;
  let message = '';
  if (over) {
    message = overMandateMessage(opts, counted, used, allowed, 'weekly');
  } else if (under) {
    const who = opts.studentLabel ? ` for ${opts.studentLabel}` : '';
    message = `Under mandate${who}: ${used} of ${allowed} this week.`;
  }
  return { used, allowed, over, under, message };
}

/**
 * Check all active mandates for students with sessions this week.
 * Multiple mandates per student (e.g. individual + group) are each checked
 * against sessions assigned to that mandate — second rows are not dropped.
 */
export function checkMandatesForWeek(
  mandates: Mandate[],
  sessions: SessionRow[],
  allSessions: SessionRow[] = sessions,
  studentNameById?: ReadonlyMap<string, string> | Record<string, string>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byStudent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    if (isAdditionalServiceSession(s)) continue;
    const list = byStudent.get(s.studentId) ?? [];
    list.push(s);
    byStudent.set(s.studentId, list);
  }
  for (const [studentId, rows] of byStudent) {
    const studentLabel = resolveStudentLabel(studentId, studentNameById);
    const studentMandates = mandates.filter((m) => m.studentId === studentId);
    if (!studentMandates.length) {
      const result = checkMandate(undefined, rows, allSessions, { studentLabel });
      warnings.push(result.message);
      continue;
    }

    if (studentMandates.length === 1) {
      const result = checkMandate(studentMandates[0], rows, allSessions, { studentLabel });
      if (result.skippedWeekly) warnings.push(result.message);
      else if (result.over) errors.push(result.message);
      else if (result.under) warnings.push(result.message);
      continue;
    }

    const { byMandateId, unmatched } = assignSessionsToMandates(studentMandates, rows);
    for (const mandate of studentMandates) {
      const assigned = isMakeupAuthMandate(mandate)
        ? allSessions.filter(
            (s) =>
              s.studentId === studentId &&
              !isAdditionalServiceSession(s) &&
              s.attendance === 'makeup' &&
              !s.makeupOfSessionId,
          )
        : (byMandateId.get(mandate.id) ?? []);
      const serviceLabel = `${mandate.discipline || mandate.serviceType || 'service'}${
        mandate.ratioGroup ? ' group' : ' individual'
      }`;
      const result = checkMandate(mandate, assigned, allSessions, { studentLabel, serviceLabel });
      if (result.skippedWeekly) {
        warnings.push(result.message);
      } else if (result.over) {
        errors.push(result.message);
      } else if (result.under) {
        warnings.push(result.message);
      }
    }
    const unmatchedUsed = unmatched.filter(
      (s) => s.attendance === 'attended' && !makeupExemptFromWeeklyMandate(s),
    );
    if (unmatchedUsed.length) {
      const who = studentLabel || 'this child';
      const slots = unmatchedUsed.map(sessionSlotLabel).join('; ');
      warnings.push(
        `${unmatchedUsed.length} session(s) for ${who} did not match a specific mandate ratio/discipline` +
          (slots ? `: ${slots}.` : '.'),
      );
    }
  }
  return { errors, warnings };
}
