import { serviceTypeLooksGroup } from '@white-glove/shared';
import type { Provider, SessionRow } from './types.js';

/** Legacy S3 rows used a single `payRate` (per hour) plus four bundled fields. */
type LegacyProvider = Partial<Provider> & {
  id?: string;
  payRate?: number | null;
  payRatePerChildGroupHour?: number | null;
  payRatePerEval?: number | null;
  payRateAdditionalServices?: number | null;
};

export function asNullableNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function blankProviderPay(): Pick<
  Provider,
  | 'payRate30Min'
  | 'payRate42Min'
  | 'payRate45Min'
  | 'payRatePerHour'
  | 'payRateGroup15Min'
  | 'payRateGroup30Min'
  | 'payRateGroup42Min'
  | 'payRateGroup45Min'
  | 'payRateEval'
  | 'payRateAdditionalHourly'
> {
  return {
    payRate30Min: null,
    payRate42Min: null,
    payRate45Min: null,
    payRatePerHour: null,
    payRateGroup15Min: null,
    payRateGroup30Min: null,
    payRateGroup42Min: null,
    payRateGroup45Min: null,
    payRateEval: null,
    payRateAdditionalHourly: null,
  };
}

/** Minutes between clock times like `9:00 am` / `9:42 AM`. */
export function sessionDurationMinutes(beginTime: string, endTime: string): number | null {
  const a = clockToMinutes(beginTime);
  const b = clockToMinutes(endTime);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export function clockToMinutes(raw: string): number | null {
  const s = String(raw || '').trim();
  // Accept "9:00 am", "9:00am", "9:00 a.m.", "9:00 A.M."
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(min)) return null;
  const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  return hour * 60 + min;
}

/**
 * Map authorized mandate duration to a pay bucket.
 * Nearest of 15/30/42/45 within 3 minutes; otherwise hourly.
 * Callers must pass **mandate** minutes — never Frontline/PDF clock length.
 * Same thresholds as shared `nearestSchoolDurationBucket` (hour ↔ billing 60).
 * The 15-minute bucket selects group pay (`payRateGroup15Min`) only.
 * Individual pay has no 15-minute rate and still falls through to hourly.
 */
export function closestDurationBucket(minutes: number): 15 | 30 | 42 | 45 | 'hour' {
  const opts: Array<{ n: 15 | 30 | 42 | 45; d: number }> = [
    { n: 15, d: Math.abs(minutes - 15) },
    { n: 30, d: Math.abs(minutes - 30) },
    { n: 42, d: Math.abs(minutes - 42) },
    { n: 45, d: Math.abs(minutes - 45) },
  ];
  opts.sort((x, y) => x.d - y.d);
  if (opts[0].d <= 3) return opts[0].n;
  return 'hour';
}

/** Optional peer + mandate context for pay / pay-code selection. */
export type SessionGroupPayOpts = {
  /**
   * Other attended/makeup children in the same group↔group clock window (same provider/day).
   * Missed/absent do not count. When omitted, treated as 0 (solo → individual).
   */
  presentGroupPeerCount?: number;
  /**
   * Authorized duration from the matching mandate (caseload RS Duration).
   * Drives 30/42/45 (or hourly) bucket — not Frontline begin/end rounding.
   */
  mandateDurationMinutes?: number | null;
};

/**
 * True when the visit should use group duration rates.
 * Group-tagged, or any N:1 with N >= 2 (2:1 through 5:1 and up). Frontline tags drive pay;
 * a group mandate alone does not. 1:1 / Individual / no group token stays individual.
 * Group-tagged but alone in the caregiver window (no other present peers) also uses individual rates.
 */
export function sessionUsesGroupPayRate(
  session: SessionRow,
  opts?: SessionGroupPayOpts,
): boolean {
  if (session.additionalServiceType) return false;
  if (!serviceTypeLooksGroup(session.serviceType)) return false;
  // Solo group (peer count 0 / omitted) → individual 30/42/45 (or hourly).
  return (opts?.presentGroupPeerCount ?? 0) >= 1;
}

/**
 * Paid absence is an attendance value. Older rows stored it as an additional
 * service, often with attendance missed. Ordinary misses stay unpaid.
 */
export function isPaidAbsenceSession(
  session: Pick<
    SessionRow,
    'attendance' | 'additionalServiceType' | 'serviceType' | 'notes' | 'cancelReason'
  >,
): boolean {
  if (session.attendance === 'paid_absence') return true;
  if (String(session.additionalServiceType || '') === 'paid_absence') return true;
  const blob = `${session.serviceType || ''} ${session.notes || ''} ${session.cancelReason || ''}`;
  return /\bpaid\s*absence\b/i.test(blob);
}

