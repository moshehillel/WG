import * as XLSX from 'xlsx';
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
  /** 1-based CSV line number; 0 = file/header-level. */
  row: number;
  /** Alias of `row` (older clients). */
  rowNumber: number;
  /** Column / field name when known (e.g. "Last Name", "Freq"). */
  field?: string;
  /** Student label when known (e.g. "Ahmad Haris"). */
  student?: string;
  /** What went wrong (plain English). */
  problem: string;
  /** How to fix it (plain English). */
  fix: string;
  /** Combined sentence for older clients: problem + fix. */
  message: string;
}

function caseloadErr(
  row: number,
  parts: {
    field?: string;
    student?: string;
    problem: string;
    fix: string;
  },
): CaseloadRowError {
  const problem = String(parts.problem || '').trim();
  const fix = String(parts.fix || '').trim();
  const message = [problem, fix].filter(Boolean).join(' ');
  return {
    row,
    rowNumber: row,
    field: parts.field,
    student: parts.student,
    problem,
    fix,
    message,
  };
}

function studentLabel(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

/** True when empty or successfully normalized to YYYY-MM-DD. */
function isOkCaseloadDate(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeCaseloadDate(s));
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
  /** Minutes from RS Duration when present. */
  durationMinutes: number | null;
  /** From group-size column, or derived from RS Ratio (Individual → 1). */
  groupSize: number | null;
  frequencyKind: FrequencyKind;
  sessionsPerPeriod: number;
  periodSchoolDays: number;
  /** Set only for weekly rows; 0 for school_day_cycle. */
  frequencyPerWeek: number;
  location: string;
  providerName: string;
  /** Optional Program ID from caseload when present. */
  programId: string;
  /** Optional Program Type from caseload when present. */
  programType: string;
  /** Optional DOB from caseload when present (YYYY-MM-DD preferred). */
  dob: string;
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
  durationMinutes: number | null;
  groupSize: number | null;
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
  /** True when RS Provider text matched an existing TMS therapist. */
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

/**
 * Final KU export: “Related Service by serviceschool (WG)” (Listing Results).
 * Older “Related Service Details by School” short headers stay as aliases.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  school: [
    'cr recommended school',
    'recommended school',
    'school',
    'school name',
  ],
  lastName: ['student last name', 'last name', 'lastname'],
  firstName: ['student first name', 'first name', 'firstname'],
  grade: ['cr expected grade', 'expected grade', 'grade'],
  decision: ['cr decision/status', 'cr decision', 'decision/status', 'decision'],
  startOn: ['rs start', 'start', 'start date', 'mandate start'],
  endOn: ['rs end', 'end', 'end date', 'mandate end'],
  service: ['related service', 'service type', 'service'],
  ratio: ['rs ratio', 'ratio', 'group ratio'],
  freq: ['rs frequency', 'frequency', 'freq'],
  period: ['rs period', 'freq period', 'period'],
  location: ['rs location', 'location'],
  provider: ['rs provider', 'related service provider', 'provider', 'therapist'],
  /** Minutes per session (e.g. 30, 42, 45). */
  duration: ['rs duration', 'duration', 'duration minutes', 'session duration'],
  /** Optional group size; otherwise derived from RS Ratio. */
  groupSize: ['rs group size', 'group size', 'groupsize', 'rs size', 'group #'],
  /** Optional on some exports; blank is fine (recommended later for HHA). */
  programId: ['program id', 'programid', 'program #', 'admission id', 'admissionid'],
  programType: ['program type', 'programtype'],
  dob: ['date of birth', 'dob', 'birth date', 'birthdate', 'real dob'],
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

/** Positive whole minutes from RS Duration (e.g. "30", "45 min"). */
export function parseDurationMinutes(raw: string): number | null {
  const n = parseFreqNumber(raw);
  if (n == null || n <= 0) return null;
  return Math.round(n);
}

/**
 * Prefer explicit group-size column; else Individual → 1, N:1 ratio → N,
 * Small Group without a number → null.
 */
export function parseGroupSize(groupSizeRaw: string, ratioRaw: string, ratioGroup: boolean): number | null {
  const fromCol = parseFreqNumber(groupSizeRaw);
  if (fromCol != null && fromCol > 0) return Math.round(fromCol);

  const ratio = String(ratioRaw || '').toLowerCase();
  const nToOne = ratio.match(/(\d+)\s*:\s*1/);
  if (nToOne) {
    const n = Number(nToOne[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const loneNum = parseFreqNumber(ratioRaw);
  if (ratioGroup && loneNum != null && loneNum > 1) return Math.round(loneNum);

  if (/\bindividual\b|\b1\s*:\s*1\b/.test(ratio) || (!ratioGroup && !ratio.trim())) return 1;
  if (!ratioGroup) return 1;
  return null;
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

function looksLikeCaseloadHeaders(headers: string[]): boolean {
  return colIndex(headers, HEADER_ALIASES.firstName) >= 0 && colIndex(headers, HEADER_ALIASES.lastName) >= 0;
}

function emptyCaseloadFile(): CaseloadParseResult {
  return {
    rows: [],
    warnings: [],
    errors: [
      caseloadErr(0, {
        field: 'File',
        problem: 'This file is empty — there are no rows to import.',
        fix: 'Upload a KU “Related Service by serviceschool (WG)” export as CSV or Excel (.xls / .xlsx).',
      }),
    ],
  };
}

/** Shared row parser for CSV and Excel (headers already mapped to cells). */
export function parseCaseloadGrid(
  headerCells: string[],
  dataRows: Array<{ rowNumber: number; cells: string[] }>,
): CaseloadParseResult {
  const errors: CaseloadRowError[] = [];
  const warnings: CaseloadRowError[] = [];
  const rows: CaseloadImportRow[] = [];
  const headers = headerCells.map(normHeader);
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
    duration: colIndex(headers, HEADER_ALIASES.duration),
    groupSize: colIndex(headers, HEADER_ALIASES.groupSize),
    programId: colIndex(headers, HEADER_ALIASES.programId),
    programType: colIndex(headers, HEADER_ALIASES.programType),
    dob: colIndex(headers, HEADER_ALIASES.dob),
  };

  if (idx.firstName < 0 || idx.lastName < 0) {
    errors.push(
      caseloadErr(0, {
        field: 'Header',
        problem: 'The header row is missing First Name and/or Last Name columns.',
        fix: 'Use a KU “Related Service by serviceschool (WG)” CSV or Excel file that includes student first and last name columns.',
      }),
    );
    return { rows, errors, warnings };
  }
  if (idx.service < 0) {
    errors.push(
      caseloadErr(0, {
        field: 'Header',
        problem: 'The header row is missing a Related Service column.',
        fix: 'Add a “Related Service” (or “Service Type”) column, then import again.',
      }),
    );
    return { rows, errors, warnings };
  }
  if (idx.freq < 0 || idx.period < 0) {
    const missing = [
      idx.freq < 0 ? 'RS Frequency (or Freq)' : '',
      idx.period < 0 ? 'RS Period (or Period)' : '',
    ]
      .filter(Boolean)
      .join(' and ');
    errors.push(
      caseloadErr(0, {
        field: 'Header',
        problem: `The header row is missing required column(s): ${missing}.`,
        fix: 'Include both frequency and period columns from the KU “Related Service by serviceschool (WG)” export, then import again.',
      }),
    );
    return { rows, errors, warnings };
  }

  for (const data of dataRows) {
    const row = data.rowNumber;
    const cells = data.cells;
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
    const durationRaw = cell(cells, idx.duration);
    const groupSizeRaw = cell(cells, idx.groupSize);
    const programId = cell(cells, idx.programId);
    const programType = cell(cells, idx.programType);
    const dobRaw = cell(cells, idx.dob);
    const startRaw = cell(cells, idx.startOn);
    const endRaw = cell(cells, idx.endOn);
    const who = studentLabel(firstName, lastName);

    let rowFailed = false;
    if (!lastName) {
      errors.push(
        caseloadErr(row, {
          field: 'Last Name',
          student: who || undefined,
          problem: 'Last Name is empty.',
          fix: "Add the student's last name.",
        }),
      );
      rowFailed = true;
    }
    if (!firstName) {
      errors.push(
        caseloadErr(row, {
          field: 'First Name',
          student: who || undefined,
          problem: 'First Name is empty.',
          fix: "Add the student's first name.",
        }),
      );
      rowFailed = true;
    }
    if (!serviceType) {
      errors.push(
        caseloadErr(row, {
          field: 'Related Service',
          student: who || undefined,
          problem: 'Related Service is empty.',
          fix: 'Enter the service type (e.g. PT, OT, or SLP).',
        }),
      );
      rowFailed = true;
    }

    const freqNum = parseFreqNumber(freqRaw);
    if (freqNum == null || freqNum <= 0) {
      errors.push(
        caseloadErr(row, {
          field: 'Freq',
          student: who || undefined,
          problem: freqRaw.trim()
            ? `Freq "${freqRaw}" is not a valid session count.`
            : 'Freq is empty.',
          fix: 'Enter a positive number such as 1 or 2.',
        }),
      );
      rowFailed = true;
    }

    if (!isOkCaseloadDate(startRaw)) {
      errors.push(
        caseloadErr(row, {
          field: 'RS Start',
          student: who || undefined,
          problem: `RS Start date "${startRaw}" is not recognized.`,
          fix: 'Use MM/DD/YYYY or YYYY-MM-DD (e.g. 09/01/2025).',
        }),
      );
      rowFailed = true;
    }
    if (!isOkCaseloadDate(endRaw)) {
      errors.push(
        caseloadErr(row, {
          field: 'RS End',
          student: who || undefined,
          problem: `RS End date "${endRaw}" is not recognized.`,
          fix: 'Use MM/DD/YYYY or YYYY-MM-DD (e.g. 06/30/2026).',
        }),
      );
      rowFailed = true;
    }
    if (dobRaw && !isOkCaseloadDate(dobRaw)) {
      warnings.push(
        caseloadErr(row, {
          field: 'Date of Birth',
          student: who || undefined,
          problem: `Date of Birth "${dobRaw}" is not recognized.`,
          fix: 'Use MM/DD/YYYY or YYYY-MM-DD. Row will still import with blank DOB.',
        }),
      );
    }

    const { kind, periodSchoolDays } = parsePeriod(periodRaw);
    const periodLooksWeekly =
      /\bweekly\b/i.test(periodRaw) ||
      /^weeks?$/i.test(periodRaw.trim()) ||
      /\bper\s+week\b/i.test(periodRaw);
    const periodLooksCycle =
      /\bcycle\b/i.test(periodRaw) || /\d+\s*school\s*days?/i.test(periodRaw);
    if (!periodRaw) {
      warnings.push(
        caseloadErr(row, {
          field: 'Period',
          student: who || undefined,
          problem: 'Period is empty.',
          fix: 'Defaulting to Weekly for this row. Prefer filling Period with Weekly or a school-day cycle.',
        }),
      );
    } else if (kind === 'weekly' && !periodLooksWeekly && !periodLooksCycle) {
      errors.push(
        caseloadErr(row, {
          field: 'Period',
          student: who || undefined,
          problem: `Period "${periodRaw}" is not recognized.`,
          fix: 'Use Weekly or a school-day cycle (e.g. "6 day cycle").',
        }),
      );
      rowFailed = true;
    }

    if (rowFailed) continue;

    const startOn = normalizeCaseloadDate(startRaw);
    const endOn = normalizeCaseloadDate(endRaw);

    if (decision && /reject|den(y|ied)|declin/i.test(decision)) {
      warnings.push(
        caseloadErr(row, {
          field: 'Decision',
          student: who || undefined,
          problem: `Decision is "${decision}".`,
          fix: 'Row will still import — review whether this mandate should be skipped.',
        }),
      );
    }

    const discipline = disciplineFromServiceType(serviceType);
    if (!discipline) {
      warnings.push(
        caseloadErr(row, {
          field: 'Related Service',
          student: who || undefined,
          problem: `Related Service "${serviceType}" could not be mapped to OT, PT, or SLP.`,
          fix: 'Use a service label that includes OT, PT, or SLP when possible.',
        }),
      );
    }

    const ratioGroup = parseRatioGroup(ratioRaw);
    const durationMinutes = parseDurationMinutes(durationRaw);
    const groupSize = parseGroupSize(groupSizeRaw, ratioRaw, ratioGroup);
    const frequencyPerWeek = kind === 'weekly' ? freqNum! : 0;
    const sessionsPerPeriod = freqNum!;
    const days = kind === 'school_day_cycle' ? periodSchoolDays || 6 : 0;

    rows.push({
      rowNumber: row,
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
      durationMinutes,
      groupSize,
      frequencyKind: kind,
      sessionsPerPeriod,
      periodSchoolDays: days,
      frequencyPerWeek,
      location,
      providerName,
      programId,
      programType,
      dob: dobRaw && isOkCaseloadDate(dobRaw) ? normalizeCaseloadDate(dobRaw) : '',
      freqDisplay: formatFreqDisplay(kind, sessionsPerPeriod, days),
    });
  }

  return { rows, errors, warnings };
}

export function parseCaseloadCsv(csvText: string): CaseloadParseResult {
  const raw = String(csvText || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return emptyCaseloadFile();
  const headerCells = splitCsvLine(lines[0]);
  const dataRows = lines.slice(1).map((line, i) => ({
    rowNumber: i + 2,
    cells: splitCsvLine(line),
  }));
  return parseCaseloadGrid(headerCells, dataRows);
}

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isExcelCaseloadName(fileName: string, mime = ''): boolean {
  if (/\.xlsx?$/i.test(String(fileName || ''))) return true;
  const m = String(mime || '').toLowerCase();
  return (
    m.includes('spreadsheetml') ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/vnd.ms-excel.sheet.binary.spreadsheetml.sheet'
  );
}

export function isExcelCaseloadBytes(buf: Buffer): boolean {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE_MAGIC)) return true;
  return false;
}

function cellToString(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).replace(/^"|"$/g, '').trim();
}

function formatExcelDateSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 200 || n > 80000) return null;
  const parsed = XLSX.SSF.parse_date_code(n) as { y?: number; m?: number; d?: number } | null;
  if (!parsed?.y) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function cellToDateString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatExcelDateSerial(value) || cellToString(value);
  }
  return cellToString(value);
}

