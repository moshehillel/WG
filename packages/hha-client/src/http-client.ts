import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';
import type { ClosedCaseUpdate, HhaClient, UpsertResult } from './types.js';
import type {
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
} from './types.js';

export interface HttpHhaClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin REST client scaffold. Paths/payloads will be aligned once API docs arrive.
 */
export class HttpHhaClient implements HhaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpHhaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HHA API ${method} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  findPatient(options: {
    externalId?: string;
    caseId?: string;
  }): Promise<string | undefined> {
    return this.request('POST', '/patients/find', options);
  }

  upsertPatient(patient: HhaPatient): Promise<UpsertResult> {
    return this.request('POST', '/patients/upsert', patient);
  }

  upsertContract(contract: HhaContract): Promise<UpsertResult> {
    return this.request('POST', '/contracts/upsert', contract);
  }

  upsertAuthorization(auth: HhaAuthorization): Promise<UpsertResult> {
    return this.request('POST', '/authorizations/upsert', auth);
  }

  locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult> {
    return this.request('POST', '/visits/locate-or-schedule', visit);
  }

  findPendingCall(options: {
    patientId: string;
    caregiverId?: string;
    visitDate: string;
    officeId?: number;
  }): Promise<import('./types.js').PendingCall | undefined> {
    return this.request('POST', '/calls/pending', options);
  }

  linkClockToVisit(
    visitId: string,
    options: { callerId: string; startTime?: string; endTime?: string },
  ): Promise<void> {
    return this.request('POST', `/visits/${encodeURIComponent(visitId)}/link-clock`, options);
  }

  resolveCaregiverId(providerName: string | undefined): Promise<string | undefined> {
    return this.request('POST', '/caregivers/resolve', { providerName });
  }

  resolvePayCodeId(payCodeName: string): Promise<string | undefined> {
    return this.request('POST', '/pay-codes/resolve', { payCodeName });
  }

  resolveContractId(programType: string | undefined): Promise<number | undefined> {
    return this.request('POST', '/contracts/resolve', { programType });
  }

  resolveServiceCodeId(
    serviceType: string | undefined,
    contractId?: number,
  ): Promise<string | undefined> {
    return this.request('POST', '/service-codes/resolve', { serviceType, contractId });
  }

  getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails> {
    return this.request('POST', `/visits/${encodeURIComponent(visitId)}/clocking`, {
      expected,
    });
  }

  async approveVisit(visitId: string): Promise<void> {
    await this.request('POST', `/visits/${encodeURIComponent(visitId)}/approve`);
  }

  async updateClosedCase(update: ClosedCaseUpdate): Promise<void> {
    await this.request('POST', '/cases/close', update);
  }

  async dischargeService(update: DischargeServiceUpdate): Promise<void> {
    await this.request('POST', '/services/discharge', update);
  }

  async dischargePlacement(options: DischargePlacementOptions): Promise<void> {
    await this.request('POST', '/placements/discharge', options);
  }

  async dischargeAllPlacements(options: DischargeAllPlacementsOptions): Promise<void> {
    await this.request('POST', '/placements/discharge-all', options);
  }

  listPatientPlacements(
    patientId: string,
    visitDate?: string,
  ): Promise<import('./types.js').PatientPlacementSummary[]> {
    return this.request('POST', '/placements/list', { patientId, visitDate });
  }

  validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }> {
    return this.request('POST', '/transfers/validate', { externalRefs });
  }
}
