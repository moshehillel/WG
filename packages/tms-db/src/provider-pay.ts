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
 * Nearest of 30/42/45 within 3 minutes; otherwise hourly.
 * Callers must pass **mandate** minutes — never Frontline/PDF clock length.
 * Same thresholds as shared `nearestSchoolDurationBucket` (hour ↔ billing 60).
 */
export function closestDurationBucket(minutes: number): 30 | 42 | 45 | 'hour' {
  const opts: Array<{ n: 30 | 42 | 45; d: number }> = [
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
 * Group-tagged (or 2:1 / 3:1 / 4:1) only — Frontline tags drive pay; group-mandate alone does not.
 * Group-mandate children seen individually (1:1 / Individual / no group token) use individual rates.
 * Group-tagged but alone in the caregiver window (no other present peers) also uses individual rates.
 */
export function sessionUsesGroupPayRate(
  session: SessionRow,
  opts?: SessionGroupPayOpts,
): boolean {
  if (session.additionalServiceType) return false;
  const looksGroup = /\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(
    session.serviceType || '',
  );
  if (!looksGroup) return false;
  // Solo group (peer count 0 / omitted) → individual 30/42/45 (or hourly).
  return (opts?.presentGroupPeerCount ?? 0) >= 1;
}

/** Eval → School eval; other additional kinds → additional services; else school duration. */
export function sessionBillingKind(
  session: Pick<SessionRow, 'additionalServiceType' | 'serviceType'>,
): 'eval' | 'additional' | 'school' {
  const additional = session.additionalServiceType || '';
  if (additional === 'eval' || /\beval\b/i.test(session.serviceType || '')) return 'eval';
  if (
    additional ||
    /\b(progress\s*report|consultation|meetings?|paid\s*absence|additional)\b/i.test(
      session.serviceType || '',
    )
  ) {
    return 'additional';
  }
  return 'school';
}

/**
 * Catalog rate used for HHA pay-code name (e.g. OT $62.5 / OT Group $34).
 * School duration bucket comes from mandate authorized minutes (not Frontline clock).
 * Uses flat duration rates when bucketed; does not prorate hourly sessions.
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
  if (billingKind === 'additional' || session.additionalServiceType) {
    return provider.payRateAdditionalHourly;
  }
  const mandateMinutes = opts?.mandateDurationMinutes;
  const group = sessionUsesGroupPayRate(session, opts);
  if (mandateMinutes == null || !Number.isFinite(mandateMinutes)) {
    return provider.payRatePerHour;
  }
  const bucket = closestDurationBucket(mandateMinutes);
  if (group) {
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
  if (billingKind === 'additional' || session.additionalServiceType) {
    const hourly = provider.payRateAdditionalHourly;
    if (hourly == null) return null;
    const mins = clockMinutes ?? 0;
    return Math.round(((mins / 60) * hourly + Number.EPSILON) * 100) / 100;
  }
  const group = sessionUsesGroupPayRate(session, opts);
  const mandateMinutes = opts?.mandateDurationMinutes;
  if (mandateMinutes == null || !Number.isFinite(mandateMinutes)) {
    return provider.payRatePerHour;
  }
  const bucket = closestDurationBucket(mandateMinutes);
  if (group) {
    if (bucket === 30) return provider.payRateGroup30Min ?? provider.payRatePerHour;
    if (bucket === 42) return provider.payRateGroup42Min ?? provider.payRatePerHour;
    if (bucket === 45) return provider.payRateGroup45Min ?? provider.payRatePerHour;
    return provider.payRatePerHour != null
      ? Math.round((((clockMinutes ?? mandateMinutes) / 60) * provider.payRatePerHour + Number.EPSILON) * 100) /
          100
      : null;
  }
  if (bucket === 30) return provider.payRate30Min ?? provider.payRatePerHour;
  if (bucket === 42) return provider.payRate42Min ?? provider.payRatePerHour;
  if (bucket === 45) return provider.payRate45Min ?? provider.payRatePerHour;
  return provider.payRatePerHour != null
    ? Math.round((((clockMinutes ?? mandateMinutes) / 60) * provider.payRatePerHour + Number.EPSILON) * 100) /
        100
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
