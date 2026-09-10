import { buildSchoolBillingServiceName } from '@white-glove/shared';
import { isoDate, parseDos } from './ids.js';
import {
  hasConfiguredSchoolCalendar,
  isSchoolDay,
  schoolCalendarMonFriFallbackWarning,
} from './school-calendar.js';
import type { Discipline, FrequencyKind, Mandate, MandateKind, SchoolCalendar, SessionRow } from './types.js';

/**
 * HHA school billing name from mandate discipline + RS Duration bucket (+ group).
 * Group → `{Disc} school group {bucket}`; individual → `{Disc} school {bucket}`.
 * Does not replace Related Service (`serviceType`) — therapists still see that text.
 */
export function schoolBillingServiceNameForMandate(
  mandate: Pick<Mandate, 'discipline' | 'durationMinutes' | 'mandateKind' | 'ratioGroup' | 'groupSize'>,
): string | undefined {
  if (mandate.mandateKind === 'makeup_auth') return undefined;
  const group =
    Boolean(mandate.ratioGroup) ||
    (mandate.groupSize != null && Number(mandate.groupSize) > 1);
  return buildSchoolBillingServiceName({
    discipline: mandate.discipline || undefined,
    kind: 'school',
    durationMinutes: mandate.durationMinutes,
    group,
  });
}

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
 * Weekly over-check allowance.
 * Returns null for school_day_cycle / monthly — those use their own window checks.
 */
export function weeklyAllowedSessions(mandate: Mandate | undefined): number | null {
  if (!mandate) return 0;
  const kind = mandateFrequencyKind(mandate);
  if (kind === 'school_day_cycle' || kind === 'monthly') return null;
  return Number(mandate.frequencyPerWeek) || Number(mandate.sessionsPerPeriod) || 0;
}

/** Sessions allowed per calendar month when frequencyKind is monthly. */
export function monthlyAllowedSessions(mandate: Mandate | undefined): number {
  if (!mandate || mandateFrequencyKind(mandate) !== 'monthly') return 0;
  return Number(mandate.sessionsPerPeriod) || Number(mandate.frequencyPerWeek) || 0;
}

/** YYYY-MM key for a DOS string (empty when unparseable). */
export function dosMonthKey(dos: string): string {
  const iso = dosToIso(dos);
  return iso ? iso.slice(0, 7) : '';
}

/** Sessions allowed per school-day cycle (e.g. 2 per 6 school days). */
export function cycleAllowedSessions(mandate: Mandate | undefined): number {
  if (!mandate || mandateFrequencyKind(mandate) !== 'school_day_cycle') return 0;
  return Number(mandate.sessionsPerPeriod) || 0;
}

