import { normalizeProgramType } from '@white-glove/shared';

export interface NamedHhaRef {
  id: string;
  name: string;
  /** Present on GetBillingServiceCodes rows — agency catalog is multi-contract. */
  contractId?: string;
  contractName?: string;
}

/** Normalize PS / HHA names for fuzzy matching (same rules as lookup-reference-data.mjs). */
export function normalizeRefName(value: string | undefined): string {
  return normalizeProgramType(value);
}

export function matchByName(needle: string | undefined, haystack: NamedHhaRef[]): NamedHhaRef | undefined {
  const n = normalizeRefName(needle);
  if (!n) return undefined;
  let hit = haystack.find((x) => normalizeRefName(x.name) === n);
  if (hit) return hit;
  hit = haystack.find((x) => {
    const h = normalizeRefName(x.name);
    return h.includes(n) || n.includes(h);
  });
  return hit;
}

export function parseContractsFromXml(xml: string): NamedHhaRef[] {
  const list: NamedHhaRef[] = [];
  for (const m of xml.matchAll(
    /<ContractInfo>[\s\S]*?<ContractID>(\d+)<\/ContractID>[\s\S]*?<ContractName>([^<]*)<\/ContractName>/gi,
  )) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  for (const m of xml.matchAll(/<Contract>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  for (const m of xml.matchAll(
    /<ContractID>(\d+)<\/ContractID>\s*<ContractName>([^<]*)<\/ContractName>/gi,
  )) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  return [...new Map(list.map((c) => [c.id, c])).values()];
}

export function parseServiceCodesFromXml(xml: string): NamedHhaRef[] {
  const list: NamedHhaRef[] = [];
  // Prefer full <ServiceCode> blocks so ContractID/Name are kept — prod
  // GetBillingServiceCodes returns the agency-wide catalog tagged per contract.
  for (const m of xml.matchAll(/<ServiceCode>([\s\S]*?)<\/ServiceCode>/gi)) {
    const block = m[1] ?? '';
    const id =
      block.match(/<ServiceCodeID>(\d+)<\/ServiceCodeID>/i)?.[1] ??
      block.match(/<ID>(\d+)<\/ID>/i)?.[1];
    const name =
      block.match(/<ServiceCodeName>([^<]*)<\/ServiceCodeName>/i)?.[1]?.trim() ??
      block.match(/<Name>([^<]*)<\/Name>/i)?.[1]?.trim();
    if (!id || !name) continue;
    const contractId = block.match(/<ContractID>(\d+)<\/ContractID>/i)?.[1];
    const contractName = block.match(/<ContractName>([^<]*)<\/ContractName>/i)?.[1]?.trim();
    list.push({
      id,
      name,
      ...(contractId ? { contractId } : {}),
      ...(contractName ? { contractName } : {}),
    });
  }
  if (!list.length) {
    for (const m of xml.matchAll(
      /<ServiceCodeID>(\d+)<\/ServiceCodeID>\s*<ServiceCodeName>([^<]*)<\/ServiceCodeName>/gi,
    )) {
      list.push({ id: m[1]!, name: m[2]!.trim() });
    }
    for (const m of xml.matchAll(/<ServiceCode>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
      list.push({ id: m[1]!, name: m[2]!.trim() });
    }
  }
  return [...new Map(list.map((s) => [s.id, s])).values()];
}

/**
 * GetBillingServiceCodes is agency-wide: many contracts expose a billing name "PT"
 * with different ServiceCodeIDs. CreatePatientAuthorization only accepts the ID
 * linked to *this* ContractID (e.g. Americare PT = 313582, not decoy 232853).
 */
export function filterServiceCodesForContract(
  rows: readonly NamedHhaRef[],
  contractId: number,
): NamedHhaRef[] {
  if (!Number.isFinite(contractId) || contractId <= 0) return [...rows];
  const want = String(contractId);
  const scoped = rows.filter((r) => r.contractId === want);
  // Older/sandbox payloads may omit ContractID — keep unfiltered then.
  return scoped.length ? scoped : [...rows];
}
