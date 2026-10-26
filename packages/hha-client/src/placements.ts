import { psDateToIso } from './hha-time.js';
import { xmlFirstTag, xmlIds } from './hha-xml-parse.js';

export interface PatientPlacement {
  placementId: string;
  contractId?: string;
  serviceCodeId?: string;
  startDate?: string;
  dischargeDate?: string;
}

export type ReuseContractPlacementResult =
  | { kind: 'reuse'; placement: PatientPlacement }
  | { kind: 'ambiguous'; placements: PatientPlacement[] }
  | { kind: 'none' };

/** Parse GetPatientContracts / AddPatientContract XML into placement rows. */
export function parsePatientPlacements(xml: string): PatientPlacement[] {
  const list: PatientPlacement[] = [];
  for (const block of xml.match(/<PatientContractInfo>[\s\S]*?<\/PatientContractInfo>/gi) ?? []) {
    const placementId = xmlFirstTag(block, 'PlacementID');
    if (!placementId) continue;
    list.push({
      placementId,
      contractId:
        xmlFirstTag(block, 'ContractID') ??
        block.match(/<Contract>\s*<ID>(\d+)/i)?.[1],
      serviceCodeId:
        xmlFirstTag(block, 'ServiceCodeID') ??
        block.match(/<ServiceCode>\s*<ID>(\d+)/i)?.[1],
      // HHA GetPatientContracts uses ServiceStartDate (not StartDate).
      startDate: xmlFirstTag(block, 'ServiceStartDate') ?? xmlFirstTag(block, 'StartDate'),
      dischargeDate: xmlFirstTag(block, 'DischargeDate'),
    });
  }

  if (list.length) return dedupePlacements(list);

  const ids = xmlIds(xml, 'PlacementID');
  return ids.map((id) => ({ placementId: String(id) }));
}

export function activePlacements(placements: PatientPlacement[]): PatientPlacement[] {
  return placements.filter((p) => !p.dischargeDate?.trim());
}

/** Normalize HHA / ProviderSoft dates to YYYY-MM-DD for comparison. */
export function normalizePlacementDate(d: string | undefined): string | undefined {
  if (!d?.trim()) return undefined;
  return (psDateToIso(d) ?? d).slice(0, 10);
}

/**
 * True when placement covers visitDate: start ≤ visit and end empty or ≥ visit.
 * DischargeDate is treated as the placement end.
 */
export function placementCoversDate(
  placement: PatientPlacement,
  visitDate: string,
): boolean {
  const visit = normalizePlacementDate(visitDate);
  if (!visit) return false;
  const start = normalizePlacementDate(placement.startDate);
  if (!start || start > visit) return false;
  const end = normalizePlacementDate(placement.dischargeDate);
  if (end && end < visit) return false;
  return true;
}

/**
 * Pick an existing same-ContractID placement to reuse instead of AddPatientContract.
 * Prefers serviceCodeId match among date-covering placements; falls back to sole
 * covering, then sole undischarged same-contract placement (legacy).
 */
export function findReusableContractPlacement(
  placements: PatientPlacement[],
  options: {
    contractId: string;
    visitDate: string;
    serviceCodeId?: string;
  },
): ReuseContractPlacementResult {
  const targetContract = String(options.contractId);
  const sameContract = placements.filter((p) => p.contractId === targetContract);
  if (!sameContract.length) return { kind: 'none' };

  const covering = sameContract.filter((p) => placementCoversDate(p, options.visitDate));
  const serviceWanted = options.serviceCodeId?.trim();

  const pickUnique = (candidates: PatientPlacement[]): ReuseContractPlacementResult | null => {
    if (candidates.length === 1) return { kind: 'reuse', placement: candidates[0]! };
    if (candidates.length > 1) return { kind: 'ambiguous', placements: candidates };
    return null;
  };

  if (covering.length) {
    if (serviceWanted) {
      const byService = covering.filter((p) => p.serviceCodeId === serviceWanted);
      const servicePick = pickUnique(byService);
      if (servicePick) return servicePick;
    }

    const visit = normalizePlacementDate(options.visitDate);
    if (visit) {
      const exactStart = covering.filter((p) => normalizePlacementDate(p.startDate) === visit);
      const exactPick = pickUnique(exactStart);
      if (exactPick?.kind === 'reuse') return exactPick;
    }

    const coverPick = pickUnique(covering);
    if (coverPick) return coverPick;
  }

  // Legacy: sole undischarged placement on this ContractID (even if dates missing).
  const activeSame = activePlacements(sameContract);
  if (activeSame.length === 1) {
    return { kind: 'reuse', placement: activeSame[0]! };
  }
  if (activeSame.length > 1 && !covering.length) {
    // Multiple active same-contract rows that do not cover visit — caller may Add or fail.
    return { kind: 'none' };
  }

  return { kind: 'none' };
}

/**
 * Start date to send as UpdatePatientContract StartDate when a reused placement
 * begins after the visit. HHA then rejects CreateSchedule with
 * "no any active contract" (ErrorID=-310) even though the contract exists.
 * Returns the visit date, which is earlier than the current start.
 * Undefined when the placement already covers the visit, is discharged before
 * it, or either date cannot be normalized.
 */
export function backdatePlacementStart(
  placement: PatientPlacement,
  visitDate: string,
): string | undefined {
  const visit = normalizePlacementDate(visitDate);
  const current = normalizePlacementDate(placement.startDate);
  if (!visit || !current || current <= visit) return undefined;
  const end = normalizePlacementDate(placement.dischargeDate);
  if (end && end < visit) return undefined;
  return visit;
}

/** HHA ErrorID=-74 placement-overlap text (ErrorID is overloaded — match message). */
export function isPlacementOverlapFault(
  errorId: string | undefined,
  errorMessage: string | undefined,
): boolean {
  if (String(errorId) !== '-74') return false;
  const msg = errorMessage ?? '';
  return (
    /placement overlaps with an existing placement/i.test(msg) ||
    /New placement overlaps/i.test(msg) ||
    /placement period overlaps/i.test(msg) ||
    /placement overlap/i.test(msg)
  );
}

function dedupePlacements(list: PatientPlacement[]): PatientPlacement[] {
  return [...new Map(list.map((p) => [p.placementId, p])).values()];
}
