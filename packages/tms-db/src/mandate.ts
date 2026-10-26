import { buildSchoolBillingServiceName } from '@white-glove/shared';
import { isoDate, parseDos } from './ids.js';
import { sessionBillingKind, sessionDurationMinutes } from './provider-pay.js';
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
  if (mandate.mandateKind === 'makeup_auth' || mandate.mandateKind === 'makeup_weekly') {
    return undefined;
  }
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

export function cyclePeriodSchoolDays(
  mandate: Mandate | undefined,
  calendar?: SchoolCalendar | null,
): number {
  if (!mandate || mandateFrequencyKind(mandate) !== 'school_day_cycle') return 0;
  const n = Number(mandate.periodSchoolDays);
  if (Number.isFinite(n) && n > 0) return n;
  const fromSchool = Number(calendar?.cycleDays);
  if (Number.isFinite(fromSchool) && fromSchool > 0) return fromSchool;
  return 6;
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
  if (/\bgroup\b/i.test(s)) return true;
  // Any N:1 with N≥2 is a group (2:1, 3:1, 5:1…). Clock times (8:40, 9:10) are not N:1.
  const ratio = s.match(/\b(\d+)\s*:\s*1\b/);
  if (ratio) {
    const n = Number(ratio[1]);
    if (Number.isFinite(n) && n >= 2) return true;
    if (n === 1) return false;
  }
  if (/\bindividual\b/i.test(s)) return false;
  return null;
}

/**
 * True when notes clearly say no peer/partner was available (or clear synonym).
 * Solo-group Frontline rows often arrive as 1:1 with this note.
 * Also matches "group mate is absent" / "partner absent" (peer missing, student attended),
 * and "Group Mandate- seen individually" (hyphen, en dash, em dash, colon, or spaces).
 * The person and absent/missing must be adjacent (optional "was"/"is"). A clinical
 * sentence such as "Student walk on balance beams without missing" is not a peer absence.
 */
export function notesMentionNoPeerAvailable(notes: string): boolean {
  const n = String(notes || '');
  if (!n.trim()) return false;
  // peer | partner | classmate | groupmate / "group mate" / "group member" (optional plural)
  const who =
    'peers?|partners?|classmates?|groupmates?|group\\s*mates?|group\\s*partners?|group\\s*members?';
  const otherWho =
    'student|child|peer|partner|member|participant|group\\s*mate|group\\s*partner|group\\s*member|classmate';
  if (
    new RegExp(
      `\\bno\\s+(?:other\\s+)?(?:${who})\\b` +
        `|\\b(?:${who})\\s+(?:were\\s+|was\\s+|are\\s+|is\\s+)?(?:not\\s+|un)?available\\b` +
        `|\\bno\\s+other\\s+(?:${otherWho})s?\\b` +
        `|\\b(?:other\\s+)?(?:${otherWho})s?\\s+(?:(?:was|were|is|are)\\s+)?(?:absent|unavailable|missing)\\b` +
        `|\\b(?:his|her|their|the)\\s+(?:${who})\\s+(?:is|was|are|were)\\s+absent\\b` +
        // Therapists often write "Group not available" for solo-group (no peer).
        `|\\bgroups?\\s+(?:was\\s+|were\\s+|is\\s+|are\\s+)?(?:not\\s+)?(?:un)?available\\b` +
        `|\\bno\\s+group\\s+available\\b` +
        // Elizabeth-style: "can not be seen in a group" / "no one appropriate to group…"
        `|\\bcan(?:\\s*not|not)\\s+be\\s+seen\\s+in\\s+(?:a\\s+)?group\\b` +
        `|\\bno\\s+one\\s+appropriate\\s+to\\s+group\\b` +
        `|\\bnot\\s+appropriate\\s+to\\s+group\\b` +
        // "Group Mandate- seen individually" (hyphen, en dash, em dash, colon, or just spaces).
        `|\\bgroup\\s+mandate\\s*[-\\u2013\\u2014:]?\\s*seen\\s+individually\\b`,
      'i',
    ).test(n)
  ) {
    return true;
  }
  return false;
}

