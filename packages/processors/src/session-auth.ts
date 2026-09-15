import type { HhaClient } from '@white-glove/hha-client';
import { sessionDurationMinutes } from '@white-glove/hha-client';
import type { VerifiedSessionRow } from '@white-glove/shared';

/**
 * Same-day Entire Period maximum for API Report session auth.
 * Mirrors TMS school/office pattern (≈15 for ≤30-min visits).
 */
export function sessionAuthPeriodMaximum(durationMinutes: number | undefined): {
  period: string;
  maximum: number;
} {
  const duration = Math.max(1, Number(durationMinutes) || 30);
  const maximum = duration <= 30 ? 15 : Math.max(15, Math.round((duration / 60) * 100) / 100);
  return { period: 'Entire Period', maximum };
}

/** Stable AuthorizationNumber for API Report sessions (idempotent upsert). */
export function apiReportAuthorizationNumber(sessionId: string): string {
  const id = sessionId.trim().replace(/\s+/g, '');
  return `API-${id}`.slice(0, 50);
}

/**
 * Ensure patient has HHA authorization for this API Report session, then return
 * AuthorizationID to put on CreateSchedule PrimaryBillTo.
 */
export async function ensureSessionAuthorization(options: {
  hha: HhaClient;
  patientId: string;
  row: VerifiedSessionRow;
  contractId: string;
  serviceCodeId: string;
  serviceCode: string;
  durationMinutes?: number;
}): Promise<{ authorizationId: string; authorizationNumber: string; created: boolean }> {
  const { hha, patientId, row, contractId, serviceCodeId, serviceCode } = options;
  const visitDay = (row.visitDate ?? '').trim();
  if (!visitDay) {
    throw new Error(
      `[verified_sessions] session=${row.sessionId} missing visit date — cannot create authorization`,
    );
  }

  const duration =
    options.durationMinutes ??
    sessionDurationMinutes(row.startTime, row.endTime) ??
    30;
  const { period, maximum } = sessionAuthPeriodMaximum(duration);
  const authorizationNumber = apiReportAuthorizationNumber(row.sessionId);

  const result = await hha.upsertAuthorization({
    patientId,
    authorizationNumber,
    serviceCode,
    serviceCodeId,
    programType: row.programType,
    contractId,
    startDate: visitDay,
    endDate: visitDay,
    period,
    maximum,
  });

  return {
    authorizationId: result.id,
    authorizationNumber,
    created: result.created,
  };
}
