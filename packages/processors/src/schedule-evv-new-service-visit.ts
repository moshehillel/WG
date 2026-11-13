import type { HhaClient } from '@white-glove/hha-client';
import { pickCaregiverDisciplinePayCode } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException } from '@white-glove/shared';
import {
  BLANK_PAY_RATE_EVV_VISIT_MESSAGE,
  buildPayCodeName,
  buildRowException,
  extractDisciplineFromServiceType,
  isBlankOrZeroPayRate,
  normalizeVisitDate,
  programSessionMode,
  resolveTherapyAssignment,
  serviceTypeLooksGroup,
} from '@white-glove/shared';

/**
 * Placeholder schedule window. Always 1:00–1:30 AM so the scaffolding visit
 * cannot be mistaken for a real daytime therapy session on the HHA calendar.
 * Clocks do not use these times. Same 30-minute duration as before.
 */
export const NEW_SERVICE_EVV_VISIT_START = '1:00 AM';
export const NEW_SERVICE_EVV_VISIT_END = '1:30 AM';

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

  // Blank/zero Pay Rate: live write may still use a caregiver-assigned HHA rate.
  // Preview flags the missing PS column so ops see it before nightly.
  if (isBlankOrZeroPayRate(row.payRate)) {
    return buildRowException({
      code: 'missing_field',
      message: `[preview/new_services] case/session ${rowId}: ${BLANK_PAY_RATE_EVV_VISIT_MESSAGE} (Pay Rate blank on export; write may use caregiver HHA pay code if assigned)`,
      reportKind: 'new_services',
      rowId,
      details: {
        missing: [NEW_SERVICE_PAY_RATE_COLUMN],
        expectedColumn: NEW_SERVICE_PAY_RATE_COLUMN,
        preview: true,
        visitSchedule: true,
        blankPayRate: true,
      },
    });
  }

  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  const discipline = extractDisciplineFromServiceType(row.serviceCode);
  if (!payCode && !discipline) {
    return buildRowException({
      code: 'missing_field',
      message: `[new_services] row=${rowId} EVV placeholder visit needs Service Type (discipline) to resolve a pay code`,
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

  if (payCode && (options?.payCodeId === null || options?.payCodeId === '')) {
    return buildRowException({
      code: 'other',
      message: `[preview/new_services] case/session ${rowId}: pay code "${payCode.payCodeName}" not found in HHA GetPayRateCodes — confirm Pay Rate + Service Type`,
      reportKind: 'new_services',
      rowId,
      details: {
        payCodeName: payCode.payCodeName,
        payRate: row.payRate,
        serviceCode: row.serviceCode,
        preview: true,
        visitSchedule: true,
      },
    });
  }

  return undefined;
}

export type ResolvedNewServiceEvvPayCode = {
  payCodeName: string;
  payCodeId: string;
  payRate: string;
  /** True when Pay Rate was blank and we used the caregiver's assigned HHA pay code. */
  fromCaregiverAssignment?: boolean;
};

/**
 * Resolve HHA PayCodeID from Service Type discipline + Pay Rate (e.g. OT $72).
 * Blank/zero Pay Rate returns undefined (caller may try caregiver assignment).
 */
export async function resolveNewServiceEvvPayCodeId(options: {
  row: OpenedCaseRow;
  hha: HhaClient;
}): Promise<ResolvedNewServiceEvvPayCode | undefined> {
  const { row, hha } = options;
  if (isBlankOrZeroPayRate(row.payRate)) {
    return undefined;
  }
  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  if (!payCode) {
    throw new Error(
      `EVV placeholder visit needs Service Type discipline to resolve a pay code (got service="${row.serviceCode ?? ''}", payRate="${row.payRate ?? ''}")`,
    );
  }
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
  };
}

/**
 * When PS Pay Rate is blank: use the caregiver's sole assigned discipline pay code
 * in HHA, or the pay code from their most recent matching visit.
 * Never invents office-catalog first-hits (OT $100 PL).
 */
export async function resolveCaregiverAssignedEvvPayCode(options: {
  row: OpenedCaseRow;
  hha: HhaClient;
  caregiverId: string;
}): Promise<ResolvedNewServiceEvvPayCode | undefined> {
  const { row, hha, caregiverId } = options;
  const discipline = extractDisciplineFromServiceType(row.serviceCode);
  if (!discipline) return undefined;
  const preferEval = /\beval\b/i.test(row.serviceCode ?? '');
  const preferGroup = serviceTypeLooksGroup(row.serviceCode);

  if (hha.listCaregiverPayCodes) {
    const rows = await hha.listCaregiverPayCodes(caregiverId);
    const picked = pickCaregiverDisciplinePayCode(rows, discipline, {
      preferGroup,
      preferEval,
    });
    if (picked) {
      const rateMatch = picked.name.match(/\$(\d+(?:\.\d+)?)/);
      return {
        payCodeName: picked.name,
        payCodeId: picked.id,
        payRate: rateMatch?.[1] ?? '',
        fromCaregiverAssignment: true,
      };
    }
  }

  if (hha.findRecentCaregiverDisciplinePayCode) {
    const recent = await hha.findRecentCaregiverDisciplinePayCode(caregiverId, discipline, {
      preferEval,
    });
    if (recent) {
      const rateMatch = recent.name.match(/\$(\d+(?:\.\d+)?)/);
      console.info(
        `[new_services] EVV placeholder using recent caregiver visit pay code ` +
          `"${recent.name}" (${recent.id}) case=${row.caseId} caregiver=${caregiverId}`,
      );
      return {
        payCodeName: recent.name,
        payCodeId: recent.id,
        payRate: rateMatch?.[1] ?? '',
        fromCaregiverAssignment: true,
      };
    }
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
    throw new Error(`Provider "${providerName}" not found in HHA`);
  }

  const visitDate = normalizeVisitDate(row.startDate);
  if (!visitDate) {
    throw new Error(
      `EVV placeholder visit needs Service Begin Date as MM/DD/YYYY or YYYY-MM-DD (got "${row.startDate}")`,
    );
  }

  let resolved = await resolveNewServiceEvvPayCodeId({ row, hha });
  if (!resolved && isBlankOrZeroPayRate(row.payRate)) {
    resolved = await resolveCaregiverAssignedEvvPayCode({ row, hha, caregiverId });
    if (resolved) {
      console.info(
        `[new_services] EVV placeholder using caregiver-assigned pay code ` +
          `"${resolved.payCodeName}" (${resolved.payCodeId}) case=${row.caseId} caregiver=${caregiverId}`,
      );
    }
  }

  // Last resort: CreateSchedule without PayCodeID (schedule-builder omits the tag).
  // Only when rate is blank and no caregiver assignment — HHA may still accept 1am dummy.
  if (!resolved && isBlankOrZeroPayRate(row.payRate)) {
    const assignment = resolveTherapyAssignment(providerName);
    if (!assignment.ok) {
      throw new Error(
        'EVV placeholder visit needs a provider last name to assign a coordinator. No HHA visit write.',
      );
    }
    try {
      console.info(
        `[new_services] EVV placeholder CreateSchedule without PayCodeID (blank pay rate) case=${row.caseId}`,
      );
      return await hha.locateOrScheduleVisit({
        patientId,
        visitDate,
        startTime: NEW_SERVICE_EVV_VISIT_START,
        endTime: NEW_SERVICE_EVV_VISIT_END,
        caregiverId,
        contractId,
        serviceCodeId,
        serviceCode: row.serviceCode,
        scheduleType: 'Skilled',
        programType: row.programType,
        providerName,
        durationMinutes: 30,
        teamId: String(assignment.teamId),
        coordinatorId: String(assignment.coordinatorId),
      });
    } catch (err) {
      if (isCreateScheduleShiftOverlapError(err)) {
        console.info(
          `[new_services] EVV placeholder visit already present (CreateSchedule shift overlap) ` +
            `case=${row.caseId} provider="${providerName}" date=${visitDate}`,
        );
        return { id: 'overlap-existing', created: false };
      }
      // HHA requires PayCodeID — fail visibly (auth already written by caller).
      throw new Error(BLANK_PAY_RATE_EVV_VISIT_MESSAGE, { cause: err });
    }
  }

  if (!resolved) {
    throw new Error(BLANK_PAY_RATE_EVV_VISIT_MESSAGE);
  }

  const { payCodeId, payRate } = resolved;

  const assignment = resolveTherapyAssignment(providerName);
  if (!assignment.ok) {
    throw new Error(
      'EVV placeholder visit needs a provider last name to assign a coordinator. No HHA visit write.',
    );
  }

  // Therapy EVV placeholders must be Skilled — Non-Skilled yields false -310
  // ("cannot be scheduled for OT/PT/ST visit") even when the caregiver is eligible.
  // Same aide on siblings: stagger night windows (1:00, 1:30, 2:00 AM) so caregiver
  // overlap does not block the second child's clockable visit.
  const windows = [
    { start: NEW_SERVICE_EVV_VISIT_START, end: NEW_SERVICE_EVV_VISIT_END },
    { start: '1:30 AM', end: '2:00 AM' },
    { start: '2:00 AM', end: '2:30 AM' },
  ];
  let lastErr: unknown;
  for (const window of windows) {
    try {
      return await hha.locateOrScheduleVisit({
        patientId,
        visitDate,
        startTime: window.start,
        endTime: window.end,
        caregiverId,
        contractId,
        serviceCodeId,
        serviceCode: row.serviceCode,
        scheduleType: 'Skilled',
        programType: row.programType,
        providerName,
        payCodeId,
        payRate,
        durationMinutes: 30,
        teamId: String(assignment.teamId),
        coordinatorId: String(assignment.coordinatorId),
      });
    } catch (err) {
      lastErr = err;
      // Patient-side overlap → scaffolding already present for this child.
      if (isCreateScheduleShiftOverlapError(err) && /Patient:/i.test(String((err as Error).message ?? err))) {
        console.info(
          `[new_services] EVV placeholder visit already present (CreateSchedule shift overlap) ` +
            `case=${row.caseId} provider="${providerName}" date=${visitDate}`,
        );
        return { id: 'overlap-existing', created: false };
      }
      // Caregiver overlap with another patient — try the next night window.
      if (isCreateScheduleShiftOverlapError(err)) {
        console.info(
          `[new_services] EVV placeholder caregiver overlap at ${window.start}; trying next window ` +
            `case=${row.caseId} provider="${providerName}"`,
        );
        continue;
      }
      throw err;
    }
  }
  if (isCreateScheduleShiftOverlapError(lastErr)) {
    console.info(
      `[new_services] EVV placeholder visit already present after staggered windows ` +
        `case=${row.caseId} provider="${providerName}" date=${visitDate}`,
    );
    return { id: 'overlap-existing', created: false };
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'CreateSchedule failed'));
}

/**
 * True when HHA CreateSchedule failed because a shift already overlaps
 * (visit scaffolding already satisfied). Does not match other -310 variants
 * such as "cannot be scheduled for OT/PT/ST visit".
 */
export function isCreateScheduleShiftOverlapError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (
    /Overlapping shifts are not allowed/i.test(message) ||
    /Your shift is overlapping with (Patient|Caregiver)/i.test(message)
  ) {
    return true;
  }
  // Defensive: ErrorID=-310 only counts when overlap wording is also present.
  return /ErrorID\s*=\s*-310\b/i.test(message) && /overlap/i.test(message);
}
