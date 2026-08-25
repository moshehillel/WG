import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';
import {
  resolveDischargeToId,
  extractDisciplineFromServiceType,
  DEFAULT_DISCHARGE_REASON_LABEL,
} from '@white-glove/shared';
import {
  lookupContractId,
  lookupServiceCode,
  lookupServiceCodeAlias,
  hasServiceCodeAlias,
  normalizeHhaGender,
  providerNameMatchKeys,
} from '@white-glove/shared';
import type {
  ClosedCaseUpdate,
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
  FindPatientOptions,
  HhaClient,
  PatientDemoFields,
  PatientPlacementSummary,
  PendingCall,
  UpsertResult,
} from './types.js';
import { caregiverSearchNameOrders, compareSessionClock, psDateToIso } from './hha-time.js';
import {
  matchByName,
  normalizeRefName,
  parseContractsFromXml,
  parseServiceCodesFromXml,
} from './reference-resolve.js';
import {
  parseCallDashboardEntries,
  parsePayRateCodesFromXml,
  xmlFirstTag,
  xmlIds,
} from './hha-xml-parse.js';
import { buildCreateScheduleBody } from './schedule-builder.js';
import {
  buildCreatePatientBody,
  canCreatePatient,
  createPatientDefaultsFromEnv,
  defaultReferenceIds,
  formatAdmissionId,
  type CreatePatientDefaults,
  type CreatePatientReferenceIds,
} from './create-patient-builder.js';
import { stripLeadingZerosFromNumericId } from './create-patient-builder.js';
import { HhaSoapClient, type HhaSoapAuth, type SoapCallResult } from './soap-client.js';
import { AmbiguousPatientNameError } from './patient-errors.js';
import { isTrustedHhaPatientId, toFindPatientOptions } from './resolve-patient-id.js';
import type { HhaReferenceCache } from './reference-cache.js';
import {
  normalizePsPayCodeName,
  resolveHhaPayCodeName,
  resolvePayCodeIdFromCatalog,
  type PayCodeRow,
} from './pay-code-resolve.js';
import { activePlacements, parsePatientPlacements } from './placements.js';
import { resolvePlacementForService } from './resolve-placement.js';
import { resolveServiceCodeIdFromRows } from './resolve-service-code-order.js';
import {
  buildConfirmVisitsBody,
  buildConfirmVisitsEvvBody,
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
  /** Office/coordinator/reference IDs for CreatePatient (defaults from env). */
  createPatientDefaults?: CreatePatientDefaults;
  /** DynamoDB-backed cache for codes discovered via live HHA lookup. */
  referenceCache?: HhaReferenceCache;
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
  private payCodeResolvedCache = new Map<string, string>();
  private payRateCodeRows?: PayCodeRow[];
  private createPatientRefs?: CreatePatientReferenceIds;
  private contractCache?: Array<{ id: string; name: string }>;
  private serviceCodeByName = new Map<string, string>();
  private serviceCodeRowsByContract = new Map<number, Array<{ id: string; name: string }>>();
  private loadedContractServiceCodes = new Set<number>();
  private disciplineCache?: Array<{ id: string; name: string }>;
  private dischargeReasonId?: string;
  private readonly createPatientDefaults: CreatePatientDefaults;
  private readonly referenceCache?: HhaReferenceCache;
  readonly defaultOfficeId?: number;

  constructor(options: SoapHhaClientAdapterOptions) {
    this.soap = new HhaSoapClient({
      baseUrl: options.baseUrl,
      auth: options.auth,
      fetchImpl: options.fetchImpl,
      allowProductionEndpoint: process.env.HHA_ALLOW_PRODUCTION === 'true',
    });
    this.defaultOfficeId = options.defaultOfficeId;
    this.reasonLookupVisitId = options.reasonLookupVisitId;
    this.createPatientDefaults =
      options.createPatientDefaults ?? createPatientDefaultsFromEnv();
    this.referenceCache = options.referenceCache;
    if (options.defaultOfficeId) {
      this.createPatientDefaults.officeId = options.defaultOfficeId;
    }

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

  async findPatient(options: FindPatientOptions): Promise<string | undefined> {
    const searchedMr = new Set<string>();
    const searchedAdmission = new Set<string>();

    const byMr = async (mrNumber?: string): Promise<string | undefined> => {
      const key = mrNumber?.trim();
      if (!key || searchedMr.has(key)) return undefined;
      searchedMr.add(key);
      const result = await this.soap.searchPatients({ mrNumber: key, status: 'All' });
      const ids = result.ok ? collectPatientIds(result.raw) : [];
      return ids[0] ? String(ids[0]) : undefined;
    };

    const byAdmission = async (caseOrExternal?: string): Promise<string | undefined> => {
      const admissionId = formatAdmissionId(
        caseOrExternal,
        this.createPatientDefaults.admissionIdPrefix,
      );
      if (!admissionId || searchedAdmission.has(admissionId)) return undefined;
      searchedAdmission.add(admissionId);
      const result = await this.soap.searchPatients({ admissionId, status: 'All' });
      const ids = result.ok ? collectPatientIds(result.raw) : [];
      return ids[0] ? String(ids[0]) : undefined;
    };

    // Order: exact MR → admission PS{id} → leading-zero strip (MR + admission) → exact name (+ DOB).
    const found =
      (await byMr(options.externalId)) ??
      (await byAdmission(options.caseId ?? options.externalId));
    if (found) return found;

    for (const source of [options.externalId, options.caseId]) {
      const unpadded = stripLeadingZerosFromNumericId(source);
      if (!unpadded) continue;
      const recovered = (await byMr(unpadded)) ?? (await byAdmission(unpadded));
      if (recovered) return recovered;
    }

    return this.findPatientByExactName(options);
  }

  /**
   * After MR/admission miss: SearchPatients by exact first+last (case-insensitive verify via demos).
   * Prefer a unique DOB match when PS DOB is present. If multiple strong matches remain
   * (e.g. same name+DOB duplicates), do NOT guess — return undefined.
   */
  private async findPatientByExactName(
    options: FindPatientOptions,
  ): Promise<string | undefined> {
    const first = options.firstName?.trim();
    const last = options.lastName?.trim();
    if (!first || !last) return undefined;

    const wantDob = normalizeDobKey(options.dateOfBirth);
    const matches = await this.collectExactNameMatches(first, last);
    if (matches.length === 0) {
      // Low-risk: last/first swapped when as-is returned nothing.
      const swapped = await this.collectExactNameMatches(last, first, first, last);
      return pickUniqueNameMatch(swapped, wantDob);
    }
    return pickUniqueNameMatch(matches, wantDob);
  }

  private async collectExactNameMatches(
    searchFirst: string,
    searchLast: string,
    expectFirst = searchFirst,
    expectLast = searchLast,
  ): Promise<Array<{ patientId: string; dobKey: string | undefined }>> {
    const result = await this.soap.searchPatients({
      firstName: searchFirst,
      lastName: searchLast,
      status: 'All',
    });
    if (!result.ok) return [];
    const ids = collectPatientIds(result.raw).slice(0, 25);
    const out: Array<{ patientId: string; dobKey: string | undefined }> = [];
    for (const id of ids) {
      const demo = await this.soap.getPatientDemographics(id);
      if (!demo.ok || !demo.bodyXml) continue;
      const demoFirst = xmlFirstTag(demo.bodyXml, 'FirstName') ?? '';
      const demoLast = xmlFirstTag(demo.bodyXml, 'LastName') ?? '';
      if (!namesEqual(demoFirst, expectFirst) || !namesEqual(demoLast, expectLast)) {
        // Also accept true swapped identity on the HHA record vs PS expect.
        if (
          !(namesEqual(demoFirst, expectLast) && namesEqual(demoLast, expectFirst))
        ) {
          continue;
        }
      }
      const rawDob =
        xmlFirstTag(demo.bodyXml, 'DOB') ??
        xmlFirstTag(demo.bodyXml, 'BirthDate') ??
        xmlFirstTag(demo.bodyXml, 'DateOfBirth');
      out.push({ patientId: String(id), dobKey: normalizeDobKey(rawDob) });
    }
    return out;
  }

  async getPatientGender(patientId: string): Promise<string | undefined> {
    const demo = await this.getPatientDemographicsFields(patientId);
    return demo.gender;
  }

  async getPatientDemographicsFields(patientId: string): Promise<PatientDemoFields> {
    const result = await this.soap.getPatientDemographics(Number(patientId));
    if (!result.ok || !result.bodyXml) return {};
    const xml = result.bodyXml;
    const rawGender = xmlFirstTag(xml, 'Gender');
    const zip =
      xmlFirstTag(xml, 'ZipCode') ??
      xmlFirstTag(xml, 'Zip5') ??
      xmlFirstTag(xml, 'Zip') ??
      undefined;
    const zip4 = xmlFirstTag(xml, 'Zip4');
    const zipCode =
      zip && zip4 && !zip.includes('-') ? `${zip}-${zip4}` : zip || undefined;
    return {
      gender: rawGender ? normalizeHhaGender(rawGender) : undefined,
      address1: xmlFirstTag(xml, 'Address1') || undefined,
      city: xmlFirstTag(xml, 'City') || undefined,
      state: xmlFirstTag(xml, 'State') || undefined,
      zipCode: zipCode?.trim() || undefined,
    };
  }

  async upsertPatient(patient: HhaPatient): Promise<UpsertResult> {
    const existingId = await this.findPatient({
      externalId: patient.externalId,
      caseId: patient.caseId,
    });
    if (existingId) return { id: existingId, created: false };

    const searchByName = await this.soap.searchPatients({
      firstName: patient.firstName,
      lastName: patient.lastName,
      status: 'Active',
    });
    if (searchByName.ok) {
      const ids = collectPatientIds(searchByName.raw);
      if (ids.length >= 2) {
        throw new AmbiguousPatientNameError(
          patient.firstName ?? '',
          patient.lastName ?? '',
          ids.length,
        );
      }
      if (ids[0]) return { id: String(ids[0]), created: false };
    }

    const readiness = canCreatePatient(patient, this.createPatientDefaults);
    if (!readiness.ok) {
      const fieldLabels: Record<string, string> = {
        officeId: 'Office',
        coordinatorId: 'Coordinator',
        firstName: 'First Name',
        lastName: 'Last Name',
        dateOfBirth: 'Date of Birth',
        address1: 'Address',
        city: 'City',
        state: 'State',
        zipCode: 'Zip Code',
        caseId: 'Program Id / Case Id',
        gender: 'Gender',
      };
      const missingLabels = readiness.missing.map((k) => fieldLabels[k] ?? k);
      throw new Error(
        `CreatePatient FAILED — missing required field(s): ${missingLabels.join(', ')}. Existing patient search found no match.`,
      );
    }

    const refs = await this.resolveCreatePatientRefs();
    const body = buildCreatePatientBody(patient, this.createPatientDefaults, refs);
    const result = await this.soap.createPatient(body);
    assertOk(result, 'CreatePatient');
    const newId =
      xmlIds(result.bodyXml, 'PatientID')[0]?.toString() ??
      pickId(result.raw, ['PatientID', 'ID']);
    if (!newId) {
      throw new Error('CreatePatient succeeded but no PatientID returned');
    }
    return { id: newId, created: true };
  }

  private async resolveCreatePatientRefs(): Promise<CreatePatientReferenceIds> {
    if (this.createPatientRefs) return this.createPatientRefs;

    const envRefs = defaultReferenceIds();
    let mobilityStatusId = envRefs.mobilityStatusId;
    let evacuationZoneId = envRefs.evacuationZoneId;

    try {
      const mobility = await this.soap.getMobilityStatuses();
      if (mobility.ok) {
        const picked = pickMobilityStatusId(mobility.bodyXml);
        if (picked) mobilityStatusId = picked;
      }
      const evacuation = await this.soap.getEvacuationZones();
      if (evacuation.ok) {
        const picked = pickEvacuationZoneId(evacuation.bodyXml);
        if (picked && picked > 100_000) evacuationZoneId = picked;
      }
    } catch {
      /* use env defaults */
    }

    this.createPatientRefs = {
      branchId: envRefs.branchId,
      teamId: envRefs.teamId,
      locationId: envRefs.locationId,
      mobilityStatusId,
      evacuationZoneId,
    };
    return this.createPatientRefs;
  }

  async upsertContract(contract: HhaContract): Promise<UpsertResult> {
    const startIso =
      psDateToIso(contract.startDate) ??
      contract.startDate ??
      new Date().toISOString().slice(0, 10);
    const visitDate = startIso.slice(0, 10);
    const existing = await this.soap.getPatientContracts(Number(contract.patientId), visitDate);
    assertOk(existing, 'GetPatientContracts');

    if (!contract.contractExternalId) {
      throw new Error('AddPatientContract requires ContractID from GetContracts / report mapping');
    }

    if (existing.bodyXml) {
      const targetContract = contract.contractExternalId;
      const targetStart = startIso.slice(0, 10);
      const active = activePlacements(parsePatientPlacements(existing.bodyXml));
      const duplicate = active.find((p) => {
        if (p.contractId !== targetContract) return false;
        if (!p.startDate?.trim() || !targetStart) return false;
        const placementStart = (psDateToIso(p.startDate) ?? p.startDate).slice(0, 10);
        return placementStart === targetStart;
      });
      if (duplicate) {
        return { id: duplicate.placementId, created: false };
      }
      const sameContract = active.filter((p) => p.contractId === targetContract);
      if (sameContract.length === 1) {
        return { id: sameContract[0]!.placementId, created: false };
      }
    }

    const result = await this.soap.call(
      'AddPatientContract',
      `<PatientContractInfo>
  <PatientID>${escape(contract.patientId)}</PatientID>
  <ContractID>${escape(contract.contractExternalId)}</ContractID>
  <StartDate>${escape(startIso)}</StartDate>
</PatientContractInfo>`,
    );
    assertOk(result, 'AddPatientContract');
    const placementId =
      pickId(result.raw, ['PlacementID', 'PatientContractID', 'ID']) ??
      (result.bodyXml ? parsePatientPlacements(result.bodyXml)[0]?.placementId : undefined) ??
      contract.contractExternalId;
    return {
      id: placementId,
      created: true,
    };
  }

  async upsertAuthorization(auth: HhaAuthorization): Promise<UpsertResult> {
    if (!auth.authorizationNumber) {
      throw new Error('CreatePatientAuthorization requires authorizationNumber');
    }
    const contractId = auth.contractId;
    if (!contractId) {
      throw new Error('CreatePatientAuthorization requires contractId from program type mapping');
    }
    const contractNum = Number(contractId);
    let serviceCodeId = auth.serviceCodeId;
    if (!serviceCodeId && auth.serviceCode) {
      serviceCodeId = await this.resolveServiceCodeId(
        auth.serviceCode,
        contractNum,
        auth.programType,
      );
    }
    if (serviceCodeId && auth.serviceCode) {
      serviceCodeId = await this.ensureContractServiceCodeId(
        auth.serviceCode,
        contractNum,
        serviceCodeId,
        auth.programType,
      );
    }
    if (!serviceCodeId) {
      throw new Error(
        'CreatePatientAuthorization requires ServiceCodeID — service type not found in HHA billing codes for this contract',
      );
    }
    let disciplineId = auth.disciplineId;
    if (!disciplineId) {
      disciplineId = await this.resolveDisciplineId(auth.serviceCode);
    }
    if (!disciplineId) {
      throw new Error('CreatePatientAuthorization requires DisciplineID from service type');
    }
    let period = auth.period?.trim();
    let maximum = auth.maximum;
    if (!period || maximum === undefined) {
      // Reuse only the SAME Authorization Number — never copy Period/Maximum from a sibling auth.
      const existingId = await this.findAuthorizationByNumber(
        auth.patientId,
        auth.authorizationNumber!,
        contractId,
      );
      if (existingId) {
        return { id: existingId, created: false };
      }
      throw new Error(
        'CreatePatientAuthorization requires Period and Maximum from the ProviderSoft report row (Basic Mandate Frequency / Times per Basic Mandate). No sibling-auth fallback.',
      );
    }
    const fromDate = psDateToIso(auth.startDate) ?? auth.startDate ?? '';
    const toDate = psDateToIso(auth.endDate) ?? auth.endDate ?? '';
    const buildAuthXml = (serviceId: string) =>
      `<CreateAuthorizationInfo>
  <PatientID>${escape(auth.patientId)}</PatientID>
  <ContractID>${escape(contractId)}</ContractID>
  <DisciplineID>${escape(disciplineId)}</DisciplineID>
  <ServiceCodeID>${escape(serviceId)}</ServiceCodeID>
  <AuthorizationNumber>${escape(auth.authorizationNumber!)}</AuthorizationNumber>
  <FromDate>${escape(fromDate)}</FromDate>
  <ToDate>${escape(toDate)}</ToDate>
  <Period>${escape(period)}</Period>
  <Maximum>${escape(String(maximum))}</Maximum>
  <IsAdditionalRules>False</IsAdditionalRules>
</CreateAuthorizationInfo>`;

    let result = await this.soap.call('CreatePatientAuthorization', buildAuthXml(serviceCodeId));
    if (!result.ok && String(result.errorId) === '-74' && auth.serviceCode) {
      this.loadedContractServiceCodes.delete(contractNum);
      this.serviceCodeRowsByContract.delete(contractNum);
      const retried = await this.resolveServiceCodeId(
        auth.serviceCode,
        contractNum,
        auth.programType,
      );
      if (retried && retried !== serviceCodeId) {
        serviceCodeId = retried;
        result = await this.soap.call('CreatePatientAuthorization', buildAuthXml(serviceCodeId));
      }
    }
    if (!result.ok) {
      if (String(result.errorId) === '-78') {
        // Only treat as already-exists when the SAME Authorization Number is present.
        const existingId = await this.findAuthorizationByNumber(
          auth.patientId,
          auth.authorizationNumber!,
          contractId,
        );
        if (existingId) {
          return { id: existingId, created: false };
        }
      }
      throw new Error(
        `CreatePatientAuthorization failed: ${result.errorMessage ?? result.status} (ErrorID=${result.errorId}).`,
      );
    }
    return {
      id: pickId(result.raw, ['AuthorizationID', 'ID']) ?? auth.authorizationNumber,
      created: true,
    };
  }

  /** SOAP SearchVisits + EVV time match — does not create a visit. */
  async findExistingVisit(visit: HhaVisit): Promise<UpsertResult | undefined> {
    if (visit.visitExternalId && /^\d+$/.test(visit.visitExternalId)) {
      const info = await this.soap.getVisitInfoV2(Number(visit.visitExternalId));
      if (info.ok) {
        return { id: visit.visitExternalId, created: false };
      }
    }

    if (!visit.patientId || !visit.visitDate) return undefined;

    const visitDate = psDateToIso(visit.visitDate) ?? visit.visitDate;
    const found = await this.soap.searchVisits({
      patientId: Number(visit.patientId),
      startDate: visitDate,
      endDate: visitDate,
    });
    if (!found.ok) return undefined;

    const visitIds = xmlIds(found.bodyXml, 'VisitID');
    for (const vid of visitIds) {
      const info = await this.soap.getVisitInfoV2(vid);
      if (!info.ok) continue;
      const cmp = compareSessionClock(
        visit.startTime,
        visit.endTime,
        xmlFirstTag(info.bodyXml, 'EVVStartTime') ?? xmlFirstTag(info.bodyXml, 'VisitStartTime'),
        xmlFirstTag(info.bodyXml, 'EVVEndTime') ?? xmlFirstTag(info.bodyXml, 'VisitEndTime'),
      );
      if (cmp.matches) return { id: String(vid), created: false };
    }
    return undefined;
  }

  async locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult> {
    const existing = await this.findExistingVisit(visit);
    if (existing) return existing;

    if (visit.contractId && visit.serviceCodeId && visit.caregiverId && visit.visitDate) {
      const body = buildCreateScheduleBody(visit);
      const result = await this.soap.createSchedule(body);
      assertOk(result, 'CreateSchedule');
      const newId =
        xmlIds(result.bodyXml, 'VisitID')[0]?.toString() ??
        pickId(result.raw, ['VisitID', 'ID']);
      if (!newId) {
        throw new Error('CreateSchedule succeeded but no VisitID returned');
      }
      return { id: newId, created: true };
    }

    throw new Error(
      'Cannot locate or create visit: missing contractId, serviceCodeId, caregiverId, or visitDate for CreateSchedule',
    );
  }

  async findPendingCall(options: {
    patientId: string;
    caregiverId?: string;
    visitDate: string;
    officeId?: number;
  }): Promise<PendingCall | undefined> {
    const visitDate = psDateToIso(options.visitDate) ?? options.visitDate;
    const result = await this.soap.getCallDashboardData({
      officeId: options.officeId ?? this.defaultOfficeId,
      patientId: Number(options.patientId),
      caregiverId: options.caregiverId ? Number(options.caregiverId) : undefined,
      startDate: visitDate,
      endDate: visitDate,
    });
    if (!result.ok) return undefined;

    const entries = parseCallDashboardEntries(result.bodyXml);
    const match = entries.find(
      (e) =>
        (!options.caregiverId || e.caregiverId === options.caregiverId) &&
        (!e.patientId || e.patientId === options.patientId),
    );
    if (!match?.callDashboardId) return undefined;
    return { callDashboardId: match.callDashboardId, callTime: match.callTime };
  }

  async linkClockToVisit(
    visitId: string,
    options: { callerId: string; startTime?: string; endTime?: string },
  ): Promise<void> {
    const numericId = Number(visitId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new Error(`linkClockToVisit requires numeric VisitID, got ${visitId}`);
    }

    const info = await this.soap.getVisitInfoV2(numericId);
    assertOk(info, 'GetVisitInfoV2');

    const times =
      parseVisitConfirmTimes(info.bodyXml) ??
      (() => {
        throw new Error(
          `Cannot link clock to visit ${visitId}: missing VisitDate/Schedule times in GetVisitInfoV2`,
        );
      })();

    const visitFlags = parseTimesheetFlags(info.bodyXml);
    const reasonPairs = await this.resolveConfirmReasonPairs(numericId);
    if (!reasonPairs.length) {
      throw new Error(
        'ConfirmVisitsEVV requires ReasonCode/ActionCode; enable GetVisitEditReasonActionTaken on sandbox or configure HHA_REASON_LOOKUP_URL',
      );
    }

    const errors: string[] = [];
    for (const pair of reasonPairs) {
      for (const flags of timesheetConfirmAttempts(visitFlags)) {
        const body = buildConfirmVisitsEvvBody({
          visitId,
          callerId: options.callerId,
          times,
          reasonCode: pair.reasonCode,
          actionCode: pair.actionCode,
          timesheetRequired: flags.timesheetRequired,
          timesheetApproved: flags.timesheetApproved,
        });
        const result = await this.soap.confirmVisitEvv(body);
        if (result.ok) return;
        errors.push(
          `reason=${pair.reasonCode} action=${pair.actionCode}: ${result.errorMessage ?? result.status} (${result.errorId ?? '-'})`,
        );
        if (result.errorId === '-310') break;
      }
    }

    throw new Error(
      `ConfirmVisitsEVV failed for visit ${visitId}: ${errors.slice(0, 3).join('; ')}`,
    );
  }

  async resolveCaregiverId(providerName: string | undefined): Promise<string | undefined> {
    const attempts = caregiverSearchNameOrders(providerName);
    if (attempts.length === 0) return undefined;
    const providerTokens = new Set(
      (providerName ?? '')
        .trim()
        .toUpperCase()
        .split(/\s+/)
        .filter(Boolean),
    );

    for (const { firstName, lastName } of attempts) {
      const hit = await this.pickCaregiverIdFromSearch(firstName, lastName, providerName);
      if (hit) return hit;
    }

    // Broader last-name-only search when multi-word first names miss SearchCaregivers.
    // SearchCaregivers returns CaregiverID list only (no FirstName/LastName in XML).
    const lastNames = [...new Set(attempts.map((a) => a.lastName).filter((n) => n.trim()))];
    for (const lastName of lastNames) {
      const hit = await this.pickCaregiverIdFromSearch('', lastName, providerName, {
        requireNameMatch: true,
        acceptUniqueLastName:
          providerTokens.size > 1 && providerTokens.has(lastName.trim().toUpperCase()),
      });
      if (hit) return hit;
    }

    return undefined;
  }

  private async pickCaregiverIdFromSearch(
    firstName: string,
    lastName: string,
    providerName: string | undefined,
    options?: { requireNameMatch?: boolean; acceptUniqueLastName?: boolean },
  ): Promise<string | undefined> {
    const result = await this.soap.searchCaregivers({
      firstName,
      lastName,
      status: 'Active',
    });
    if (!result.ok || !result.bodyXml) return undefined;

    const blocks = result.bodyXml.match(/<CaregiverInfo>[\s\S]*?<\/CaregiverInfo>/gi) ?? [];
    const ids = xmlIds(result.bodyXml, 'CaregiverID').map(String);
    if (ids.length === 0 && blocks.length === 0) return undefined;

    if (providerName?.trim()) {
      const wantKeys = new Set(providerNameMatchKeys(providerName));
      const matched: string[] = [];
      for (const block of blocks) {
        const id = xmlFirstTag(block, 'CaregiverID');
        if (!id) continue;
        const first = xmlFirstTag(block, 'FirstName') ?? '';
        const last = xmlFirstTag(block, 'LastName') ?? '';
        const candidates = [`${last} ${first}`.trim(), `${first} ${last}`.trim()];
        const hit = candidates.some((c) =>
          providerNameMatchKeys(c).some((k) => wantKeys.has(k)),
        );
        if (hit) matched.push(id);
      }
      if (matched.length === 1) return matched[0];
      if (matched.length > 1) return matched[0];
      if (options?.requireNameMatch) {
        // Prod SearchCaregivers often returns <Caregivers><CaregiverID/> only.
        // If exactly one Active caregiver shares this last name token, accept it.
        if (options.acceptUniqueLastName && ids.length === 1) return ids[0];
        return undefined;
      }
    }

    if (options?.requireNameMatch) return undefined;
    if (ids.length === 1) return ids[0];
    // Prefer unique hit when first+last both provided (narrow search).
    if (firstName.trim() && lastName.trim() && ids.length >= 1) return ids[0];
    return undefined;
  }

  async resolvePayCodeId(payCodeName: string): Promise<string | undefined> {
    if (!payCodeName.trim()) return undefined;
    const key = normalizePsPayCodeName(payCodeName);

    const cached = await this.referenceCache?.getPayCodeId(key);
    if (cached) return cached;

    const inRun = this.payCodeResolvedCache.get(key);
    if (inRun) return inRun;

    const resolved = resolvePayCodeIdFromCatalog(key, await this.loadPayRateCodeRows());
    if (!resolved) return undefined;

    const hhaName = resolveHhaPayCodeName(key, this.payRateCodeRows ?? []);
    await this.referenceCache?.putPayCodeId(key, resolved, {
      hhaPayCodeName: hhaName,
    });
    this.payCodeResolvedCache.set(key, resolved);
    return resolved;
  }

  async resolveContractId(programType: string | undefined): Promise<number | undefined> {
    if (!programType?.trim()) return undefined;

    const staticId = lookupContractId(programType);
    if (staticId) return staticId;

    const cached = await this.referenceCache?.getContractId(programType);
    if (cached) return cached;

    await this.loadContractCache();
    const match = matchByName(programType, this.contractCache ?? []);
    if (match) {
      const id = Number(match.id);
      await this.referenceCache?.putContractId(programType, id);
      return id;
    }

    return undefined;
  }

  async resolveServiceCodeId(
    serviceType: string | undefined,
    contractId?: number,
    programType?: string,
  ): Promise<string | undefined> {
    if (!serviceType?.trim()) return undefined;

    if (contractId) {
      // Excel program aliases (e.g. OT HC Eval → OT) must resolve against the
      // contract by mapped HHA name. Never trust ref#program-service / flat
      // SERVICE_CODE_MAP cache for aliased PS types — those entries were often
      // written from the global static ID map and bypass alias→contract lookup.
      const alias = lookupServiceCodeAlias(serviceType, programType);

      await this.loadServiceCodesForContract(contractId);
      const rows = this.serviceCodeRowsByContract.get(contractId) ?? [];

      // Cache is only a hint: ServiceCodeID must appear on this contract's
      // GetBillingServiceCodes list (same gate as CreatePatientAuthorization).
      if (programType?.trim() && !alias) {
        const cached = await this.referenceCache?.getProgramServiceCodeId(
          programType,
          serviceType,
        );
        if (cached && rows.some((r) => r.id === cached)) {
          return cached;
        }
      }

      const id = resolveServiceCodeIdFromRows({
        serviceType,
        programType,
        rows,
      });
      if (!id) return undefined;

      if (programType?.trim()) {
        await this.referenceCache?.putProgramServiceCodeId(programType, serviceType, id, {
          ...(alias?.hhaServiceCodeName
            ? { hhaServiceName: alias.hhaServiceCodeName }
            : {}),
        });
      }
      // Flat service cache is program-agnostic; do not store aliased resolutions
      // (Americare OT ≠ Extended "OT SOC/ROC OASIS" for the same PS label).
      if (!alias) {
        await this.referenceCache?.putServiceCodeId(serviceType, id);
      }
      return id;
    }

    const key = normalizeRefName(serviceType);

    // Without a contract, static IDs are only safe when no Excel alias exists
    // for this PS code (aliases are program-scoped and need contract rows).
    // Callers that need CreatePatientAuthorization safety (dry-run preview,
    // upsertAuthorization) must pass contractId so membership is confirmed.
    const staticMapping = lookupServiceCode(serviceType);
    if (staticMapping?.hhaCode && !hasServiceCodeAlias(serviceType)) {
      return staticMapping.hhaCode;
    }

    // Flat ref#service cache is also unsafe for aliased PS labels.
    if (!hasServiceCodeAlias(serviceType)) {
      const cached = await this.referenceCache?.getServiceCodeId(serviceType);
      if (cached) return cached;
    }

    await this.loadContractCache();
    for (const contract of this.contractCache ?? []) {
      const cid = Number(contract.id);
      await this.loadServiceCodesForContract(cid);
      const fromHha = this.serviceCodeByName.get(key);
      if (fromHha) {
        if (!hasServiceCodeAlias(serviceType)) {
          await this.referenceCache?.putServiceCodeId(serviceType, fromHha);
        }
        return fromHha;
      }
    }

    return undefined;
  }

  async resolveDisciplineId(serviceType: string | undefined): Promise<string | undefined> {
    await this.loadDisciplineCache();
    const token = extractDisciplineFromServiceType(serviceType);
    if (token) {
      const hhaName = token === 'SLP' ? 'ST' : token;
      const match = matchByName(hhaName, this.disciplineCache ?? []);
      if (match) return match.id;
    }
    const canonicalDiscipline: Record<string, string> = {
      'occupational therapy': 'OT',
      'physical therapy': 'PT',
      'speech therapy': 'ST',
    };
    const mapped = canonicalDiscipline[normalizeRefName(serviceType ?? '')];
    if (mapped) {
      const match = matchByName(mapped, this.disciplineCache ?? []);
      if (match) return match.id;
    }
    return undefined;
  }

  private async loadContractCache(): Promise<void> {
    if (this.contractCache) return;
    const result = await this.soap.getContracts();
    this.contractCache = result.ok ? parseContractsFromXml(result.bodyXml) : [];
  }

  private async loadServiceCodesForContract(
    contractId: number,
    attempt = 0,
  ): Promise<void> {
    if (!Number.isFinite(contractId) || contractId <= 0) return;
    if (this.loadedContractServiceCodes.has(contractId)) return;
    const skilledRows: Array<{ id: string; name: string }> = [];
    const fallbackRows: Array<{ id: string; name: string }> = [];
    for (const scheduleType of ['Skilled', 'Non-Skilled'] as const) {
      const result = await this.soap.getBillingServiceCodes(contractId, scheduleType);
      if (!result.ok) continue;
      for (const row of parseServiceCodesFromXml(result.bodyXml)) {
        this.serviceCodeByName.set(normalizeRefName(row.name), row.id);
        if (scheduleType === 'Skilled') skilledRows.push(row);
        else fallbackRows.push(row);
      }
    }
    const rows = skilledRows.length ? skilledRows : fallbackRows;
    if (!rows.length && attempt < 2) {
      await new Promise((r) => setTimeout(r, 750));
      return this.loadServiceCodesForContract(contractId, attempt + 1);
    }
    this.serviceCodeRowsByContract.set(contractId, rows);
    if (rows.length) {
      this.loadedContractServiceCodes.add(contractId);
    }
  }

  private async loadDisciplineCache(): Promise<void> {
    if (this.disciplineCache) return;
    const result = await this.soap.getDisciplines();
    if (!result.ok) {
      this.disciplineCache = [];
      return;
    }
    const list: Array<{ id: string; name: string }> = [];
    for (const m of result.bodyXml.matchAll(
      /<DisciplineID>(\d+)<\/DisciplineID>\s*<DisciplineName>([^<]*)<\/DisciplineName>/gi,
    )) {
      list.push({ id: m[1], name: m[2].trim() });
    }
    this.disciplineCache = [...new Map(list.map((d) => [d.id, d])).values()];
  }

  private async resolveDischargeReasonId(): Promise<string | undefined> {
    if (this.dischargeReasonId) return this.dischargeReasonId;
    const envId = process.env.HHA_DISCHARGE_REASON_ID?.trim();
    if (envId) {
      this.dischargeReasonId = envId;
      return envId;
    }
    const result = await this.soap.call(
      'GetContractDischargeReason',
      '<Status>Active</Status>',
    );
    if (!result.ok || !result.bodyXml) return undefined;
    const preferred = [...result.bodyXml.matchAll(
      /<ReasonID>(\d+)<\/ReasonID>\s*<Reason>([^<]*)<\/Reason>\s*<ReasonDescription>([^<]*)<\/ReasonDescription>/gi,
    )];
    const pick =
      preferred.find((m) => /self care|independent|termination|case/i.test(m[2] + m[3])) ??
      preferred[0];
    if (pick) {
      this.dischargeReasonId = pick[1];
      return pick[1];
    }
    const fallback = result.bodyXml.match(/<ReasonID>(\d+)<\/ReasonID>/i)?.[1];
    if (fallback) this.dischargeReasonId = fallback;
    return fallback;
  }

  private async ensureContractServiceCodeId(
    serviceType: string,
    contractId: number,
    candidate: string,
    programType?: string,
  ): Promise<string | undefined> {
    await this.loadServiceCodesForContract(contractId);
    const rows = this.serviceCodeRowsByContract.get(contractId) ?? [];
    if (rows.some((r) => r.id === candidate)) return candidate;
    this.loadedContractServiceCodes.delete(contractId);
    this.serviceCodeRowsByContract.delete(contractId);
    const resolved = await this.resolveServiceCodeId(serviceType, contractId, programType);
    if (resolved) return resolved;
    // Never return an unverified candidate — HHA CreatePatientAuthorization
    // would reject it with Invalid ServiceCodeID (ErrorID=-74).
    return undefined;
  }

  /** Match SearchPatientAuthorizations by AuthorizationNumber (optional contract filter). */
  private async findAuthorizationByNumber(
    patientId: string,
    authorizationNumber: string,
    contractId?: string,
  ): Promise<string | undefined> {
    const want = authorizationNumber.trim().toLowerCase();
    if (!want) return undefined;
    const result = await this.soap.call(
      'SearchPatientAuthorizations',
      `<SearchFilters><PatientID>${escape(patientId)}</PatientID></SearchFilters>`,
    );
    if (!result.ok || !result.bodyXml) return undefined;
    const blocks = [
      ...(result.bodyXml.match(/<Authorization>[\s\S]*?<\/Authorization>/gi) ?? []),
      ...(result.bodyXml.match(/<AuthorizationInfo>[\s\S]*?<\/AuthorizationInfo>/gi) ?? []),
    ];
    for (const block of blocks) {
      const number = (
        xmlFirstTag(block, 'AuthorizationNumber') ??
        xmlFirstTag(block, 'AuthNumber') ??
        ''
      )
        .trim()
        .toLowerCase();
      if (number !== want) continue;
      if (contractId) {
        const blockContract =
          xmlFirstTag(block, 'ContractID') ?? block.match(/<Contract>\s*<ID>(\d+)/i)?.[1];
        if (blockContract && String(blockContract) !== String(contractId)) continue;
      }
      const authId = xmlFirstTag(block, 'AuthorizationID') ?? xmlFirstTag(block, 'ID');
      if (authId) return authId;
    }
    return undefined;
  }

  private async loadPayRateCodeRows(): Promise<PayCodeRow[]> {
    if (this.payRateCodeRows) return this.payRateCodeRows;

    let result = await this.soap.getPayRateCodes();
    if (!result.ok && this.reasonLookup) {
      result = await this.reasonLookup.getPayRateCodes();
    }

    const rows = result.ok ? parsePayRateCodesFromXml(result.bodyXml) : [];
    this.payRateCodeRows = rows;
    return rows;
  }

  async getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails> {
    const info = await this.soap.getVisitInfoV2(Number(visitId));
    assertOk(info, 'GetVisitInfoV2');
    const clockIn =
      xmlFirstTag(info.bodyXml, 'EVVStartTime') ??
      xmlFirstTag(info.bodyXml, 'VisitStartTime') ??
      '';
    const clockOut =
      xmlFirstTag(info.bodyXml, 'EVVEndTime') ??
      xmlFirstTag(info.bodyXml, 'VisitEndTime') ??
      '';
    const cmp = compareSessionClock(expected.startTime, expected.endTime, clockIn, clockOut);
    return {
      visitId,
      clockIn: clockIn || undefined,
      clockOut: clockOut || undefined,
      matchesExpected: cmp.matches,
      notes: cmp.matches
        ? undefined
        : `time off: start Δ${cmp.startDiffMin ?? '?'}min end Δ${cmp.endDiffMin ?? '?'}min`,
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

  async listPatientPlacements(
    patientId: string,
    visitDate?: string,
  ): Promise<PatientPlacementSummary[]> {
    const date = hhaDate(visitDate);
    const contracts = await this.soap.getPatientContracts(Number(patientId), date);
    assertOk(contracts, 'GetPatientContracts');
    const xml = contracts.bodyXml ?? '';
    return parsePatientPlacements(xml);
  }

  async dischargePlacement(options: DischargePlacementOptions): Promise<void> {
    const dischargeDate = hhaDate(options.dischargeDate);
    const dischargeToId = resolveDischargeToId();
    const dischargeNote = options.dischargeReason?.trim() || DEFAULT_DISCHARGE_REASON_LABEL;
    const dischargeReasonId = await this.resolveDischargeReasonId();
    const dischargeToXml = dischargeToId
      ? `\n  <DischargeToID>${escape(dischargeToId)}</DischargeToID>`
      : '';
    const dischargeReasonXml = dischargeReasonId
      ? `\n  <DischargeReasonID>${escape(dischargeReasonId)}</DischargeReasonID>`
      : '';
    const result = await this.soap.call(
      'UpdatePatientContract',
      `<PatientContractInfo>
  <PatientID>${escape(options.patientId)}</PatientID>
  <PlacementID>${escape(options.placementId)}</PlacementID>
  <UpdateDischargeDate>true</UpdateDischargeDate>
  <DischargeDate>${escape(dischargeDate)}</DischargeDate>${dischargeToXml}${dischargeReasonXml}
  <DischargeNote>${escape(dischargeNote)}</DischargeNote>
</PatientContractInfo>`,
    );
    assertOk(result, 'UpdatePatientContract');
  }

  async dischargeAllPlacements(options: DischargeAllPlacementsOptions): Promise<void> {
    const placements = activePlacements(
      await this.listPatientPlacements(options.patientId, options.dischargeDate),
    );
    if (!placements.length) {
      throw new Error(`No active HHA placements to discharge for patient ${options.patientId}`);
    }
    for (const placement of placements) {
      await this.dischargePlacement({
        patientId: options.patientId,
        placementId: placement.placementId,
        dischargeDate: options.dischargeDate,
      });
    }
  }

  async dischargeService(update: DischargeServiceUpdate): Promise<void> {
    const patientId = await this.resolvePatientId(update.patientId, update.caseId, {
      firstName: update.firstName,
      lastName: update.lastName,
      dateOfBirth: update.dateOfBirth,
    });
    const active = activePlacements(
      await this.listPatientPlacements(patientId, update.dischargeDate),
    );
    const contractId = await this.resolveContractId(update.programType);
    const resolvedServiceCodeId =
      update.serviceCode && contractId
        ? await this.resolveServiceCodeId(update.serviceCode, contractId)
        : undefined;
    const placementId = resolvePlacementForService({
      serviceCode: update.serviceCode,
      startDate: update.startDate,
      contractId,
      resolvedServiceCodeId,
      active,
    });
    await this.dischargePlacement({
      patientId,
      placementId,
      dischargeDate: update.dischargeDate,
      dischargeReason: update.closedReason,
    });
  }

  async updateClosedCase(update: ClosedCaseUpdate): Promise<void> {
    const patientId = await this.resolvePatientId(update.patientId, update.caseId, {
      firstName: update.firstName,
      lastName: update.lastName,
      dateOfBirth: update.dateOfBirth,
    });
    await this.dischargeAllPlacements({
      patientId,
      dischargeDate: update.closedDate,
    });
  }

  /**
   * Resolve HHA PatientID for discharge/close (and any write that needs contracts).
   * Uses isTrustedHhaPatientId + findPatient (MR / admission / zero-strip / name+DOB).
   * Never treat ProviderSoft Program Id as HHA PatientID — that causes ErrorID=-56.
   */
  private async resolvePatientId(
    patientId: string | undefined,
    caseId: string | undefined,
    lookup?: { firstName?: string; lastName?: string; dateOfBirth?: string },
  ): Promise<string> {
    if (isTrustedHhaPatientId(patientId, caseId)) return patientId!.trim();

    const found = await this.findPatient(
      toFindPatientOptions({
        caseId,
        patientExternalId: caseId,
        firstName: lookup?.firstName,
        lastName: lookup?.lastName,
        dateOfBirth: lookup?.dateOfBirth,
      }),
    );
    if (!found) {
      throw new Error(
        `HHA patient not found for caseId="${caseId ?? '(missing)'}" — cannot discharge safely`,
      );
    }
    return found;
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

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Normalize PS/HHA DOB strings to YYYY-MM-DD for equality checks. */
function normalizeDobKey(d: string | undefined): string | undefined {
  if (!d?.trim()) return undefined;
  const iso = psDateToIso(d.trim());
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1];
}

/**
 * Prefer a unique DOB match when PS DOB is present; otherwise require a unique exact-name hit.
 * Multiple remaining candidates → undefined (never guess among duplicates).
 */
function pickUniqueNameMatch(
  matches: Array<{ patientId: string; dobKey: string | undefined }>,
  wantDob: string | undefined,
): string | undefined {
  if (matches.length === 0) return undefined;
  if (wantDob) {
    const dobHits = matches.filter((m) => m.dobKey === wantDob);
    if (dobHits.length === 1) return dobHits[0]!.patientId;
    if (dobHits.length > 1) return undefined;
  }
  if (matches.length === 1) return matches[0]!.patientId;
  return undefined;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickMobilityStatusId(xml: string): number | undefined {
  for (const block of xml.match(/<MobilityStatus[^>]*>[\s\S]*?<\/MobilityStatus>/gi) ?? []) {
    const id = Number(
      block.match(/<MobilityStatusID>(\d+)<\/MobilityStatusID>/i)?.[1] ??
        block.match(/<ID>(\d+)<\/ID>/i)?.[1],
    );
    if (id) return id;
  }
  return undefined;
}

function hhaDate(d?: string): string {
  return (psDateToIso(d) ?? d ?? new Date().toISOString()).slice(0, 10);
}

function pickEvacuationZoneId(xml: string): number | undefined {
  for (const block of xml.match(/<EvacuationZone[^>]*>[\s\S]*?<\/EvacuationZone>/gi) ?? []) {
    const name = block.match(/<Name>([^<]*)<\/Name>/i)?.[1]?.trim().toLowerCase();
    const id = Number(block.match(/<ID>(\d+)<\/ID>/i)?.[1]);
    if (id && name === 'none') return id;
  }
  for (const block of xml.match(/<EvacuationZone[^>]*>[\s\S]*?<\/EvacuationZone>/gi) ?? []) {
    const id = Number(block.match(/<ID>(\d+)<\/ID>/i)?.[1]);
    if (id > 10000) return id;
  }
  return undefined;
}
