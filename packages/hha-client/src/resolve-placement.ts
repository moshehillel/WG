import { lookupServiceCode } from '@white-glove/shared';
import type { PatientPlacement } from './placements.js';
import { activePlacements } from './placements.js';

export interface ResolvePlacementInput {
  serviceCode?: string;
  startDate?: string;
  placementId?: string;
  active: PatientPlacement[];
}

/**
 * Pick the HHA placement to discharge for a service row.
 * Never guess when multiple active placements and no mapping — caller must alert.
 */
export function resolvePlacementForService(input: ResolvePlacementInput): string {
  if (input.placementId) {
    const known = input.active.find((p) => p.placementId === input.placementId);
    if (known) return known.placementId;
    throw new Error(
      `Mapped placement ${input.placementId} is not active for this patient (already discharged or missing)`,
    );
  }

  const active = input.active;
  if (!active.length) {
    throw new Error('No active HHA placements found for patient');
  }
  if (active.length === 1) {
    return active[0]!.placementId;
  }

  const mapped = lookupServiceCode(input.serviceCode);
  const hhaServiceCodeId = mapped?.hhaCode?.trim();
  if (hhaServiceCodeId) {
    const byService = active.filter((p) => p.serviceCodeId === hhaServiceCodeId);
    if (byService.length === 1) return byService[0]!.placementId;
  }

  if (input.startDate?.trim()) {
    const byStart = active.filter(
      (p) => p.startDate?.trim() === input.startDate!.trim(),
    );
    if (byStart.length === 1) return byStart[0]!.placementId;
  }

  throw new Error(
    `Ambiguous HHA discharge: patient has ${active.length} active placements and no stored mapping for service "${input.serviceCode ?? '(missing)'}" / start "${input.startDate ?? '(missing)'}". Refuse to discharge the wrong placement.`,
  );
}

export { activePlacements };