/**
 * Attendance HHA should store. Paid absence is sent as attended.
 * Makeup stays makeup. Everything else that is transferred is attended.
 */
export function hhaTransferAttendance(
  session: Pick<
    SessionRow,
    'attendance' | 'additionalServiceType' | 'serviceType' | 'notes' | 'cancelReason'
  >,
): 'attended' | 'makeup' {
  if (isPaidAbsenceSession(session)) return 'attended';
  return session.attendance === 'makeup' ? 'makeup' : 'attended';
}

/**
 * Rows CreateSchedule should send.
 * Attended, makeup, and paid absence go. Unpaid misses stay off.
 * A paid absence is converted to attended at send time.
 */
export function isHhaTransferSession(
  session: Pick<
    SessionRow,
    'attendance' | 'additionalServiceType' | 'serviceType' | 'notes' | 'cancelReason'
  >,
): boolean {
  const attendance = session.attendance || '';
  if (attendance === 'attended' || attendance === 'makeup' || attendance === 'paid_absence') return true;
  return attendance === 'missed' && isPaidAbsenceSession(session);
}

/** Eval → School eval; other additional kinds → additional services; else school duration. Paid absence bills as a school visit. */
export function sessionBillingKind(
  session: Pick<
    SessionRow,
    'additionalServiceType' | 'serviceType' | 'notes' | 'cancelReason' | 'attendance'
  >,
): 'eval' | 'additional' | 'school' {
  if (isPaidAbsenceSession(session)) return 'school';
  const additional = session.additionalServiceType || '';
  if (additional === 'eval' || /\beval\b/i.test(session.serviceType || '')) return 'eval';
  if (
    additional ||
    /\b(progress\s*report|consultation|meetings?|documentation|additional)\b/i.test(
      session.serviceType || '',
    )
  ) {
    return 'additional';
  }
  return 'school';
}

/** Mandate length when present. A paid absence with no mandate uses the clock, same as an attended visit of that length. */
function paidAbsenceDurationMinutes(
  session: SessionRow,
  mandateMinutes: number | null | undefined,
): number | null | undefined {
  if (mandateMinutes != null && Number.isFinite(mandateMinutes)) return mandateMinutes;
  if (!isPaidAbsenceSession(session)) return mandateMinutes;
  return sessionDurationMinutes(session.beginTime, session.endTime);
}

/**
 * Catalog rate used for HHA pay-code name (e.g. OT $62.5 / OT Group $34).
 * School duration bucket comes from mandate authorized minutes (not Frontline clock).
 * A 15-minute group mandate uses `payRateGroup15Min` (flat), same as group 30.
 * Uses flat duration rates when bucketed; school hourly fallback is not prorated.
 * Additional services are an hourly rate billed to the minute: the pay-code
 * dollar is (minutes / 60) × hourly, because HHA pay codes are the visit amount
 * (`ST $44` for a half hour of $88/hour, not `ST $88`).
 * Eval uses `payRateEval` (not additional hourly).
 */
export function sessionPayCodeRate(
  provider: Provider,
  session: SessionRow,
  opts?: SessionGroupPayOpts,
): number | null {
  const billingKind = sessionBillingKind(session);
  if (billingKind === 'eval') {
    return provider.payRateEval;
  }
  if (!isPaidAbsenceSession(session) && (billingKind === 'additional' || session.additionalServiceType)) {
    const hourly = provider.payRateAdditionalHourly;
    if (hourly == null) return null;
    const mins = sessionDurationMinutes(session.beginTime, session.endTime);
    if (mins == null) return null;
    return Math.round(((mins / 60) * hourly + Number.EPSILON) * 100) / 100;
  }
  const mandateMinutes = paidAbsenceDurationMinutes(session, opts?.mandateDurationMinutes);
  const group = sessionUsesGroupPayRate(session, opts);
  if (mandateMinutes == null || !Number.isFinite(mandateMinutes)) {
    return provider.payRatePerHour;
  }
  const bucket = closestDurationBucket(mandateMinutes);
  if (group) {
    if (bucket === 15) return provider.payRateGroup15Min ?? provider.payRatePerHour;
    if (bucket === 30) return provider.payRateGroup30Min ?? provider.payRatePerHour;
    if (bucket === 42) return provider.payRateGroup42Min ?? provider.payRatePerHour;
    if (bucket === 45) return provider.payRateGroup45Min ?? provider.payRatePerHour;
    return provider.payRatePerHour;
  }
  if (bucket === 30) return provider.payRate30Min ?? provider.payRatePerHour;
  if (bucket === 42) return provider.payRate42Min ?? provider.payRatePerHour;
  if (bucket === 45) return provider.payRate45Min ?? provider.payRatePerHour;
  return provider.payRatePerHour;
}

