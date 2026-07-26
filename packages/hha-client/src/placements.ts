import { xmlFirstTag, xmlIds } from './hha-xml-parse.js';

export interface PatientPlacement {
  placementId: string;
  contractId?: string;
  serviceCodeId?: string;
  startDate?: string;
  dischargeDate?: string;
}

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
      startDate: xmlFirstTag(block, 'StartDate'),
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

function dedupePlacements(list: PatientPlacement[]): PatientPlacement[] {
  return [...new Map(list.map((p) => [p.placementId, p])).values()];
}
