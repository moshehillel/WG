import { disciplineFromServiceType } from './mandate.js';
import type { MemoryStore } from './memory-store.js';
import { newId, nowIso } from './ids.js';
import type {
  Discipline,
  FrequencyKind,
  Mandate,
  Provider,
  School,
  Student,
} from './types.js';

export interface CaseloadRowError {
  rowNumber: number;
  message: string;
}

export interface CaseloadImportRow {
  rowNumber: number;
  schoolName: string;
  firstName: string;
  lastName: string;
  grade: string;
  decision: string;
  startOn: string;
  endOn: string;
  serviceType: string;
  discipline: Discipline | '';
  ratioGroup: boolean;
  frequencyKind: FrequencyKind;
  sessionsPerPeriod: number;
  periodSchoolDays: number;
  /** Set only for weekly rows; 0 for school_day_cycle. */
  frequencyPerWeek: number;
  location: string;
  providerName: string;
  /** Human display e.g. "1 / week" or "2 / 6 school days". */
  freqDisplay: string;
}

export interface CaseloadParseResult {
  rows: CaseloadImportRow[];
  errors: CaseloadRowError[];
  warnings: CaseloadRowError[];
}

export interface CaseloadPreviewMandate {
  rowNumber: number;
  studentKey: string;
  firstName: string;
  lastName: string;
  schoolName: string;
  grade: string;
  serviceType: string;
  discipline: Discipline | '';
  ratioGroup: boolean;
  freqDisplay: string;
  frequencyKind: FrequencyKind;
  sessionsPerPeriod: number;
  periodSchoolDays: number;
  frequencyPerWeek: number;
  startOn: string;
  endOn: string;
  location: string;
  providerName: string;
  providerId: string;
  providerMatched: boolean;
  studentExists: boolean;
  schoolExists: boolean;
}

