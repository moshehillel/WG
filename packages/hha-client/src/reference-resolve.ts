import { normalizeProgramType } from '@white-glove/shared';

export interface NamedHhaRef {
  id: string;
  name: string;
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
  for (const m of xml.matchAll(
    /<ServiceCodeID>(\d+)<\/ServiceCodeID>\s*<ServiceCodeName>([^<]*)<\/ServiceCodeName>/gi,
  )) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  for (const m of xml.matchAll(/<ServiceCode>\s*<ID>(\d+)<\/ID>\s*<Name>([^<]*)<\/Name>/gi)) {
    list.push({ id: m[1]!, name: m[2]!.trim() });
  }
  return [...new Map(list.map((s) => [s.id, s])).values()];
}
