import type { MemoryStore } from './memory-store.js';
import type { District, School } from './types.js';
import { normalizeProgramTypeKey } from './week-school.js';

/** Strip common UFSD / district suffixes for fuzzy name matching. */
export function normalizeDistrictNameKey(name: string | undefined | null): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\b(union\s+free\s+school\s+district|school\s+district|cufsd|ufsd|district)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findDistrictByName(
  store: MemoryStore,
  name: string | undefined | null,
): District | undefined {
  const raw = String(name || '').trim();
  if (!raw) return undefined;
  const want = normalizeProgramTypeKey(raw);
  const wantKey = normalizeDistrictNameKey(raw);
  const districts = store.data.districts || [];
  const exact = districts.find((d) => normalizeProgramTypeKey(d.name) === want);
  if (exact) return exact;
  if (!wantKey) return undefined;
  return districts.find((d) => normalizeDistrictNameKey(d.name) === wantKey);
}

/**
 * Resolve timesheet signer: school signer wins; else district entity matched by
 * school.district and/or programType (caseload UFSD label).
 */
export function resolveSchoolOrDistrictSigner(
  store: MemoryStore,
  school: Pick<School, 'district' | 'signerName' | 'signerEmail'> | undefined | null,
  programType?: string | null,
): {
  signerName: string;
  signerEmail: string;
  source: 'school' | 'district' | 'none';
} {
  const schoolEmail = String(school?.signerEmail || '').trim();
  if (schoolEmail) {
    return {
      signerName: String(school?.signerName || '').trim(),
      signerEmail: schoolEmail,
      source: 'school',
    };
  }
  const labels = [
    String(school?.district || '').trim(),
    String(programType || '').trim(),
  ].filter(Boolean);
  for (const label of labels) {
    const district = findDistrictByName(store, label);
    const email = String(district?.signerEmail || '').trim();
    if (email) {
      return {
        signerName: String(district?.signerName || '').trim(),
        signerEmail: email,
        source: 'district',
      };
    }
  }
  return { signerName: '', signerEmail: '', source: 'none' };
}

/** Schools whose district field matches this district name (fuzzy). */
export function schoolsForDistrict(store: MemoryStore, districtName: string): School[] {
  const key = normalizeDistrictNameKey(districtName);
  const exact = normalizeProgramTypeKey(districtName);
  if (!key && !exact) return [];
  return (store.data.schools || []).filter((s) => {
    const d = String(s.district || '').trim();
    if (!d) return false;
    return normalizeProgramTypeKey(d) === exact || normalizeDistrictNameKey(d) === key;
  });
}

/**
 * Distinct district labels from school.district + student.programType,
 * merged with saved District entities (signer wins from entity when present).
 */
export function listDistrictDirectory(store: MemoryStore): Array<{
  id: string;
  name: string;
  signerName: string;
  signerEmail: string;
  schoolCount: number;
  schools: Array<{
    id: string;
    name: string;
    signerName: string;
    signerEmail: string;
  }>;
  persisted: boolean;
}> {
  const byKey = new Map<
    string,
    {
      id: string;
      name: string;
      signerName: string;
      signerEmail: string;
      persisted: boolean;
    }
  >();
  for (const d of store.data.districts || []) {
    const name = String(d.name || '').trim();
    if (!name) continue;
    const key = normalizeDistrictNameKey(name) || normalizeProgramTypeKey(name);
    if (!key) continue;
    byKey.set(key, {
      id: d.id,
      name,
      signerName: String(d.signerName || '').trim(),
      signerEmail: String(d.signerEmail || '').trim(),
      persisted: true,
    });
  }
  const ensureLabel = (raw: string | undefined | null) => {
    const name = String(raw || '').trim();
    if (!name) return;
    const key = normalizeDistrictNameKey(name) || normalizeProgramTypeKey(name);
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      // Prefer longer / UFSD-style label when deriving.
      if (name.length > existing.name.length) existing.name = name;
      return;
    }
    byKey.set(key, {
      id: `derived:${key}`,
      name,
      signerName: '',
      signerEmail: '',
      persisted: false,
    });
  };
  for (const s of store.data.schools || []) {
    ensureLabel(s.district);
  }
  for (const st of store.data.students || []) {
    ensureLabel(st.programType);
  }
  return [...byKey.values()]
    .map((row) => {
      const schools = schoolsForDistrict(store, row.name).map((s) => ({
        id: s.id,
        name: s.name,
        signerName: String(s.signerName || '').trim(),
        signerEmail: String(s.signerEmail || '').trim(),
      }));
      // Also count schools linked only via student.programType when school.district blank.
      const ptKey = normalizeDistrictNameKey(row.name) || normalizeProgramTypeKey(row.name);
      const schoolIds = new Set(schools.map((s) => s.id));
      for (const st of store.data.students || []) {
        const pt = String(st.programType || '').trim();
        if (!pt) continue;
        const stKey = normalizeDistrictNameKey(pt) || normalizeProgramTypeKey(pt);
        if (stKey !== ptKey) continue;
        const sid = String(st.schoolId || '').trim();
        if (!sid || schoolIds.has(sid)) continue;
        const school = store.data.schools.find((s) => s.id === sid);
        if (!school) continue;
        schoolIds.add(sid);
        schools.push({
          id: school.id,
          name: school.name,
          signerName: String(school.signerName || '').trim(),
          signerEmail: String(school.signerEmail || '').trim(),
        });
      }
      schools.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return {
        ...row,
        schoolCount: schools.length,
        schools,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Decode a path/id segment that may still be percent-encoded (`derived%3Acarle%20place`). */
export function decodeDistrictPathId(raw: string | undefined | null): string {
  let s = String(raw || '').trim().replace(/\+/g, ' ');
  if (!s) return '';
  // API Gateway sometimes leaves the segment encoded, or encodes it twice.
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9a-f]{2}/i.test(s)) break;
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s.trim();
}

/**
 * Find a directory row by real id, derived id (`derived:carle place`),
 * encoded path segment, or district name / normalized key.
 */
export function findDistrictDirectoryRow(
  store: MemoryStore,
  idOrName: string | undefined | null,
): ReturnType<typeof listDistrictDirectory>[number] | undefined {
  const raw = String(idOrName || '').trim();
  if (!raw) return undefined;
  const decoded = decodeDistrictPathId(raw);
  const directory = listDistrictDirectory(store);
  const byId = directory.find((d) => d.id === decoded) || directory.find((d) => d.id === raw);
  if (byId) return byId;
  const derivedKey = decoded.startsWith('derived:')
    ? decoded.slice('derived:'.length).trim()
    : raw.startsWith('derived:')
      ? decodeDistrictPathId(raw.slice('derived:'.length)).trim()
      : '';
  const wantKey =
    normalizeDistrictNameKey(derivedKey || decoded) ||
    normalizeProgramTypeKey(derivedKey || decoded);
  if (wantKey) {
    const byKey = directory.find((d) => {
      const k = normalizeDistrictNameKey(d.name) || normalizeProgramTypeKey(d.name);
      // Compare to the requested key. `derived:${k}` is true for every derived
      // row and would return the first caseload district for any lookup.
      return k === wantKey || d.id === `derived:${wantKey}`;
    });
    if (byKey) return byKey;
  }
  const wantName = (derivedKey || decoded).toLowerCase();
  return directory.find((d) => d.name.toLowerCase() === wantName);
}
