/** Persisted HHA reference IDs discovered at runtime (after static config miss). */
import { normalizeMappingKey } from '@white-glove/shared';
export interface HhaReferenceCache {
  getContractId(programType: string): Promise<number | undefined>;
  putContractId(programType: string, contractId: number): Promise<void>;
  getServiceCodeId(serviceType: string): Promise<string | undefined>;
  putServiceCodeId(serviceType: string, hhaCodeId: string): Promise<void>;
  getProgramServiceCodeId(
    programType: string,
    serviceType: string,
  ): Promise<string | undefined>;
  putProgramServiceCodeId(
    programType: string,
    serviceType: string,
    hhaCodeId: string,
    meta?: { hhaServiceName?: string },
  ): Promise<void>;
  /** ProviderSoft-style name e.g. OT70 ΓåÆ HHA PayCodeID. */
  getPayCodeId(psPayCodeName: string): Promise<string | undefined>;
  putPayCodeId(
    psPayCodeName: string,
    payCodeId: string,
    meta?: { hhaPayCodeName?: string },
  ): Promise<void>;
}

export class InMemoryHhaReferenceCache implements HhaReferenceCache {
  private readonly contracts = new Map<string, number>();
  private readonly services = new Map<string, string>();
  private readonly payCodes = new Map<string, string>();
  private readonly programServices = new Map<string, string>();

  async getContractId(programType: string): Promise<number | undefined> {
    return this.contracts.get(normalizeRefKey(programType));
  }

  async putContractId(programType: string, contractId: number): Promise<void> {
    this.contracts.set(normalizeRefKey(programType), contractId);
  }

  async getServiceCodeId(serviceType: string): Promise<string | undefined> {
    return this.services.get(normalizeRefKey(serviceType));
  }

  async putServiceCodeId(serviceType: string, hhaCodeId: string): Promise<void> {
    this.services.set(normalizeRefKey(serviceType), hhaCodeId);
  }

  async getPayCodeId(psPayCodeName: string): Promise<string | undefined> {
    return this.payCodes.get(normalizeRefKey(psPayCodeName));
  }

  async putPayCodeId(
    psPayCodeName: string,
    payCodeId: string,
    _meta?: { hhaPayCodeName?: string },
  ): Promise<void> {
    this.payCodes.set(normalizeRefKey(psPayCodeName), payCodeId);
  }

  async getProgramServiceCodeId(
    programType: string,
    serviceType: string,
  ): Promise<string | undefined> {
    return this.programServices.get(
      `${normalizeMappingKey(programType)}\0${normalizeMappingKey(serviceType)}`,
    );
  }

  async putProgramServiceCodeId(
    programType: string,
    serviceType: string,
    hhaCodeId: string,
    _meta?: { hhaServiceName?: string },
  ): Promise<void> {
    this.programServices.set(
      `${normalizeMappingKey(programType)}\0${normalizeMappingKey(serviceType)}`,
      hhaCodeId,
    );
  }
}

function normalizeRefKey(value: string): string {
  return value.trim().toLowerCase();
}