export function cyclePeriodSchoolDays(mandate: Mandate | undefined): number {
  if (!mandate || mandateFrequencyKind(mandate) !== 'school_day_cycle') return 0;
  const n = Number(mandate.periodSchoolDays);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function dosToIso(dos: string): string {
  const dt = parseDos(dos);
  return dt ? isoDate(dt) : '';
}

/**
 * Walk backward from endIso over Mon–Fri school days (calendar off-days when provided)
 * and return the ISO start of a window covering `periodDays` school days inclusive of end.
 */
export function schoolDayWindowStart(
  endDos: string,
  periodDays: number,
  calendar?: SchoolCalendar | null,
): string {
  const endIso = dosToIso(endDos);
  if (!endIso || periodDays <= 0) return '';
  const dt = parseDos(endIso);
  if (!dt) return '';
  let counted = 0;
  // Cap search so bad calendars cannot loop forever (~2 years of weekdays).
  for (let i = 0; i < 800; i += 1) {
    const iso = isoDate(dt);
    if (isSchoolDay(iso, calendar ?? null)) {
      counted += 1;
      if (counted >= periodDays) return iso;
    }
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return isoDate(dt);
}

/**
 * Max attended sessions falling in any sliding school-day window of length periodDays
 * ending on a counted session's DOS. Used for school_day_cycle over-check.
 */
export function maxSessionsInSchoolDayCycle(
  counted: SessionRow[],
  periodDays: number,
  calendar?: SchoolCalendar | null,
): { used: number; windowEnd?: string; windowStart?: string } {
  if (!counted.length || periodDays <= 0) return { used: 0 };
  let maxUsed = 0;
  let bestEnd = '';
  let bestStart = '';
  for (const end of counted) {
    const endIso = dosToIso(end.dateOfService);
    if (!endIso) continue;
    const startIso = schoolDayWindowStart(end.dateOfService, periodDays, calendar);
    if (!startIso) continue;
    const used = counted.filter((s) => {
      const iso = dosToIso(s.dateOfService);
      return iso && iso >= startIso && iso <= endIso;
    }).length;
    if (used > maxUsed) {
      maxUsed = used;
      bestEnd = end.dateOfService;
      bestStart = startIso;
    }
  }
  return { used: maxUsed, windowEnd: bestEnd || undefined, windowStart: bestStart || undefined };
}

export function sessionLooksGroup(serviceType: string): boolean | null {
  const s = String(serviceType || '');
  if (/\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(s)) return true;
  if (/\bindividual\b|\b1\s*:\s*1\b/i.test(s)) return false;
  return null;
}

/**
 * True when notes clearly say no peer/partner was available (or clear synonym).
 * Solo-group Frontline rows often arrive as 1:1 with this note.
 */
export function notesMentionNoPeerAvailable(notes: string): boolean {
  const n = String(notes || '');
  if (!n.trim()) return false;
  // peer | partner | classmate | groupmate (optional plural)
  const who = 'peers?|partners?|classmates?|groupmates?';
  const otherWho = 'student|child|peer|partner|member|participant';
  if (
    new RegExp(
      `\\bno\\s+(?:other\\s+)?(?:${who})\\b` +
        `|\\b(?:${who})\\s+(?:were\\s+|was\\s+)?(?:not\\s+|un)?available\\b` +
        `|\\bno\\s+other\\s+(?:${otherWho})s?\\b` +
        `|\\bother\\s+(?:${otherWho}).{0,24}(?:absent|unavailable|missing)\\b`,
      'i',
    ).test(n)
  ) {
    return true;
  }
  return false;
}

/**
 * Solo group documented as individual/1:1 with a no-partner note.
 * Pay stays individual; mandate frequency still consumes the group mandate.
 */
export function sessionIsSoloGroupViaNote(session: Pick<SessionRow, 'serviceType' | 'notes'>): boolean {
  return (
    sessionLooksGroup(session.serviceType) !== true &&
    notesMentionNoPeerAvailable(session.notes || '')
  );
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
  if (sessGroup != null && sessGroup !== Boolean(mandate.ratioGroup)) {
    // 1:1 / individual tag with "no partner available" still matches the group mandate
    // for frequency (pay remains individual via presentGroupPeerCount).
    if (mandate.ratioGroup && sessionIsSoloGroupViaNote(session)) return true;
    return false;
  }
  return true;
}

/**
 * Preferred matching mandate for a session (same preference rules as assignSessionsToMandates).
 * Used for pay/billing duration — authorized minutes come from this row, not Frontline clock.
 */
export function preferredMandateForSession(
  session: SessionRow,
  mandates: Mandate[],
): Mandate | undefined {
  const studentMandates = mandates.filter((m) => m.studentId === session.studentId);
  if (!studentMandates.length) return undefined;
  const { byMandateId, unmatched } = assignSessionsToMandates(studentMandates, [session]);
  if (unmatched.some((u) => u.id === session.id)) return undefined;
  for (const m of studentMandates) {
    if ((byMandateId.get(m.id) || []).some((s) => s.id === session.id)) return m;
  }
  return undefined;
}

/** Mandate RS Duration minutes for pay / school-billing bucket selection. */
export function mandateDurationMinutesForSession(
  session: SessionRow,
  mandates: Mandate[],
): number | null {
  const m = preferredMandateForSession(session, mandates);
  const d = m?.durationMinutes;
  if (d == null) return null;
  const n = typeof d === 'number' ? d : Number(d);
  return Number.isFinite(n) ? n : null;
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
    const soloGroupViaNote = sessionIsSoloGroupViaNote(s);
    let preferred = candidates[0];
    if (s.attendance === 'makeup' && !s.makeupOfSessionId) {
      // Unlinked makeups consume leftover makeup-auth; miss-linked makeups do not.
      preferred =
        candidates.find((m) => isMakeupAuthMandate(m)) ||
        (soloGroupViaNote
          ? candidates.find((m) => m.ratioGroup)
          : undefined) ||
        candidates.find((m) => Boolean(m.ratioGroup) === Boolean(sessGroup)) ||
        candidates[0];
    } else if (s.attendance === 'makeup' && s.makeupOfSessionId) {
      preferred =
        (soloGroupViaNote
          ? candidates.find((m) => !isMakeupAuthMandate(m) && m.ratioGroup)
          : undefined) ||
        candidates.find((m) => !isMakeupAuthMandate(m) && Boolean(m.ratioGroup) === Boolean(sessGroup)) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    } else if (soloGroupViaNote) {
      // Solo group / no-partner note → group mandate frequency (not individual).
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && m.ratioGroup) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    } else if (sessGroup === false) {
      // True individual / 1:1 without no-partner note → individual mandate first.
      // Never force these onto a group mandate when both exist.
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && !m.ratioGroup) ||
        candidates.find((m) => !isMakeupAuthMandate(m)) ||
        candidates[0];
    } else if (sessGroup === true) {
      preferred =
        candidates.find((m) => !isMakeupAuthMandate(m) && m.ratioGroup) ||
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
  /** True when there is no regular mandate on file (import blocker). */
  missingMandate?: boolean;
  /** school_day_cycle over-check (not a silent weekly skip). */
  cycleCheck?: boolean;
}

export type MandateCheckOpts = {
  /** Child display name for clear over/under messages. */
  studentLabel?: string;
  /** e.g. "PT individual" when multiple mandates share a student. */
  serviceLabel?: string;
  /** Optional school calendar for school_day_cycle windows (defaults to Mon–Fri). */
  calendar?: SchoolCalendar | null;
  /**
   * DOS / ISO used to pick the calendar month when this mandate has no sessions
   * in the current week slice (e.g. dual individual+group — monthly row empty).
   * Without an anchor, monthly checks must not fall back to all-time history.
   */
  monthAnchorDos?: string;
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
  kind: 'weekly' | 'makeup_auth' | 'school_day_cycle' | 'monthly',
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
  if (kind === 'school_day_cycle') {
    return (
      `This exceeds the cycle mandate for ${who}:${slotBit} ` +
      `Mandate allows ${allowed} session(s) per cycle; densest window would make it ${used}.`
    );
  }
  if (kind === 'monthly') {
    return (
      `This exceeds the monthly mandate for ${who}:${slotBit} ` +
      `Mandate allows ${allowed} session(s) per month; this upload would make it ${used}.`
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
      over: true,
      under: false,
      missingMandate: true,
      message: opts.studentLabel
        ? `No mandate on file for ${opts.studentLabel} — import blocked. Ask the office to import the caseload or add a mandate.`
        : 'No mandate on file for this student — import blocked. Ask the office to import the caseload or add a mandate.',
    };
  }

  const allowedOrSkip = weeklyAllowedSessions(mandate);
  if (allowedOrSkip === null) {
    const who = opts.studentLabel ? ` for ${opts.studentLabel}` : '';
    if (mandateFrequencyKind(mandate) === 'monthly') {
      const allowed = monthlyAllowedSessions(mandate);
      if (allowed <= 0) {
        return {
          used,
          allowed: 0,
          over: true,
          under: false,
          missingMandate: true,
          message: opts.studentLabel
            ? `No mandate on file for ${opts.studentLabel} — import blocked.`
            : 'No mandate on file for this student — import blocked.',
        };
      }
      // Anchor month from this mandate's week slice, else sibling-week DOS (dual mandates).
      const anchorDos =
        counted.map((s) => s.dateOfService).sort().slice(-1)[0] ||
        weekSessions.map((s) => s.dateOfService).filter(Boolean).sort().slice(-1)[0] ||
        String(opts.monthAnchorDos || '').trim() ||
        '';
      const monthKey = dosMonthKey(anchorDos);
      // No calendar month → never fall back to all-time history (that falsely over-blocks).
      if (!monthKey) {
        return {
          used: 0,
          allowed,
          over: false,
          under: allowed > 0,
          message:
            allowed > 0
              ? `Under monthly mandate${who}: 0 of ${allowed} this month.`
              : '',
        };
      }
      const pool = sessionsCountingTowardWeekly(
        allSessions.filter((s) => s.studentId === mandate.studentId),
      );
      const matched = pool.filter((s) => sessionMatchesMandate(s, mandate));
      const monthPool = (matched.length ? matched : pool).filter(
        (s) => dosMonthKey(s.dateOfService) === monthKey,
      );
      const monthUsed = monthPool.length;
      const over = monthUsed > allowed;
      return {
        used: monthUsed,
        allowed,
        over,
        under: !over && monthUsed < allowed,
        message: over
          ? overMandateMessage(opts, monthPool, monthUsed, allowed, 'monthly')
          : monthUsed < allowed
            ? `Under monthly mandate${who}: ${monthUsed} of ${allowed} this month.`
            : '',
      };
    }
    // school_day_cycle: enforce densest sliding school-day window (Mon–Fri / calendar).
    const allowed = cycleAllowedSessions(mandate);
    const days = cyclePeriodSchoolDays(mandate);
    if (allowed <= 0) {
      return {
        used,
        allowed: 0,
        over: true,
        under: false,
        missingMandate: true,
        cycleCheck: true,
        message: opts.studentLabel
          ? `No mandate on file for ${opts.studentLabel} — import blocked.`
          : 'No mandate on file for this student — import blocked.',
      };
    }
    // Include same-child sessions outside this calendar week so the cycle window is accurate.
    const pool = sessionsCountingTowardWeekly(
      allSessions.filter((s) => s.studentId === mandate.studentId),
    );
    // Prefer mandate-matched pool when ratio/discipline known; fall back to week counted.
    const matched = pool.filter((s) => sessionMatchesMandate(s, mandate));
    const cycleCounted = matched.length ? matched : pool.length ? pool : counted;
    const densest = maxSessionsInSchoolDayCycle(cycleCounted, days, opts.calendar);
    const cycleUsed = densest.used;
    const over = cycleUsed > allowed;
    return {
      used: cycleUsed,
      allowed,
      over,
      under: !over && cycleUsed < allowed,
      cycleCheck: true,
      message: over
        ? overMandateMessage(opts, cycleCounted, cycleUsed, allowed, 'school_day_cycle')
        : cycleUsed < allowed
          ? `Under cycle mandate${who}: ${cycleUsed} of ${allowed} in a ${days}-school-day window.`
          : '',
    };
  }

  const allowed = allowedOrSkip;
  if (allowed <= 0) {
    return {
      used,
      allowed: 0,
      over: true,
      under: false,
      missingMandate: true,
      message: opts.studentLabel
        ? `No mandate on file for ${opts.studentLabel} — import blocked. Ask the office to import the caseload or add a mandate.`
        : 'No mandate on file for this student — import blocked. Ask the office to import the caseload or add a mandate.',
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

export type MandateWeekCheckOpts = {
  /** Fallback calendar when no per-student entry (defaults to Mon–Fri). */
  calendar?: SchoolCalendar | null;
  /** Per-child school calendar (preferred for multi-school weeks). */
  calendarByStudentId?:
    | ReadonlyMap<string, SchoolCalendar | null | undefined>
    | Record<string, SchoolCalendar | null | undefined>;
  /** School display name per child (for Mon–Fri fallback warnings). */
  schoolNameByStudentId?:
    | ReadonlyMap<string, string>
    | Record<string, string>;
  /**
   * Also evaluate these children when they have no sessions this week
   * (so under-mandate yellow fires for 0 of N, not only partial uploads).
   */
  includeStudentIds?: readonly string[];
};

function resolveCalendarForStudent(
  studentId: string,
  opts?: MandateWeekCheckOpts,
): SchoolCalendar | null | undefined {
  const byId = opts?.calendarByStudentId;
  if (!byId) return opts?.calendar;
  if (byId instanceof Map) {
    if (byId.has(studentId)) return byId.get(studentId) ?? null;
    return opts?.calendar;
  }
  if (Object.prototype.hasOwnProperty.call(byId, studentId)) {
    return (byId as Record<string, SchoolCalendar | null | undefined>)[studentId] ?? null;
  }
  return opts?.calendar;
}

function resolveSchoolNameForStudent(
  studentId: string,
  opts?: MandateWeekCheckOpts,
): string {
  const byId = opts?.schoolNameByStudentId;
  if (!byId) return '';
  if (byId instanceof Map) return String(byId.get(studentId) || '').trim();
  return String((byId as Record<string, string>)[studentId] || '').trim();
}

/**
 * Check all active mandates for students with sessions this week.
 * Multiple mandates per student (e.g. individual + group) are each checked
 * against sessions assigned to that mandate — second rows are not dropped.
 * No mandate on file → error (import blocked). Under-mandate → warning only.
 * school_day_cycle → densest school-day window over-check (not a silent skip).
 * Pass calendarByStudentId (or calendar) so off-days / year bounds apply.
 * Empty / missing school calendar → Mon–Fri still used, plus an explicit warning.
 */
export function checkMandatesForWeek(
  mandates: Mandate[],
  sessions: SessionRow[],
  allSessions: SessionRow[] = sessions,
  studentNameById?: ReadonlyMap<string, string> | Record<string, string>,
  opts?: MandateWeekCheckOpts,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const calendarFallbackWarned = new Set<string>();
  const byStudent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    if (isAdditionalServiceSession(s)) continue;
    const list = byStudent.get(s.studentId) ?? [];
    list.push(s);
    byStudent.set(s.studentId, list);
  }
  for (const studentId of opts?.includeStudentIds || []) {
    if (!studentId || byStudent.has(studentId)) continue;
    byStudent.set(studentId, []);
  }
  for (const [studentId, rows] of byStudent) {
    const studentLabel = resolveStudentLabel(studentId, studentNameById);
    const calendar = resolveCalendarForStudent(studentId, opts);
    const studentMandates = mandates.filter((m) => m.studentId === studentId);
    const usesCycle = studentMandates.some(
      (m) => mandateFrequencyKind(m) === 'school_day_cycle',
    );
    if (usesCycle && !hasConfiguredSchoolCalendar(calendar)) {
      const schoolName = resolveSchoolNameForStudent(studentId, opts);
      const warnKey = schoolName || studentId;
      if (!calendarFallbackWarned.has(warnKey)) {
        calendarFallbackWarned.add(warnKey);
        warnings.push(schoolCalendarMonFriFallbackWarning(schoolName));
      }
    }
    if (!studentMandates.length) {
      // No sessions and no mandate → nothing to flag (avoid "no mandate" for empty include list).
      if (!rows.length) continue;
      const result = checkMandate(undefined, rows, allSessions, {
        studentLabel,
        calendar,
      });
      errors.push(result.message);
      continue;
    }

    // Shared month/week anchor so empty monthly mandate slices still scope to this upload month.
    const monthAnchorDos =
      rows
        .map((s) => s.dateOfService)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || '';

    if (studentMandates.length === 1) {
      const result = checkMandate(studentMandates[0], rows, allSessions, {
        studentLabel,
        calendar,
        monthAnchorDos,
      });
      if (result.over || result.missingMandate) errors.push(result.message);
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
      const result = checkMandate(mandate, assigned, allSessions, {
        studentLabel,
        serviceLabel,
        calendar,
        monthAnchorDos,
      });
      if (result.over || result.missingMandate) {
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
