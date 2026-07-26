import { lookupServiceCode } from '@white-glove/shared';
import { psDateToIso } from './hha-time.js';
import type { PatientPlacement } from './placements.js';
import { activePlacements } from './placements.js';

export interface ResolvePlacementInput {
  /** ProviderSoft Service Type from discharge report. */
  serviceCode?: string;
  /** ProviderSoft Service Begin Date (M/D/YYYY or ISO). */
  startDate?: string;
  /** HHA contract id resolved from report Program Type. */
  contractId?: string | number;
  active: PatientPlacement[];
}

function normalizeReportDate(d: string | undefined): string | undefined {
  return psDateToIso(d) ?? d?.trim();
}

function datesMatch(placementDate: string | undefined, reportDate: string | undefined): boolean {
  const left = normalizeReportDate(placementDate);
  const right = normalizeReportDate(reportDate);
  if (!left || !right) return false;
  return left === right;
}

function contractIdsMatch(
  placementContractId: string | undefined,
  reportContractId: string | number | undefined,
): boolean {
  if (!placementContractId || reportContractId == null) return false;
  return String(placementContractId) === String(reportContractId);
}

function uniquePlacement(matches: PatientPlacement[]): string | undefined {
  if (matches.length !== 1) return undefined;
  return matches[0]!.placementId;
}

export function assertDischargeReportFields(serviceCode?: string, startDate?: string): void {
  const missing: string[] = [];
  if (!serviceCode?.trim()) missing.push('Service Type');
  if (!startDate?.trim()) missing.push('Service Begin Date');
  if (missing.length) {
    throw new Error(
      `Discharge report missing ${missing.join(' and ')} — coordinator must fill both on every discharge service row before HHA can terminate the correct placement.`,
    );
  }
}

/**
 * Pick the HHA placement to discharge using discharge-report fields.
 * Requires Service Type + Service Begin Date — never guesses from a sole active placement.
 */
export function resolvePlacementForService(input: ResolvePlacementInput): string {
  assertDischargeReportFields(input.serviceCode, input.startDate);

  const active = input.active;
  if (!active.length) {
    throw new Error('No active HHA placements found for patient');
  }

  const reportStart = normalizeReportDate(input.startDate);
  const mapped = lookupServiceCode(input.serviceCode);
  const hhaServiceCodeId = mapped?.hhaCode?.trim();
  const reportContractId =
    input.contractId != null ? String(input.contractId) : undefined;

  const byService = hhaServiceCodeId
    ? active.filter((p) => p.serviceCodeId === hhaServiceCodeId)
    : [];

  if (byService.length && reportStart) {
    const match = uniquePlacement(
      byService.filter((p) => datesMatch(p.startDate, reportStart)),
    );
    if (match) return match;
  }

  if (byService.length && reportContractId) {
    const match = uniquePlacement(
      byService.filter((p) => contractIdsMatch(p.contractId, reportContractId)),
    );
    if (match) return match;
  }

  if (reportStart && reportContractId) {
    const match = uniquePlacement(
      active.filter(
        (p) =>
          datesMatch(p.startDate, reportStart) &&
          contractIdsMatch(p.contractId, reportContractId),
      ),
    );
    if (match) return match;
  }

  throw new Error(
    `Ambiguous HHA discharge: patient has ${active.length} active placement(s); no HHA placement matches report Service Type "${input.serviceCode}" / Service Begin Date "${input.startDate}". Coordinator: verify both fields match the active service line in HHA exactly.`,
  );
}

export { activePlacements };
