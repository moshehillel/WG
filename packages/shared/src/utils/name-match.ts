/**
 * Normalize ProviderSoft / HHA names for lookup (case, spacing, punctuation).
 * Coordinators should not need to match capitalization exactly — the bot handles it.
 */
export function normalizeLookupName(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[''`]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact uppercase key for service/contract name matching (OT $70 → OT70). */
export function normalizeMappingKey(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Sorted token key — matches "BOYCE TRUDY" with "TRUDY BOYCE" after uppercasing. */
export function providerNameMatchKeys(name: string | undefined): string[] {
  // Strip commas/punctuation so "Vasaturo, James" matches "VASATURO JAMES".
  const raw = normalizeLookupName(name).toUpperCase();
  if (!raw) return [];
  const tokens = raw.split(' ').filter(Boolean);
  const joined = tokens.join(' ');
  const keys = new Set<string>([joined]);
  if (tokens.length > 1) {
    keys.add([...tokens].sort().join(' '));
  }
  return [...keys];
}

export function namesMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeLookupName(a);
  const nb = normalizeLookupName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}
