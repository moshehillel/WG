import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';
import type { ClosedCaseUpdate, HhaClient, UpsertResult } from './types.js';
import { HhaSoapClient, type HhaSoapAuth, type SoapCallResult } from './soap-client.js';

export interface SoapHhaClientAdapterOptions {
  baseUrl: string;
  auth: HhaSoapAuth;
  /** Required for CreatePatient / CreateSchedule (office-scoped). */
  defaultOfficeId?: number;
  fetchImpl?: typeof fetch;
}

function assertOk(result: SoapCallResult, context: string): void {
  if (!result.ok) {
    throw new Error(
      `HHA ${context} failed: ${result.errorMessage ?? result.status ?? 'unknown'} (ErrorID=${result.errorId ?? '-'})`,
    );
  }
}

function pickId(raw: unknown, keys: string[]): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).length > 0) return String(value);
  }
  // Nested Result / Patient / Visit wrappers
  for (const nest of ['Patient', 'Visit', 'Authorization', 'Contract']) {
    const child = obj[nest];
    if (child && typeof child === 'object') {
      const found = pickId(child, keys);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Maps White-glove domain operations onto HHAeXchange Enterprise SOAP V1.8.
 * Field completeness for Create* calls depends on ProviderSoft report columns + office config.
 */
export class SoapHhaClientAdapter implements HhaClient {
  private readonly soap: HhaSoapClient;
  readonly defaultOfficeId?: number;

  constructor(options: SoapHhaClientAdapterOptions) {
    this.soap = new HhaSoapClient(options);
    this.defaultOfficeId = options.defaultOfficeId;
  }

  getSoap(): HhaSoapClient {
    return this.soap;
  }

  async upsertPatient(patient: HhaPatient): Promise<UpsertResult> {
    if (patient.externalId) {
      const search = await this.soap.searchPatients({ mrNumber: patient.externalId });
      if (search.ok) {
        const ids = collectPatientIds(search.raw);
        if (ids[0]) return { id: String(ids[0]), created: false };
      }
    }

    const searchByName = await this.soap.searchPatients({
      firstName: patient.firstName,
      lastName: patient.lastName,
      status: 'Active',
    });
    if (searchByName.ok) {
      const ids = collectPatientIds(searchByName.raw);
      if (ids[0]) return { id: String(ids[0]), created: false };
    }

    // CreatePatient requires many office-specific fields; surface clearly until report mapping is complete.
    throw new Error(
      'CreatePatient not auto-invoked yet: map OfficeID, Address, Coordinator, and required demographics from ProviderSoft reports / HHA office setup first. Existing patient search found no match.',
    );
  }

  async upsertContract(contract: HhaContract): Promise<UpsertResult> {
    const existing = await this.soap.getPatientContracts(Number(contract.patientId));
    assertOk(existing, 'GetPatientContracts');
    const existingId = pickId(existing.raw, ['ID', 'ContractID']);
    if (existingId && !contract.contractExternalId) {
      return { id: existingId, created: false };
    }

    if (!contract.contractExternalId) {
      throw new Error('AddPatientContract requires ContractID from GetContracts / report mapping');
    }

    const result = await this.soap.call(
      'AddPatientContract',
      `<PatientContract>
  <PatientID>${escape(contract.patientId)}</PatientID>
  <ContractID>${escape(contract.contractExternalId)}</ContractID>
  <ServiceStartDate>${escape(contract.startDate ?? '')}</ServiceStartDate>
</PatientContract>`,
    );
    assertOk(result, 'AddPatientContract');
    return {
      id: pickId(result.raw, ['ID', 'ContractID', 'PatientContractID']) ?? contract.contractExternalId,
      created: true,
    };
  }

  async upsertAuthorization(auth: HhaAuthorization): Promise<UpsertResult> {
    if (!auth.authorizationNumber) {
      throw new Error('CreatePatientAuthorization requires authorizationNumber');
    }
    const result = await this.soap.call(
      'CreatePatientAuthorization',
      `<Authorization>
  <PatientID>${escape(auth.patientId)}</PatientID>
  <ContractID>${escape(auth.serviceCode ?? '')}</ContractID>
  <AuthorizationNumber>${escape(auth.authorizationNumber)}</AuthorizationNumber>
  <StartDate>${escape(auth.startDate ?? '')}</StartDate>
  <EndDate>${escape(auth.endDate ?? '')}</EndDate>
</Authorization>`,
    );
    // Note: ContractID / discipline / units shapes will be refined from sandbox CreatePatientAuthorization sample + report columns.
    if (!result.ok) {
      throw new Error(
        `CreatePatientAuthorization failed: ${result.errorMessage ?? result.status} (ErrorID=${result.errorId}). Payload may need ContractID/discipline from GetContractServiceCode.`,
      );
    }
    return {
      id: pickId(result.raw, ['AuthorizationID', 'ID']) ?? auth.authorizationNumber,
      created: true,
    };
  }

  async locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult> {
    if (visit.visitExternalId && /^\d+$/.test(visit.visitExternalId)) {
      const info = await this.soap.getVisitInfoV2(Number(visit.visitExternalId));
      if (info.ok) {
        return { id: visit.visitExternalId, created: false };
      }
    }

    if (visit.patientId && visit.visitDate) {
      const found = await this.soap.searchVisits({
        patientId: Number(visit.patientId),
        startDate: visit.visitDate,
        endDate: visit.visitDate,
      });
      if (found.ok) {
        const id = pickId(found.raw, ['VisitID', 'ID']);
        if (id) return { id, created: false };
      }
    }

    throw new Error(
      'CreateSchedule not auto-invoked yet: need caregiver, discipline, contract, and schedule times from Verified Sessions + HHA reference data.',
    );
  }

  async getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails> {
    const info = await this.soap.getVisitInfoV2(Number(visitId));
    assertOk(info, 'GetVisitInfoV2');
    const visitInfo =
      (info.raw as { VisitInfo?: Record<string, unknown> }).VisitInfo ??
      (info.raw as Record<string, unknown>);
    const clockIn = String(visitInfo.VisitStartTime ?? visitInfo.EVVStartTime ?? '');
    const clockOut = String(visitInfo.VisitEndTime ?? visitInfo.EVVEndTime ?? '');
    const expectedStart = expected.startTime ?? '';
    const expectedEnd = expected.endTime ?? '';
    const matchesExpected =
      (!expectedStart || clockIn.includes(expectedStart)) &&
      (!expectedEnd || clockOut.includes(expectedEnd));
    return {
      visitId,
      clockIn: clockIn || undefined,
      clockOut: clockOut || undefined,
      matchesExpected,
      notes: matchesExpected ? undefined : 'Visit EVV/clock times do not match expected session window',
    };
  }

  async approveVisit(visitId: string): Promise<void> {
    const result = await this.soap.call(
      'ConfirmVisits',
      `<VisitInfo>
  <VisitID>${escape(visitId)}</VisitID>
  <TimesheetRequired>No</TimesheetRequired>
  <TimesheetApproved>Yes</TimesheetApproved>
</VisitInfo>`,
    );
    assertOk(result, 'ConfirmVisits');
  }

  async updateClosedCase(update: ClosedCaseUpdate): Promise<void> {
    // HHA models "closed" via patient contract discharge fields (UpdatePatientContract).
    if (!update.patientId && !update.caseId) {
      throw new Error('updateClosedCase requires patientId or resolvable caseId');
    }
    const patientId = update.patientId;
    if (!patientId) {
      throw new Error(
        'Closed-case updates need HHA PatientID mapping from ProviderSoft caseId before UpdatePatientContract discharge can run',
      );
    }
    const contracts = await this.soap.getPatientContracts(Number(patientId));
    assertOk(contracts, 'GetPatientContracts');
    const contractId = pickId(contracts.raw, ['ID', 'ContractID']);
    if (!contractId) {
      throw new Error(`No patient contract found to discharge for patient ${patientId}`);
    }
    const result = await this.soap.call(
      'UpdatePatientContract',
      `<PatientContract>
  <PatientID>${escape(patientId)}</PatientID>
  <ContractID>${escape(contractId)}</ContractID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${escape(update.closedDate ?? '')}</DischargeDate>
</PatientContract>`,
    );
    assertOk(result, 'UpdatePatientContract');
  }

  async validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];
    for (const ref of externalRefs) {
      if (!/^\d+$/.test(ref)) {
        missing.push(ref);
        continue;
      }
      const demo = await this.soap.getPatientDemographics(Number(ref));
      if (!demo.ok) {
        const visit = await this.soap.getVisitInfoV2(Number(ref));
        if (!visit.ok) missing.push(ref);
      }
    }
    return { ok: missing.length === 0, missing };
  }
}

function collectPatientIds(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') return [];
  const patients = (raw as { Patients?: { PatientID?: unknown } }).Patients;
  if (!patients) return [];
  const ids = patients.PatientID;
  if (Array.isArray(ids)) return ids.map(Number).filter((n) => !Number.isNaN(n));
  if (ids !== undefined) return [Number(ids)].filter((n) => !Number.isNaN(n));
  return [];
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
