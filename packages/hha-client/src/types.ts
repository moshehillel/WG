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

export interface HhaClient {
  upsertPatient(patient: HhaPatient): Promise<UpsertResult>;
  upsertContract(contract: HhaContract): Promise<UpsertResult>;
  upsertAuthorization(auth: HhaAuthorization): Promise<UpsertResult>;
  locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult>;
  getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails>;
  approveVisit(visitId: string): Promise<void>;
  updateClosedCase(update: ClosedCaseUpdate): Promise<void>;
  validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }>;
}
