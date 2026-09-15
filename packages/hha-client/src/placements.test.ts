import { describe, expect, it } from 'vitest';
import { parsePatientPlacements } from './placements.js';

describe('parsePatientPlacements', () => {
  it('reads ServiceStartDate from GetPatientContracts XML', () => {
    const xml = `<PatientContractInfo>
  <PlacementID>6761818</PlacementID>
  <Contract><ID>61591</ID><Name>Extended Home Care Therapy</Name></Contract>
  <ServiceStartDate>2024-11-03</ServiceStartDate>
  <ServiceCode><ID>785139</ID><Name>PT SOC/ROC OASIS</Name></ServiceCode>
  <DischargeDate />
</PatientContractInfo>`;
    expect(parsePatientPlacements(xml)).toEqual([
      {
        placementId: '6761818',
        contractId: '61591',
        serviceCodeId: '785139',
        startDate: '2024-11-03',
        dischargeDate: undefined,
      },
    ]);
  });
});