/**
 * Short note-context tags for mandate reader / over-mandate messages.
 * Prefer product language: "no partner available", "makeup session".
 */
export function sessionMandateNoteContext(session: Pick<SessionRow, 'attendance' | 'notes'>): string {
  const bits: string[] = [];
  const notes = String(session.notes || '');
  if (
    session.attendance === 'makeup' ||
    /\bm+ake[\s-]?up\s+(?:session|for)\b/i.test(notes)
  ) {
    bits.push('makeup session');
  }
  if (notesMentionNoPeerAvailable(notes)) bits.push('no partner available');
  return bits.join('; ');
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
  if (mandate.mandateKind === 'makeup_weekly') return 'makeup_weekly';
  if (mandate.mandateKind === 'makeup_auth') return 'makeup_auth';
  if (/\bmakeup\b|make[\s-]?up/i.test(mandate.serviceType || '')) return 'makeup_auth';
  return 'regular';
}

export function isMakeupAuthMandate(mandate: Mandate | undefined): boolean {
  return mandateKindOf(mandate) === 'makeup_auth';
}

export function isMakeupWeeklyMandate(mandate: Mandate | undefined): boolean {
  return mandateKindOf(mandate) === 'makeup_weekly';
}

/** Leftover pool or weekly makeup authorization — not a basic attended-session mandate. */
export function isMakeupKindMandate(mandate: Mandate | undefined): boolean {
  return isMakeupAuthMandate(mandate) || isMakeupWeeklyMandate(mandate);
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
 * Edelia: a school visit shorter than the mandate (15 min on a 30-min mandate)
 * is never allowed. The rate and the service code stay on the mandate.
 * Additional services are exempt — those rates follow the clock.
 */
export function sessionShorterThanMandateError(
  session: SessionRow,
  mandates: Mandate[],
): string | null {
  if (
    session.attendance !== 'attended' &&
    session.attendance !== 'makeup' &&
    session.attendance !== 'paid_absence'
  ) {
    return null;
  }
  if (sessionBillingKind(session) !== 'school') return null;
  const clock = sessionDurationMinutes(session.beginTime, session.endTime);
  const mandateMinutes = mandateDurationMinutesForSession(session, mandates);
  if (clock == null || mandateMinutes == null || clock >= mandateMinutes) return null;
  return (
    `Session is ${clock} min but the mandate is ${mandateMinutes} min. ` +
    `Sessions shorter than the mandate are not allowed. ` +
    `The rate and service code stay on the ${mandateMinutes}-minute mandate. ` +
    `Change the times to ${mandateMinutes} min.`
  );
}

/**
 * Among same-class candidates, prefer the mandate whose RS Duration is closest
 * to the session clock. Avoids billing a 60-min Frontline visit as PT school 30
 * (HHA CreateSchedule ErrorID=-11 when PrimaryBillTo minutes ≠ service-code unit).
 */
function preferClosestDurationMandate(
  candidates: Mandate[],
  session: SessionRow,
): Mandate | undefined {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const clock = sessionDurationMinutes(session.beginTime, session.endTime);
  if (clock == null) return candidates[0];
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of candidates) {
    const md = Number(m.durationMinutes);
    const score = Number.isFinite(md) ? Math.abs(clock - md) : Number.POSITIVE_INFINITY;
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
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
    let preferred = preferClosestDurationMandate(candidates, s) || candidates[0]!;
    if (s.attendance === 'makeup' && !s.makeupOfSessionId) {
      // Unlinked makeups: Makeup auth pool first, then Makeup-Weekly; miss-linked do not.
      preferred =
        preferClosestDurationMandate(
          candidates.filter((m) => isMakeupAuthMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => isMakeupWeeklyMandate(m)),
          s,
        ) ||
        (soloGroupViaNote
          ? preferClosestDurationMandate(
              candidates.filter((m) => m.ratioGroup),
              s,
            )
          : undefined) ||
        preferClosestDurationMandate(
          candidates.filter((m) => Boolean(m.ratioGroup) === Boolean(sessGroup)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
    } else if (s.attendance === 'makeup' && s.makeupOfSessionId) {
      preferred =
        (soloGroupViaNote
          ? preferClosestDurationMandate(
              candidates.filter((m) => !isMakeupKindMandate(m) && m.ratioGroup),
              s,
            )
          : undefined) ||
        preferClosestDurationMandate(
          candidates.filter(
            (m) => !isMakeupKindMandate(m) && Boolean(m.ratioGroup) === Boolean(sessGroup),
          ),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
    } else if (soloGroupViaNote) {
      // Solo group / no-partner note → group mandate frequency (not individual).
      preferred =
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m) && m.ratioGroup),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
    } else if (sessGroup === false) {
      // True individual / 1:1 without no-partner note → individual mandate first.
      // Never force these onto a group mandate when both exist.
      // Prefer RS Duration closest to clock (60-min visit → PT school 60, not 30).
      preferred =
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m) && !m.ratioGroup),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
    } else if (sessGroup === true) {
      preferred =
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m) && m.ratioGroup),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
    } else if (candidates.length > 1) {
      // No ratio signal — prefer individual when both exist so group slots aren't double-spent.
      preferred =
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m) && !m.ratioGroup),
          s,
        ) ||
        preferClosestDurationMandate(
          candidates.filter((m) => !isMakeupKindMandate(m)),
          s,
        ) ||
        preferClosestDurationMandate(candidates, s) ||
        candidates[0]!;
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