function sheetToRawGrid(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  }) as unknown[][];
}

function findHeaderRowIndex(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const headers = (grid[i] || []).map((c) => normHeader(cellToString(c)));
    if (
      looksLikeCaseloadHeaders(headers) &&
      (colIndex(headers, HEADER_ALIASES.service) >= 0 || colIndex(headers, HEADER_ALIASES.freq) >= 0)
    ) {
      return i;
    }
  }
  for (let i = 0; i < limit; i += 1) {
    const headers = (grid[i] || []).map((c) => normHeader(cellToString(c)));
    if (looksLikeCaseloadHeaders(headers)) return i;
  }
  return 0;
}

export function parseCaseloadWorkbook(input: Buffer | Uint8Array | ArrayBuffer): CaseloadParseResult {
  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  } catch {
    return {
      rows: [],
      warnings: [],
      errors: [
        caseloadErr(0, {
          field: 'File',
          problem: 'This Excel file could not be read.',
          fix: 'Re-export “Related Service by serviceschool (WG)” as .xls, .xlsx, or CSV and try again.',
        }),
      ],
    };
  }

  let chosen: { grid: unknown[][]; headerIdx: number } | undefined;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const grid = sheetToRawGrid(sheet);
    if (!grid.length) continue;
    const headerIdx = findHeaderRowIndex(grid);
    const headers = (grid[headerIdx] || []).map((c) => normHeader(cellToString(c)));
    if (looksLikeCaseloadHeaders(headers)) {
      chosen = { grid, headerIdx };
      break;
    }
    if (!chosen) chosen = { grid, headerIdx };
  }
  if (!chosen) return emptyCaseloadFile();

  const headerCells = (chosen.grid[chosen.headerIdx] || []).map((c) => cellToString(c));
  const headersNorm = headerCells.map(normHeader);
  const dateCols = new Set<number>();
  const startIdx = colIndex(headersNorm, HEADER_ALIASES.startOn);
  const endIdx = colIndex(headersNorm, HEADER_ALIASES.endOn);
  if (startIdx >= 0) dateCols.add(startIdx);
  if (endIdx >= 0) dateCols.add(endIdx);

  const dataRows: Array<{ rowNumber: number; cells: string[] }> = [];
  for (let i = chosen.headerIdx + 1; i < chosen.grid.length; i += 1) {
    const raw = chosen.grid[i] || [];
    const cells = raw.map((v, col) => (dateCols.has(col) ? cellToDateString(v) : cellToString(v)));
    if (cells.every((c) => !c)) continue;
    dataRows.push({ rowNumber: i + 1, cells });
  }
  return parseCaseloadGrid(headerCells, dataRows);
}