/** Pay for one session using the provider's duration / hourly / eval / additional rates. */
export function sessionPayAmount(
  provider: Provider,
  session: SessionRow,
  opts?: SessionGroupPayOpts,
): number | null {
  const clockMinutes = sessionDurationMinutes(session.beginTime, session.endTime);
  const billingKind = sessionBillingKind(session);
  if (billingKind === 'eval') {
    return provider.payRateEval;
  }
  if (!isPaidAbsenceSession(session) && (billingKind === 'additional' || session.additionalServiceType)) {
    const hourly = provider.payRateAdditionalHourly;
    if (hourly == null) return null;
    const mins = clockMinutes ?? 0;
    return Math.round(((mins / 60) * hourly + Number.EPSILON) * 100) / 100;
  }
  const group = sessionUsesGroupPayRate(session, opts);
  const mandateMinutes = paidAbsenceDurationMinutes(session, opts?.mandateDurationMinutes);
  if (mandateMinutes == null || !Number.isFinite(mandateMinutes)) {
    return provider.payRatePerHour;
  }
  const bucket = closestDurationBucket(mandateMinutes);
  if (group) {
    if (bucket === 15) return provider.payRateGroup15Min ?? provider.payRatePerHour;
    if (bucket === 30) return provider.payRateGroup30Min ?? provider.payRatePerHour;
    if (bucket === 42) return provider.payRateGroup42Min ?? provider.payRatePerHour;
    if (bucket === 45) return provider.payRateGroup45Min ?? provider.payRatePerHour;
    return provider.payRatePerHour != null
      ? Math.round(((mandateMinutes / 60) * provider.payRatePerHour + Number.EPSILON) * 100) / 100
      : null;
  }
  if (bucket === 30) return provider.payRate30Min ?? provider.payRatePerHour;
  if (bucket === 42) return provider.payRate42Min ?? provider.payRatePerHour;
  if (bucket === 45) return provider.payRate45Min ?? provider.payRatePerHour;
  return provider.payRatePerHour != null
    ? Math.round(((mandateMinutes / 60) * provider.payRatePerHour + Number.EPSILON) * 100) / 100
    : null;
}

/** Normalize a provider row: migrate old pay fields into duration / hourly / eval rates. */
export function migrateProvider(row: LegacyProvider): Provider {
  const legacyHour = asNullableNumber(row.payRate);
  const payRatePerHour =
    row.payRatePerHour !== undefined ? asNullableNumber(row.payRatePerHour) : legacyHour;

  const payRateEval =
    row.payRateEval !== undefined
      ? asNullableNumber(row.payRateEval)
      : asNullableNumber(row.payRatePerEval);

  const additional =
    row.payRateAdditionalHourly !== undefined
      ? asNullableNumber(row.payRateAdditionalHourly)
      : asNullableNumber(row.payRateAdditionalServices);

  return {
    id: String(row.id || ''),
    userId: String(row.userId || ''),
    firstName: String(row.firstName || ''),
    lastName: String(row.lastName || ''),
    discipline: (row.discipline as Provider['discipline']) || 'PT',
    payRate30Min: asNullableNumber(row.payRate30Min),
    payRate42Min: asNullableNumber(row.payRate42Min),
    payRate45Min: asNullableNumber(row.payRate45Min),
    payRatePerHour,
    payRateGroup15Min: asNullableNumber(row.payRateGroup15Min),
    payRateGroup30Min: asNullableNumber(row.payRateGroup30Min),
    payRateGroup42Min: asNullableNumber(row.payRateGroup42Min),
    payRateGroup45Min: asNullableNumber(row.payRateGroup45Min),
    payRateEval,
    payRateAdditionalHourly: additional,
    hhaCaregiverCode: String(row.hhaCaregiverCode || ''),
    active: row.active === false ? false : true,
    createdAt: String(row.createdAt || ''),
  };
}

export function migrateProviders(rows: unknown): Provider[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => migrateProvider((r && typeof r === 'object' ? r : {}) as LegacyProvider));
}
