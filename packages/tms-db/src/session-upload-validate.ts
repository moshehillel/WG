import { sessionDurationMinutes } from './provider-pay.js';

export type CptCoverage = {
  codes: string[];
  totalUnits: number;
  /** Raw CPT labels like 97110x2 */
  procedures: string[];
};

/** 1 billed unit per 15 minutes (ceil). */
export function requiredCptUnitsForDuration(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return Math.max(1, Math.ceil(durationMinutes / 15));
}

/**
 * Pull CPT codes + units from a Frontline session text slice.
 * Supports `97110x2`, `97112x1, 97110x1`, and labeled CPT Code / CPT Units lines.
 */
export function parseCptCoverage(slice: string): CptCoverage {
  const text = String(slice || '');
  const found: Array<{ code: string; units: number }> = [];

  for (const m of text.matchAll(/\b(\d{4,5})\s*[xX×]\s*(\d{1,2})\b/g)) {
    found.push({ code: m[1]!, units: Math.max(1, Number(m[2]) || 1) });
  }
  if (found.length) {
    return summarizeCpt(found);
  }

  const labeledBlocks = [
    ...text.matchAll(
      /CPT\s*Codes?\s*:?\s*(\d{4,5})(?:[^\d]{0,40}?CPT\s*Units?\s*:?\s*(\d{1,2}))?/gi,
    ),
  ];
  for (const m of labeledBlocks) {
    found.push({ code: m[1]!, units: Math.max(1, Number(m[2] || '1') || 1) });
  }
  if (found.length) {
    const unitsOnly = text.match(/CPT\s*Units?\s*:?\s*(\d{1,2})/i);
    if (found.length === 1 && unitsOnly?.[1] && !labeledBlocks[0]?.[2]) {
      found[0]!.units = Math.max(1, Number(unitsOnly[1]) || 1);
    }
    return summarizeCpt(found);
  }

  // Bare therapy CPT codes (OT/PT/SLP ranges) with optional nearby unit.
  const bareRe = /\b(97\d{3}|925\d{2}|926\d{2}|961\d{2}|975\d{2})\b/g;
  for (const m of text.matchAll(bareRe)) {
    const code = m[1]!;
    const at = m.index ?? 0;
    const after = text.slice(at + code.length, at + code.length + 24);
    const unitNear = after.match(/^\s*[xX×]\s*(\d{1,2})\b/) || after.match(/^\s+(\d{1,2})\b/);
    const unitTok = unitNear?.[1];
    // Don't treat another CPT code as this code's unit count.
    if (unitTok && /^(97\d{3}|925\d{2}|926\d{2}|961\d{2}|975\d{2})$/.test(unitTok)) {
      found.push({ code, units: 1 });
    } else {
      found.push({ code, units: unitTok ? Math.max(1, Number(unitTok) || 1) : 1 });
    }
  }
  return summarizeCpt(found);
}

function summarizeCpt(found: Array<{ code: string; units: number }>): CptCoverage {
  const byCode = new Map<string, number>();
  for (const row of found) {
    byCode.set(row.code, Math.max(byCode.get(row.code) || 0, row.units));
  }
  const codes = [...byCode.keys()];
  const procedures = codes.map((c) => `${c}x${byCode.get(c)}`);
  const totalUnits = [...byCode.values()].reduce((a, n) => a + n, 0);
  return { codes, totalUnits, procedures };
}

/** Untimed speech/language CPT codes — 1 unit covers the whole session (not 15-min). */
const UNTIMED_SESSION_CPT = new Set([
  '92507',
  '92508',
  '92521',
  '92522',
  '92523',
  '92524',
  '92610',
]);

export function cptCodesAreUntimedSession(codes: string[]): boolean {
  const list = (codes || []).map((c) => String(c || '').trim()).filter(Boolean);
  return list.length > 0 && list.every((c) => UNTIMED_SESSION_CPT.has(c));
}

export function cptDurationError(
  beginTime: string,
  endTime: string,
  sliceOrCoverage: string | CptCoverage,
  attendance: string,
): string | null {
  if (attendance !== 'attended' && attendance !== 'makeup') return null;
  const coverage =
    typeof sliceOrCoverage === 'string' ? parseCptCoverage(sliceOrCoverage) : sliceOrCoverage;
  const minutes = sessionDurationMinutes(beginTime, endTime);
  // Always require at least one CPT unit for attended/makeup — even when clock duration
  // cannot be parsed (otherwise "attended + no CPT" silently skipped the locker).
  if (minutes == null || minutes <= 0) {
    if (!coverage.codes.length || coverage.totalUnits < 1) {
      return 'CPT units missing for attended/makeup session (need at least 1 unit).';
    }
    return null;
  }
  const required = requiredCptUnitsForDuration(minutes);
  // 92507/92508 etc. are session-based (1 unit), not timed 15-min codes.
  if (cptCodesAreUntimedSession(coverage.codes) && coverage.totalUnits >= 1) return null;
  if (coverage.totalUnits >= required) return null;
  if (!coverage.codes.length) {
    return (
      `CPT units missing for a ${minutes}-minute session ` +
      `(need ${required} unit(s) — 1 per 15 minutes).`
    );
  }
  return (
    `CPT units (${coverage.procedures.join(', ') || coverage.totalUnits}) cover ` +
    `${coverage.totalUnits}×15 min but session is ${minutes} min (need ${required} unit(s)).`
  );
}

