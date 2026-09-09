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

/**
 * Strip therapy discipline suffixes that ProviderSoft embeds in provider names
 * (e.g. "Patel PT*", "NEELAMBEN Patel PT*") before HHA SearchCaregivers / match.
 */
const PROVIDER_DISCIPLINE_TOKENS = new Set([
  'PT',
  'OT',
  'SLP',
  'ST',
  'COTA',
  'PTA',
  'DPT',
]);

export function stripProviderDisciplineSuffixes(name: string | undefined): string {
  return (name ?? '')
    .trim()
    .replace(/[*]+/g, ' ')
    .replace(/[,.;:/\\|]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !PROVIDER_DISCIPLINE_TOKENS.has(tok.replace(/\*+$/g, '').toUpperCase()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact uppercase key for service/contract name matching (OT $70 → OT70). */
export function normalizeMappingKey(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Sorted token key — matches "BOYCE TRUDY" with "TRUDY BOYCE" after uppercasing. */
export function providerNameMatchKeys(name: string | undefined): string[] {
  // Strip commas/punctuation + discipline suffixes so "Patel PT*, Neelamben" matches "NEELAMBEN PATEL".
  const raw = normalizeLookupName(stripProviderDisciplineSuffixes(name)).toUpperCase();
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
