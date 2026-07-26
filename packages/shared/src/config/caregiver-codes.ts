/**
 * ProviderSoft "caregiver codes" report: Provider Name → HHA Caregiver Code (e.g. WGC-35595).
 * Refresh by downloading the PS report; fall back to saved CSV if a row is missing.
 */

export interface CaregiverCodeEntry {
  providerName: string;
  caregiverCode: string;
}

export function normalizeProviderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Parse PS caregiver codes CSV (columns: Provider Name, Caregiver Code). */
export function parseCaregiverCodesCsv(content: string): CaregiverCodeEntry[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0]!.toLowerCase();
  const nameIdx = header.includes('provider') ? 0 : 0;
  const codeIdx = header.includes('caregiver') ? 1 : 1;

  const entries: CaregiverCodeEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const providerName = (cols[nameIdx] ?? '').trim();
    const caregiverCode = (cols[codeIdx] ?? '').trim();
    if (providerName && caregiverCode) {
      entries.push({ providerName, caregiverCode });
    }
  }
  return entries;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function buildCaregiverCodeMap(entries: CaregiverCodeEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    map.set(normalizeProviderName(e.providerName), e.caregiverCode.trim());
  }
  return map;
}

export function lookupCaregiverCode(
  map: Map<string, string>,
  providerName: string | undefined,
): string | undefined {
  if (!providerName?.trim()) return undefined;
  const key = normalizeProviderName(providerName);
  const direct = map.get(key);
  if (direct) return direct;

  // Loose match: ignore trailing/leading space differences already normalized; try contains.
  for (const [k, code] of map) {
    if (k === key || k.replace(/\s/g, '') === key.replace(/\s/g, '')) return code;
  }
  return undefined;
}
