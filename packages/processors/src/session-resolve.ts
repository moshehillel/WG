import type { HhaClient } from '@white-glove/hha-client';
import { psDateToIso, sessionDurationMinutes } from '@white-glove/hha-client';
import type { ExceptionCode, HhaVisit, VerifiedSessionRow } from '@white-glove/shared';
import {
  buildPayCodeName,
  isUnmatchedServiceType,
  lookupCaregiverCode,
} from '@white-glove/shared';

export interface SessionResolveError {
  code: ExceptionCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResolvedSession {
  visit: HhaVisit;
  needsEvv: boolean;
}

function resolveError(
  code: ExceptionCode,
  message: string,
  details?: Record<string, unknown>,
): SessionResolveError {
  return { code, message, details };
}

/** Map ProviderSoft session row → HHA visit fields (live HHA reference lookup + static fallback). */
export async function resolveSessionVisit(options: {
  row: VerifiedSessionRow;
  caregiverMap: Map<string, string>;
  hha: HhaClient;
  needsEvv: boolean;
}): Promise<{ ok: true; resolved: ResolvedSession } | { ok: false; error: SessionResolveError }> {
  const { row, caregiverMap, hha, needsEvv } = options;
  const sessionId = row.sessionId;

  if (!row.serviceCode?.trim()) {
    return {
      ok: false,
      error: resolveError(
        'missing_service_code',
        `[verified_sessions] session=${sessionId} error: no service type on API report row`,
        { serviceCode: row.serviceCode },
      ),
    };
  }

  if (isUnmatchedServiceType(row.serviceCode)) {
    return {
      ok: false,
      error: resolveError(
        'unknown_service_code',
        `[verified_sessions] session=${sessionId} error: service type "${row.serviceCode}" has no HHA billing code`,
        { serviceCode: row.serviceCode },
      ),
    };
  }

  const contractNum = await hha.resolveContractId(row.programType);
  if (!contractNum) {
    return {
      ok: false,
      error: resolveError(
        'other',
        `[verified_sessions] session=${sessionId} error: no HHA ContractID for program type "${row.programType ?? '(missing)'}"`,
        { programType: row.programType },
      ),
    };
  }

  const serviceCodeId = await hha.resolveServiceCodeId(row.serviceCode, contractNum);
  if (!serviceCodeId) {
    return {
      ok: false,
      error: resolveError(
        'unknown_service_code',
        `[verified_sessions] session=${sessionId} error: service type "${row.serviceCode}" not found in HHA billing codes`,
        { serviceCode: row.serviceCode, contractId: contractNum },
      ),
    };
  }

  const visitDate = psDateToIso(row.visitDate) ?? row.visitDate;
  if (!visitDate) {
    return {
      ok: false,
      error: resolveError(
        'parse_error',
        `[verified_sessions] session=${sessionId} missing visit/session date`,
        { visitDate: row.visitDate },
      ),
    };
  }

  const caregiverCode =
    lookupCaregiverCode(caregiverMap, row.providerName) ?? row.caregiverId;
  const caregiverId = await hha.resolveCaregiverId(row.providerName);
  if (!caregiverId) {
    return {
      ok: false,
      error: resolveError(
        'other',
        `[verified_sessions] session=${sessionId} error: caregiver not found in HHA for provider "${row.providerName ?? '(missing)'}"`,
        { providerName: row.providerName, caregiverCode },
      ),
    };
  }

  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  let payCodeId: string | undefined;
  if (payCode) {
    payCodeId = await hha.resolvePayCodeId(payCode.payCodeName);
    if (!payCodeId) {
      return {
        ok: false,
        error: resolveError(
          'other',
          `[verified_sessions] session=${sessionId} error: pay code "${payCode.payCodeName}" not found in HHA GetCaregiverPayCodes`,
          { payCodeName: payCode.payCodeName, payRate: row.payRate, serviceCode: row.serviceCode },
        ),
      };
    }
  }

  const durationMinutes = sessionDurationMinutes(row.startTime, row.endTime);

  const visit: HhaVisit = {
    patientId: '',
    visitExternalId: row.sessionId,
    serviceCode: row.serviceCode,
    visitDate,
    startTime: row.startTime,
    endTime: row.endTime,
    caregiverId,
    contractId: String(contractNum),
    serviceCodeId,
    payCodeId,
    programType: row.programType,
    providerName: row.providerName,
    payRate: row.payRate,
    scheduleType: 'Non-Skilled',
    durationMinutes,
  };

  return { ok: true, resolved: { visit, needsEvv } };
}
