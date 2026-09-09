import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException } from '@white-glove/shared';
import {
  buildPayCodeName,
  buildRowException,
  extractDisciplineFromServiceType,
  normalizeVisitDate,
  pickFirstPayCodeForDiscipline,
  programSessionMode,
  serviceTypeLooksGroup,
} from '@white-glove/shared';

/** Placeholder schedule window — clocks do not use these times. */
export const NEW_SERVICE_EVV_VISIT_START = '9:00 AM';
export const NEW_SERVICE_EVV_VISIT_END = '9:30 AM';

/** Expected ProviderSoft CSV header for the therapist who will clock. */
export const NEW_SERVICE_PROVIDER_COLUMN = 'Provider Name';

/** Expected ProviderSoft CSV header for pay-code naming (discipline + rate). */
export const NEW_SERVICE_PAY_RATE_COLUMN = 'Pay Rate';

export function isEvvProgramForNewService(programType: string | undefined): boolean {
  return programSessionMode(programType) === 'evv';
}

/** True when this new_services row should get a placeholder CreateSchedule visit. */
export function shouldScheduleEvvVisitForNewService(row: OpenedCaseRow): boolean {
  return row.sourceReport === 'new_services' && isEvvProgramForNewService(row.programType);
}

export function previewEvvNewServiceVisit(
  row: OpenedCaseRow,
  options?: { caregiverFound?: boolean; payCodeId?: string | null },
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

  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  const discipline = extractDisciplineFromServiceType(row.serviceCode);
  if (!payCode && !discipline) {
    return buildRowException({
      code: 'missing_field',
      message: `[new_services] row=${rowId} EVV placeholder visit needs Service Type (discipline) to resolve a PayCode — blank Pay Rate is ok (catalog fallback)`,
      reportKind: 'new_services',
      rowId,
      details: {
        missing: ['Service Type'],
        serviceCode: row.serviceCode,
        payRate: row.payRate,
        preview: true,
        visitSchedule: true,
      },
    });
  }

  if (options?.payCodeId === null || options?.payCodeId === '') {
    const label = payCode?.payCodeName ?? `${discipline ?? '?'} (any catalog rate)`;
    return buildRowException({
      code: 'other',
      message: `[preview/new_services] case/session ${rowId}: pay code "${label}" not found in HHA GetPayRateCodes — confirm Pay Rate + Service Type (or that the discipline has any pay rate on the contract)`,
      reportKind: 'new_services',
      rowId,
      details: {
        payCodeName: payCode?.payCodeName,
        payRate: row.payRate,
        serviceCode: row.serviceCode,
        preview: true,
        visitSchedule: true,
        payRateFallback: !payCode,
      },
    });
  }

  return undefined;
}

export type ResolvedNewServiceEvvPayCode = {
  payCodeName: string;
  payCodeId: string;
  payRate: string;
  /** True when report Pay Rate was blank/invalid and catalog first-match was used. */
  usedPayRateFallback: boolean;
};

/**
 * Resolve HHA PayCodeID the same way as verified sessions:
 * Service Type discipline + Pay Rate → e.g. OT $72 → GetPayRateCodes catalog.
 * When Pay Rate is blank, fall back to the first catalog pay code for that discipline
 * (group form when Service Type looks group; SLP → ST). Placeholder visit only.
 */
export async function resolveNewServiceEvvPayCodeId(options: {
  row: OpenedCaseRow;
  hha: HhaClient;
}): Promise<ResolvedNewServiceEvvPayCode> {
  const { row, hha } = options;
  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  if (payCode) {
    const payCodeId = await hha.resolvePayCodeId(payCode.payCodeName);
    if (!payCodeId) {
      throw new Error(
        `pay code "${payCode.payCodeName}" not found in HHA GetPayRateCodes (Service Type="${row.serviceCode}", Pay Rate="${row.payRate}")`,
      );
    }
    return {
      payCodeName: payCode.payCodeName,
      payCodeId,
      payRate: String(row.payRate),
      usedPayRateFallback: false,
    };
  }

  const discipline = extractDisciplineFromServiceType(row.serviceCode);
  if (!discipline) {
    throw new Error(
      `EVV placeholder visit needs Service Type discipline to resolve PayCode (got service="${row.serviceCode ?? ''}", payRate="${row.payRate ?? ''}")`,
    );
  }

  const catalog = await hha.listPayRateCodes();
  const fallback = pickFirstPayCodeForDiscipline(discipline, catalog, {
    group: serviceTypeLooksGroup(row.serviceCode),
  });
  if (!fallback) {
    throw new Error(
      `EVV placeholder visit: no HHA pay rate codes for discipline "${discipline}" (Service Type="${row.serviceCode}", blank Pay Rate; catalog size=${catalog.length})`,
    );
  }

  console.info(
    `[new_services] EVV placeholder visit using fallback pay rate ` +
      `payCode="${fallback.name}" id=${fallback.id} rate=${fallback.rateSuffix} ` +
      `(report Pay Rate blank; Service Type="${row.serviceCode}")`,
  );

  return {
    payCodeName: fallback.name,
    payCodeId: fallback.id,
    payRate: fallback.rateSuffix,
    usedPayRateFallback: true,
  };
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

  const { payCodeId, payRate, payCodeName, usedPayRateFallback } = await resolveNewServiceEvvPayCodeId({
    row,
    hha,
  });

  if (usedPayRateFallback) {
    console.info(
      `[new_services] scheduling EVV placeholder visit case=${row.caseId} ` +
        `with fallback PayCode "${payCodeName}" (visit is scaffolding only)`,
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
    payCodeId,
    payRate,
    durationMinutes: 30,
  });
}
