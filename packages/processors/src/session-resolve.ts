import type { HhaClient } from '@white-glove/hha-client';
import { psDateToIso, sessionDurationMinutes } from '@white-glove/hha-client';
import type { ExceptionCode, HhaVisit, UnscheduledMatchKeys, VerifiedSessionRow } from '@white-glove/shared';
import {
  buildPayCodeName,
  lookupCaregiverCode,
} from '@white-glove/shared';
import { HHA_NAME_MATCH_HINT } from './preview-scan.js';
import { applyGroupServiceRemap } from './remap-group-service.js';
import { resolveHhaPatientId } from './resolve-hha-patient.js';

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

  const groupRemap = applyGroupServiceRemap(row);
  const serviceCode = groupRemap.serviceType ?? row.serviceCode;

  const contractNum = await hha.resolveContractId(row.programType);
  if (!contractNum) {
    return {
      ok: false,
      error: resolveError(
        'other',
        `[verified_sessions] session=${sessionId} error: no HHA ContractID for program type "${row.programType ?? '(missing)'}" — ${HHA_NAME_MATCH_HINT}`,
        { programType: row.programType },
      ),
    };
  }

  const serviceCodeId = await hha.resolveServiceCodeId(
    serviceCode,
    contractNum,
    row.programType,
  );
  if (!serviceCodeId) {
    return {
      ok: false,
      error: resolveError(
        'unknown_service_code',
        `[verified_sessions] session=${sessionId} error: service type "${serviceCode}" not found in HHA billing codes (name must match HHA) — ${HHA_NAME_MATCH_HINT}`,
        {
          serviceCode,
          originalServiceCode: groupRemap.remapped ? row.serviceCode : undefined,
          programType: row.programType,
          contractId: contractNum,
        },
      ),
    };
  }

  const visitDate = psDateToIso(row.visitDate) ?? row.visitDate;
  if (!visitDate) {
    return {
      ok: false,
      error: resolveError(
        'missing_field',
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

  const payCode = buildPayCodeName(serviceCode, row.payRate);
  let payCodeId: string | undefined;
  // Missed / Pay Rate 0 never produces OT0 — leave payCodeId unset and continue.
  if (payCode) {
    payCodeId = await hha.resolvePayCodeId(payCode.payCodeName);
    if (!payCodeId) {
      return {
        ok: false,
        error: resolveError(
          'other',
          `[verified_sessions] session=${sessionId} error: pay code "${payCode.payCodeName}" not found in HHA GetPayRateCodes`,
          { payCodeName: payCode.payCodeName, payRate: row.payRate, serviceCode },
        ),
      };
    }
  }

  const durationMinutes = sessionDurationMinutes(row.startTime, row.endTime);

  const visit: HhaVisit = {
    patientId: '',
    visitExternalId: row.sessionId,
    serviceCode,
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

/** Resolve HHA ids for matching verified sessions to getUnscheduledServices rows. */
export async function resolveUnscheduledMatchKeys(options: {
  row: VerifiedSessionRow;
  caregiverMap: Map<string, string>;
  hha: HhaClient;
  cache?: {
    patients: Map<string, string | undefined>;
    caregivers: Map<string, string | undefined>;
  };
}): Promise<UnscheduledMatchKeys> {
  const { row, caregiverMap, hha, cache } = options;
  const patientKey = `${row.patientExternalId ?? ''}|${row.caseId ?? ''}`;
  const caregiverKey = row.providerName?.trim().toUpperCase() ?? '';

  let hhaPatientId = cache?.patients.get(patientKey);
  if (hhaPatientId === undefined && !cache?.patients.has(patientKey)) {
    hhaPatientId =
      (await resolveHhaPatientId(hha, row)) ?? undefined;
    cache?.patients.set(patientKey, hhaPatientId);
  }

  let hhaCaregiverId = cache?.caregivers.get(caregiverKey);
  if (hhaCaregiverId === undefined && !cache?.caregivers.has(caregiverKey)) {
    hhaCaregiverId = (await hha.resolveCaregiverId(row.providerName)) ?? undefined;
    cache?.caregivers.set(caregiverKey, hhaCaregiverId);
  }

  return {
    hhaPatientId,
    hhaCaregiverId,
    caregiverCode: lookupCaregiverCode(caregiverMap, row.providerName),
  };
}
