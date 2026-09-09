import { isoDate, parseDos } from './ids.js';
import { isIsoDate, normalizeOffDays } from './school-calendar.js';

export type ParsedSchoolCalendarPdf = {
  yearStart: string;
  yearEnd: string;
  offDays: string[];
  warnings: string[];
};

export const SCHOOL_CALENDAR_PDF_NO_TEXT_ERROR =
  'Could not read text from this PDF. Upload a text-based school calendar PDF (not a scanned image). Scanned calendars need OCR and are not supported.';

export const SCHOOL_CALENDAR_PDF_HINT =
  'Works best with district calendars that list holidays/closed days in text (e.g. “Thanksgiving Recess Nov 27–28, 2025”). Image-only scans will not work.';

const MONTH_MAP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_ALT = Object.keys(MONTH_MAP).join('|');

/** Lines that look like closed / holiday / no-school entries. */
const OFF_LINE_RE =
  /\b(closed|holiday|holidays|recess|break|vacation|no\s*school|schools?\s+closed|off\s*day|half[\s-]?day|staff\s+development|superintendent|conference|election|memorial|labor\s+day|columbus|thanksgiving|christmas|winter\s+recess|spring\s+recess|mid[\s-]?winter|presidents|mlk|martin\s+luther|good\s+friday|passover|rosh|yom\s+kippur|sukkot|chanukah|hanukkah|eid|diwali)\b/i;

/** Labels for first / last instructional day (not off days). */
const YEAR_START_RE =
  /\b(first\s+day(?:\s+of\s+(?:school|classes|instruction))?|opening\s+day|school\s+begins|classes?\s+begin|students?\s+return|year\s+start|start\s+of\s+school)\b/i;
const YEAR_END_RE =
  /\b(last\s+day(?:\s+of\s+(?:school|classes|instruction))?|closing\s+day|school\s+ends|classes?\s+end|year\s+end|end\s+of\s+school|graduation)\b/i;

function utcDate(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return isoDate(dt);
}

function coerceYear(y: number, defaultYear: number): number {
  if (y >= 100) return y;
  if (y < 0) return defaultYear;
  // 0–99 → 2000+
  return 2000 + y;
}

/** Collect 4-digit years and academic-year pairs like 2025-2026. */
function detectYears(text: string): { years: number[]; academicStart?: number; academicEnd?: number } {
  const years = [
    ...new Set(
      [...String(text || '').matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])).filter(Boolean),
    ),
  ].sort();
  const academic = String(text || '').match(/\b(20\d{2})\s*[-–—/]\s*(20\d{2})\b/);
  if (academic) {
    return {
      years,
      academicStart: Number(academic[1]),
      academicEnd: Number(academic[2]),
    };
  }
  return { years };
}

/**
 * Infer calendar year for a month when the PDF omits the year.
 * Prefer academic year: Aug–Dec → start year, Jan–Jul → end year.
 */
function yearForMonth(
  month: number,
  ctx: { academicStart?: number; academicEnd?: number; years: number[]; fallback: number },
): number {
  if (ctx.academicStart && ctx.academicEnd) {
    return month >= 8 ? ctx.academicStart : ctx.academicEnd;
  }
  if (ctx.years.length === 1) return ctx.years[0]!;
  if (ctx.years.length >= 2) {
    const lo = ctx.years[0]!;
    const hi = ctx.years[ctx.years.length - 1]!;
    return month >= 8 ? lo : hi;
  }
  return ctx.fallback;
}

