import {
  isAdditionalServiceSession,
  isMakeupAuthMandate,
  notesMentionNoPeerAvailable,
  sessionLooksGroup,
  sessionSlotLabel,
} from './mandate.js';
import { clockToMinutes } from './provider-pay.js';
import type { Mandate, SessionRow } from './types.js';

export { notesMentionNoPeerAvailable };

export type OverlapSession = Pick<
  SessionRow,
  'id' | 'studentId' | 'dateOfService' | 'beginTime' | 'endTime' | 'serviceType' | 'attendance'
> & {
  additionalServiceType?: SessionRow['additionalServiceType'];
};

/** Normalize Frontline DOS strings for same-day compares (`09/01/2026` vs `9/1/2026`). */
export function sameDateOfService(a: string, b: string): boolean {
  const na = normalizeDosKey(a);
  const nb = normalizeDosKey(b);
  if (!na || !nb) return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  return na === nb;
}

function normalizeDosKey(raw: string): string {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return '';
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return '';
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * True when ranges share interior time on the clock.
 * Adjacent is OK: `2:00–2:30` and `2:30–3:00` do not overlap.
 */
export function sessionsHaveInteriorOverlap(
  a: Pick<OverlapSession, 'beginTime' | 'endTime'>,
  b: Pick<OverlapSession, 'beginTime' | 'endTime'>,
): boolean {
  const a0 = clockToMinutes(a.beginTime);
  const a1 = clockToMinutes(a.endTime);
  const b0 = clockToMinutes(b.beginTime);
  const b1 = clockToMinutes(b.endTime);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  // Half-open [start, end): end touching the next start is adjacent, not overlapping.
  return a0 < b1 && b0 < a1;
}

/** True when a mandate is a group mandate (ratio, size > 1, or group keywords). */
export function mandateLooksGroup(m: Pick<Mandate, 'ratioGroup' | 'groupSize' | 'serviceType'>): boolean {
  if (m.ratioGroup) return true;
  if (m.groupSize != null && Number(m.groupSize) > 1) return true;
  if (sessionLooksGroup(m.serviceType || '') === true) return true;
  return false;
}

export function childHasGroupMandate(studentId: string, mandates?: Mandate[]): boolean {
  if (!studentId || !mandates?.length) return false;
  return mandates.some((m) => m.studentId === studentId && mandateLooksGroup(m));
}

/** True when the child has a regular (non-makeup) individual mandate (`ratioGroup` false). */
export function childHasIndividualMandate(studentId: string, mandates?: Mandate[]): boolean {
  if (!studentId || !mandates?.length) return false;
  return mandates.some(
    (m) => m.studentId === studentId && !m.ratioGroup && !isMakeupAuthMandate(m),
  );
}

/**
 * Strictest positive groupSize among the child's group mandates.
 * Unspecified / Small Group (fewer than 3) → max 2.
 */
export function childGroupSizeCap(studentId: string, mandates?: Mandate[]): number | null {
  if (!studentId || !mandates?.length) return null;
  let cap: number | null = null;
  let unspecifiedGroup = false;
  for (const m of mandates) {
    if (m.studentId !== studentId || !mandateLooksGroup(m)) continue;
    const n = m.groupSize == null ? NaN : Number(m.groupSize);
    if (!Number.isFinite(n) || n <= 0) {
      unspecifiedGroup = true;
      continue;
    }
    const rounded = Math.round(n);
    cap = cap == null ? rounded : Math.min(cap, rounded);
  }
  if (cap != null) return cap;
  // Client: small group = fewer than 3 → allow at most 2 present children.
  return unspecifiedGroup ? 2 : null;
}

/**
 * Group↔group may share a clock window only when both sessions are group-tagged
 * (Group, or any N:1 with N >= 2). Group-mandate kids seen individually (individual / 1:1 /
 * no group token) are treated as individual for overlap — a later peer in the same
 * window is blocked even if both have group mandates.
 */
export function overlapExceptionAllows(
  a: Pick<OverlapSession, 'serviceType' | 'studentId'>,
  b: Pick<OverlapSession, 'serviceType' | 'studentId'>,
  _mandates?: Mandate[],
): boolean {
  return (
    sessionLooksGroup(a.serviceType) === true && sessionLooksGroup(b.serviceType) === true
  );
}

function occupiesProviderTime(s: OverlapSession): boolean {
  if (isAdditionalServiceSession(s as SessionRow)) return true;
  return s.attendance === 'attended' || s.attendance === 'makeup';
}

function sessionIsIndividualForPay(s: Pick<OverlapSession, 'serviceType'>): boolean {
  // Explicit individual / 1:1, or unknown (not group) — treat as individual for the lock.
  return sessionLooksGroup(s.serviceType) !== true;
}

/**
 * Explicit group visit: service text contains Group, ratio N:1 with N >= 2,
 * or group CPT 97150 when the row is not tagged 1:1 / Individual.
 * A partner who is not in TMS yet does not make this an individual visit.
 */
export function sessionExplicitlyMarkedGroup(
  serviceType: string,
  extra?: { ratio?: string | null; cptCodes?: readonly string[] | null },
): boolean {
  const combined = [serviceType, extra?.ratio].filter((s) => String(s || '').trim()).join(' ');
  const looks = sessionLooksGroup(combined);
  // True solo tag wins. Billing 97150 on a 1:1 row does not skip the no-peer note.
  if (looks === false) return false;
  if (looks === true) return true;
  return (extra?.cptCodes || []).some((c) => String(c || '').trim() === '97150');
}

/**
 * Hard locker when a group-mandate child is actually seen individually
 * (ratio 1:1 / Individual, or no group ratio): the note must say no peer/partner
 * was available (or a clear equivalent).
 *
 * An explicit group session (Group, 2:1 / N:1, or CPT 97150) is not blocked
 * just because the partner child is not on this row yet — that note is entered
 * separately. Dual mandate (individual + group): a normal 1:1 visit without a
 * no-partner note covers the individual mandate and does not demand the note.
 */
export function soloGroupMandateNoteError(opts: {
  notes: string;
  serviceType: string;
  studentId: string;
  attendance: string;
  mandates?: Mandate[];
  /** Kept for callers. Explicit group sessions no longer use peer count for this gate. */
  presentGroupPeerCount?: number;
  /** Frontline CPT codes. 97150 is a group procedure when the row is not 1:1. */
  cptCodes?: readonly string[] | null;
  /** Parsed ratio token when it was not copied into serviceType. */
  ratio?: string | null;
}): string | null {
  if (opts.attendance !== 'attended' && opts.attendance !== 'makeup') return null;
  if (!childHasGroupMandate(opts.studentId, opts.mandates)) return null;
  if (
    sessionExplicitlyMarkedGroup(opts.serviceType, {
      ratio: opts.ratio,
      cptCodes: opts.cptCodes,
    })
  ) {
    return null;
  }
  if (notesMentionNoPeerAvailable(opts.notes)) return null;
  // True individual visit when the child also has an individual mandate.
  if (childHasIndividualMandate(opts.studentId, opts.mandates)) {
    return null;
  }
  return (
    'Group-mandate child seen individually — note must say no peer was available ' +
    '(or no partner available / equivalent). This session is blocked until the note is clear.'
  );
}

/** @deprecated Use soloGroupMandateNoteError — now a hard locker. */
export function soloGroupMandateNoteWarning(
  opts: Parameters<typeof soloGroupMandateNoteError>[0],
): string | null {
  return soloGroupMandateNoteError(opts);
}

function childLabel(
  studentId: string,
  names?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  if (!names) return 'another child';
  if (names instanceof Map) return String(names.get(studentId) || '').trim() || 'another child';
  return String((names as Record<string, string>)[studentId] || '').trim() || 'another child';
}

export type SessionOverlapCheckOpts = {
  /** Candidate session being added / saved. */
  candidate: OverlapSession;
  /** Existing + earlier-in-batch sessions for the same provider (any week). */
  peers: OverlapSession[];
  studentNameById?: ReadonlyMap<string, string> | Record<string, string>;
  /** Mandates used for group-mandate overlap + groupSize cap. */
  mandates?: Mandate[];
};

/**
 * Distinct children in the candidate's group↔group overlapping cluster (same provider day).
 */
export function groupOverlapClusterStudentIds(opts: SessionOverlapCheckOpts): string[] {
  const { candidate, peers, mandates } = opts;
  const ids = new Set<string>([candidate.studentId]);
  if (!occupiesProviderTime(candidate)) return [...ids];

  for (const peer of peers) {
    if (peer.id && candidate.id && peer.id === candidate.id) continue;
    if (!occupiesProviderTime(peer)) continue;
    if (!sameDateOfService(candidate.dateOfService, peer.dateOfService)) continue;
    if (!sessionsHaveInteriorOverlap(candidate, peer)) continue;
    if (!overlapExceptionAllows(candidate, peer, mandates)) continue;
    ids.add(peer.studentId);
  }
  return [...ids];
}

/**
 * Other present (attended/makeup) children sharing the candidate's group↔group clock window.
 * Missed/absent peers do not count — used for solo-group → individual pay.
 */
export function presentGroupPeerCount(opts: SessionOverlapCheckOpts): number {
  return Math.max(0, groupOverlapClusterStudentIds(opts).length - 1);
}

function groupClusterSizeError(opts: SessionOverlapCheckOpts): string | null {
  const clusterIds = groupOverlapClusterStudentIds(opts);
  if (clusterIds.length <= 1) return null;
  const n = clusterIds.length;
  for (const studentId of clusterIds) {
    const cap = childGroupSizeCap(studentId, opts.mandates);
    if (cap != null && n > cap) {
      return (
        `Group locker: mandate allows ${cap} overlapping children; this slot has ${n} for this provider.`
      );
    }
  }
  return null;
}

/**
 * Clear per-row error when the candidate conflicts with a peer on the same DOS.
 * Returns null when OK (no conflict, or group↔group exception within groupSize).
 */
export function sessionOverlapError(opts: SessionOverlapCheckOpts): string | null {
  const { candidate, peers } = opts;
  if (!occupiesProviderTime(candidate)) return null;
  const dos = String(candidate.dateOfService || '').trim();
  if (!dos) return null;

  for (const peer of peers) {
    if (peer.id && candidate.id && peer.id === candidate.id) continue;
    if (!occupiesProviderTime(peer)) continue;
    if (!sameDateOfService(candidate.dateOfService, peer.dateOfService)) continue;
    if (!sessionsHaveInteriorOverlap(candidate, peer)) continue;
    if (overlapExceptionAllows(candidate, peer, opts.mandates)) continue;

    const peerName = childLabel(peer.studentId, opts.studentNameById);
    const peerSlot = sessionSlotLabel(peer as SessionRow);
    const candLooksGroup = sessionLooksGroup(candidate.serviceType) === true;
    const peerLooksGroup = sessionLooksGroup(peer.serviceType) === true;

    // Rule 4: group peer after a group-mandate child was already paid individually for this slot.
    if (candLooksGroup && !peerLooksGroup) {
      const peerHasGroupMandate = childHasGroupMandate(peer.studentId, opts.mandates);
      if (peerHasGroupMandate || sessionIsIndividualForPay(peer)) {
        return (
          `Cannot add a group session overlapping ${peerName} on ${peerSlot} — ` +
          `that visit was already paid at the individual rate. Group peers are not allowed for this slot.`
        );
      }
    }
    if (!candLooksGroup && peerLooksGroup) {
      if (childHasGroupMandate(candidate.studentId, opts.mandates)) {
        return (
          `Cannot add an individual session overlapping group session for ${peerName} on ${peerSlot} — ` +
          `times may not mix group and individual.`
        );
      }
    }

    return (
      `Session time overlaps ${peerName} on ${peerSlot}. ` +
      `Adjacent times are OK (e.g. 2:00–2:30 then 2:30–3:00); interior overlap is not. ` +
      `Only group↔group sessions may share the same clock window.`
    );
  }

  return groupClusterSizeError(opts);
}

/** Patient token from HHA -310 text: `[WGC-PS922524305/Hussnain Musa ]`. */
export function hhaOverlapPatientToken(message: string): { admission: string; name: string } {
  const inner = String(message || '').match(/\[([^\]]+)\]/)?.[1]?.trim() || '';
  const slash = inner.indexOf('/');
  if (slash < 0) return { admission: inner, name: '' };
  return {
    admission: inner.slice(0, slash).trim(),
    name: inner.slice(slash + 1).trim(),
  };
}

function nameTokensMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const left = norm(a).split(' ').filter(Boolean).sort().join(' ');
  const right = norm(b).split(' ').filter(Boolean).sort().join(' ');
  return Boolean(left) && left === right;
}

export type GroupMateStudent = {
  id: string;
  firstName?: string;
  lastName?: string;
  /** Caseload id HHA embeds in the admission number (922524305 → WGC-PS922524305). */
  programId?: string;
};

/**
 * The -310 names a different child who is a real group mate of this session
 * (same clock, both group-tagged). Same-child duplicates return null.
 */
export function hhaOverlapGroupMate(opts: {
  message: string;
  candidate: OverlapSession;
  peers: OverlapSession[];
  mandates?: Mandate[];
  students?: GroupMateStudent[];
}): GroupMateStudent | null {
  const { admission, name } = hhaOverlapPatientToken(opts.message);
  if (!admission && !name) return null;
  if (!occupiesProviderTime(opts.candidate)) return null;
  const byId = new Map((opts.students || []).map((s) => [s.id, s]));
  for (const peer of opts.peers) {
    if (!peer.studentId || peer.studentId === opts.candidate.studentId) continue;
    if (!occupiesProviderTime(peer)) continue;
    if (!sameDateOfService(opts.candidate.dateOfService, peer.dateOfService)) continue;
    if (!sessionsHaveInteriorOverlap(opts.candidate, peer)) continue;
    if (!overlapExceptionAllows(opts.candidate, peer, opts.mandates)) continue;
    const student = byId.get(peer.studentId);
    if (!student) continue;
    const program = String(student.programId || '').replace(/\s+/g, '').toLowerCase();
    const adm = admission.replace(/\s+/g, '').toLowerCase();
    const programHit = Boolean(program) && adm.includes(program);
    const full = `${student.firstName || ''} ${student.lastName || ''}`.trim();
    const nameHit = Boolean(name) && nameTokensMatch(name, full);
    if (programHit || nameHit) return student;
  }
  return null;
}

/**
 * Sessions for a provider on a given DOS (all weeks), excluding an optional id.
 */
export function providerDaySessions(
  sessions: SessionRow[],
  weeks: Array<{ id: string; providerId: string }>,
  providerId: string,
  dateOfService: string,
  excludeSessionId?: string,
): SessionRow[] {
  const weekIds = new Set(
    weeks.filter((w) => w.providerId === providerId).map((w) => w.id),
  );
  return sessions.filter(
    (s) =>
      weekIds.has(s.weekId) &&
      sameDateOfService(s.dateOfService, dateOfService) &&
      (!excludeSessionId || s.id !== excludeSessionId),
  );
}
