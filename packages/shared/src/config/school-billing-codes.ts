/**
 * TMS → HHA billing ServiceCodeName (Sep 2026 / Moshe).
 * Billing creates these under each contract; lookup is case-insensitive.
 *
 * Exact strings to create in HHA (per discipline OT / PT / SLP):
 *   - `{Disc} School eval`
 *   - `{Disc} school 30` / `42` / `45` / `60`          (individual mandates)
 *   - `{Disc} school group 30` / `42` / `45` / `60`    (group mandates)
 *   - `{Disc} additional services`
 *
 * Duration rule (same as TMS provider pay): pass **mandate** authorized
 * minutes; nearest of 30 / 42 / 45 within 3 minutes; otherwise bucket 60
 * (`school 60` / `school group 60`). Do not pass Frontline clock length for
 * school buckets.
 */

export type SchoolBillingDiscipline = 'OT' | 'PT' | 'SLP';
export type SchoolBillingKind = 'eval' | 'additional' | 'school';
export type SchoolDurationBucket = 30 | 42 | 45 | 60;

const DISCIPLINES: readonly SchoolBillingDiscipline[] = ['OT', 'PT', 'SLP'];
const DURATION_BUCKETS: readonly SchoolDurationBucket[] = [30, 42, 45, 60];

/** Canonical HHA names billing must create (30 total). */
export const SCHOOL_BILLING_SERVICE_NAMES: readonly string[] = DISCIPLINES.flatMap((d) => [
  `${d} School eval`,
  ...DURATION_BUCKETS.map((b) => `${d} school ${b}`),
  ...DURATION_BUCKETS.map((b) => `${d} school group ${b}`),
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
 * Build HHA billing ServiceCodeName for a TMS school session / mandate.
 * Match in HHA via case-insensitive catalog name.
 *
 * Group mandates → `{Disc} school group {bucket}`;
 * individual → `{Disc} school {bucket}`.
 */
export function buildSchoolBillingServiceName(input: {
  discipline: string | undefined;
  kind: SchoolBillingKind;
  /** Required for kind === 'school'; ignored for eval / additional. */
  durationMinutes?: number | null;
  /** When kind === 'school', true → insert "group" before the duration bucket. */
  group?: boolean;
}): string | undefined {
  const discipline = normalizeSchoolBillingDiscipline(input.discipline);
  if (!discipline) return undefined;

  if (input.kind === 'eval') return `${discipline} School eval`;
  if (input.kind === 'additional') return `${discipline} additional services`;

  const minutes = input.durationMinutes;
  if (minutes == null || !Number.isFinite(minutes)) return undefined;
  const bucket = nearestSchoolDurationBucket(minutes);
  const middle = input.group ? 'school group' : 'school';
  return `${discipline} ${middle} ${bucket}`;
}

/** Individual school duration name, e.g. `PT school 30` (no "group"). */
const INDIVIDUAL_SCHOOL_BILLING_RE = /^(OT|PT|SLP)\s+school\s+(30|42|45|60)$/i;

/**
 * True when `name` is an individual school duration code (missing "group").
 * Used to detect legacy group-mandate rows stamped with the wrong pattern.
 */
export function isIndividualSchoolBillingServiceName(name: string | undefined): boolean {
  return INDIVIDUAL_SCHOOL_BILLING_RE.test(String(name || '').trim());
}
