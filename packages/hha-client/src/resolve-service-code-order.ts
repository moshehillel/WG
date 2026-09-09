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

export function resolveServiceCodeIdFromRows(options: {
  serviceType: string;
  programType?: string;
  rows: readonly ContractServiceCodeRow[];
}): string | undefined {
  const { serviceType, programType, rows } = options;
  if (!serviceType.trim()) return undefined;

  const alias = lookupServiceCodeAlias(serviceType, programType);
  if (alias) {
    if (alias.hhaCode && rows.some((r) => r.id === alias.hhaCode)) {
      return alias.hhaCode;
    }
    const mappedKey = billingNameKey(alias.hhaServiceCodeName);
    const byMappedName = rows.find((r) => billingNameKey(r.name) === mappedKey);
    if (byMappedName) return byMappedName.id;
    // Mapped but HHA name not on this contract → fail (do not fall through to PS name).
    return undefined;
  }

  const staticMapping = lookupServiceCode(serviceType);
  if (staticMapping?.hhaCode && rows.some((r) => r.id === staticMapping.hhaCode)) {
    return staticMapping.hhaCode;
  }

  const typeKey = billingNameKey(serviceType);
  const exact = rows.find((r) => billingNameKey(r.name) === typeKey);
  return exact?.id;
}
