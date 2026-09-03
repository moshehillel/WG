import type { Discipline, FrequencyKind, Mandate, SessionRow } from './types.js';

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
    if (sessGroup != null) {
      preferred = candidates.find((m) => Boolean(m.ratioGroup) === sessGroup) || candidates[0];
    } else if (candidates.length > 1) {
      // No ratio signal — prefer individual when both exist so group slots aren't double-spent.
      preferred = candidates.find((m) => !m.ratioGroup) || candidates[0];
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

/** Attended + makeup count toward the delivery week. Missed does not consume. */
export function checkMandate(
  mandate: Mandate | undefined,
  weekSessions: SessionRow[],
): MandateCheck {
  const used = weekSessions.filter(
    (s) => s.attendance === 'attended' || s.attendance === 'makeup',
  ).length;

  if (!mandate) {
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      message: 'No mandate on file for this student.',
    };
  }

  const allowedOrSkip = weeklyAllowedSessions(mandate);
  if (allowedOrSkip === null) {
    const n = mandate.sessionsPerPeriod ?? 0;
    const days = mandate.periodSchoolDays || 6;
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      skippedWeekly: true,
      message: `Cycle mandate (${n} / ${days} school days) — weekly over-check skipped.`,
    };
  }

  const allowed = allowedOrSkip;
  if (allowed <= 0) {
    return {
      used,
      allowed: 0,
      over: false,
      under: false,
      message: 'No mandate on file for this student.',
    };
  }
  const over = used > allowed;
  const under = used < allowed;
  let message = '';
  if (over) {
    message = `Over mandate: ${used} of ${allowed} allowed this week. Upload is blocked.`;
  } else if (under) {
    message = `Under mandate: ${used} of ${allowed} this week.`;
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
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byStudent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = byStudent.get(s.studentId) ?? [];
    list.push(s);
    byStudent.set(s.studentId, list);
  }
  for (const [studentId, rows] of byStudent) {
    const studentMandates = mandates.filter((m) => m.studentId === studentId);
    if (!studentMandates.length) {
      const result = checkMandate(undefined, rows);
      warnings.push(result.message);
      continue;
    }

    if (studentMandates.length === 1) {
      const result = checkMandate(studentMandates[0], rows);
      if (result.skippedWeekly) warnings.push(result.message);
      else if (result.over) errors.push(result.message);
      else if (result.under) warnings.push(result.message);
      continue;
    }

    const { byMandateId, unmatched } = assignSessionsToMandates(studentMandates, rows);
    for (const mandate of studentMandates) {
      const assigned = byMandateId.get(mandate.id) ?? [];
      const result = checkMandate(mandate, assigned);
      const label = `${mandate.discipline || mandate.serviceType || 'service'}${
        mandate.ratioGroup ? ' group' : ' individual'
      }`;
      if (result.skippedWeekly) {
        warnings.push(`${label}: ${result.message}`);
      } else if (result.over) {
        errors.push(`${label}: ${result.message}`);
      } else if (result.under) {
        warnings.push(`${label}: ${result.message}`);
      }
    }
    const unmatchedUsed = unmatched.filter(
      (s) => s.attendance === 'attended' || s.attendance === 'makeup',
    );
    if (unmatchedUsed.length) {
      warnings.push(
        `${unmatchedUsed.length} session(s) did not match a specific mandate ratio/discipline.`,
      );
    }
  }
  return { errors, warnings };
}
