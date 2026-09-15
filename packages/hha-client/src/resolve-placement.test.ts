import { describe, expect, it } from 'vitest';
import {
  assertDischargeReportFields,
  resolvePlacementForService,
} from './resolve-placement.js';
import type { PatientPlacement } from './placements.js';

describe('resolvePlacementForService', () => {
  const active: PatientPlacement[] = [
    { placementId: 'p1', serviceCodeId: '973449', contractId: '61591', startDate: '2026-01-01' },
    { placementId: 'p2', serviceCodeId: '111111', contractId: '61591', startDate: '2026-02-01' },
  ];

  it('requires Service Type and Service Begin Date on the report row', () => {
    expect(() => resolvePlacementForService({ active: [active[0]!] })).toThrow(
      /Discharge report missing/,
    );
  });

  it('matches service type and begin date from report', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'OT HC Eval',
        startDate: '1/1/2026',
        active: [active[0]!],
      }),
    ).toBe('p1');
  });

  it('prefers program-scoped resolvedServiceCodeId over flat SERVICE_CODE_MAP', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'PT HC Eval',
        startDate: '8/14/2026',
        contractId: 61591,
        // Flat map would use a different ID; placement has Extended OASIS id.
        resolvedServiceCodeIds: ['785139', '1416587'],
        active: [
          {
            placementId: '6761818',
            serviceCodeId: '785139',
            contractId: '61591',
            startDate: '2024-11-03',
          },
        ],
      }),
    ).toBe('6761818');
  });

  it('matches sole byService placement when PS begin date ≠ HHA ServiceStartDate', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'PT HC Eval',
        startDate: '8/14/2026',
        contractId: 61591,
        resolvedServiceCodeId: '785139',
        active: [
          {
            placementId: '6761818',
            serviceCodeId: '785139',
            contractId: '61591',
            startDate: '2024-11-03',
          },
        ],
      }),
    ).toBe('6761818');
  });

  it('matches service code and begin date among multiple placements', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'OT HC Eval',
        startDate: '1/1/2026',
        active,
      }),
    ).toBe('p1');
  });

  it('matches service code and contract id from program type', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'UNKNOWN SERVICE',
        contractId: 61591,
        startDate: '2026-02-01',
        active,
      }),
    ).toBe('p2');
  });

  it('refuses when report fields do not match any placement', () => {
    expect(() =>
      resolvePlacementForService({
        serviceCode: 'UNKNOWN SERVICE',
        startDate: '1/1/2026',
        active,
      }),
    ).toThrow(/Ambiguous HHA discharge/);
  });

  it('assertDischargeReportFields lists missing columns', () => {
    expect(() => assertDischargeReportFields('', '')).toThrow(
      /Service Type and Service Begin Date/,
    );
  });
});