/** Additional service saved with no student. HHA gets a new "no child" patient per row. */
export function additionalServiceWithoutChild(
  session: Pick<SessionRow, 'studentId' | 'additionalServiceType'>,
): boolean {
  return Boolean(session.additionalServiceType) && !String(session.studentId || '').trim();
}

/** Placeholder created only so an additional service can be scheduled in HHA. */
export function isNoChildPlaceholderName(
  student: { firstName?: string; lastName?: string } | null | undefined,
): boolean {
  return (
    String(student?.firstName || '').trim().toLowerCase() === 'no' &&
    String(student?.lastName || '').trim().toLowerCase() === 'child'
  );
}

/** Child column for lists and the timesheet. Additional services with no student show "No child". */
export function sessionListedChildName(
  session: Pick<SessionRow, 'studentId' | 'additionalServiceType'>,
  resolvedName?: string,
): string {
  const named = String(resolvedName || '').trim();
  if (named) return named;
  const id = String(session.studentId || '').trim();
  if (id) return id;
  if (session.additionalServiceType) return 'No child';
  return '';
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

/**
 * Weekly yellow frequency: every submitted attended or missed session counts.
 * Notes do not matter. Makeup rows stay out (separate makeup rules) and never
 * drop a missed session from this count.
 */
function sessionsSubmittedTowardWeekly(weekSessions: SessionRow[]): SessionRow[] {
  return weekSessions.filter(
    (s) =>
      !isAdditionalServiceSession(s) &&
      (s.attendance === 'attended' || s.attendance === 'missed'),
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

function weeklyUnderMandateMessage(
  opts: MandateCheckOpts,
  submitted: number,
  allowed: number,
): string {
  const named = String(opts.studentLabel || '').trim() || String(opts.serviceLabel || '').trim();
  const who = named ? ` for ${whoLabel(opts)}` : '';
  return `Under mandate${who}: ${submitted} of ${allowed} this week.`;
}

function sessionSlotWithNoteContext(session: SessionRow): string {
  const slot = sessionSlotLabel(session);
  const ctx = sessionMandateNoteContext(session);
  return ctx ? `${slot} (${ctx})` : slot;
}

function overMandateMessage(
  opts: MandateCheckOpts,
  counted: SessionRow[],
  used: number,
  allowed: number,
  kind: 'weekly' | 'makeup_auth' | 'makeup_weekly' | 'school_day_cycle' | 'monthly',
): string {
  const who = whoLabel(opts);
  const slots = counted.map(sessionSlotWithNoteContext).filter(Boolean).join('; ');
  const slotBit = slots ? ` session(s) on ${slots}.` : '';
  // Exact reader reasons when dual-mandate math applies solo-group / makeup rows.
  const noteContexts = [
    ...new Set(counted.map(sessionMandateNoteContext).filter(Boolean)),
  ];
  const reasonBit = noteContexts.length
    ? ` Reason from note: ${noteContexts.join('; ')}.`
    : '';
  if (kind === 'makeup_auth') {
    return (
      `This exceeds the makeup authorization for ${who}:${slotBit} ` +
      `Authorization allows ${allowed} leftover makeup session(s); this would make it ${used}.` +
      (reasonBit || ' Reason from note: makeup session.')
    );
  }
  if (kind === 'makeup_weekly') {
    return (
      `This exceeds the Makeup-Weekly authorization for ${who}:${slotBit} ` +
      `Allows ${allowed} makeup session(s) per week; this would make it ${used}.` +
      (reasonBit || ' Reason from note: makeup session.')
    );
  }
  if (kind === 'school_day_cycle') {
    return (
      `This exceeds the cycle mandate for ${who}:${slotBit} ` +
      `Mandate allows ${allowed} session(s) per cycle; densest window would make it ${used}.` +
      reasonBit
    );
  }
  if (kind === 'monthly') {
    return (
      `This exceeds the monthly mandate for ${who}:${slotBit} ` +
      `Mandate allows ${allowed} session(s) per month; this upload would make it ${used}.` +
      reasonBit
    );
  }
  return (
    `This exceeds the mandate for ${who}:${slotBit} ` +
    `Mandate allows ${allowed} session(s) per week; this upload would make it ${used}.` +
    reasonBit
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

/**
 * Attended counts toward weekly over-mandate. A missed session does not.
 * Yellow under-mandate counts every submitted attended or missed session.
 * Notes do not matter. Linked and unlinked makeups stay on makeup rules.
 */
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
    // Leftover makeup-auth capacity is not a yellow week warning — only over-auth blocks.
    // Basic under-mandate warnings still come from regular weekly/monthly/cycle checks.
    return {
      used,
      allowed,
      over,
      under: false,
      message: over ? overMandateMessage(opts, pool, used, allowed, 'makeup_auth') : '',
    };
  }

  if (isMakeupWeeklyMandate(mandate) && mandate) {
    const allowed = weeklyAllowedSessions(mandate) || 0;
    // Weekly cadence for unlinked makeups in this week slice (assigned or student week rows).
    const pool = weekSessions.filter(
      (s) =>
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
      under: false,
      message: over ? overMandateMessage(opts, pool, used, allowed, 'makeup_weekly') : '',
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
    const days = cyclePeriodSchoolDays(mandate, opts.calendar);
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
  const submitted = sessionsSubmittedTowardWeekly(weekSessions).length;
  // Over stays attended-only: an extra miss must not exceed the weekly mandate.
  const over = used > allowed;
  // Yellow is a missing session. Attended and missed both count; notes do not.
  const under = submitted < allowed;
  return {
    used,
    allowed,
    over,
    under,
    message: over
      ? overMandateMessage(opts, counted, used, allowed, 'weekly')
      : under
        ? weeklyUnderMandateMessage(opts, submitted, allowed)
        : '',
  };
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
   * (weekly 0-of-N, monthly / cycle shortfall, and calendar fallback).
   */
  includeStudentIds?: readonly string[];
  /**
   * When set, yellow under-mandate warnings only come from these providers'
   * mandates (this timesheet's caseload, including same-name alias ids).
   * Over-mandate errors are unchanged.
   */
  caseloadProviderIds?: readonly string[];
  /** Monday YYYY-MM-DD of the week being viewed. Used for discharge. */
  weekStart?: string;
  /**
   * Today YYYY-MM-DD. A mandate with endOn on or before this date is discharged
   * for a week that contains this date (same <= rule as the mandate screen).
   */
  asOf?: string;
};

function canonicalIsoDay(value: string): string {
  const dt = parseDos(value);
  return dt ? isoDate(dt) : '';
}

function isoDayPlus(iso: string, days: number): string {
  const dt = parseDos(iso);
  if (!dt) return '';
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoDate(dt);
}

/**
 * True when endOn is set and the mandate is already over for the week being viewed.
 * Ended on or before that Monday, or — when today falls in the week — endOn <= today.
 */
export function mandateDischargedForWeek(
  mandate: { endOn?: string },
  weekStart: string,
  asOf = '',
): boolean {
  const end = canonicalIsoDay(String(mandate.endOn || ''));
  if (!end) return false;
  const start = canonicalIsoDay(weekStart);
  const today = canonicalIsoDay(asOf);
  if (start && end <= start) return true;
  if (start && today && start <= today) {
    const weekEnd = isoDayPlus(start, 6);
    if (weekEnd && today <= weekEnd && end <= today) return true;
  }
  if (!start && today && end <= today) return true;
  return false;
}

/** Yellow under-mandate only: active caseload mandate for the week being viewed. */
function underMandateWarningApplies(mandate: Mandate, opts?: MandateWeekCheckOpts): boolean {
  const ids = (opts?.caseloadProviderIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (ids.length && !ids.includes(String(mandate.providerId || '').trim())) return false;
  const weekStart = String(opts?.weekStart || '').trim();
  const asOf = String(opts?.asOf || '').trim();
  if ((weekStart || asOf) && mandateDischargedForWeek(mandate, weekStart, asOf)) return false;
  return true;
}

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
 * No mandate on file → error (import blocked).
 * Weekly yellow is fewer submitted sessions than the mandate (attended and missed both count; notes do not).
 * When caseloadProviderIds / weekStart are set, that yellow is skipped for another
 * provider's mandate and for a discharged mandate (endOn on or before the week, or endOn <= today inside the week).
 * Monthly / cycle shortfall remains a warning. Makeup-auth under-use does not warn.
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
    for (const s of rows) {
      const shortErr = sessionShorterThanMandateError(s, mandates);
      if (!shortErr) continue;
      const who = studentLabel ? `${studentLabel}: ` : '';
      errors.push(`${s.dateOfService} ${who}${shortErr}`);
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
      const mandate = studentMandates[0]!;
      const result = checkMandate(mandate, rows, allSessions, {
        studentLabel,
        calendar,
        monthAnchorDos,
      });
      if (result.over || result.missingMandate) errors.push(result.message);
      else if (result.under && result.message && underMandateWarningApplies(mandate, opts)) {
        warnings.push(result.message);
      }
      continue;
    }

    const { byMandateId, unmatched } = assignSessionsToMandates(studentMandates, rows);
    const mandateResults: Array<{ mandate: Mandate; result: ReturnType<typeof checkMandate> }> = [];
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
      mandateResults.push({ mandate, result });
    }
    const hasGroupUnder = mandateResults.some(
      ({ mandate, result }) =>
        underMandateWarningApplies(mandate, opts) &&
        !isMakeupKindMandate(mandate) &&
        mandate.ratioGroup &&
        result.under &&
        !result.over &&
        !result.missingMandate,
    );
    for (const { mandate, result } of mandateResults) {
      if (result.over || result.missingMandate) {
        let msg = result.message;
        // Dual individual+group: individual over while group still has room → tell reader
        // the note must say no partner available so frequency counts toward group.
        if (
          hasGroupUnder &&
          !isMakeupKindMandate(mandate) &&
          !mandate.ratioGroup &&
          result.over &&
          !/Reason from note:/i.test(msg)
        ) {
          msg +=
            ' If this session covers the group mandate, the note must say no partner available (or group partner absent / makeup session).';
        }
        errors.push(msg);
      } else if (result.under && result.message && underMandateWarningApplies(mandate, opts)) {
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
