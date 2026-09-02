export interface ParsedSessionNote {
  studentName: string;
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

/** Weekly Frontline-style notes as extracted text (pdf.js on the SPA, or pasted). */
export function parseWeeklySessionText(text: string): ParsedSessionNote[] {
  const blob = String(text || '');
  const studentName = (
    blob.match(/Student Name:\s*([^\n,]+)/i) ||
    blob.match(/Student:\s*([^\n]+)/i) ||
    []
  )[1]
    ?.replace(/D\.?O\.?B\..*$/i, '')
    .trim() ?? '';
  const serviceType = (blob.match(/Service:\s*([^\n]+)/i) || [])[1]?.trim() ?? '';
  const rows: ParsedSessionNote[] = [];
  const dateRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  const dates = [...blob.matchAll(dateRe)].map((m) => m[1]);
  const uniqueDates = [...new Set(dates)].filter((d) => !/D\.?O\.?B/i.test(blob.split(d)[0]?.slice(-20) ?? ''));
  for (const dateOfService of uniqueDates.slice(0, 40)) {
    const idx = blob.indexOf(dateOfService);
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
    const location = (slice.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+School)\b/) || [])[1] || '';
    rows.push({
      studentName,
      dateOfService,
      beginTime,
      endTime,
      attendance,
      cancelReason: cancellationFromNotes(notes, attendance),
      notes,
      serviceType,
      location,
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
