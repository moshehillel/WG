import type {
  ClosedCaseRow,
  OpenedCaseRow,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { firstField, normalizeHeaders, parseCsv, truthyFlag } from './csv.js';
import { isEarlyInterventionProgram } from './rules.js';

/** Gluck exports use "Last First" in Child's Name. */
export function parseChildName(full: string | undefined): {
  firstName: string;
  lastName: string;
} {
  if (!full?.trim()) return { firstName: '', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
}

function detectEarlyIntervention(row: Record<string, string>): {
  programType?: string;
  isEarlyIntervention: boolean;
} {
  const programType = firstField(row, 'program_type', 'program', 'programtype');
  const eiField = firstField(
    row,
    'is_early_intervention',
    'early_intervention',
    'ei',
    'program_type',
    'program',
  );
  return {
    programType,
    isEarlyIntervention: truthyFlag(eiField) || isEarlyInterventionProgram(programType),
  };
}

export function parseOpenedCases(content: string): OpenedCaseRow[] {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    const { programType, isEarlyIntervention } = detectEarlyIntervention(row);
    const childName = firstField(row, 'childs_name', "child's_name", 'child_name');
    const parsedName = parseChildName(childName);
    const programId =
      firstField(row, 'program_id', 'programid', 'case_id', 'caseid', 'case_number', 'id') ??
      '';

    return {
      caseId: programId,
      patientExternalId:
        firstField(row, 'patient_external_id', 'patient_id', 'client_id') ?? programId,
      firstName:
        firstField(row, 'first_name', 'firstname', 'patient_first_name') ??
        parsedName.firstName,
      lastName:
        firstField(row, 'last_name', 'lastname', 'patient_last_name') ?? parsedName.lastName,
      dateOfBirth: firstField(
        row,
        'date_of_birth',
        'dob',
        'birth_date',
        'date_of_birth',
      ),
      programType,
      serviceCode: firstField(
        row,
        'service_code',
        'servicecode',
        'code',
        'service_type',
      ),
      authorizationNumber: firstField(
        row,
        'authorization_number',
        'auth_number',
        'authorization',
      ),
      contractId: firstField(row, 'contract_id', 'contract'),
      startDate: firstField(
        row,
        'start_date',
        'opened_date',
        'open_date',
        'service_begin_date',
        'date_of_intake',
      ),
      endDate: firstField(row, 'end_date', 'auth_end_date', 'service_end_date'),
      isEarlyIntervention,
      raw: row,
    };
  });
}

export function parseClosedCases(content: string): ClosedCaseRow[] {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    const { programType, isEarlyIntervention } = detectEarlyIntervention(row);
    const childName = firstField(row, 'childs_name', "child's_name", 'child_name');
    const parsedName = parseChildName(childName);
    const programId =
      firstField(row, 'program_id', 'programid', 'case_id', 'caseid', 'case_number', 'id') ??
      '';

    return {
      caseId: programId,
      patientExternalId:
        firstField(row, 'patient_external_id', 'patient_id', 'client_id') ?? programId,
      firstName: firstField(row, 'first_name', 'firstname') ?? parsedName.firstName,
      lastName: firstField(row, 'last_name', 'lastname') ?? parsedName.lastName,
      programType,
      isEarlyIntervention,
      closedDate: firstField(
        row,
        'closed_date',
        'close_date',
        'end_date',
        'closure_date',
      ),
      closedReason: firstField(row, 'closed_reason', 'reason', 'close_reason'),
      status: firstField(row, 'status', 'case_status') ?? 'Closed',
      raw: row,
    };
  });
}

export function parseVerifiedSessions(content: string): VerifiedSessionRow[] {
  return parseCsv(content).map((raw, index) => {
    const row = normalizeHeaders(raw);
    const { programType, isEarlyIntervention } = detectEarlyIntervention(row);
    const programId = firstField(row, 'program_id', 'programid', 'patient_id') ?? '';
    const visitDate = firstField(row, 'visit_date', 'session_date', 'date') ?? '';
    const startTime = firstField(row, 'start_time', 'start', 'clock_in', 'begin_time') ?? '';
    const provider = firstField(row, 'provider_name', 'caregiver_id', 'provider_id') ?? '';
    const sessionId =
      firstField(row, 'session_id', 'sessionid', 'visit_id', 'id') ??
      [programId, visitDate, startTime, provider, String(index)].filter(Boolean).join('|');

    return {
      sessionId,
      caseId: firstField(row, 'case_id', 'caseid') ?? programId,
      patientExternalId:
        firstField(row, 'patient_external_id', 'patient_id', 'client_id') ?? programId,
      programType,
      isEarlyIntervention,
      serviceCode: firstField(
        row,
        'service_code',
        'servicecode',
        'code',
        'service_type',
        'cpt_codes',
      ),
      visitDate,
      startTime,
      endTime: firstField(row, 'end_time', 'end', 'clock_out', 'end_time'),
      caregiverId: firstField(
        row,
        'caregiver_id',
        'provider_id',
        'aide_id',
        'provider_name',
        'supplier_number',
      ),
      verifiedAt: firstField(row, 'verified_at', 'verified_date'),
      status: firstField(row, 'status', 'authorization_number'),
      raw: row,
    };
  });
}

/** 4th ProviderSoft report — service-level discharge rows. */
export function parseDischargeService(content: string): Array<{
  caseId: string;
  patientExternalId?: string;
  firstName?: string;
  lastName?: string;
  programType?: string;
  serviceCode?: string;
  startDate?: string;
  endDate?: string;
  dischargeDate?: string;
  isEarlyIntervention?: boolean;
  raw?: Record<string, string>;
}> {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    const { programType, isEarlyIntervention } = detectEarlyIntervention(row);
    const childName = firstField(row, 'childs_name', "child's_name", 'child_name');
    const parsedName = parseChildName(childName);
    const programId =
      firstField(row, 'program_id', 'programid', 'case_id', 'caseid') ?? '';

    return {
      caseId: programId,
      patientExternalId: programId,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      programType,
      serviceCode: firstField(row, 'service_type', 'service_code'),
      startDate: firstField(row, 'service_begin_date', 'start_date'),
      endDate: firstField(row, 'service_end_date', 'end_date'),
      dischargeDate: firstField(row, 'service_discharge_date', 'discharge_date'),
      isEarlyIntervention,
      raw: row,
    };
  });
}