export interface CaseloadApplyResult {
  dryRun: boolean;
  rows: CaseloadPreviewMandate[];
  errors: CaseloadRowError[];
  warnings: CaseloadRowError[];
  createdStudents: number;
  updatedStudents: number;
  createdMandates: number;
  updatedMandates: number;
  createdSchools: number;
  students: Student[];
  mandates: Mandate[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  school: ['recommended school', 'school', 'school name'],
  lastName: ['last name', 'lastname', 'student last name'],
  firstName: ['first name', 'firstname', 'student first name'],
  grade: ['grade'],
  decision: ['decision'],
  startOn: ['rs start', 'start', 'start date', 'mandate start'],
  endOn: ['rs end', 'end', 'end date', 'mandate end'],
  service: ['related service', 'service', 'service type'],
  ratio: ['ratio', 'group ratio'],
  freq: ['freq', 'frequency'],
  period: ['period', 'freq period'],
  location: ['location'],
  provider: ['rs provider', 'provider', 'therapist', 'related service provider'],
};

function normHeader(h: string): string {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Quote-aware CSV line split (commas inside quotes preserved). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        q = !q;
      }
    } else if (ch === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function colIndex(headers: string[], aliases: string[]): number {
  const exact = headers.findIndex((h) => aliases.some((a) => h === a));
  if (exact >= 0) return exact;
  return headers.findIndex((h) => aliases.some((a) => h.includes(a)));
}

function cell(cells: string[], idx: number): string {
  if (idx < 0 || idx >= cells.length) return '';
  return String(cells[idx] || '')
    .replace(/^"|"$/g, '')
    .trim();
}

function parseRatioGroup(raw: string): boolean {
  const s = String(raw || '').toLowerCase();
  if (/\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b|\bsmall\s*group\b/.test(s)) return true;
  if (/\bindividual\b|\b1\s*:\s*1\b/.test(s)) return false;
  return false;
}

function parsePeriod(raw: string): { kind: FrequencyKind; periodSchoolDays: number } {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const cycle = s.match(/(\d+)\s*[-\s]?\s*day\s*cycle/) || s.match(/(\d+)\s*school\s*days?/);
  if (cycle || /\bcycle\b/.test(s)) {
    const days = cycle ? Number(cycle[1]) : 6;
    return { kind: 'school_day_cycle', periodSchoolDays: Number.isFinite(days) && days > 0 ? days : 6 };
  }
  return { kind: 'weekly', periodSchoolDays: 0 };
}

function parseFreqNumber(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Normalize MM/DD/YYYY or ISO into YYYY-MM-DD when possible; else keep trimmed raw. */
export function normalizeCaseloadDate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return s;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const mm = String(Number(m[1])).padStart(2, '0');
  const dd = String(Number(m[2])).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function formatFreqDisplay(
  kind: FrequencyKind,
  sessionsPerPeriod: number,
  periodSchoolDays: number,
): string {
  if (kind === 'school_day_cycle') {
    return `${sessionsPerPeriod} / ${periodSchoolDays || 6} school days`;
  }
  return `${sessionsPerPeriod} / week`;
}

export function parseCaseloadCsv(csvText: string): CaseloadParseResult {
  const raw = String(csvText || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const errors: CaseloadRowError[] = [];
  const warnings: CaseloadRowError[] = [];
  const rows: CaseloadImportRow[] = [];

  if (!lines.length) {
    errors.push({ rowNumber: 0, message: 'CSV is empty.' });
    return { rows, errors, warnings };
  }

  const headers = splitCsvLine(lines[0]).map(normHeader);
  const idx = {
    school: colIndex(headers, HEADER_ALIASES.school),
    lastName: colIndex(headers, HEADER_ALIASES.lastName),
    firstName: colIndex(headers, HEADER_ALIASES.firstName),
    grade: colIndex(headers, HEADER_ALIASES.grade),
    decision: colIndex(headers, HEADER_ALIASES.decision),
    startOn: colIndex(headers, HEADER_ALIASES.startOn),
    endOn: colIndex(headers, HEADER_ALIASES.endOn),
    service: colIndex(headers, HEADER_ALIASES.service),
    ratio: colIndex(headers, HEADER_ALIASES.ratio),
    freq: colIndex(headers, HEADER_ALIASES.freq),
    period: colIndex(headers, HEADER_ALIASES.period),
    location: colIndex(headers, HEADER_ALIASES.location),
    provider: colIndex(headers, HEADER_ALIASES.provider),
  };

  if (idx.firstName < 0 || idx.lastName < 0) {
    errors.push({
      rowNumber: 0,
      message: 'Missing required columns: First Name and Last Name.',
    });
    return { rows, errors, warnings };
  }
  if (idx.service < 0) {
    errors.push({ rowNumber: 0, message: 'Missing required column: Related Service.' });
    return { rows, errors, warnings };
  }
  if (idx.freq < 0 || idx.period < 0) {
    errors.push({ rowNumber: 0, message: 'Missing required columns: Freq and Period.' });
    return { rows, errors, warnings };
  }

  for (let i = 1; i < lines.length; i += 1) {
    const rowNumber = i + 1;
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => !String(c || '').trim())) continue;

    const firstName = cell(cells, idx.firstName);
    const lastName = cell(cells, idx.lastName);
    const schoolName = cell(cells, idx.school);
    const grade = cell(cells, idx.grade);
    const decision = cell(cells, idx.decision);
    const serviceType = cell(cells, idx.service);
    const ratioRaw = cell(cells, idx.ratio);
    const freqRaw = cell(cells, idx.freq);
    const periodRaw = cell(cells, idx.period);
    const location = cell(cells, idx.location);
    const providerName = cell(cells, idx.provider);
    const startOn = normalizeCaseloadDate(cell(cells, idx.startOn));
    const endOn = normalizeCaseloadDate(cell(cells, idx.endOn));

    if (!firstName || !lastName) {
      errors.push({ rowNumber, message: 'Missing student first or last name.' });
      continue;
    }
    if (!serviceType) {
      errors.push({ rowNumber, message: 'Missing Related Service.' });
      continue;
    }

    const freqNum = parseFreqNumber(freqRaw);
    if (freqNum == null || freqNum <= 0) {
      errors.push({ rowNumber, message: `Invalid Freq "${freqRaw || ''}".` });
      continue;
    }

    const { kind, periodSchoolDays } = parsePeriod(periodRaw);
    if (!periodRaw) {
      warnings.push({ rowNumber, message: 'Empty Period — defaulting to Weekly.' });
    } else if (kind === 'weekly' && !/week/i.test(periodRaw) && !/\bcycle\b/i.test(periodRaw)) {
      warnings.push({
        rowNumber,
        message: `Unrecognized Period "${periodRaw}" — treating as Weekly.`,
      });
    }

    if (decision && /reject|den(y|ied)|declin/i.test(decision)) {
      warnings.push({
        rowNumber,
        message: `Decision "${decision}" — row still imported; review if needed.`,
      });
    }

    const discipline = disciplineFromServiceType(serviceType);
    if (!discipline) {
      warnings.push({
        rowNumber,
        message: `Could not map Related Service "${serviceType}" to OT/PT/SLP.`,
      });
    }

    const ratioGroup = parseRatioGroup(ratioRaw);
    const frequencyPerWeek = kind === 'weekly' ? freqNum : 0;
    const sessionsPerPeriod = freqNum;
    const days = kind === 'school_day_cycle' ? periodSchoolDays || 6 : 0;

    rows.push({
      rowNumber,
      schoolName,
      firstName,
      lastName,
      grade,
      decision,
      startOn,
      endOn,
      serviceType,
      discipline,
      ratioGroup,
      frequencyKind: kind,
      sessionsPerPeriod,
      periodSchoolDays: days,
      frequencyPerWeek,
      location,
      providerName,
      freqDisplay: formatFreqDisplay(kind, sessionsPerPeriod, days),
    });
  }

  return { rows, errors, warnings };
}

function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findProviderByName(providers: Provider[], rawName: string): Provider | undefined {
  const s = String(rawName || '').trim();
  if (!s) return undefined;
  const lower = normName(s);
  const direct = providers.find((p) => normName(`${p.firstName} ${p.lastName}`) === lower);
  if (direct) return direct;
  const swapped = providers.find((p) => normName(`${p.lastName} ${p.firstName}`) === lower);
  if (swapped) return swapped;
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',').map((p) => p.trim());
    const first = rest.join(' ').trim();
    return providers.find(
      (p) => normName(p.firstName) === normName(first) && normName(p.lastName) === normName(last),
    );
  }
  return undefined;
}

