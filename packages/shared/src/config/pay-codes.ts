/**
 * Pay code naming (Sep 2026 / Moshe):
 * HHA pay code title = discipline + optional Group + $rate
 *   e.g. OT + 62.5 → "OT $62.5"
 *   e.g. OT group + 34 → "OT Group $34"
 * Discipline comes from the leading token of Service Type (e.g. OT CHHA EXTENDED → OT)
 * or from an explicit TMS discipline. Rate comes from Pay Rate / provider pay fields.
 */

const KNOWN_DISCIPLINES = new Set([
  'OT',
  'PT',
  'SI',
  'ST',
  'SLP',
  'PCA',
  'HHA',
  'COTA',
  'PTA',
  'RN',
  'LPN',
  'MSW',
]);

/** First discipline token from PS Service Type (e.g. "OT CHHA EXTENDED" → "OT"). */
export function extractDisciplineFromServiceType(serviceType: string | undefined): string | undefined {
  if (!serviceType?.trim()) return undefined;
  const first = serviceType.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!first || first.length < 2 || first.length > 4) return undefined;
  if (KNOWN_DISCIPLINES.has(first)) return first;
  // Two–four letter prefix used as discipline in many WG service types (OT, PT, SI, …).
  if (/^[A-Z]{2,4}$/.test(first)) return first;
  return undefined;
}

/**
 * Pay-rate suffix for pay code name.
 * - `70.0000` → `"70"`
 * - `52.50` → `"52.5"` (keeps meaningful decimals for HHA rows like `OT $52.5`)
 * - `0` / blank → undefined (missed sessions must not become OT $0)
 */
export function payRateSuffix(payRate: string | number | undefined): string | undefined {
  if (payRate === undefined || payRate === '') return undefined;
  const n = typeof payRate === 'number' ? payRate : parseFloat(String(payRate).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (Number.isInteger(n) || Math.abs(n - Math.trunc(n)) < 1e-9) return String(Math.trunc(n));
  return String(parseFloat(n.toFixed(2)));
}

/** True when Service Type includes a standalone Group token (or ratio like 2:1). */
export function serviceTypeLooksGroup(serviceType: string | undefined): boolean {
  return /\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(serviceType?.trim() ?? '');
}

export interface BuildPayCodeNameOptions {
  /** Force group pay-code form (`OT Group $34`). Defaults to detecting Group on serviceType. */
  group?: boolean;
}

/**
 * Build expected HHA pay code name, e.g. OT + 62.5 → "OT $62.5",
 * or group → "OT Group $34".
 */
export function buildPayCodeName(
  serviceType: string | undefined,
  payRate: string | number | undefined,
  options?: BuildPayCodeNameOptions,
): { payCodeName: string; discipline: string; rateSuffix: string; isGroup: boolean } | undefined {
  const discipline = extractDisciplineFromServiceType(serviceType);
  const rateSuffix = payRateSuffix(payRate);
  if (!discipline || !rateSuffix) return undefined;
  const isGroup = options?.group ?? serviceTypeLooksGroup(serviceType);
  const payCodeName = isGroup
    ? `${discipline} Group $${rateSuffix}`
    : `${discipline} $${rateSuffix}`;
  return { payCodeName, discipline, rateSuffix, isGroup };
}
