import { describe, expect, it } from 'vitest';
import { resolvePlacementForService } from './resolve-placement.js';
import type { PatientPlacement } from './placements.js';

describe('resolvePlacementForService', () => {
  const active: PatientPlacement[] = [
    { placementId: 'p1', serviceCodeId: '973449', startDate: '2026-01-01' },
    { placementId: 'p2', serviceCodeId: '111111', startDate: '2026-02-01' },
  ];

  it('uses mapped placement when active', () => {
    expect(
      resolvePlacementForService({
        placementId: 'p2',
        active,
      }),
    ).toBe('p2');
  });

  it('uses sole active placement', () => {
    expect(
      resolvePlacementForService({
        active: [active[0]!],
      }),
    ).toBe('p1');
  });

  it('matches by mapped HHA service code id', () => {
    expect(
      resolvePlacementForService({
        serviceCode: 'OT HC Eval',
        active,
      }),
    ).toBe('p1');
  });

  it('refuses ambiguous multi-service discharge', () => {
    expect(() =>
      resolvePlacementForService({
        serviceCode: 'UNKNOWN SERVICE',
        active,
      }),
    ).toThrow(/Ambiguous HHA discharge/);
  });
});
