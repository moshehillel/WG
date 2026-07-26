/**
 * Emit contract-map.ts and service-codes.ts from tmp/hha-lookup-results.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const data = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/hha-lookup-results.json'), 'utf8'));

const contractEntries = Object.entries(data.programContractMap ?? {}).sort(([a], [b]) =>
  a.localeCompare(b),
);

const contractMapTs = `/**
 * Program Type → HHA ContractID (prod GetContracts name match, ${data.lookedUpAt.slice(0, 10)}).
 * Regenerate: node packages/hha-client/scripts/lookup-reference-data.mjs && node packages/hha-client/scripts/generate-hha-config.mjs
 */
import { normalizeProgramType } from './program-types.js';

export const PROGRAM_CONTRACT_MAP: Readonly<Record<string, number>> = {
${contractEntries.map(([k, v]) => `  ${JSON.stringify(k)}: ${v},`).join('\n')}
};

const byNormalized = new Map<string, number>(
  Object.entries(PROGRAM_CONTRACT_MAP).map(([name, id]) => [normalizeProgramType(name), id]),
);

/** Resolve HHA ContractID from ProviderSoft Program Type (exact name match in HHA). */
export function lookupContractId(programType: string | undefined): number | undefined {
  const key = normalizeProgramType(programType);
  if (!key) return undefined;
  return byNormalized.get(key);
}
`;

const serviceEntries = Object.entries(data.serviceTypeMap ?? {}).sort(([a], [b]) =>
  a.localeCompare(b),
);

function defaultTriage(serviceType) {
  const u = serviceType.toUpperCase();
  if (u.includes(' EI') || u.startsWith('EI ') || u.endsWith(' EI')) return 'skip';
  return 'verify_clocking';
}

const serviceCodesTs = `/**
 * Service Type (ProviderSoft API Report) → HHA ServiceCodeID (prod GetBillingServiceCodes, ${data.lookedUpAt.slice(0, 10)}).
 * ${data.stats.serviceTypesMatched}/${data.stats.serviceTypesTotal} sample types matched; unmatched SI/ABA variants may need manual HHA codes.
 * Regenerate: node packages/hha-client/scripts/lookup-reference-data.mjs && node packages/hha-client/scripts/generate-hha-config.mjs
 */
export interface ServiceCodeMapping {
  /** ProviderSoft Service Type name (API Report column). */
  providerSoftCode: string;
  /** HHA ServiceCodeID. */
  hhaCode: string;
  description: string;
  createIfMissing: boolean;
  defaultSessionTriage: 'auto_approve' | 'verify_clocking' | 'skip';
}

export const SERVICE_CODE_MAP: ServiceCodeMapping[] = [
${serviceEntries
  .map(
    ([name, id]) => `  {
    providerSoftCode: ${JSON.stringify(name)},
    hhaCode: ${JSON.stringify(String(id))},
    description: ${JSON.stringify(name)},
    createIfMissing: false,
    defaultSessionTriage: '${defaultTriage(name)}',
  },`,
  )
  .join('\n')}
];

const byName = new Map<string, ServiceCodeMapping>(
  SERVICE_CODE_MAP.map((m) => [m.providerSoftCode.trim().toLowerCase(), m]),
);

export function lookupServiceCode(code: string | undefined): ServiceCodeMapping | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toLowerCase();
  return (
    byName.get(normalized) ??
    SERVICE_CODE_MAP.find(
      (m) =>
        m.providerSoftCode.toUpperCase() === code.trim().toUpperCase() ||
        m.hhaCode === code.trim(),
    )
  );
}

/** Known-unmapped Service Types from prod lookup — rows using these must error until mapped in HHA. */
export const UNMATCHED_SERVICE_TYPES: readonly string[] = ${JSON.stringify(data.unmatchedServiceTypes ?? [], null, 2)};
`;

writeFileSync(path.join(repoRoot, 'packages/shared/src/config/contract-map.ts'), contractMapTs);
writeFileSync(path.join(repoRoot, 'packages/shared/src/config/service-codes.ts'), serviceCodesTs);
console.log('Wrote contract-map.ts (' + contractEntries.length + ' entries)');
console.log('Wrote service-codes.ts (' + serviceEntries.length + ' entries)');
