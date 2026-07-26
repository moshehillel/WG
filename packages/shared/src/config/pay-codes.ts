/**
 * Pay code naming per White Glove (Jul 2026):
 * HHA pay code title = discipline + pay-rate number (e.g. OT + 72 → OT72).
 * Discipline comes from the leading token of ProviderSoft Service Type (e.g. OT CHHA EXTENDED → OT).
 * Pay rate comes from API Report "Pay Rate" (session verification tab).
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

/** Integer pay-rate suffix for pay code name (70.0000 → "70"). */
export function payRateSuffix(payRate: string | number | undefined): string | undefined {
  if (payRate === undefined || payRate === '') return undefined;
  const n = typeof payRate === 'number' ? payRate : parseFloat(String(payRate).replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return String(Math.trunc(n));
}

/** Build expected HHA pay code name, e.g. OT + 72 → "OT72". */
export function buildPayCodeName(
  serviceType: string | undefined,
  payRate: string | number | undefined,
): { payCodeName: string; discipline: string; rateSuffix: string } | undefined {
  const discipline = extractDisciplineFromServiceType(serviceType);
  const rateSuffix = payRateSuffix(payRate);
  if (!discipline || !rateSuffix) return undefined;
  return { payCodeName: `${discipline}${rateSuffix}`, discipline, rateSuffix };
}