function expandInclusiveRange(startIso: string, endIso: string): string[] {
  if (!isIsoDate(startIso) || !isIsoDate(endIso) || startIso > endIso) return [];
  // Guard runaway ranges (e.g. bad parse spanning a full year).
  const start = parseDos(startIso)!;
  const end = parseDos(endIso)!;
  const maxDays = 120;
  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur <= end && out.length < maxDays) {
    out.push(isoDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

type DateHit = { iso: string; index: number };

/** Parse MM/DD/YYYY and Month DD[, YYYY] (and ranges) from a line. */
function extractDatesFromLine(
  line: string,
  lineOffset: number,
  yearCtx: { academicStart?: number; academicEnd?: number; years: number[]; fallback: number },
): DateHit[] {
  const hits: DateHit[] = [];
  const s = String(line || '');

  // MM/DD/YYYY or MM/DD/YY — including ranges like 12/24/25 – 1/2/26
  const slashRe =
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*[-–—to]+\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = slashRe.exec(s))) {
    const y1 = coerceYear(Number(m[3]), yearCtx.fallback);
    const start = utcDate(y1, Number(m[1]), Number(m[2]));
    if (!start) continue;
    if (m[4] && m[5] && m[6]) {
      const y2 = coerceYear(Number(m[6]), yearCtx.fallback);
      const end = utcDate(y2, Number(m[4]), Number(m[5]));
      if (end) {
        for (const iso of expandInclusiveRange(start, end)) {
          hits.push({ iso, index: lineOffset + (m.index ?? 0) });
        }
        continue;
      }
    }
    hits.push({ iso: start, index: lineOffset + (m.index ?? 0) });
  }

  // Month DD[, YYYY] – Month DD[, YYYY]  OR  Month DD–DD[, YYYY]  OR  Month DD[, YYYY]
  const monthNameRe = new RegExp(
    `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*[-–—]\\s*(\\d{1,2})(?:st|nd|rd|th)?)?` +
      `(?:\\s*,?\\s*(20\\d{2}|\\d{2}))?` +
      `(?:\\s*[-–—to]+\\s*(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*,?\\s*(20\\d{2}|\\d{2}))?)?`,
    'gi',
  );
  while ((m = monthNameRe.exec(s))) {
    const mon1 = MONTH_MAP[m[1]!.toLowerCase()]!;
    const day1 = Number(m[2]);
    const sameMonthEndDay = m[3] ? Number(m[3]) : null;
    const year1Raw = m[4] ? Number(m[4]) : null;
    const mon2Name = m[5];
    const day2 = m[6] ? Number(m[6]) : null;
    const year2Raw = m[7] ? Number(m[7]) : null;

    const y1 =
      year1Raw != null
        ? coerceYear(year1Raw, yearCtx.fallback)
        : yearForMonth(mon1, yearCtx);
    const start = utcDate(y1, mon1, day1);
    if (!start) continue;

    if (sameMonthEndDay != null && !mon2Name) {
      const end = utcDate(y1, mon1, sameMonthEndDay);
      if (end) {
        for (const iso of expandInclusiveRange(start, end)) {
          hits.push({ iso, index: lineOffset + (m.index ?? 0) });
        }
        continue;
      }
    }

    if (mon2Name && day2 != null) {
      const mon2 = MONTH_MAP[mon2Name.toLowerCase()]!;
      const y2 =
        year2Raw != null
          ? coerceYear(year2Raw, yearCtx.fallback)
          : year1Raw != null
            ? // Cross-year range without end year: Dec → Jan uses next academic year
              mon2 < mon1
              ? y1 + 1
              : y1
            : yearForMonth(mon2, yearCtx);
      const end = utcDate(y2, mon2, day2);
      if (end) {
        for (const iso of expandInclusiveRange(start, end)) {
          hits.push({ iso, index: lineOffset + (m.index ?? 0) });
        }
        continue;
      }
    }

    hits.push({ iso: start, index: lineOffset + (m.index ?? 0) });
  }

  return hits;
}

function firstDateNearLabel(text: string, labelRe: RegExp, yearCtx: ReturnType<typeof detectYears> & { fallback: number }): string {
  const lines = String(text || '').split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (labelRe.test(line)) {
      const hits = extractDatesFromLine(line, offset, yearCtx);
      if (hits[0]) return hits[0].iso;
      // Sometimes the date is on the next line
    }
    offset += line.length + 1;
  }
  // Whole-blob fallback: label then date within ~80 chars
  const blob = String(text || '').replace(/\s+/g, ' ');
  const m = labelRe.exec(blob);
  if (m) {
    const slice = blob.slice(m.index, m.index + 100);
    const hits = extractDatesFromLine(slice, 0, yearCtx);
    if (hits[0]) return hits[0].iso;
  }
  return '';
}

/**
 * Extract school year bounds and closed/off days from calendar PDF text.
 * Prefer labeled first/last days; off days from holiday/closed lines and ranges.
 */