function stripDataUrl(b64: string): string {
  return String(b64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
}

export function parseCaseloadUpload(opts: {
  fileName?: string;
  mime?: string;
  csvText?: string;
  fileBase64?: string;
}): CaseloadParseResult {
  const fileName = String(opts.fileName || '');
  const mime = String(opts.mime || '');
  const csvText = String(opts.csvText || '');
  const b64 = stripDataUrl(String(opts.fileBase64 || ''));
  let buf: Buffer | null = null;
  if (b64) {
    buf = Buffer.from(b64, 'base64');
    if (!buf.length) buf = null;
  }

  const excelNamed = isExcelCaseloadName(fileName, mime);
  if (buf && (excelNamed || isExcelCaseloadBytes(buf))) {
    return parseCaseloadWorkbook(buf);
  }
  if (excelNamed && !buf) {
    return {
      rows: [],
      warnings: [],
      errors: [
        caseloadErr(0, {
          field: 'File',
          problem: 'This looks like an Excel workbook, but the file bytes were not sent.',
          fix: 'Upload the .xls / .xlsx file again from Mandates → Import caseload.',
        }),
      ],
    };
  }
  if (buf && !csvText.trim()) {
    if (isExcelCaseloadBytes(buf)) return parseCaseloadWorkbook(buf);
    return parseCaseloadCsv(buf.toString('utf8'));
  }
  if (csvText.trim()) return parseCaseloadCsv(csvText);
  return {
    rows: [],
    warnings: [],
    errors: [
      caseloadErr(0, {
        field: 'File',
        problem: 'No caseload file was provided.',
        fix: 'Choose a CSV or Excel (.xls / .xlsx) file and preview again.',
      }),
    ],
  };
}

function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Agency / office labels in RS Provider (not a real therapist name). */
export function isAgencyProviderName(rawName: string): boolean {
  const n = normName(rawName);
  if (!n) return false;
  return (
    n === 'white glove' ||
    n === 'whiteglove' ||
    n === 'white glove care' ||
    /^white\s*glove\b/.test(n)
  );
}

/** Prefer linked login + active when duplicate provider rows share a name. */
export function preferCanonicalProvider(providers: Provider[]): Provider | undefined {
  if (!providers.length) return undefined;
  const linkedActive = providers.find((p) => String(p.userId || '').trim() && p.active !== false);
  if (linkedActive) return linkedActive;
  const linked = providers.find((p) => String(p.userId || '').trim());
  if (linked) return linked;
  const active = providers.find((p) => p.active !== false);
  if (active) return active;
  return providers[0];
}

export function providerDisplayNameKey(p: { firstName?: string; lastName?: string }): string {
  return normName(`${p.firstName || ''} ${p.lastName || ''}`);
}

/**
 * Match RS Provider text to a TMS provider.
 * Accepts "First Last", "Last First", and "Last, First".
 * Agency labels like "White, Glove" / "White Glove" never match a person.
 * When several rows share a name, prefer the linked (login) active profile.
 */
export function findProviderByName(providers: Provider[], rawName: string): Provider | undefined {
  const s = String(rawName || '').trim();
  if (!s) return undefined;
  if (isAgencyProviderName(s)) return undefined;
  const lower = normName(s);
  if (!lower) return undefined;

  const hits: Provider[] = [];
  const pushUnique = (p: Provider | undefined) => {
    if (!p) return;
    if (!hits.some((x) => x.id === p.id)) hits.push(p);
  };

  for (const p of providers) {
    if (normName(`${p.firstName} ${p.lastName}`) === lower) pushUnique(p);
  }
  for (const p of providers) {
    if (normName(`${p.lastName} ${p.firstName}`) === lower) pushUnique(p);
  }

  if (s.includes(',')) {
    const [last, ...rest] = s.split(',').map((p) => p.trim());
    const first = rest.join(' ').trim();
    if (first && last) {
      for (const p of providers) {
        if (normName(p.firstName) === normName(first) && normName(p.lastName) === normName(last)) {
          pushUnique(p);
        }
      }
    }
  }

  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    for (const p of providers) {
      const fn = normName(p.firstName);
      const ln = normName(p.lastName);
      if (!fn || !ln) continue;
      if (tokens.includes(fn) && tokens.includes(ln)) pushUnique(p);
    }
  }

  return preferCanonicalProvider(hits);
}

