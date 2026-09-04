export interface ParsedSessionNote {
  studentName: string;
  /** Service Provider line from Frontline (when present). */
  providerName: string;
  /** School / setting from the report when recognizable. */
  schoolName: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  attendance: 'attended' | 'missed' | 'makeup';
  cancelReason: string;
  notes: string;
  serviceType: string;
  location: string;
  ratio: string;
}

const MISSED_RE =
  /\b(student absence|student not available|student not in school|absent|missed|cancell?ed)\b/i;
const MAKEUP_RE = /\b(makeup|make[\s-]?up)\b/i;

export function attendanceFromNotes(
  notes: string,
  timeIn: string,
  timeOut: string,
): ParsedSessionNote['attendance'] {
  const n = String(notes || '');
  if (/student absence|student not available|student not in school|student absent/i.test(n)) {
    return 'missed';
  }
  if (MAKEUP_RE.test(n)) return 'makeup';
  if (MISSED_RE.test(n) && !/make[\s-]?up session/i.test(n)) return 'missed';
  if (timeIn && timeOut) return 'attended';
  return 'missed';
}

export function cancellationFromNotes(
  notes: string,
  attendance: ParsedSessionNote['attendance'],
): string {
  if (attendance !== 'missed') return '';
  const n = String(notes || '');
  if (/not available/i.test(n)) return 'Student Not Available';
  if (/not in school/i.test(n)) return 'Student not in school';
  if (/cancell?ed/i.test(n)) return 'Cancelled';
  return 'Student Absent';
}

function dateIndexForSession(blob: string, date: string): number {
  let from = 0;
  while (from < blob.length) {
    const idx = blob.indexOf(date, from);
    if (idx < 0) return -1;
    const before = blob.slice(Math.max(0, idx - 48), idx);
    // Skip report range header "From: … To: …" and DOB lines.
    if (/\bFrom:\s*$/i.test(before) || /\bTo:\s*$/i.test(before) || /D\.?O\.?B\.?\s*$/i.test(before)) {
      from = idx + date.length;
      continue;
    }
    // Skip "makeup for / missed on …" reference dates — those are not session DOS rows.
    if (
      /(?:makeup for|make[\s-]?up for|missed(?:\s+session)?(?:\s+on)?|original(?:\s+date|\s+dos)?|for(?:\s+date)?)\s*$/i.test(
        before,
      )
    ) {
      from = idx + date.length;
      continue;
    }
    return idx;
  }
  return -1;
}

function cleanStudentName(raw: string): string {
  return String(raw || '')
    .replace(/,?\s*D\.?O\.?B\..*$/i, '')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isServiceTypeSchoolLabel(name: string): boolean {
  const n = normEntityName(name);
  return /^(ot|pt|slp|speech|physical therapy|occupational therapy|related service)\s+school$/.test(
    n,
  );
}

function extractSchoolName(blob: string): string {
  const labeled =
    (blob.match(/\bSchool(?:\s*Name)?\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    (blob.match(/\bRecommended School\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    '';
  if (labeled && !isServiceTypeSchoolLabel(labeled)) {
    return labeled.replace(/\s+/g, ' ').trim();
  }
  const re =
    /\b([A-Z][A-Za-z0-9'.-]+(?:\s+[A-Z][A-Za-z0-9'.-]+){0,5}\s+School)\b/g;
  for (const m of blob.matchAll(re)) {
    const name = String(m[1] || '').replace(/\s+/g, ' ').trim();
    if (!name || isServiceTypeSchoolLabel(name)) continue;
    const before = blob.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    if (/Service:\s*$/i.test(before)) continue;
    return name;
  }
  return '';
}

function schoolFromSlice(slice: string): string {
  const re =
    /\b([A-Z][A-Za-z0-9'.-]+(?:\s+[A-Z][A-Za-z0-9'.-]+){0,5}\s+School)\b/g;
  for (const m of slice.matchAll(re)) {
    const name = String(m[1] || '').replace(/\s+/g, ' ').trim();
    if (!name || isServiceTypeSchoolLabel(name)) continue;
    return name;
  }
  return '';
}

/** Weekly Frontline-style notes as extracted text (server PDF extract, or pasted). */
export function parseWeeklySessionText(text: string): ParsedSessionNote[] {
  const blob = String(text || '');
  const studentName = cleanStudentName(
    (blob.match(/Student Name:\s*([^\n]+)/i) || blob.match(/Student:\s*([^\n]+)/i) || [])[1] || '',
  );
  const providerName = (
    (blob.match(/Service Provider\s*:\s*([^\n]+)/i) ||
      blob.match(/Provider(?:\s*Name)?\s*:\s*([^\n]+)/i) ||
      [])[1] || ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  const serviceType = (blob.match(/Service:\s*([^\n]+)/i) || [])[1]?.trim() ?? '';
  const reportSchool = extractSchoolName(blob);
  const rows: ParsedSessionNote[] = [];
  const dateRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  const dates = [...blob.matchAll(dateRe)].map((m) => m[1]);
  const uniqueDates = [...new Set(dates)].filter((d) => dateIndexForSession(blob, d) >= 0);
  for (const dateOfService of uniqueDates.slice(0, 40)) {
    const idx = dateIndexForSession(blob, dateOfService);
    if (idx < 0) continue;
    const slice = blob.slice(idx, idx + 400);
    const times = [...slice.matchAll(/(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/gi)].map((m) => m[1]);
    const notesMatch = slice.match(
      /(?:Service Provided:|Student Absence:|Student Not Available:|Make up[^.\n]*)[^.\n]*/i,
    );
    const notes = (notesMatch?.[0] || slice.replace(/\s+/g, ' ').trim()).slice(0, 400);
    const beginTime = times[0] || '';
    const endTime = times[1] || '';
    const attendance = attendanceFromNotes(notes, beginTime, endTime);
    const ratio = (slice.match(/\b(\d+\s*:\s*\d+)\b/) || [])[1] || '';
    const location = schoolFromSlice(slice);
    const schoolName = location || reportSchool;
    rows.push({
      studentName,
      providerName,
      schoolName,
      dateOfService,
      beginTime,
      endTime,
      attendance,
      cancelReason: cancellationFromNotes(notes, attendance),
      notes,
      serviceType,
      location: location || schoolName,
      ratio,
    });
  }
  return rows;
}

export function splitPersonName(raw: string): { first: string; last: string } {
  const s = String(raw || '')
    .replace(/\(white glove\)/gi, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/,$/, '')
    .trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const bits = s.split(',').map((p) => p.trim()).filter(Boolean);
    return { first: bits.slice(1).join(' '), last: bits[0] ?? '' };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

export function mappingName(raw: string): { first: string; last: string } {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[parts.length - 1] ?? '', last: parts.slice(0, -1).join(' ') };
}

export function nameKey(first: string, last: string): string {
  return `${String(last || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(first || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}`;
}

/** Normalize school / person labels for loose equality. */
export function normEntityName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when PDF school clearly differs from the child's known school. */
export function schoolNamesConflict(pdfSchool: string, knownSchool: string): boolean {
  const a = normEntityName(pdfSchool);
  const b = normEntityName(knownSchool);
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false;
  return true;
}
