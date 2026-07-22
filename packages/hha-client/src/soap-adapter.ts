import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';
import type { ClosedCaseUpdate, HhaClient, UpsertResult } from './types.js';
import { HhaSoapClient, type HhaSoapAuth, type SoapCallResult } from './soap-client.js';
import {
  buildConfirmVisitsBody,
  parseTimesheetFlags,
  parseVisitConfirmTimes,
  parseVisitEditReasonPairs,
  timesheetConfirmAttempts,
  type VisitConfirmReasonPair,
} from './visit-confirm.js';

export interface SoapHhaClientAdapterOptions {
  baseUrl: string;
  auth: HhaSoapAuth;
  /** Required for CreatePatient / CreateSchedule (office-scoped). */
  defaultOfficeId?: number;
  fetchImpl?: typeof fetch;
  /**
   * When sandbox returns -9 on GetVisitEditReasonActionTaken, read pairs from prod (read-only).
   * Defaults to HHA_REASON_LOOKUP_URL or app.hhaexchange.com when HHA_ALLOW_REASON_LOOKUP=true.
   */
  reasonLookupBaseUrl?: string;
  /** Prod visit used only for reason lookup (not the visit being confirmed). */
  reasonLookupVisitId?: number;
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
  private readonly reasonLookup?: HhaSoapClient;
  private readonly reasonLookupVisitId?: number;
  readonly defaultOfficeId?: number;

  constructor(options: SoapHhaClientAdapterOptions) {
    this.soap = new HhaSoapClient({
      baseUrl: options.baseUrl,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
    });
    this.defaultOfficeId = options.defaultOfficeId;
    this.reasonLookupVisitId = options.reasonLookupVisitId;

    const lookupUrl = options.reasonLookupBaseUrl?.trim();
    if (lookupUrl) {
      this.reasonLookup = new HhaSoapClient({
        baseUrl: lookupUrl,
        auth: options.auth,
        fetchImpl: options.fetchImpl,
        allowProductionEndpoint: true,
      });
    }
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
    const visitDate = contract.startDate ?? new Date().toISOString().slice(0, 10);
    const existing = await this.soap.getPatientContracts(Number(contract.patientId), visitDate);
    assertOk(existing, 'GetPatientContracts');
    const existingId =
      pickId(existing.raw, ['PlacementID', 'ID', 'ContractID']) ??
      pickNestedContractId(existing.raw);
    if (existingId && !contract.contractExternalId) {
      return { id: existingId, created: false };
    }

    if (!contract.contractExternalId) {
      throw new Error('AddPatientContract requires ContractID from GetContracts / report mapping');
    }

    const result = await this.soap.call(
      'AddPatientContract',
      `<PatientContractInfo>
  <PatientID>${escape(contract.patientId)}</PatientID>
  <ContractID>${escape(contract.contractExternalId)}</ContractID>
  <StartDate>${escape(contract.startDate ?? '')}</StartDate>
</PatientContractInfo>`,
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
      `<CreateAuthorizationInfo>
  <PatientID>${escape(auth.patientId)}</PatientID>
  <ContractID>${escape(auth.serviceCode ?? '')}</ContractID>
  <AuthorizationNumber>${escape(auth.authorizationNumber)}</AuthorizationNumber>
  <FromDate>${escape(auth.startDate ?? '')}</FromDate>
  <ToDate>${escape(auth.endDate ?? '')}</ToDate>
</CreateAuthorizationInfo>`,
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
    const numericId = Number(visitId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new Error(`approveVisit requires numeric VisitID, got ${visitId}`);
    }

    const info = await this.soap.getVisitInfoV2(numericId);
    assertOk(info, 'GetVisitInfoV2');

    const times =
      parseVisitConfirmTimes(info.bodyXml) ??
      (() => {
        throw new Error(
          `Cannot confirm visit ${visitId}: missing VisitDate/Schedule times in GetVisitInfoV2`,
        );
      })();

    const visitFlags = parseTimesheetFlags(info.bodyXml);
    const reasonPairs = await this.resolveConfirmReasonPairs(numericId);
    if (!reasonPairs.length) {
      throw new Error(
        'ConfirmVisits requires ReasonCode/ActionCode; enable GetVisitEditReasonActionTaken on sandbox or configure HHA_REASON_LOOKUP_URL + HHA_REASON_LOOKUP_VISIT_ID',
      );
    }

    const errors: string[] = [];
    for (const pair of reasonPairs) {
      for (const flags of timesheetConfirmAttempts(visitFlags)) {
        const body = buildConfirmVisitsBody({
          visitId,
          times,
          reasonCode: pair.reasonCode,
          actionCode: pair.actionCode,
          timesheetRequired: flags.timesheetRequired,
          timesheetApproved: flags.timesheetApproved,
        });
        const result = await this.soap.confirmVisit(body);
        if (result.ok) return;
        errors.push(
          `reason=${pair.reasonCode} action=${pair.actionCode} ts=${flags.timesheetRequired}/${flags.timesheetApproved}: ${result.errorMessage ?? result.status} (${result.errorId ?? '-'})`,
        );
        // Future visit — other pairs won't help
        if (result.errorId === '-310') break;
      }
    }

    throw new Error(
      `ConfirmVisits failed for visit ${visitId} after ${reasonPairs.length} reason pair(s): ${errors.slice(0, 3).join('; ')}`,
    );
  }

  /** Load reason/action codes: sandbox visit first, then optional prod read-only fallback. */
  private async resolveConfirmReasonPairs(visitId: number): Promise<VisitConfirmReasonPair[]> {
    const fromVisit = await this.fetchReasonPairs(this.soap, visitId);
    if (fromVisit.length) return fromVisit;

    if (this.reasonLookup && this.reasonLookupVisitId) {
      const fromProd = await this.fetchReasonPairs(
        this.reasonLookup,
        this.reasonLookupVisitId,
      );
      if (fromProd.length) return fromProd;
    }

    return [];
  }

  private async fetchReasonPairs(
    client: HhaSoapClient,
    visitId: number,
  ): Promise<VisitConfirmReasonPair[]> {
    const res = await client.getVisitEditReasonActionTaken(visitId);
    if (!res.ok) return [];
    return parseVisitEditReasonPairs(res.bodyXml);
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
    const contracts = await this.soap.getPatientContracts(
      Number(patientId),
      update.closedDate ?? new Date().toISOString().slice(0, 10),
    );
    assertOk(contracts, 'GetPatientContracts');
    const contractId =
      pickId(contracts.raw, ['PlacementID', 'ID', 'ContractID']) ??
      pickNestedContractId(contracts.raw);
    if (!contractId) {
      throw new Error(`No patient contract found to discharge for patient ${patientId}`);
    }
    const result = await this.soap.call(
      'UpdatePatientContract',
      `<PatientContractInfo>
  <PatientID>${escape(patientId)}</PatientID>
  <PlacementID>${escape(contractId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${escape(update.closedDate ?? '')}</DischargeDate>
</PatientContractInfo>`,
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

function pickNestedContractId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const root = raw as Record<string, unknown>;
  const list =
    (root.PatientContracts as { PatientContractInfo?: unknown } | undefined)?.PatientContractInfo ??
    root.PatientContractInfo;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== 'object') return undefined;
  const row = first as Record<string, unknown>;
  if (row.PlacementID !== undefined) return String(row.PlacementID);
  const contract = row.Contract as Record<string, unknown> | undefined;
  if (contract?.ID !== undefined) return String(contract.ID);
  return undefined;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