/** Move mandates from same-name orphan provider rows onto the linked canonical profile. */
export function consolidateDuplicateProviderMandates(store: MemoryStore): number {
  const byName = new Map<string, Provider[]>();
  for (const p of store.data.providers) {
    const key = providerDisplayNameKey(p);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(p);
    byName.set(key, list);
  }
  let moved = 0;
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const canonical = preferCanonicalProvider(group);
    if (!canonical) continue;
    const aliasIds = new Set(group.map((p) => p.id));
    for (const m of store.data.mandates) {
      if (aliasIds.has(m.providerId) && m.providerId !== canonical.id) {
        store.upsertMandate({ ...m, providerId: canonical.id });
        moved += 1;
      }
    }
  }
  return moved;
}

function studentKey(first: string, last: string, school: string): string {
  return `${normName(last)}|${normName(first)}|${normName(school)}`;
}

/** Stable identity for caseload upsert (student is matched separately). */
export function mandateMatchKey(row: {
  discipline?: string;
  ratioGroup?: boolean;
  frequencyKind?: FrequencyKind | string;
  sessionsPerPeriod?: number;
  frequencyPerWeek?: number;
  periodSchoolDays?: number;
  startOn?: string;
  endOn?: string;
  serviceType?: string;
}): string {
  const disc =
    String(row.discipline || '').toUpperCase() ||
    disciplineFromServiceType(String(row.serviceType || '')) ||
    normName(String(row.serviceType || ''));
  const kind: FrequencyKind =
    row.frequencyKind === 'school_day_cycle' ? 'school_day_cycle' : 'weekly';
  const sessions = Number(
    row.sessionsPerPeriod ?? row.frequencyPerWeek ?? 0,
  );
  const periodDays =
    kind === 'school_day_cycle'
      ? Number(row.periodSchoolDays) > 0
        ? Number(row.periodSchoolDays)
        : 6
      : 0;
  return [
    disc,
    row.ratioGroup ? 'group' : 'indiv',
    kind,
    Number.isFinite(sessions) ? sessions : 0,
    periodDays,
    normalizeCaseloadDate(String(row.startOn || '')),
    normalizeCaseloadDate(String(row.endOn || '')),
  ].join('|');
}

