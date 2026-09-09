import {
  FRONTLINE_MISSED_REASON_RE,
  matchFrontlineMissedReason,
  parseCptCoverage,
  sessionIsSigned,
} from './session-upload-validate.js';

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
  /** CPT codes parsed from the session slice (e.g. 97110). */
  cptCodes: string[];
  /** Sum of CPT units for duration checks (1 unit ≈ 15 min). */
  cptUnits: number;
  /** Labels like 97110x2 for error messages. */
  cptProcedures: string[];
  /** True when Frontline / Therapist Activity signature block is filled. */
  signed: boolean;
  /** Raw text around the session (for signature / CPT re-checks). */
  sourceSlice: string;
}

const MISSED_RE = new RegExp(
  `${FRONTLINE_MISSED_REASON_RE.source}|\\b(?:student not in school|student absent|absent|missed|cancell?ed|no[\\s-]?show|did not attend|not present|refused)\\b`,
  'i',
);
const MAKEUP_RE = /\b(makeup|make[\s-]?up)\b/i;
const FRONTLINE_ABSENCE_LABEL_RE =
  /(?:Provider\s+Absence|Provider\s+Not\s+Available|Student\s+Absence|Student\s+Not\s+Available|School\s+Closed|Staff\s+Shortage)\s*:/i;

export function attendanceFromNotes(
  notes: string,
  timeIn: string,
  timeOut: string,
): ParsedSessionNote['attendance'] {
  const n = String(notes || '');
  if (
    /provider absence|student absence|student not available|student not in school|student absent/i.test(
      n,
    )
  ) {
    return 'missed';
  }
  // Makeup wins only when it is clearly a makeup session (not "will make up later" on an absence).
  if (MAKEUP_RE.test(n) && !MISSED_RE.test(n)) return 'makeup';
  if (
    MAKEUP_RE.test(n) &&
    /make[\s-]?up\s+(?:for|session)/i.test(n) &&
    !FRONTLINE_MISSED_REASON_RE.test(n)
  ) {
    return 'makeup';
  }
  if (MISSED_RE.test(n) && !/make[\s-]?up session/i.test(n)) return 'missed';
  if (timeIn && timeOut) return 'attended';
  return 'missed';
}

export function cancellationFromNotes(
  notes: string,
  attendance: ParsedSessionNote['attendance'],
): string {
  if (attendance !== 'missed') return '';
  // Prefer Frontline dropdown labels; upload locker requires one of these.
  return matchFrontlineMissedReason(notes);
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

/** Setting labels that are not school names (Therapist Activity "Preschool", etc.). */
export function isGenericSettingLabel(name: string): boolean {
  const n = normEntityName(name);
  return /^(preschool|school|clinic|home|telehealth|office|classroom|therapy room|community)$/.test(
    n,
  );
}

const SCHOOL_NAME_RE =
  /\b([A-Z][A-Za-z0-9'.-]+(?:\s+[A-Za-z0-9'.\/-]+){0,6}(?:\s+(?:MS\/HS|M\.?S\.?|H\.?S\.?)|\s+School))\b/g;

function takeSchoolLabel(raw: string): string {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name || isServiceTypeSchoolLabel(name) || isGenericSettingLabel(name)) return '';
  return name;
}