export function parseSchoolCalendarPdfText(text: string): ParsedSchoolCalendarPdf {
  const warnings: string[] = [];
  const raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) {
    return { yearStart: '', yearEnd: '', offDays: [], warnings: ['No calendar text to parse.'] };
  }

  const detected = detectYears(raw);
  const fallbackYear = detected.academicStart || detected.years[0] || new Date().getUTCFullYear();
  const yearCtx = { ...detected, fallback: fallbackYear };

  const yearStart = firstDateNearLabel(raw, YEAR_START_RE, yearCtx);
  const yearEnd = firstDateNearLabel(raw, YEAR_END_RE, yearCtx);

  const offHits: DateHit[] = [];
  const lines = raw.split(/\n/);
  let offset = 0;
  let offLineCount = 0;
  for (const line of lines) {
    if (OFF_LINE_RE.test(line) && !YEAR_START_RE.test(line) && !YEAR_END_RE.test(line)) {
      offLineCount += 1;
      offHits.push(...extractDatesFromLine(line, offset, yearCtx));
    }
    offset += line.length + 1;
  }

  // If few labeled off lines, also pull dates from a "Closed / Holidays / Recess" section
  // until the next major heading.
  if (offHits.length < 3) {
    const sectionRe =
      /(?:^|\n)\s*((?:school\s+)?(?:holidays?|closed\s+days?|recess(?:es)?|vacation|no\s+school)\s*[^\n]*)([\s\S]{0,2500}?)(?=\n\s*(?:first\s+day|last\s+day|marking\s+period|report\s+card|important|calendar|notes?\b)|$)/i;
    const sec = sectionRe.exec(raw);
    if (sec) {
      const chunk = `${sec[1]}\n${sec[2]}`;
      offHits.push(...extractDatesFromLine(chunk, sec.index, yearCtx));
      // Also line-by-line inside the section for multi-line holiday lists
      let secOff = sec.index;
      for (const line of chunk.split(/\n/)) {
        if (OFF_LINE_RE.test(line) || /\d/.test(line)) {
          offHits.push(...extractDatesFromLine(line, secOff, yearCtx));
        }
        secOff += line.length + 1;
      }
    }
  }

  // Strip yearStart/yearEnd from off days if they were also matched as holidays.
  let offDays = normalizeOffDays(offHits.map((h) => h.iso));
  if (yearStart) offDays = offDays.filter((d) => d !== yearStart);
  if (yearEnd) offDays = offDays.filter((d) => d !== yearEnd);

  // If still no off days but we found many dates on off-keyword lines elsewhere failed —
  // last resort: any line with a date + short holiday-ish word nearby in the blob.
  if (offDays.length === 0) {
    const looseRe = new RegExp(OFF_LINE_RE.source, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = looseRe.exec(raw))) {
      const slice = raw.slice(Math.max(0, hit.index - 20), hit.index + 120);
      offHits.push(...extractDatesFromLine(slice, 0, yearCtx));
    }
    offDays = normalizeOffDays(offHits.map((h) => h.iso));
    if (yearStart) offDays = offDays.filter((d) => d !== yearStart);
    if (yearEnd) offDays = offDays.filter((d) => d !== yearEnd);
  }

  if (!yearStart && !yearEnd && offDays.length === 0) {
    warnings.push(
      'No school dates found. Use a text-based calendar that lists holidays or closed days (MM/DD/YYYY or Month Day).',
    );
  } else if (offDays.length === 0) {
    warnings.push(
      'Found school year dates but no clear off days. Add holidays manually or check that closed days are listed in text.',
    );
  }

  if (offLineCount === 0 && offDays.length > 0) {
    warnings.push('Off days were inferred from a holidays/closed section; please review before saving.');
  }

  return {
    yearStart,
    yearEnd,
    offDays,
    warnings,
  };
}

/** Merge PDF parse into an existing calendar (dedupe off days; keep existing bounds unless PDF has clearer ones). */
export function mergeSchoolCalendarParse(
  existing: { yearStart?: string; yearEnd?: string; offDays?: string[] } | null | undefined,
  parsed: ParsedSchoolCalendarPdf,
): { yearStart: string; yearEnd: string; offDays: string[] } {
  const prevStart = String(existing?.yearStart || '').trim();
  const prevEnd = String(existing?.yearEnd || '').trim();
  let yearStart = parsed.yearStart || prevStart;
  let yearEnd = parsed.yearEnd || prevEnd;

  // If PDF had neither bound, optionally infer from off-day span only when both ends empty
  // and we have a wide enough set — prefer leaving empty so admin can set first/last.
  if (!yearStart && !yearEnd && !prevStart && !prevEnd && parsed.offDays.length >= 2) {
    // Do not auto-set first/last from off days — that would wrong-foot mandate tracking.
  }

  const offDays = normalizeOffDays([...(existing?.offDays || []), ...parsed.offDays]);
  if (yearStart && yearEnd && yearStart > yearEnd) {
    // Prefer PDF pair if both present; else keep previous order-safe pair
    if (parsed.yearStart && parsed.yearEnd && parsed.yearStart <= parsed.yearEnd) {
      yearStart = parsed.yearStart;
      yearEnd = parsed.yearEnd;
    } else if (prevStart && prevEnd && prevStart <= prevEnd) {
      yearStart = prevStart;
      yearEnd = prevEnd;
    } else {
      yearEnd = '';
    }
  }
  return { yearStart, yearEnd, offDays };
}
