import type {
  HhaAuthorization,
  HhaClockingDetails,
  HhaContract,
  HhaPatient,
  HhaVisit,
} from '@white-glove/shared';
import type { ClosedCaseUpdate, HhaClient, UpsertResult } from './types.js';

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

  validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }> {
    return this.request('POST', '/transfers/validate', { externalRefs });
  }
}