function extractSchoolName(blob: string): string {
  const labeled =
    (blob.match(/\bSetting\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    (blob.match(/\bSchool(?:\s*Name)?\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    (blob.match(/\bRecommended School\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    '';
  const fromLabel = takeSchoolLabel(labeled);
  if (fromLabel) return fromLabel;
  const re = new RegExp(SCHOOL_NAME_RE.source, 'g');
  for (const m of blob.matchAll(re)) {
    const name = takeSchoolLabel(m[1] || '');
    if (!name) continue;
    const before = blob.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    if (/Service:\s*$/i.test(before)) continue;
    return name;
  }
  return '';
}

function schoolFromSlice(slice: string): string {
  const setting = takeSchoolLabel((slice.match(/\bSetting\s*:\s*([^\n]+)/i) || [])[1] || '');
  if (setting) return setting;
  const re = new RegExp(SCHOOL_NAME_RE.source, 'g');
  for (const m of slice.matchAll(re)) {
    const name = takeSchoolLabel(m[1] || '');
    if (name) return name;
  }
  return '';
}

function studentNameBefore(blob: string, idx: number, fallback: string): string {
  const before = blob.slice(0, idx);
  const matches = [...before.matchAll(/Student Name:\s*([^\n]+)/gi)];
  const last = matches[matches.length - 1];
  if (!last?.[1]) return fallback;
  return cleanStudentName(last[1]);
}

/** Detect Therapist Activity Output reports (vs Frontline weekly notes). */
export function isTherapistActivityText(text: string): boolean {
  const t = String(text || '');
  if (/Therapist\s+Activity\s*Printed/i.test(t)) return true;
  if (/Date\s*\/\s*Time/i.test(t) && /ICD\s*\/\s*CPT/i.test(t) && /\bIn:\s*\d{1,2}:\d{2}/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Therapist Activity Tj extraction often splits tokens across operators
 * (e.g. 92507 / x / 1, CBRS / 2627 / S / …). Normalize for parsing.
 */
export function normalizeTherapistActivityText(text: string): string {
  let s = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
  // Join fragmented CPT: 92507\nx\n1 or 92507 x 1
  s = s.replace(/\b(\d{4,5})\s*\n?\s*[xX×]\s*\n?\s*(\d{1,2})\b/g, '$1x$2');
  // Join ICD fragments: F\n80.2 → F80.2
  s = s.replace(/\b([A-Z])\s*\n\s*(\d{1,3}(?:\.\d{1,2})?)\b/g, '$1$2');
  // Join child program id fragments: CBRS\n2627\nS\n0093066\n(ST-I)
  s = s.replace(
    /\b(CBRS)\s*\n?\s*(\d+)\s*\n?\s*([A-Z])\s*\n?\s*(\d+)\s*\n?\s*(\([^)]+\))/gi,
    '$1$2$3$4$5',
  );
  return s.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function serviceTypeFromActivityCode(code: string): { serviceType: string; ratio: string } {
  const c = String(code || '')
    .replace(/[()]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');
  const group = /(?:-G|G)$/.test(c) || /\dG$/.test(c);
  let disc = 'Related Service';
  if (/^ST/.test(c) || /^SLP/.test(c)) disc = 'Speech';
  else if (/^OT/.test(c)) disc = 'OT';
  else if (/^PT/.test(c)) disc = 'PT';
  return {
    serviceType: `${disc} ${group ? 'Group' : 'Individual'}`,
    ratio: group ? '2:1' : '1:1',
  };
}

function activityProviderName(blob: string): string {
  const footers = [
    ...blob.matchAll(/Page\s+\d+\s+of\s+\d+\s+([A-Za-z][A-Za-z'.-]+,\s*[A-Za-z][A-Za-z'.-]+)/g),
  ];
  const lastFooter = footers[footers.length - 1]?.[1];
  if (lastFooter) return lastFooter.replace(/\s+/g, ' ').trim();
  const signed = blob.match(
    /Signed:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s+([A-Za-z][A-Za-z .'-]+?)(?:,\s*(?:M\.?S\.?|M\.?A\.?|CCC|PT|OT|SLP|DPT|TSSLD)|\s+CCC)/i,
  );
  if (signed?.[1]) {
    return signed[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Parse Therapist Activity Output session pages into the shared session shape. */
export function parseTherapistActivityText(text: string): ParsedSessionNote[] {
  const flat = normalizeTherapistActivityText(text);
  if (!flat) return [];
  const providerName = activityProviderName(flat);
  const rows: ParsedSessionNote[] = [];

  const sessionRe =
    /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+In:\s*(\d{1,2}:\d{2})\s*(AM|PM)\s+Out:\s*(\d{1,2}:\d{2})\s*(AM|PM)/gi;
  const hits: Array<{
    dateOfService: string;
    beginTime: string;
    endTime: string;
    idx: number;
    endIdx: number;
  }> = [];
  for (const m of flat.matchAll(sessionRe)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    hits.push({
      dateOfService: m[1]!,
      beginTime: `${m[2]} ${m[3]}`.replace(/\s+/g, ' '),
      endTime: `${m[4]} ${m[5]}`.replace(/\s+/g, ' '),
      idx,
      endIdx: idx + m[0].length,
    });
  }

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const nextStart = hits[i + 1]?.idx ?? flat.length;
    const slice = flat.slice(hit.idx, Math.min(nextStart, hit.idx + 3500));

    const makeupFor =
      (slice.match(/Make\s*up\s*for:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i) || [])[1] || '';
    const groupMatch = slice.match(/#\s*Children\s*in\s*Group:\s*(\d+)/i);
    const groupSize = groupMatch ? Number(groupMatch[1]) : 0;

    // Prefer "LAST, FIRST" (optional III/Jr) immediately before program id / (ST-I).
    const nameRe =
      /\b([A-Z][A-Za-z0-9'.-]+(?:\s+(?:III|II|IV|Jr\.?|Sr\.?))?),\s*([A-Za-z][A-Za-z'.-]+)\b(?=\s*(?:CBRS|\([A-Z]{2,4}))/g;
    const nameHits = [...slice.matchAll(nameRe)];
    let studentName = '';
    if (nameHits.length) {
      const last = nameHits[nameHits.length - 1]!;
      studentName = cleanStudentName(`${last[1]}, ${last[2]}`);
    }
    if (!studentName) {
      const afterTimes = slice.slice(hit.endIdx - hit.idx);
      const nameHit = afterTimes.match(
        /\b([A-Z][A-Za-z0-9'.-]+(?:\s+(?:III|II|IV|Jr\.?|Sr\.?))?),\s*([A-Za-z][A-Za-z'.-]+)\b/,
      );
      if (nameHit) studentName = cleanStudentName(`${nameHit[1]}, ${nameHit[2]}`);
    }

    // Allow split tokens like (ST 1 - G) from Tj extraction.
    const svcCode = (slice.match(/\(([A-Z]{2,4}\s*\d?\s*-?\s*[IG])\)/i) || [])[1] || '';
    const mapped = serviceTypeFromActivityCode(svcCode);
    let ratio = mapped.ratio;
    if (groupSize >= 2) ratio = `${groupSize}:1`;

    const setting =
      (slice.match(
        /\b(Preschool|School|Clinic|Home|Telehealth|Office|Classroom|Community)\b/i,
      ) || [])[1] || '';
    const location = setting;
    const schoolName =
      setting && !isGenericSettingLabel(setting) ? setting : schoolFromSlice(slice);

    let notes = '';
    const notesStart = slice.search(/\b(?:925\d{2}|97\d{3}|961\d{2}|975\d{2})x\d+\b/i);
    if (notesStart >= 0) {
      const afterCpt = slice.slice(notesStart).replace(/^(?:[\d,xX×\s]|F\d{2}(?:\.\d+)?)+/, '');
      notes = afterCpt
        .replace(/\s*Notes\s+Entered:[\s\S]*$/i, '')
        .replace(/\s*Signed:[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 800);
    }
    // Missed Therapist Activity rows often have no CPT — pull a short absence label when present.
    // Leave notes empty otherwise; attendance still reads the full slice below.
    if (!notes) {
      const absenceHit = slice.match(
        /\b((?:Provider\s+Absence|Student\s+Absence|Student\s+Not\s+Available|Student\s+Absent|Absent|Missed|Cancelled|Canceled|No[\s-]?Show)[:\s][\s\S]*?)(?=\s*Notes\s+Entered:|\s*Signed:|$)/i,
      );
      if (absenceHit?.[1]) {
        notes = absenceHit[1].replace(/\s+/g, ' ').trim().slice(0, 800);
      }
    }
    if (makeupFor) {
      notes = `Make up for: ${makeupFor}${notes ? ` ${notes}` : ''}`.trim();
    }

    // Use notes || slice so absence keywords still classify as missed when note text is sparse.
    const attendance: ParsedSessionNote['attendance'] = makeupFor
      ? 'makeup'
      : attendanceFromNotes(notes || slice, hit.beginTime, hit.endTime);
    // Missed notes must not keep invented/clock times from the activity header.
    const beginTime = attendance === 'missed' ? '' : hit.beginTime;
    const endTime = attendance === 'missed' ? '' : hit.endTime;

    const cpt =
      attendance === 'missed'
        ? { codes: [] as string[], totalUnits: 0, procedures: [] as string[] }
        : parseCptCoverage(slice);
    rows.push({
      studentName,
      providerName,
      schoolName,
      dateOfService: hit.dateOfService,
      beginTime,
      endTime,
      attendance,
      cancelReason: cancellationFromNotes(notes || slice, attendance),
      notes,
      serviceType: mapped.serviceType,
      location: location || schoolName,
      ratio,
      cptCodes: cpt.codes,
      cptUnits: cpt.totalUnits,
      cptProcedures: cpt.procedures,
      signed: sessionIsSigned(slice),
      sourceSlice: slice,
    });
  }
  return rows;
}

/** True when this slash-date is a Frontline service-date row (not From/To/DOB/makeup). */
function isFrontlineServiceDateHit(blob: string, idx: number): boolean {
  const before = blob.slice(Math.max(0, idx - 48), idx);
  if (/\bFrom:\s*$/i.test(before) || /\bTo:\s*$/i.test(before) || /D\.?O\.?B\.?\s*$/i.test(before)) {
    return false;
  }
  if (
    /(?:makeup for|make[\s-]?up for|missed(?:\s+session)?(?:\s+on)?|original(?:\s+date|\s+dos)?|for(?:\s+date)?)\s*$/i.test(
      before,
    )
  ) {
    return false;
  }
  return true;
}

/** End of this Frontline session block: next service date, next student, or EOF. */
function frontlineSessionBlockEnd(blob: string, startIdx: number, dateToken: string): number {
  // Must start after the full current DOS token — otherwise `09/01/2026` yields a
  // false "next" hit on `9/01/2026` and the slice collapses to the leading `0`.
  const searchFrom = startIdx + Math.max(String(dateToken || '').length, 1);
  let nextDate = blob.length;
  const dateRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})/g;
  dateRe.lastIndex = searchFrom;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(blob))) {
    const idx = m.index ?? -1;
    if (idx < searchFrom || !isFrontlineServiceDateHit(blob, idx)) continue;
    nextDate = idx;
    break;
  }
  const nextStudent = blob.indexOf('Student Name:', searchFrom);
  if (nextStudent >= searchFrom && nextStudent < nextDate) return nextStudent;
  return nextDate;
}

function normClockKey(t: string): string {
  return String(t || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '');
}

function mergeCptParts(
  a: Pick<ParsedSessionNote, 'cptCodes' | 'cptUnits' | 'cptProcedures'>,
  b: Pick<ParsedSessionNote, 'cptCodes' | 'cptUnits' | 'cptProcedures'>,
): Pick<ParsedSessionNote, 'cptCodes' | 'cptUnits' | 'cptProcedures'> {
  const byCode = new Map<string, number>();
  const ingest = (codes: string[], procedures: string[]) => {
    for (let i = 0; i < codes.length; i++) {
      const code = String(codes[i] || '').trim();
      if (!code) continue;
      const fromProc = (procedures[i] || '').match(/x(\d+)/i)?.[1];
      const units = Math.max(1, Number(fromProc) || 1);
      byCode.set(code, Math.max(byCode.get(code) || 0, units));
    }
  };
  ingest(a.cptCodes || [], a.cptProcedures || []);
  ingest(b.cptCodes || [], b.cptProcedures || []);
  // Also parse procedure labels that may not align 1:1 with codes arrays.
  for (const label of [...(a.cptProcedures || []), ...(b.cptProcedures || [])]) {
    const m = String(label || '').match(/^(\d{4,5})x(\d+)$/i);
    if (!m) continue;
    byCode.set(m[1]!, Math.max(byCode.get(m[1]!) || 0, Math.max(1, Number(m[2]) || 1)));
  }
  const codes = [...byCode.keys()];
  const procedures = codes.map((c) => `${c}x${byCode.get(c)}`);
  const totalUnits = [...byCode.values()].reduce((sum, n) => sum + n, 0);
  return { cptCodes: codes, cptUnits: totalUnits, cptProcedures: procedures };
}

/**
 * Frontline often exports one 30-min visit as two rows (different CPT codes, same
 * child + clock window). Merge those into one session so units cover duration and
 * overlap / double-count do not fire.
 */
export function mergeFrontlineSplitCptRows(rows: ParsedSessionNote[]): ParsedSessionNote[] {
  const out: ParsedSessionNote[] = [];
  const indexByKey = new Map<string, number>();
  for (const row of rows) {
    const key = [
      normEntityName(row.studentName),
      String(row.dateOfService || '').trim(),
      normClockKey(row.beginTime),
      normClockKey(row.endTime),
      row.attendance,
    ].join('|');
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, out.length);
      out.push({ ...row, cptCodes: [...(row.cptCodes || [])], cptProcedures: [...(row.cptProcedures || [])] });
      continue;
    }
    const prev = out[existingIdx]!;
    const cpt = mergeCptParts(prev, row);
    const preferNotes =
      String(row.notes || '').length > String(prev.notes || '').length ? row.notes : prev.notes;
    out[existingIdx] = {
      ...prev,
      ...cpt,
      notes: preferNotes,
      signed: prev.signed || row.signed,
      sourceSlice: [prev.sourceSlice, row.sourceSlice].filter(Boolean).join('\n'),
      cancelReason: prev.cancelReason || row.cancelReason,
      ratio: prev.ratio || row.ratio,
      beginTime: prev.beginTime || row.beginTime,
      endTime: prev.endTime || row.endTime,
    };
  }
  return out;
}

function parseFrontlineWeeklySessionText(text: string): ParsedSessionNote[] {
  const blob = String(text || '');
  const fallbackStudent = cleanStudentName(
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
  const dateHits: Array<{ dateOfService: string; idx: number }> = [];
  for (const m of blob.matchAll(dateRe)) {
    const dateOfService = m[1]!;
    const idx = m.index ?? -1;
    if (idx < 0 || !isFrontlineServiceDateHit(blob, idx)) continue;
    dateHits.push({ dateOfService, idx });
  }
  for (const { dateOfService, idx } of dateHits.slice(0, 80)) {
    const end = frontlineSessionBlockEnd(blob, idx, dateOfService);
    const slice = blob.slice(idx, end);
    const notesMatch = slice.match(
      /(?:Service Provided:|Provider Absence:|Provider Not Available:|Student Absence:|Student Not Available:|School Closed:|Staff Shortage:|Make[\s-]?up)[\s\S]*?(?=\n\s*(?:Provider\s+Signature|Telehealth:)|$)/i,
    );
    const notes = (notesMatch?.[0] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
    const absenceOnly =
      FRONTLINE_ABSENCE_LABEL_RE.test(slice) && !/Service\s+Provided\s*:/i.test(slice);
    // Missed Frontline rows have no Session Start/End — never borrow times from a later visit.
    let beginTime = '';
    let endTime = '';
    if (!absenceOnly) {
      const times = [...slice.matchAll(/(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/gi)].map((m) => m[1]!);
      beginTime = times[0] || '';
      endTime = times[1] || '';
    }
    const attendance = attendanceFromNotes(notes || slice, beginTime, endTime);
    if (attendance === 'missed') {
      beginTime = '';
      endTime = '';
    }
    const ratio = absenceOnly
      ? ''
      : (slice.match(/\b([1-9]\s*:\s*[1-9]\d?)\b/) || [])[1] || '';
    const location = schoolFromSlice(slice);
    const schoolName = location || reportSchool;
    const cpt = attendance === 'missed' ? { codes: [] as string[], totalUnits: 0, procedures: [] as string[] } : parseCptCoverage(slice);
    const noteText = notes || (absenceOnly ? slice.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
    rows.push({
      studentName: studentNameBefore(blob, idx, fallbackStudent),
      providerName,
      schoolName,
      dateOfService,
      beginTime,
      endTime,
      attendance,
      cancelReason: cancellationFromNotes(noteText || slice, attendance),
      notes: noteText || (attendance === 'missed' ? slice.replace(/\s+/g, ' ').trim().slice(0, 200) : ''),
      serviceType,
      location: location || schoolName,
      ratio,
      cptCodes: cpt.codes,
      cptUnits: cpt.totalUnits,
      cptProcedures: cpt.procedures,
      signed: sessionIsSigned(slice),
      sourceSlice: slice,
    });
  }
  return mergeFrontlineSplitCptRows(rows);
}

/** Weekly notes as extracted text — Frontline or Therapist Activity (auto-detect). */
export function parseWeeklySessionText(text: string): ParsedSessionNote[] {
  if (isTherapistActivityText(text)) {
    return parseTherapistActivityText(text);
  }
  return parseFrontlineWeeklySessionText(text);
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

/** Expand MS/HS-style tokens so Frontline Setting aliases match TMS school names. */
export function expandSchoolNameTokens(s: string): string {
  return ` ${normEntityName(s)} `
    .replace(/\bms hs\b/g, ' middle school high school ')
    .replace(/\bmiddle high\b/g, ' middle school high school ')
    .replace(/\bjr sr\b/g, ' junior senior ')
    .replace(/\bms\b/g, ' middle school ')
    .replace(/\bhs\b/g, ' high school ')
    .replace(/\bes\b/g, ' elementary school ')
    .replace(/\belem\b/g, ' elementary ')
    .replace(/\bint\b/g, ' intermediate ')
    .replace(/\bjhs\b/g, ' junior high school ')
    .replace(/\s+/g, ' ')
    .trim();
}

function schoolCoreName(s: string): string {
  return expandSchoolNameTokens(s)
    .replace(
      /\b(middle school|high school|elementary school|junior high school|junior|senior|elementary|intermediate|primary|school)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when PDF school clearly differs from the child's known school. */
export function schoolNamesConflict(pdfSchool: string, knownSchool: string): boolean {
  const a = expandSchoolNameTokens(pdfSchool);
  const b = expandSchoolNameTokens(knownSchool);
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false;
  const ca = schoolCoreName(pdfSchool);
  const cb = schoolCoreName(knownSchool);
  if (ca && cb && (ca === cb || ca.includes(cb) || cb.includes(ca))) return false;
  return true;
}
