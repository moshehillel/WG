import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException } from '@white-glove/shared';
import { buildRowException, normalizeVisitDate, programSessionMode } from '@white-glove/shared';

/** Placeholder schedule window — clocks do not use these times. */
export const NEW_SERVICE_EVV_VISIT_START = '9:00 AM';
export const NEW_SERVICE_EVV_VISIT_END = '9:30 AM';

/** Expected ProviderSoft CSV header for the therapist who will clock. */
export const NEW_SERVICE_PROVIDER_COLUMN = 'Provider Name';

export function isEvvProgramForNewService(programType: string | undefined): boolean {
  return programSessionMode(programType) === 'evv';
}

/** True when this new_services row should get a placeholder CreateSchedule visit. */
export function shouldScheduleEvvVisitForNewService(row: OpenedCaseRow): boolean {
  return row.sourceReport === 'new_services' && isEvvProgramForNewService(row.programType);
}

export function previewEvvNewServiceVisit(
  row: OpenedCaseRow,
  options?: { caregiverFound?: boolean },
): PipelineException | undefined {
  if (!shouldScheduleEvvVisitForNewService(row)) return undefined;

  const rowId = row.caseId;
  if (!row.startDate?.trim()) {
    return buildRowException({
      code: 'missing_field',
      message: `[new_services] row=${rowId} EVV placeholder visit needs Service Begin Date — no visit scheduled`,
      reportKind: 'new_services',
      rowId,
      details: { missing: ['Service Begin Date'], preview: true, visitSchedule: true },
    });
  }

  if (!row.providerName?.trim()) {
    return buildRowException({
      code: 'missing_field',
      message: `[new_services] row=${rowId} EVV placeholder visit needs "${NEW_SERVICE_PROVIDER_COLUMN}" on the new service export (blank or missing column) — caregiver cannot clock without a scheduled visit`,
      reportKind: 'new_services',
      rowId,
      details: {
        missing: [NEW_SERVICE_PROVIDER_COLUMN],
        expectedColumn: NEW_SERVICE_PROVIDER_COLUMN,
        preview: true,
        visitSchedule: true,
      },
    });
  }

  if (options?.caregiverFound === false) {
    return buildRowException({
      code: 'other',
      message: `[preview/new_services] case/session ${rowId}: Provider "${row.providerName}" not found in HHA`,
      reportKind: 'new_services',
      rowId,
      details: {
        providerName: row.providerName,
        preview: true,
        visitSchedule: true,
      },
    });
  }

  return undefined;
}

export async function scheduleEvvNewServiceVisit(options: {
  row: OpenedCaseRow;
  hha: HhaClient;
  patientId: string;
  contractId: string;
  serviceCodeId: string;
}): Promise<{ id: string; created: boolean }> {
  const { row, hha, patientId, contractId, serviceCodeId } = options;
  if (!shouldScheduleEvvVisitForNewService(row)) {
    throw new Error('scheduleEvvNewServiceVisit called for non-EVV / non-new_services row');
  }

  const providerName = row.providerName?.trim();
  if (!providerName) {
    throw new Error(
      `EVV placeholder visit needs "${NEW_SERVICE_PROVIDER_COLUMN}" on the new service export (blank or missing column)`,
    );
  }
  if (!row.startDate?.trim()) {
    throw new Error('EVV placeholder visit needs Service Begin Date');
  }

  const caregiverId = await hha.resolveCaregiverId(providerName);
  if (!caregiverId) {
    throw new Error(
      `Provider "${providerName}" not found in HHA`,
    );
  }

  const visitDate = normalizeVisitDate(row.startDate);
  if (!visitDate) {
    throw new Error(
      `EVV placeholder visit needs Service Begin Date as MM/DD/YYYY or YYYY-MM-DD (got "${row.startDate}")`,
    );
  }

  return hha.locateOrScheduleVisit({
    patientId,
    visitDate,
    startTime: NEW_SERVICE_EVV_VISIT_START,
    endTime: NEW_SERVICE_EVV_VISIT_END,
    caregiverId,
    contractId,
    serviceCodeId,
    serviceCode: row.serviceCode,
    programType: row.programType,
    providerName,
    durationMinutes: 30,
  });
}