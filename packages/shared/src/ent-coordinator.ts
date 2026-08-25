/** Strip one layer of surrounding single/double quotes (bad secret / .env values). */
export function stripWrappingQuotes(raw: string | undefined): string {
  const v = String(raw ?? '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** Comma-separated numeric IDs → GraphQL CoordinatorId string e.g. "68033,67321" */
export function parseCoordinatorIds(raw: string | undefined): string {
  const src = stripWrappingQuotes(raw)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(src)].join(',');
}

/** Comma-separated display names aligned with coordinator IDs (optional). */
export function parseCoordinatorNames(raw: string | undefined): string[] {
  const cleaned = stripWrappingQuotes(raw);
  if (!cleaned) return [];
  return cleaned
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize HHA coordinator labels for fuzzy name match (drop extension suffix). */
export function normalizeCoordinatorLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*ext\.?\s*\d+/gi, '')
    .replace(/\s*ex\.?\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CoordinatorListEntry {
  text: string;
  value: number | string;
}

export interface CoordinatorNameMatch {
  id: string;
  name: string;
}

/** Match configured coordinator names against patient.app servicecoordinators list. */
export function matchCoordinatorsByNames(
  names: string[],
  list: CoordinatorListEntry[],
): { matched: CoordinatorNameMatch[]; unmatched: string[] } {
  const matched: CoordinatorNameMatch[] = [];
  const unmatched: string[] = [];

  for (const rawName of names) {
    const target = normalizeCoordinatorLabel(rawName);
    if (!target) continue;

    const hits = list.filter((entry) => {
      const label = normalizeCoordinatorLabel(entry.text);
      return label === target || label.includes(target) || target.includes(label);
    });

    if (hits.length === 0) {
      unmatched.push(rawName);
      continue;
    }

    const pick = [...hits].sort(
      (a, b) => Number(a.value) - Number(b.value),
    )[0]!;
    matched.push({ id: String(pick.value), name: pick.text });
  }

  return { matched, unmatched };
}

/** Merge explicit IDs with name-resolved IDs (deduped, stable order). */
export function mergeCoordinatorIds(explicitIds: string, resolvedIds: string[]): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of [...explicitIds.split(','), ...resolvedIds]) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged.join(',');
}

/** Comma-separated office IDs for GraphQL OfficeId (no wrapping quotes). */
export function parseOfficeIds(raw: string | undefined, fallback = ''): string {
  const cleaned = stripWrappingQuotes(raw);
  if (!cleaned) return fallback;
  return cleaned
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}