/** Strip labels/punctuation so “twitch different” notes still compare equal when copy-pasted. */
export function normalizeNoteForCompare(notes: string): string {
  return String(notes || '')
    .toLowerCase()
    .replace(
      /\b(service provided|student absence|student not available|provider absence|provider not available|school closed|staff shortage|make[\s-]?up)\b:?/gi,
      '',
    )
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Missed / empty absence templates must not be copy-paste sources for attended notes. */
export function noteIsCopyPasteSource(attendance: string, notes: string): boolean {
  if (attendance === 'missed') return false;
  const normalized = normalizeNoteForCompare(notes);
  if (!normalized) return false;
  // Bare miss labels left after stripping still aren't real clinical notes.
  if (
    /^(providerabsence|studentabsence|studentnotavailable|providernotavailable|schoolclosed|staffshortage|cancelled|canceled|noshow)$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return true;
}

export function notesLookCopyPasted(a: string, b: string): boolean {
  const na = normalizeNoteForCompare(a);
  const nb = normalizeNoteForCompare(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** Frontline missed-session reason dropdown labels (free-text after the label is OK). */
export const FRONTLINE_MISSED_REASONS = [
  'Student Not Available',
  'Provider Not Available',
  'School Closed',
  'Staff Shortage',
  'Student Absence',
  'Provider Absence',
] as const;

/** Match a Frontline miss reason label anywhere in text (allows `Label: details`). */
export const FRONTLINE_MISSED_REASON_RE =
  /\b(?:student\s+not\s+available|provider\s+not\s+available|school\s+closed|staff\s+shortage|student\s+absence|provider\s+absence)\b/i;

/** Canonical Frontline label when notes/cancelReason match a known miss reason; else ''. */
export function matchFrontlineMissedReason(text: string): string {
  const n = String(text || '');
  if (!n.trim()) return '';
  if (/provider\s+absence/i.test(n)) return 'Provider Absence';
  if (/student\s+absence/i.test(n)) return 'Student Absence';
  if (/student\s+not\s+available/i.test(n)) return 'Student Not Available';
  if (/provider\s+not\s+available/i.test(n)) return 'Provider Not Available';
  if (/school\s+closed/i.test(n)) return 'School Closed';
  if (/staff\s+shortage/i.test(n)) return 'Staff Shortage';
  return '';
}

/** True when missed-note text / cancelReason carries a Frontline miss reason from the allowed set. */
export function hasMissedSessionReason(cancelReason: string, notes: string): boolean {
  return Boolean(
    matchFrontlineMissedReason(cancelReason) || matchFrontlineMissedReason(notes),
  );
}

export function missedSessionReasonError(
  attendance: string,
  cancelReason: string,
  notes: string,
): string | null {
  if (attendance !== 'missed') return null;
  if (hasMissedSessionReason(cancelReason, notes)) return null;
  return (
    'Missed session needs a Frontline reason ' +
    `(${FRONTLINE_MISSED_REASONS.join(', ')}).`
  );
}

export function noteCopyPasteError(
  thisChild: string,
  otherChild: string,
  dateOfService: string,
): string {
  const a = String(thisChild || '').trim() || 'this child';
  const b = String(otherChild || '').trim() || 'another child';
  const dos = String(dateOfService || '').trim();
  return (
    `Notes look copy-pasted from ${b}` +
    (dos ? ` (same as ${b} on ${dos})` : '') +
    ` — change the note for ${a} so it is at least slightly different.`
  );
}

/**
 * Frontline signed sessions include a filled Provider Signature/Credentials block, e.g.:
 *   Provider Signature/Credentials
 *   Date
 *   James Vasaturo PT (NPI# ) (License# 1003072075)
 *   Jun 1 2026 10:49AM
 *
 * Therapist Activity Output uses:
 *   Signed:
 *   8/14/2026
 *   Wiglishai Astacio, M.S.,
 *   CCC-SLP, TSSLD
 */
export function sessionIsSigned(slice: string): boolean {
  const text = String(slice || '');
  if (/Provider\s+Signature\s*\/?\s*Credentials/i.test(text)) {
    const after = text.split(/Provider\s+Signature\s*\/?\s*Credentials/i)[1] || '';
    const block = after.slice(0, 320);
    const hasSigner =
      /License#\s*\d+/i.test(block) ||
      /\b(?:PT|OT|SLP|DPT|MS|MA|CCC(?:-SLP)?)\b/.test(block);
    const hasStamp =
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+\d{4}\b/i.test(block);
    if (hasSigner && hasStamp) return true;
  }
  // Therapist Activity: Signed: <date> <name + credentials>
  const signed = text.match(
    /Signed:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([A-Za-z][A-Za-z .'-]{1,80})/i,
  );
  if (signed) {
    const block = text.slice(signed.index ?? 0, (signed.index ?? 0) + 280);
    const hasCred =
      /\b(?:CCC-SLP|TSSLD|License#\s*\d+|\b(?:PT|OT|SLP|DPT|M\.?S\.?|M\.?A\.?)\b)/i.test(block);
    if (hasCred) return true;
  }
  return false;
}

export function sessionSignatureError(slice: string, attendance: string): string | null {
  if (attendance !== 'attended' && attendance !== 'makeup') return null;
  if (sessionIsSigned(slice)) return null;
  return (
    'Session is not signed — each attended/makeup session needs a signature ' +
    '(Frontline Provider Signature/Credentials, or Therapist Activity Signed date + credentials).'
  );
}

