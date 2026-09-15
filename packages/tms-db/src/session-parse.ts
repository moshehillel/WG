import { notesMentionNoPeerAvailable } from './mandate.js';
import { extractMakeupForDate, MAKEUP_COVERED_DATE_PREFIX } from './makeup-date.js';
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
const SERVICE_PROVIDED_RE = /Service\s+Provided\s*:/i;

/**
 * Clip long Frontline notes for storage without dropping mandate-routing phrases
 * that often appear at the end (e.g. "no partner available", "makeup session").
 */
export function clipSessionNotes(raw: string, max = 800): string {
  const full = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (full.length <= max) return full;
  const head = full.slice(0, max);
  const bits: string[] = [];
  if (notesMentionNoPeerAvailable(full) && !notesMentionNoPeerAvailable(head)) {
    bits.push('no partner available');
  }
  if (
    /\b(?:makeup|make[\s-]?up)\s+session\b|\bmake[\s-]?up\s+for\b/i.test(full) &&
    !/\b(?:makeup|make[\s-]?up)\s+session\b|\bmake[\s-]?up\s+for\b/i.test(head)
  ) {
    bits.push('makeup session');
  }
  if (!bits.length) return head;
  const suffix = ` ${bits.join('; ')}`;
  const budget = Math.max(0, max - suffix.length);
  return `${full.slice(0, budget).trim()}${suffix}`;
}

/** Combine Frontline Service header + per-session ratio (1:1 / 2:1) for mandate matching. */
export function serviceTypeWithRatio(serviceType: string, ratio: string): string {
  const base = String(serviceType || '').trim();
  const r = String(ratio || '').replace(/\s+/g, '').trim();
  if (!r) return base;
  if (new RegExp(`\\b${r.replace(':', '\\s*:\\s*')}\\b`, 'i').test(base)) return base;
  return [base, r].filter(Boolean).join(' ').trim();
}

/**
 * Peer/partner/group-mate absence is not a miss for this student when service was provided.
 * Scrub those phrases so bare "absent" in MISSED_RE does not false-trigger.
 */
