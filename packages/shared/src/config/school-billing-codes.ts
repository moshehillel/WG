/**
 * TMS → HHA billing ServiceCodeName (Sep 2026 / Moshe).
 * Billing creates these under each contract; lookup is case-insensitive.
 *
 * Exact strings to create in HHA (per discipline OT / PT / SLP):
 *   - `{Disc} School eval`
 *   - `{Disc} school 15` / `30` / `42` / `45` / `60`          (individual)
 *   - `{Disc} school group 15` / `30` / `42` / `45` / `60`    (group)
 *   - `{Disc} additional services 15` / `30` / `42` / `45` / `60`
 *
 * Duration buckets: 15 / 30 / 42 / 45, nearest within 3 minutes; otherwise 60.
 * The bucket comes from the mandate, not the session clock. A clock shorter
 * than the mandate is blocked. Additional services are the exception and
 * follow the clock: 30 minutes uses `{Disc} additional services 30`,
 * 60 minutes uses `{Disc} additional services 60`. Group pay has a 15-minute rate (`payRateGroup15Min`)
 * when the mandate bucket is 15.
 *
 * A real group (peers present) stays on the group code. A group-mandate
 * child seen individually is billed on the individual code at the mandate
 * length. Do not switch either one to a shorter code to match the clock.
 */

export type SchoolBillingDiscipline = 'OT' | 'PT' | 'SLP';
export type SchoolBillingKind = 'eval' | 'additional' | 'school';
export type SchoolDurationBucket = 15 | 30 | 42 | 45 | 60;

const DISCIPLINES: readonly SchoolBillingDiscipline[] = ['OT', 'PT', 'SLP'];
const DURATION_BUCKETS: readonly SchoolDurationBucket[] = [15, 30, 42, 45, 60];

/** Canonical HHA names (48: eval, five duration buckets × individual/group/additional). */
export const SCHOOL_BILLING_SERVICE_NAMES: readonly string[] = DISCIPLINES.flatMap((d) => [
  `${d} School eval`,
  ...DURATION_BUCKETS.map((b) => `${d} school ${b}`),
  ...DURATION_BUCKETS.map((b) => `${d} school group ${b}`),
  ...DURATION_BUCKETS.map((b) => `${d} additional services ${b}`),
]);

/**
 * Nearest of 15/30/42/45 within 3 minutes; else 60.
 * 15 is a billing bucket. Group pay also has a 15-minute rate; individual pay does not.
 */
export function nearestSchoolDurationBucket(minutes: number): SchoolDurationBucket {
  if (!Number.isFinite(minutes) || minutes < 0) return 60;
  const opts: Array<{ n: 15 | 30 | 42 | 45; d: number }> = [
    { n: 15, d: Math.abs(minutes - 15) },
    { n: 30, d: Math.abs(minutes - 30) },
    { n: 42, d: Math.abs(minutes - 42) },
    { n: 45, d: Math.abs(minutes - 45) },
  ];
  opts.sort((x, y) => x.d - y.d);
  if (opts[0]!.d <= 3) return opts[0]!.n;
  return 60;
}

/** Clock minutes that are themselves a school billing bucket (no rounding). */
export function exactSchoolDurationBucket(minutes: number): SchoolDurationBucket | undefined {
  if (!Number.isFinite(minutes)) return undefined;
  return (DURATION_BUCKETS as readonly number[]).includes(minutes)
    ? (minutes as SchoolDurationBucket)
    : undefined;
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
  /** Required for kind === 'school' and kind === 'additional'. Ignored for eval. */
  durationMinutes?: number | null;
  /** When kind === 'school', true → insert "group" before the duration bucket. */
  group?: boolean;
}): string | undefined {
  const discipline = normalizeSchoolBillingDiscipline(input.discipline);
  if (!discipline) return undefined;

  if (input.kind === 'eval') return `${discipline} School eval`;
  if (input.kind === 'additional') {
    const minutes = input.durationMinutes;
    if (minutes == null || !Number.isFinite(minutes)) return undefined;
    const bucket = exactSchoolDurationBucket(minutes);
    if (bucket == null) return undefined;
    return `${discipline} additional services ${bucket}`;
  }

  const minutes = input.durationMinutes;
  if (minutes == null || !Number.isFinite(minutes)) return undefined;
  const bucket = nearestSchoolDurationBucket(minutes);
  const middle = input.group ? 'school group' : 'school';
  return `${discipline} ${middle} ${bucket}`;
}

/**
 * Names to resolve on the contract, best first.
 * Duration is the mandate length the caller passes in. A group visit is only
 * the group name. It does not add the individual name — a non-group code
 * blocks the other child (HHA overlapping-shift -310). A child seen
 * individually is passed with group=false so the individual name is used.
 */
export function schoolBillingServiceNameCandidates(input: {
  discipline: string | undefined;
  kind: SchoolBillingKind;
  durationMinutes?: number | null;
  group?: boolean;
}): string[] {
  const primary = buildSchoolBillingServiceName(input);
  return primary ? [primary] : [];
}

/** Individual school duration name, e.g. `PT school 30` (no "group"). */
const INDIVIDUAL_SCHOOL_BILLING_RE = /^(OT|PT|SLP)\s+school\s+(15|30|42|45|60)$/i;
/** Group school duration name, e.g. `PT school group 30`. */
const GROUP_SCHOOL_BILLING_RE = /^(OT|PT|SLP)\s+school\s+group\s+(15|30|42|45|60)$/i;

/**
 * True when `name` is an individual school duration code (missing "group").
 * Used to detect legacy group-mandate rows stamped with the wrong pattern.
 */
export function isIndividualSchoolBillingServiceName(name: string | undefined): boolean {
  return INDIVIDUAL_SCHOOL_BILLING_RE.test(String(name || '').trim());
}

/** True when `name` is a group school duration code (`… school group {bucket}`). */
export function isGroupSchoolBillingServiceName(name: string | undefined): boolean {
  return GROUP_SCHOOL_BILLING_RE.test(String(name || '').trim());
}

/**
 * Duration minutes encoded in a school billing name (`PT school 30` / `PT school group 60`).
 * Used to catch CreateSchedule mismatches (clock window ≠ service-code unit → HHA ErrorID=-11).
 */
export function schoolBillingDurationMinutes(name: string | undefined): number | undefined {
  const s = String(name || '').trim();
  const m = s.match(/\b(15|30|42|45|60)\s*$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}
