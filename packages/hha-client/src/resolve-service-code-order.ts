/**
 * Pure lookup order for service codes on a contract (unit-testable).
 * Order: program alias (mapped HHA name/ID) → flat static ID map → case-insensitive PS/HHA name.
 */
import {
  lookupServiceCode,
  lookupServiceCodeAlias,
  normalizeMappingKey,
} from '@white-glove/shared';

export interface ContractServiceCodeRow {
  id: string;
  name: string;
}

/** Billing name compare: ignore spaces/dashes/punctuation (sheet vs HHA often differ). */
function billingNameKey(value: string | undefined): string {
  return normalizeMappingKey(value).replace(/[^A-Z0-9]/g, '');
}

/** All contract billing IDs that match the PS service type (alias name / static / exact). */
export function resolveServiceCodeIdsFromRows(options: {
  serviceType: string;
  programType?: string;
  rows: readonly ContractServiceCodeRow[];
}): string[] {
  const { serviceType, programType, rows } = options;
  if (!serviceType.trim()) return [];

  const alias = lookupServiceCodeAlias(serviceType, programType);
  if (alias) {
    if (alias.hhaCode && rows.some((r) => r.id === alias.hhaCode)) {
      return [alias.hhaCode];
    }
    const mappedKey = billingNameKey(alias.hhaServiceCodeName);
    // One HHA billing name can appear under multiple ServiceCodeIDs on a contract.
    const byMappedName = rows.filter((r) => billingNameKey(r.name) === mappedKey).map((r) => r.id);
    return byMappedName;
  }

  const staticMapping = lookupServiceCode(serviceType);
  if (staticMapping?.hhaCode && rows.some((r) => r.id === staticMapping.hhaCode)) {
    return [staticMapping.hhaCode];
  }

  const typeKey = billingNameKey(serviceType);
  return rows.filter((r) => billingNameKey(r.name) === typeKey).map((r) => r.id);
}

export function resolveServiceCodeIdFromRows(options: {
  serviceType: string;
  programType?: string;
  rows: readonly ContractServiceCodeRow[];
}): string | undefined {
  return resolveServiceCodeIdsFromRows(options)[0];
}
