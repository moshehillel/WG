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
  patientId?: string;
  status?: string;
  closedDate?: string;
  closedReason?: string;
}

/** Discharge one service line on an active case (discharge service report). */
export interface DischargeServiceUpdate {
  caseId: string;
  patientId?: string;
  /** ProviderSoft Service Type — matched to HHA service code on active placements. */
  serviceCode?: string;
  /** ProviderSoft Service Begin Date — matched to placement start date. */
  startDate?: string;
  /** ProviderSoft Program Type — resolved to HHA contract id for disambiguation. */
  programType?: string;
  dischargeDate?: string;
  closedReason?: string;
}

export interface DischargePlacementOptions {
  patientId: string;
  placementId: string;
  dischargeDate?: string;
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

export interface HhaClient {
  findPatient(options: { externalId?: string; caseId?: string }): Promise<string | undefined>;
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
  /** Live HHA lookup by Service Type name (static config fallback). */
  resolveServiceCodeId(
    serviceType: string | undefined,
    contractId?: number,
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
