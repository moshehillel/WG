import { parsePayCodesFromXml, parsePayRateCodesFromXml } from './hha-xml-parse.js';

export type PayCodeRow = { id: string; name: string };

export function normalizePsPayCodeName(name: string): string {
  return name.trim().toUpperCase();
}

/** Merge agency PayRateCode rows with optional per-caregiver PayCode rows. */
export function mergePayCodeRows(...groups: PayCodeRow[][]): PayCodeRow[] {
  const map = new Map<string, PayCodeRow>();
  for (const group of groups) {
    for (const row of group) {
      map.set(row.id, row);
    }
  }
  return [...map.values()];
}

export function parsePayCodeReferenceXml(xml: string): PayCodeRow[] {
  return mergePayCodeRows(parsePayRateCodesFromXml(xml), parsePayCodesFromXml(xml));
}

function matchRateOnPrefix(
  hhaRows: PayCodeRow[],
  prefixes: string[],
  rateNum: number,
): string | undefined {
  for (const row of hhaRows) {
    const n = row.name.toUpperCase();
    if (!prefixes.some((p) => n.startsWith(p))) continue;
    const rm = n.match(/\$(\d+(?:\.\d+)?)/);
    if (rm && Math.abs(Number(rm[1]) - rateNum) < 0.01) return row.id;
  }
  return undefined;
}

/**
 * Resolve pay code name (OT $70, OT Group $34, or legacy OT70) to HHA PayCodeID.
 * HHA names use formats like "OT $70" / "OT Group $34"; SLP in PS maps to ST in HHA.
 */
export function resolvePayCodeIdFromCatalog(
  psPayCodeName: string,
  hhaRows: PayCodeRow[],
): string | undefined {
  const key = normalizePsPayCodeName(psPayCodeName);
  if (!key) return undefined;

  const byExact = new Map<string, string>();
  const byNorm = new Map<string, string>();
  for (const row of hhaRows) {
    byExact.set(row.name.trim().toUpperCase(), row.id);
    byNorm.set(row.name.replace(/\s+/g, '').toUpperCase(), row.id);
  }

  if (byExact.has(key)) return byExact.get(key);
  if (byNorm.has(key.replace(/\s+/g, ''))) return byNorm.get(key.replace(/\s+/g, ''));

  const groupM = key.match(/^([A-Z]{2,4})\s+GROUP\s+\$?\s*(\d+(?:\.\d+)?)$/);
  if (groupM) {
    const disc = groupM[1]!;
    const rate = groupM[2]!;
    const stDisc = disc === 'SLP' ? 'ST' : disc;
    const rateNum = Number(rate);
    for (const cand of [
      `${stDisc} GROUP $${rate}`,
      `${disc} GROUP $${rate}`,
      `${stDisc} Group $${rate}`,
      `${disc} Group $${rate}`,
    ]) {
      const hit = byExact.get(cand.toUpperCase());
      if (hit) return hit;
    }
    return matchRateOnPrefix(
      hhaRows,
      [`${stDisc} GROUP $`, `${disc} GROUP $`],
      rateNum,
    );
  }

  const dollarM = key.match(/^([A-Z]{2,4})\s+\$(\d+(?:\.\d+)?)$/);
  if (dollarM) {
    const disc = dollarM[1]!;
    const rate = dollarM[2]!;
    const stDisc = disc === 'SLP' ? 'ST' : disc;
    const rateNum = Number(rate);
    for (const cand of [`${stDisc} $${rate}`, `${disc} $${rate}`]) {
      const hit = byExact.get(cand.toUpperCase());
      if (hit) return hit;
    }
    return matchRateOnPrefix(hhaRows, [`${stDisc} $`, `${disc} $`], rateNum);
  }

  const m = key.match(/^([A-Z]{2,4})(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;

  const disc = m[1]!;
  const rate = m[2]!;
  const stDisc = disc === 'SLP' ? 'ST' : disc;
  const rateNum = Number(rate);

  for (const cand of [`${stDisc} $${rate}`, `${disc} $${rate}`]) {
    const hit = byExact.get(cand.toUpperCase());
    if (hit) return hit;
  }

  // Dollar-sign rows: exact rate only (OT70 must not match OT $70.50).
  const dollarHit = matchRateOnPrefix(hhaRows, [`${stDisc} $`, `${disc} $`], rateNum);
  if (dollarHit) return dollarHit;

  // Bare format without "$", e.g. "PT 65".
  for (const row of hhaRows) {
    const bare = row.name.toUpperCase().match(/^([A-Z]{2,4})\s+(\d+(?:\.\d+)?)/);
    if (!bare || (bare[1] !== stDisc && bare[1] !== disc)) continue;
    if (Math.abs(Number(bare[2]) - rateNum) < 0.01) return row.id;
  }

  return undefined;
}

export function resolveHhaPayCodeName(
  psPayCodeName: string,
  hhaRows: PayCodeRow[],
): string | undefined {
  const id = resolvePayCodeIdFromCatalog(psPayCodeName, hhaRows);
  if (!id) return undefined;
  return hhaRows.find((row) => row.id === id)?.name;
}

export {
  pickFirstPayCodeForDiscipline,
  type FallbackPayCodePick,
} from '@white-glove/shared';