function scrubPeerAbsentPhrases(notes: string): string {
  const who =
    'peers?|partners?|classmates?|groupmates?|group\\s*mates?|group\\s*partners?';
  const otherWho =
    'student|child|peer|partner|member|participant|group\\s*mate|group\\s*partner|classmate';
  return String(notes || '')
    .replace(
      new RegExp(
        `\\bno\\s+(?:other\\s+)?(?:${who})\\b` +
          `|\\b(?:${who})\\s+(?:were\\s+|was\\s+|are\\s+|is\\s+)?(?:not\\s+|un)?available\\b` +
          `|\\bno\\s+other\\s+(?:${otherWho})s?\\b` +
          `|\\b(?:other\\s+)?(?:${otherWho})s?.{0,32}(?:absent|unavailable|missing)\\b` +
          `|\\b(?:his|her|their|the)\\s+(?:${who})\\s+(?:is|was|are|were)\\s+absent\\b`,
        'gi',
      ),
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

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
  // Solo group: peer/group mate absent + Service Provided → this student attended.
  if (SERVICE_PROVIDED_RE.test(n) && notesMentionNoPeerAvailable(n)) {
    if (MAKEUP_RE.test(n) && /make[\s-]?up\s+(?:for|session)/i.test(n)) return 'makeup';
    return 'attended';
  }
  const forMissScan = scrubPeerAbsentPhrases(n);
  // Makeup wins only when it is clearly a makeup session (not "will make up later" on an absence).
  if (MAKEUP_RE.test(n) && !MISSED_RE.test(forMissScan)) return 'makeup';
  if (
    MAKEUP_RE.test(n) &&
    /make[\s-]?up\s+(?:for|session)/i.test(n) &&
    !FRONTLINE_MISSED_REASON_RE.test(n)
  ) {
    return 'makeup';
  }
  if (MISSED_RE.test(forMissScan) && !/make[\s-]?up session/i.test(n)) return 'missed';
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

/**
 * Frontline rows often put group size / page / ratio tokens on their own line
 * (e.g. "1", "1:1"). Those must never win over a real building name.
 */
function isNumericOrRatioSchoolToken(name: string): boolean {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return true;
  if (/^\d+(?:\.\d+)?$/.test(n)) return true;
  if (/^[1-9]\s*:\s*[1-9]\d?$/.test(n)) return true;
  // Building / school labels need letters; reject punctuation-only scraps.
  if (!/[A-Za-z]/.test(n)) return true;
  if (n.length < 3) return true;
  return false;
}

function takeSchoolLabel(raw: string): string {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (
    !name ||
    isNumericOrRatioSchoolToken(name) ||
    isServiceTypeSchoolLabel(name) ||
    isGenericSettingLabel(name)
  ) {
    return '';
  }
  return name;
}

/** True when a Frontline label is a district/agency header, not a building. */
export function looksLikeDistrictLabel(name: string): boolean {
  const n = normEntityName(name);
  if (!n) return false;
  return /\b(ufsd|cufsd|union free|school district|district|boces|agency)\b/.test(n);
}

function isDistrictAgencyHeaderContext(before: string): boolean {
  return /District\s*\/\s*Agency\s*\/\s*BOCES\s*:\s*$/i.test(before) ||
    /\b(?:District|Agency|BOCES)\s*:\s*$/i.test(before);
}

function extractSchoolName(blob: string): string {
  const labeled =
    (blob.match(/\bSetting\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    (blob.match(/\bSchool(?:\s*Name)?\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    (blob.match(/\bRecommended School\s*:\s*([^\n]+)/i) || [])[1]?.trim() ||
    '';
  const fromLabel = takeSchoolLabel(labeled);
  if (fromLabel && !looksLikeDistrictLabel(fromLabel)) return fromLabel;
  const re = new RegExp(SCHOOL_NAME_RE.source, 'g');
  for (const m of blob.matchAll(re)) {
    const name = takeSchoolLabel(m[1] || '');
    if (!name) continue;
    const before = blob.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (/Service:\s*$/i.test(before)) continue;
    // Frontline header "District/Agency/BOCES: Westbury Union Free School District"
    // is not the child's building — prefer Setting / per-session lines instead.
    if (isDistrictAgencyHeaderContext(before) || looksLikeDistrictLabel(name)) continue;
    return name;
  }
  return '';
}

/**
 * Frontline often prints the building on its own line (no "Setting:") between the
 * date/time row and "Service Provided" / absence labels — e.g. "Powells Lane".
 */
function frontlineUnlabeledSetting(slice: string): string {
  const lines = String(slice || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue;
    if (/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i.test(line)) continue;
    if (/^(?:Service Provided|Provider Absence|Provider Not Available|Student Absence|Student Not Available|School Closed|Staff Shortage|Provider Signature|Telehealth|Make[\s-]?up)\b/i.test(line)) {
      break;
    }
    // Labeled Setting/School already handled above; if the value was rejected (e.g. "1"), skip the line.
    if (/^(?:Setting|School(?:\s*Name)?|Recommended School)\s*:/i.test(line)) continue;
    if (/^(?:Ratio|CPT|ICD|Units|Session|Log Type|Notes)\b/i.test(line)) continue;
    if (/^[Rr]\d{2}(?:\.\d+)?$/.test(line)) continue;
    if (/^\d{4,5}(?:\s*x\s*\d+)?$/.test(line)) continue;
    if (isNumericOrRatioSchoolToken(line)) continue;
    const name = takeSchoolLabel(line);
    if (!name || looksLikeDistrictLabel(name)) continue;
    // Building names are short; skip long narrative / note lines.
    if (name.split(/\s+/).length > 8) continue;
    if (name.length > 60) continue;
    return name;
  }
  return '';
}

function schoolFromSlice(slice: string): string {
  const setting = takeSchoolLabel((slice.match(/\bSetting\s*:\s*([^\n]+)/i) || [])[1] || '');
  if (setting && !looksLikeDistrictLabel(setting)) return setting;
  const unlabeled = frontlineUnlabeledSetting(slice);
  if (unlabeled) return unlabeled;
  const re = new RegExp(SCHOOL_NAME_RE.source, 'g');
  for (const m of slice.matchAll(re)) {
    const name = takeSchoolLabel(m[1] || '');
    if (!name || looksLikeDistrictLabel(name)) continue;
    return name;
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

    let fullNotes = '';
    const notesStart = slice.search(/\b(?:925\d{2}|97\d{3}|961\d{2}|975\d{2})x\d+\b/i);
    if (notesStart >= 0) {
      const afterCpt = slice.slice(notesStart).replace(/^(?:[\d,xX×\s]|F\d{2}(?:\.\d+)?)+/, '');
      fullNotes = afterCpt
        .replace(/\s*Notes\s+Entered:[\s\S]*$/i, '')
        .replace(/\s*Signed:[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    // Missed Therapist Activity rows often have no CPT — pull a short absence label when present.
    // Leave notes empty otherwise; attendance still reads the full slice below.
    if (!fullNotes) {
      const absenceHit = slice.match(
        /\b((?:Provider\s+Absence|Student\s+Absence|Student\s+Not\s+Available|Student\s+Absent|Absent|Missed|Cancelled|Canceled|No[\s-]?Show)[:\s][\s\S]*?)(?=\s*Notes\s+Entered:|\s*Signed:|$)/i,
      );
      if (absenceHit?.[1]) {
        fullNotes = absenceHit[1].replace(/\s+/g, ' ').trim();
      }
    }
    const makeupFor =
      extractMakeupForDate(fullNotes) || extractMakeupForDate(slice);
    if (makeupFor && !/make\s*up\s*for\s*:/i.test(fullNotes)) {
      fullNotes = `Make up for: ${makeupFor}${fullNotes ? ` ${fullNotes}` : ''}`.trim();
    }
    const notes = clipSessionNotes(fullNotes);

    // Use fullNotes || slice so absence / peer-absent keywords still classify correctly.
    const attendance: ParsedSessionNote['attendance'] = makeupFor
      ? 'makeup'
      : attendanceFromNotes(fullNotes || slice, hit.beginTime, hit.endTime);
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
      cancelReason: cancellationFromNotes(fullNotes || slice, attendance),
      notes,
      serviceType: serviceTypeWithRatio(mapped.serviceType, ratio),
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
  const before = blob.slice(Math.max(0, idx - 64), idx);
  if (/\bFrom:\s*$/i.test(before) || /\bTo:\s*$/i.test(before) || /D\.?O\.?B\.?\s*$/i.test(before)) {
    return false;
  }
  // Covered-miss dates inside makeup notes (e.g. "make-up session 9/3/26") must not
  // become their own session rows — that invents phantom misses on the wrong day.
  if (new RegExp(`${MAKEUP_COVERED_DATE_PREFIX}\\s*:?\\s*$`, 'i').test(before)) {
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
    // Classify attendance from the full note block before clipping for storage.
    let fullNotes = String(notesMatch?.[0] || '')
      .replace(/\s+/g, ' ')
      .trim();
    const makeupFor =
      extractMakeupForDate(fullNotes) || extractMakeupForDate(slice);
    if (makeupFor && !/make\s*up\s*for\s*:/i.test(fullNotes)) {
      fullNotes = `Make up for: ${makeupFor}${fullNotes ? ` ${fullNotes}` : ''}`.trim();
    }
    const notes = clipSessionNotes(fullNotes);
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
    const attendance: ParsedSessionNote['attendance'] = makeupFor
      ? 'makeup'
      : attendanceFromNotes(fullNotes || slice, beginTime, endTime);
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
      serviceType: serviceTypeWithRatio(serviceType, ratio),
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
      /\b(union free school district|union free|school district|ufsd|cufsd|boces|agency|district)\b/g,
      ' ',
    )
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

/**
 * PDF school vs child's building (+ optional district / program type).
 * District-level Frontline headers (e.g. "Westbury Union Free School District")
 * may match the child's program type / school.district even when the caseload
 * school is a building name like "Powells Lane". Concrete building names still
 * must match the child's building.
 */
export function pdfSchoolConflictsWithChild(
  pdfSchool: string,
  known: { name?: string; district?: string },
  programType?: string,
): boolean {
  const pdf = String(pdfSchool || '').trim();
  const building = String(known?.name || '').trim();
  if (!pdf || !building) return false;
  if (!schoolNamesConflict(pdf, building)) return false;
  if (!looksLikeDistrictLabel(pdf)) return true;
  const district = String(known?.district || '').trim();
  if (district && !schoolNamesConflict(pdf, district)) return false;
  const pt = String(programType || '').trim();
  if (pt && !schoolNamesConflict(pdf, pt)) return false;
  return true;
}
