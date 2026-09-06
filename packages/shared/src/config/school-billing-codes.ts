/**
 * TMS → HHA billing ServiceCodeName (Sep 2026 / Moshe).
 * Billing creates these under each contract; lookup is case-insensitive.
 *
 * Exact strings to create in HHA (per discipline OT / PT / SLP):
 *   - `{Disc} School eval`
 *   - `{Disc} school 30`
 *   - `{Disc} school 42`
 *   - `{Disc} school 45`
 *   - `{Disc} school 60`
 *   - `{Disc} additional services`
 *
 * Duration rule (same as TMS provider pay): nearest of 30 / 42 / 45 within
 * 3 minutes; otherwise bucket 60 (`school 60`).
 */

export type SchoolBillingDiscipline = 'OT' | 'PT' | 'SLP';
export type SchoolBillingKind = 'eval' | 'additional' | 'school';
export type SchoolDurationBucket = 30 | 42 | 45 | 60;

const DISCIPLINES: readonly SchoolBillingDiscipline[] = ['OT', 'PT', 'SLP'];

/** Canonical HHA names billing must create (18 total). */
export const SCHOOL_BILLING_SERVICE_NAMES: readonly string[] = DISCIPLINES.flatMap((d) => [
  `${d} School eval`,
  `${d} school 30`,
  `${d} school 42`,
  `${d} school 45`,
  `${d} school 60`,
  `${d} additional services`,
]);

/**
 * Nearest of 30/42/45 within 3 minutes; else 60.
 * Mirrors TMS `closestDurationBucket` in provider-pay (hour → 60 for billing).
 */
export function nearestSchoolDurationBucket(minutes: number): SchoolDurationBucket {
  if (!Number.isFinite(minutes) || minutes < 0) return 60;
  const opts: Array<{ n: 30 | 42 | 45; d: number }> = [
    { n: 30, d: Math.abs(minutes - 30) },
    { n: 42, d: Math.abs(minutes - 42) },
    { n: 45, d: Math.abs(minutes - 45) },
  ];
  opts.sort((x, y) => x.d - y.d);
  if (opts[0]!.d <= 3) return opts[0]!.n;
  return 60;
}

export function normalizeSchoolBillingDiscipline(
  raw: string | undefined,
): SchoolBillingDiscipline | undefined {
  const d = (raw ?? '').trim().toUpperCase();
  if (d === 'OT' || d === 'PT' || d === 'SLP') return d;
  if (d === 'ST') return 'SLP';
  return undefined;
}

/**
 * Build HHA billing ServiceCodeName for a TMS school session.
 * Match in HHA via case-insensitive catalog name.
 */
export function buildSchoolBillingServiceName(input: {
  discipline: string | undefined;
  kind: SchoolBillingKind;
  /** Required for kind === 'school'; ignored for eval / additional. */
  durationMinutes?: number | null;
}): string | undefined {
  const discipline = normalizeSchoolBillingDiscipline(input.discipline);
  if (!discipline) return undefined;

  if (input.kind === 'eval') return `${discipline} School eval`;
  if (input.kind === 'additional') return `${discipline} additional services`;

  const minutes = input.durationMinutes;
  if (minutes == null || !Number.isFinite(minutes)) return undefined;
  const bucket = nearestSchoolDurationBucket(minutes);
  return `${discipline} school ${bucket}`;
}
