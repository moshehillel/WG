import { sessionDurationMinutes } from '@white-glove/hha-client';
import { lookupServiceCode, lookupServiceCodeAlias } from '@white-glove/shared';

/**
 * Inclusive $ cutoffs after rounding scheduled duration to the nearest 15 minutes.
 * Only these buckets remap group -> individual. Rounded 0 or 75+ stay group.
 */
export const GROUP_TO_INDIVIDUAL_THRESHOLDS: Readonly<Record<number, number>> = {
  15: 11,
  30: 45,
  45: 55,
  60: 60,
};

export interface GroupServiceRemapInput {
  serviceType: string | undefined;
  durationMinutes: number | undefined;
  payRate: string | number | undefined;
  programType?: string;
}

export interface GroupServiceRemapResult {
  serviceType: string | undefined;
  remapped: boolean;
  roundedMinutes?: number;
}

/** Word "group" as its own token (PT School Group, OT school Group, …). */
export function isGroupServiceType(serviceType: string | undefined): boolean {
  return /\bgroup\b/i.test(serviceType?.trim() ?? '');
}

/**
 * Nearest 15 minutes, half away from zero (JS Math.round for positive values).
 * Midpoints: 7.5->15, 22.5->30, 37.5->45, 52.5->60.
 * Integer ranges: 8-22->15, 23-37->30, 38-52->45, 53-67->60.
 */
export function roundMinutesToNearest15(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) return 0;
  return Math.round(minutes / 15) * 15;
}

export function parsePayRateDollars(payRate: string | number | undefined): number | undefined {
  if (payRate === undefined || payRate === '') return undefined;
  const n = typeof payRate === 'number' ? payRate : parseFloat(String(payRate).replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/** Strip the Group token and collapse leftover spaces (PT School Group -> PT School). */
export function stripGroupFromServiceType(serviceType: string): string {
  return serviceType.replace(/\bgroup\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Prefer SERVICE_CODE_MAP / Excel alias casing so PT SCHOOL matches PT School.
 * Lookup itself is case-insensitive; this only picks a canonical display name.
 */
export function canonicalizeServiceTypeName(
  serviceType: string,
  programType?: string,
): string {
  return (
    lookupServiceCode(serviceType)?.providerSoftCode ??
    lookupServiceCodeAlias(serviceType, programType)?.providerSoftCode ??
    serviceType
  );
}

/**
 * Remap a group Service Type to its individual counterpart when scheduled duration
 * (rounded to nearest 15) plus Pay Rate meet the inclusive dollar threshold.
 * Already-individual types and below-threshold groups are left unchanged.
 * Headcount / student count is not used — only the Pay Rate on the row.
 */
export function remapGroupServiceType(input: GroupServiceRemapInput): GroupServiceRemapResult {
  const original = input.serviceType;
  if (!original?.trim() || !isGroupServiceType(original)) {
    return { serviceType: original, remapped: false };
  }

  if (
    input.durationMinutes == null ||
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes < 0
  ) {
    return { serviceType: original, remapped: false };
  }

  const rate = parsePayRateDollars(input.payRate);
  if (rate == null) {
    return { serviceType: original, remapped: false };
  }

  const roundedMinutes = roundMinutesToNearest15(input.durationMinutes);
  const threshold = GROUP_TO_INDIVIDUAL_THRESHOLDS[roundedMinutes];
  if (threshold == null || rate < threshold) {
    return { serviceType: original, remapped: false, roundedMinutes };
  }

  const stripped = stripGroupFromServiceType(original);
  if (!stripped) {
    return { serviceType: original, remapped: false, roundedMinutes };
  }

  return {
    serviceType: canonicalizeServiceTypeName(stripped, input.programType),
    remapped: true,
    roundedMinutes,
  };
}

/** Apply remap using API Report scheduled begin/end (EVV clock is pending Samet). */
export function applyGroupServiceRemap(row: {
  serviceCode?: string;
  startTime?: string;
  endTime?: string;
  payRate?: string;
  programType?: string;
}): GroupServiceRemapResult {
  return remapGroupServiceType({
    serviceType: row.serviceCode,
    durationMinutes: sessionDurationMinutes(row.startTime, row.endTime),
    payRate: row.payRate,
    programType: row.programType,
  });
}
