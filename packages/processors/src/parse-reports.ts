import type {
  ClosedCaseRow,
  OpenedCaseRow,
  VerifiedSessionRow,
} from '@white-glove/shared';
import { firstField, normalizeHeaders, parseCsv, truthyFlag } from './csv.js';

export function parseOpenedCases(content: string): OpenedCaseRow[] {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    const programType = firstField(row, 'program_type', 'program', 'programtype');
    const eiField = firstField(
      row,
      'is_early_intervention',
      'early_intervention',
      'ei',
      'program_type',
      'program',
    );
    const isEarlyIntervention =
      truthyFlag(eiField) ||
      (programType?.toLowerCase().includes('early intervention') ?? false) ||
      programType?.toUpperCase() === 'EI';

    return {
      caseId: firstField(row, 'case_id', 'caseid', 'case_number', 'id') ?? '',
      patientExternalId: firstField(row, 'patient_external_id', 'patient_id', 'client_id'),
      firstName: firstField(row, 'first_name', 'firstname', 'patient_first_name') ?? '',
      lastName: firstField(row, 'last_name', 'lastname', 'patient_last_name') ?? '',
      dateOfBirth: firstField(row, 'date_of_birth', 'dob', 'birth_date'),
      programType,
      serviceCode: firstField(row, 'service_code', 'servicecode', 'code'),
      authorizationNumber: firstField(row, 'authorization_number', 'auth_number', 'authorization'),
      contractId: firstField(row, 'contract_id', 'contract'),
      startDate: firstField(row, 'start_date', 'opened_date', 'open_date'),
      endDate: firstField(row, 'end_date', 'auth_end_date'),
      isEarlyIntervention,
      raw: row,
    };
  });
}

export function parseClosedCases(content: string): ClosedCaseRow[] {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    return {
      caseId: firstField(row, 'case_id', 'caseid', 'case_number', 'id') ?? '',
      patientExternalId: firstField(row, 'patient_external_id', 'patient_id', 'client_id'),
      firstName: firstField(row, 'first_name', 'firstname'),
      lastName: firstField(row, 'last_name', 'lastname'),
      closedDate: firstField(row, 'closed_date', 'close_date', 'end_date'),
      closedReason: firstField(row, 'closed_reason', 'reason', 'close_reason'),
      status: firstField(row, 'status', 'case_status') ?? 'Closed',
      raw: row,
    };
  });
}

export function parseVerifiedSessions(content: string): VerifiedSessionRow[] {
  return parseCsv(content).map((raw) => {
    const row = normalizeHeaders(raw);
    return {
      sessionId: firstField(row, 'session_id', 'sessionid', 'visit_id', 'id') ?? '',
      caseId: firstField(row, 'case_id', 'caseid'),
      patientExternalId: firstField(row, 'patient_external_id', 'patient_id', 'client_id'),
      serviceCode: firstField(row, 'service_code', 'servicecode', 'code'),
      visitDate: firstField(row, 'visit_date', 'session_date', 'date'),
      startTime: firstField(row, 'start_time', 'start', 'clock_in'),
      endTime: firstField(row, 'end_time', 'end', 'clock_out'),
      caregiverId: firstField(row, 'caregiver_id', 'provider_id', 'aide_id'),
      verifiedAt: firstField(row, 'verified_at', 'verified_date'),
      status: firstField(row, 'status'),
      raw: row,
    };
  });
}
