import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';

export interface UpsertResult {
  id: string;
  created: boolean;
}

export interface ClosedCaseUpdate {
  caseId: string;
  /**
   * Real HHA PatientID only. Do not pass ProviderSoft Program Id here —
   * numeric Program Ids look like HHA ids and cause GetPatientContracts ErrorID=-56.
   */
  patientId?: string;
  status?: string;
  closedDate?: string;
  closedReason?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

/** Discharge one service line on an active case (discharge service report). */
export interface DischargeServiceUpdate {
  caseId: string;
  /**
   * Real HHA PatientID only. Do not pass ProviderSoft Program Id here —
   * numeric Program Ids look like HHA ids and cause GetPatientContracts ErrorID=-56.
   */
  patientId?: string;
  /** ProviderSoft Service Type — matched to HHA service code on active placements. */
  serviceCode?: string;
  /** ProviderSoft Service Begin Date — matched to placement start date. */
  startDate?: string;
  /** ProviderSoft Program Type — resolved to HHA contract id for disambiguation. */
  programType?: string;
  dischargeDate?: string;
  closedReason?: string;
  /** For findPatient name+DOB fallback when MR/admission miss. */
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

export interface DischargePlacementOptions {
  patientId: string;
  placementId: string;
  dischargeDate?: string;
  dischargeReason?: string;
}

export interface DischargeAllPlacementsOptions {
  patientId: string;
  dischargeDate?: string;
}

export interface PatientPlacementSummary {
  placementId: string;
  contractId?: string;
  serviceCodeId?: string;
  startDate?: string;
  dischargeDate?: string;
}

export interface PendingCall {
  callDashboardId: string;
  callTime?: string;
}

/** Lookup keys for `findPatient` (MR / admission first; optional name fallback). */
export interface FindPatientOptions {
  externalId?: string;
  caseId?: string;
  /** Exact first name for SearchPatients fallback after ID/MR miss. */
  firstName?: string;
  /** Exact last name for SearchPatients fallback after ID/MR miss. */
  lastName?: string;
  /** Prefer unique exact-name+DOB when disambiguating name hits. */
  dateOfBirth?: string;
}

/** Subset of GetPatientDemographics used to fill blank ProviderSoft new_services fields. */
export interface PatientDemoFields {
  gender?: string;
  address1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface HhaClient {
  findPatient(options: FindPatientOptions): Promise<string | undefined>;
  /** Gender from GetPatientDemographics when PS row omits it (existing patient / new service). */
  getPatientGender(patientId: string): Promise<string | undefined>;
  /** Address + gender fields from GetPatientDemographics (one SOAP call). */
  getPatientDemographicsFields(patientId: string): Promise<PatientDemoFields>;
  upsertPatient(patient: HhaPatient): Promise<UpsertResult>;
  upsertContract(contract: HhaContract): Promise<UpsertResult>;
  upsertAuthorization(auth: HhaAuthorization): Promise<UpsertResult>;
  locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult>;
  findPendingCall(options: {
    patientId: string;
    caregiverId?: string;
    visitDate: string;
    officeId?: number;
  }): Promise<PendingCall | undefined>;
  linkClockToVisit(
    visitId: string,
    options: { callerId: string; startTime?: string; endTime?: string },
  ): Promise<void>;
  resolveCaregiverId(providerName: string | undefined): Promise<string | undefined>;
  resolvePayCodeId(payCodeName: string): Promise<string | undefined>;
  /** Live HHA lookup by Program Type name (static config fallback). */
  resolveContractId(programType: string | undefined): Promise<number | undefined>;
  /** Live HHA lookup by Service Type name (API Mappings sheet when programType provided). */
  resolveServiceCodeId(
    serviceType: string | undefined,
    contractId?: number,
    programType?: string,
  ): Promise<string | undefined>;
  getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails>;
  approveVisit(visitId: string): Promise<void>;
  /** Gluck closure — discharge every active placement on the patient. */
  updateClosedCase(update: ClosedCaseUpdate): Promise<void>;
  /** Discharge service report — one placement only. */
  dischargeService(update: DischargeServiceUpdate): Promise<void>;
  dischargePlacement(options: DischargePlacementOptions): Promise<void>;
  dischargeAllPlacements(options: DischargeAllPlacementsOptions): Promise<void>;
  listPatientPlacements(
    patientId: string,
    visitDate?: string,
  ): Promise<PatientPlacementSummary[]>;
  validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }>;
}
