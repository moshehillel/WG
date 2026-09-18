import { describe, expect, it } from 'vitest';
import {
  findReusableContractPlacement,
  isPlacementOverlapFault,
  parsePatientPlacements,
  placementCoversDate,
} from './placements.js';
import type { PatientPlacement } from './placements.js';

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

describe('placementCoversDate', () => {
  it('covers when start ≤ visit and end empty', () => {
    expect(
      placementCoversDate(
        { placementId: '1', startDate: '2025-09-01' },
        '2025-10-15',
      ),
    ).toBe(true);
  });

  it('covers when end ≥ visit', () => {
    expect(
      placementCoversDate(
        { placementId: '1', startDate: '2025-01-01', dischargeDate: '2025-12-31' },
        '2025-06-01',
      ),
    ).toBe(true);
  });

  it('does not cover when start after visit', () => {
    expect(
      placementCoversDate(
        { placementId: '1', startDate: '2025-11-01' },
        '2025-10-15',
      ),
    ).toBe(false);
  });

  it('does not cover when discharged before visit', () => {
    expect(
      placementCoversDate(
        { placementId: '1', startDate: '2025-01-01', dischargeDate: '2025-09-01' },
        '2025-10-15',
      ),
    ).toBe(false);
  });
});

describe('findReusableContractPlacement (cover-date reuse)', () => {
  const base: PatientPlacement[] = [
    {
      placementId: 'old-a',
      contractId: '73268',
      serviceCodeId: '111',
      startDate: '2025-07-01',
    },
    {
      placementId: 'other-contract',
      contractId: '99999',
      serviceCodeId: '222',
      startDate: '2025-07-01',
    },
  ];

  it('reuses same-ContractID placement that covers visit even when start dates differ', () => {
    const result = findReusableContractPlacement(base, {
      contractId: '73268',
      visitDate: '2025-10-15',
    });
    expect(result).toEqual({ kind: 'reuse', placement: base[0] });
  });

  it('prefers serviceCodeId match among multiple covering placements', () => {
    const placements: PatientPlacement[] = [
      {
        placementId: 'sc-a',
        contractId: '73268',
        serviceCodeId: '111',
        startDate: '2025-01-01',
      },
      {
        placementId: 'sc-b',
        contractId: '73268',
        serviceCodeId: '973449',
        startDate: '2025-02-01',
      },
    ];
    const result = findReusableContractPlacement(placements, {
      contractId: '73268',
      visitDate: '2025-10-15',
      serviceCodeId: '973449',
    });
    expect(result.kind).toBe('reuse');
    if (result.kind === 'reuse') expect(result.placement.placementId).toBe('sc-b');
  });

  it('returns ambiguous when multiple covering placements and no unique service match', () => {
    const placements: PatientPlacement[] = [
      {
        placementId: 'a',
        contractId: '73268',
        serviceCodeId: '111',
        startDate: '2025-01-01',
      },
      {
        placementId: 'b',
        contractId: '73268',
        serviceCodeId: '222',
        startDate: '2025-02-01',
      },
    ];
    const result = findReusableContractPlacement(placements, {
      contractId: '73268',
      visitDate: '2025-10-15',
    });
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.placements).toHaveLength(2);
  });

  it('returns none when only a different ContractID is present', () => {
    const result = findReusableContractPlacement(
      [
        {
          placementId: 'other-contract',
          contractId: '99999',
          startDate: '2025-07-01',
        },
      ],
      { contractId: '73268', visitDate: '2025-10-15' },
    );
    expect(result).toEqual({ kind: 'none' });
  });

  it('legacy: reuses sole undischarged same-contract when dates do not cover', () => {
    const placements: PatientPlacement[] = [
      {
        placementId: 'future-only',
        contractId: '73268',
        startDate: '2026-01-01',
      },
    ];
    const result = findReusableContractPlacement(placements, {
      contractId: '73268',
      visitDate: '2025-10-15',
    });
    expect(result).toEqual({ kind: 'reuse', placement: placements[0] });
  });
});

describe('isPlacementOverlapFault (-74 recovery gate)', () => {
  it('matches New placement overlaps message with ErrorID=-74', () => {
    expect(
      isPlacementOverlapFault(
        '-74',
        'New placement overlaps with an existing placement.',
      ),
    ).toBe(true);
  });

  it('matches placement period overlaps wording', () => {
    expect(
      isPlacementOverlapFault(
        '-74',
        'Cannot save the entry! The placement period overlaps with another placement!',
      ),
    ).toBe(true);
  });

  it('does not treat Invalid ServiceCodeID -74 as placement overlap', () => {
    expect(isPlacementOverlapFault('-74', 'Invalid "ServiceCodeID"')).toBe(false);
  });

  it('does not match without ErrorID=-74', () => {
    expect(
      isPlacementOverlapFault(
        '-56',
        'New placement overlaps with an existing placement.',
      ),
    ).toBe(false);
  });
});

describe('-74 recovery selection', () => {
  it('after overlap, reuses unambiguous same-contract covering placement', () => {
    // Simulates re-GetPatientContracts after AddPatientContract -74.
    const afterOverlap: PatientPlacement[] = [
      {
        placementId: 'existing-73268',
        contractId: '73268',
        serviceCodeId: '973449',
        startDate: '2025-09-01',
      },
      {
        placementId: 'other',
        contractId: '61591',
        startDate: '2024-01-01',
      },
    ];
    const result = findReusableContractPlacement(afterOverlap, {
      contractId: '73268',
      visitDate: '2025-10-15',
      serviceCodeId: '973449',
    });
    expect(result).toEqual({
      kind: 'reuse',
      placement: afterOverlap[0],
    });
  });

  it('after overlap, stays ambiguous when multiple same-contract covering rows', () => {
    const afterOverlap: PatientPlacement[] = [
      {
        placementId: 'p1',
        contractId: '73268',
        serviceCodeId: '111',
        startDate: '2025-01-01',
      },
      {
        placementId: 'p2',
        contractId: '73268',
        serviceCodeId: '222',
        startDate: '2025-02-01',
      },
    ];
    const result = findReusableContractPlacement(afterOverlap, {
      contractId: '73268',
      visitDate: '2025-10-15',
    });
    expect(result.kind).toBe('ambiguous');
  });

  it('PatientID-only inventory: reuses sole ACTIVE same-contract when visit is before NEW start', () => {
    // new_services mandate begin before mistaken NEW start — date-filtered Get misses NEW;
    // PatientID-only recovery must treat the already-ACTIVE placement as idempotent success
    // (OLD is discharged before the visit so it does not cover).
    const afterOverlap: PatientPlacement[] = [
      {
        placementId: '8596095',
        contractId: '73268',
        serviceCodeId: '973449',
        startDate: '2026-09-16',
      },
      {
        placementId: '8045831',
        contractId: '73268',
        serviceCodeId: '973449',
        startDate: '2025-01-01',
        dischargeDate: '2026-09-10',
      },
    ];
    const result = findReusableContractPlacement(afterOverlap, {
      contractId: '73268',
      visitDate: '2026-09-12',
      serviceCodeId: '973449',
    });
    expect(result).toEqual({
      kind: 'reuse',
      placement: afterOverlap[0],
    });
  });
});