function findStudentForCaseloadRow(
  studentByKey: Map<string, Student>,
  store: MemoryStore,
  firstName: string,
  lastName: string,
  schoolName: string,
): Student | undefined {
  const key = studentKey(firstName, lastName, schoolName);
  const hit =
    studentByKey.get(key) ||
    studentByKey.get(studentKey(firstName, lastName, '')) ||
    store.findStudentByName(firstName, lastName);
  if (hit) return hit;
  const nf = normName(firstName);
  const nl = normName(lastName);
  if (!nf && !nl) return undefined;
  return store.data.students.find(
    (s) => normName(s.firstName) === nf && normName(s.lastName) === nl,
  );
}

/**
 * Persist parsed caseload into the store unless `dryRun` is true.
 * `dryRun` is unused by the live import path (upload commits immediately).
 * Skips rows already in `errors` from parse; commit still proceeds for valid rows.
 *
 * RS Provider must match an existing TMS therapist. Blank / agency labels /
 * unmatched names are hard errors — the row is skipped (no mandate with empty provider).
 * Schools and students are still created/updated only for rows that pass provider match.
 */
export function applyCaseloadImport(
  store: MemoryStore,
  parsed: CaseloadParseResult,
  opts: { dryRun?: boolean } = {},
): CaseloadApplyResult {
  const dryRun = opts.dryRun === true;
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

  // Repair existing split caseloads before applying this file (persists on write path).
  if (!dryRun) consolidateDuplicateProviderMandates(store);

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
    const label = studentLabel(row.firstName, row.lastName) || undefined;
    const matchedProvider = findProviderByName(store.data.providers, row.providerName);
    if (!matchedProvider) {
      if (!String(row.providerName || '').trim()) {
        errors.push(
          caseloadErr(row.rowNumber, {
            field: 'RS Provider',
            student: label,
            problem: 'RS Provider is blank.',
            fix: 'Add a therapist name that already exists in TMS (First Last or Last, First), then re-import.',
          }),
        );
      } else if (isAgencyProviderName(row.providerName)) {
        errors.push(
          caseloadErr(row.rowNumber, {
            field: 'RS Provider',
            student: label,
            problem: `Provider "${row.providerName}" is an agency label, not a therapist name.`,
            fix: 'Replace with the therapist name as it appears in TMS, then re-import.',
          }),
        );
      } else {
        errors.push(
          caseloadErr(row.rowNumber, {
            field: 'RS Provider',
            student: label,
            problem: `Provider "${row.providerName}" was not found in TMS.`,
            fix: 'Add or rename the provider in TMS to match this RS Provider name, then re-import. Do not invent providers on import.',
          }),
        );
      }
      continue;
    }
    const provider = matchedProvider;

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
      warnings.push(
        caseloadErr(row.rowNumber, {
          field: 'Recommended School',
          student: label,
          problem: 'Recommended School is empty.',
          fix: 'Student will import with no school until you set one. Prefer filling Recommended School.',
        }),
      );
    }

    let student = findStudentForCaseloadRow(
      studentByKey,
      store,
      row.firstName,
      row.lastName,
      row.schoolName,
    );
    const studentExists = Boolean(student);

    if (!student) {
      student = {
        id: newId(),
        schoolId: school?.id || '',
        firstName: row.firstName,
        lastName: row.lastName,
        dob: row.dob || '',
        programId: row.programId || '',
        programType: row.programType || '',
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
      const beforeDob = student.dob;
      const beforeProgId = student.programId;
      const beforeProgType = student.programType;
      const next: Student = {
        ...student,
        schoolId: school?.id || student.schoolId,
        grade: row.grade || student.grade,
        dob: row.dob || student.dob,
        programId: row.programId || student.programId,
        programType: row.programType || student.programType,
      };
      student = next;
      studentByKey.set(key, student);
      studentByKey.set(studentKey(row.firstName, row.lastName, ''), student);
      const changed =
        next.schoolId !== beforeSchool ||
        next.grade !== beforeGrade ||
        next.dob !== beforeDob ||
        next.programId !== beforeProgId ||
        next.programType !== beforeProgType;
      if (changed) updatedStudents += 1;
      if (!dryRun && changed) store.upsertStudent(student);
    }

    const existingList = mandatesByStudent.get(student.id) ?? [];
    const matchKey = mandateMatchKey(row);
    const existing = existingList.find((m) => mandateMatchKey(m) === matchKey);

    const mandate: Mandate = {
      id: existing?.id || newId(),
      studentId: student.id,
      providerId: provider.id,
      serviceType: row.serviceType,
      discipline: row.discipline,
      frequencyPerWeek: row.frequencyPerWeek,
      frequencyKind: row.frequencyKind,
      sessionsPerPeriod: row.sessionsPerPeriod,
      periodSchoolDays:
        row.frequencyKind === 'school_day_cycle'
          ? row.periodSchoolDays || 6
          : row.periodSchoolDays || undefined,
      ratioGroup: row.ratioGroup,
      durationMinutes: row.durationMinutes,
      groupSize: row.groupSize,
      location: row.location || existing?.location || undefined,
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
      durationMinutes: row.durationMinutes,
      groupSize: row.groupSize,
      freqDisplay: row.freqDisplay,
      frequencyKind: row.frequencyKind,
      sessionsPerPeriod: row.sessionsPerPeriod,
      periodSchoolDays: row.periodSchoolDays,
      frequencyPerWeek: row.frequencyPerWeek,
      startOn: row.startOn,
      endOn: row.endOn,
      location: row.location,
      providerName: row.providerName,
      providerId: provider.id,
      providerMatched: true,
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