function studentKey(first: string, last: string, school: string): string {
  return `${normName(last)}|${normName(first)}|${normName(school)}`;
}

function mandateMatchKey(row: {
  discipline: string;
  ratioGroup: boolean;
  frequencyKind: FrequencyKind;
  sessionsPerPeriod: number;
  periodSchoolDays: number;
  startOn: string;
  endOn: string;
  serviceType: string;
}): string {
  return [
    row.discipline || row.serviceType,
    row.ratioGroup ? 'group' : 'indiv',
    row.frequencyKind,
    row.sessionsPerPeriod,
    row.periodSchoolDays || 0,
    row.startOn,
    row.endOn,
  ].join('|');
}

/**
 * Preview or commit a parsed caseload into the store.
 * Never persists when `dryRun` is true. Skips rows already in `errors` from parse;
 * commit still proceeds for valid rows when some rows had parse errors.
 */
export function applyCaseloadImport(
  store: MemoryStore,
  parsed: CaseloadParseResult,
  opts: { dryRun?: boolean } = {},
): CaseloadApplyResult {
  const dryRun = opts.dryRun !== false;
  const warnings = [...parsed.warnings];
  const errors = [...parsed.errors];
  const preview: CaseloadPreviewMandate[] = [];
  let createdStudents = 0;
  let updatedStudents = 0;
  let createdMandates = 0;
  let updatedMandates = 0;
  let createdSchools = 0;
  const studentsOut: Student[] = [];
  const mandatesOut: Mandate[] = [];

  /** Staging maps for dry-run so we don't mutate the live store. */
  const schoolByName = new Map<string, School>();
  for (const s of store.data.schools) schoolByName.set(normName(s.name), s);

  const studentByKey = new Map<string, Student>();
  for (const st of store.data.students) {
    const school = store.data.schools.find((s) => s.id === st.schoolId);
    studentByKey.set(studentKey(st.firstName, st.lastName, school?.name || ''), st);
    studentByKey.set(studentKey(st.firstName, st.lastName, ''), st);
  }

  const mandatesByStudent = new Map<string, Mandate[]>();
  for (const m of store.data.mandates) {
    const list = mandatesByStudent.get(m.studentId) ?? [];
    list.push(m);
    mandatesByStudent.set(m.studentId, list);
  }

  for (const row of parsed.rows) {
    const key = studentKey(row.firstName, row.lastName, row.schoolName);
    let school = row.schoolName ? schoolByName.get(normName(row.schoolName)) : undefined;
    const schoolExists = Boolean(school);
    if (!school && row.schoolName) {
      school = {
        id: newId(),
        name: row.schoolName,
        district: '',
        signerName: '',
        signerEmail: '',
        createdAt: nowIso(),
      };
      schoolByName.set(normName(row.schoolName), school);
      if (!dryRun) {
        store.upsertSchool(school);
        createdSchools += 1;
      } else {
        createdSchools += 1;
      }
    } else if (!school) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: 'No Recommended School — student will have empty schoolId until set.',
      });
    }

    let student =
      studentByKey.get(key) ||
      studentByKey.get(studentKey(row.firstName, row.lastName, '')) ||
      store.findStudentByName(row.firstName, row.lastName);
    const studentExists = Boolean(student);

    if (!student) {
      student = {
        id: newId(),
        schoolId: school?.id || '',
        firstName: row.firstName,
        lastName: row.lastName,
        dob: '',
        programId: '',
        programType: '',
        hhaPatientId: '',
        grade: row.grade || undefined,
        createdAt: nowIso(),
      };
      studentByKey.set(key, student);
      studentByKey.set(studentKey(row.firstName, row.lastName, ''), student);
      if (!dryRun) {
        store.upsertStudent(student);
        createdStudents += 1;
      } else {
        createdStudents += 1;
      }
    } else {
      const beforeSchool = student.schoolId;
      const beforeGrade = student.grade;
      const next: Student = {
        ...student,
        schoolId: school?.id || student.schoolId,
        grade: row.grade || student.grade,
      };
      student = next;
      studentByKey.set(key, student);
      const changed = next.schoolId !== beforeSchool || next.grade !== beforeGrade;
      if (changed) updatedStudents += 1;
      if (!dryRun && changed) store.upsertStudent(student);
    }

    const provider = findProviderByName(store.data.providers, row.providerName);
    if (row.providerName && !provider) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: `Provider "${row.providerName}" not found — mandate saved without provider (no HHA id invented).`,
      });
    }

    const existingList = mandatesByStudent.get(student.id) ?? [];
    const matchKey = mandateMatchKey(row);
    let existing = existingList.find((m) =>
      mandateMatchKey({
        discipline: m.discipline || m.serviceType,
        ratioGroup: m.ratioGroup,
        frequencyKind: m.frequencyKind || 'weekly',
        sessionsPerPeriod: m.sessionsPerPeriod ?? m.frequencyPerWeek,
        periodSchoolDays: m.periodSchoolDays || 0,
        startOn: m.startOn,
        endOn: m.endOn,
        serviceType: m.serviceType,
      }) === matchKey,
    );

    const mandate: Mandate = {
      id: existing?.id || newId(),
      studentId: student.id,
      providerId: provider?.id || existing?.providerId || '',
      serviceType: row.serviceType,
      discipline: row.discipline,
      frequencyPerWeek: row.frequencyPerWeek,
      frequencyKind: row.frequencyKind,
      sessionsPerPeriod: row.sessionsPerPeriod,
      periodSchoolDays: row.periodSchoolDays || undefined,
      ratioGroup: row.ratioGroup,
      location: row.location || undefined,
      sourcePdfKey: existing?.sourcePdfKey || 'caseload-csv',
      parsedAt: nowIso(),
      startOn: row.startOn,
      endOn: row.endOn,
      createdAt: existing?.createdAt || nowIso(),
    };

    if (existing) {
      updatedMandates += 1;
      const list = existingList.map((m) => (m.id === mandate.id ? mandate : m));
      mandatesByStudent.set(student.id, list);
    } else {
      createdMandates += 1;
      mandatesByStudent.set(student.id, [...existingList, mandate]);
    }

    if (!dryRun) {
      store.upsertMandate(mandate);
    }

    studentsOut.push(student);
    mandatesOut.push(mandate);
    preview.push({
      rowNumber: row.rowNumber,
      studentKey: key,
      firstName: row.firstName,
      lastName: row.lastName,
      schoolName: row.schoolName,
      grade: row.grade,
      serviceType: row.serviceType,
      discipline: row.discipline,
      ratioGroup: row.ratioGroup,
      freqDisplay: row.freqDisplay,
      frequencyKind: row.frequencyKind,
      sessionsPerPeriod: row.sessionsPerPeriod,
      periodSchoolDays: row.periodSchoolDays,
      frequencyPerWeek: row.frequencyPerWeek,
      startOn: row.startOn,
      endOn: row.endOn,
      location: row.location,
      providerName: row.providerName,
      providerId: provider?.id || '',
      providerMatched: Boolean(provider),
      studentExists,
      schoolExists,
    });
  }

  return {
    dryRun,
    rows: preview,
    errors,
    warnings,
    createdStudents,
    updatedStudents,
    createdMandates,
    updatedMandates,
    createdSchools,
    students: studentsOut,
    mandates: mandatesOut,
  };
}
