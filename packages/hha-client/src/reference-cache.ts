/** Persisted HHA reference IDs discovered at runtime (after static config miss). */
export interface HhaReferenceCache {
  getContractId(programType: string): Promise<number | undefined>;
  putContractId(programType: string, contractId: number): Promise<void>;
  getServiceCodeId(serviceType: string): Promise<string | undefined>;
  putServiceCodeId(serviceType: string, hhaCodeId: string): Promise<void>;
}

export class InMemoryHhaReferenceCache implements HhaReferenceCache {
  private readonly contracts = new Map<string, number>();
  private readonly services = new Map<string, string>();

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
}

function normalizeRefKey(value: string): string {
  return value.trim().toLowerCase();
}
