/**
 * Covered-miss slash-date phrases in Frontline / Therapist Activity notes.
 * Leaf module (no package imports) so session-parse and makeup can share it
 * without circular ESM init.
 */
/**
 * makeup / make-up / make up, plus a repeated leading M ("MMAKE-UP for 10/8/26").
 * m+ake[\s-]?up matches makeup, make-up, make up, and mmake-up.
 */
const MAKEUP_TOKEN = 'm+ake[\\s-]?up';

/**
 * "for" and "from" both introduce the covered miss
 * ("makeup for 10/8/26", "makeup session from 10/6/26").
 * Bare "from" later in the note is not a covered date.
 */
const MAKEUP_PREP = '(?:for|from)';

/**
 * Covered-miss date prefixes (longest phrases first).
 * Supports: Makeup for/from (date) | makeup session for/from (date) |
 * make up / make-up (space or hyphen) as makeup synonyms |
 * makeup for missed session on (date) | missed session on (date) | …
 * Dates may be slash (9/14, 9/14/26) or month-name (sept 14, Sep 14, September 14).
 */
export const MAKEUP_COVERED_DATE_PREFIX =
  '(?:' +
  `(?:${MAKEUP_TOKEN})\\s+${MAKEUP_PREP}\\s+missed(?:\\s+session)?(?:\\s+on)?|` +
  'missed(?:\\s+session)?(?:\\s+on)?|' +
  `(?:${MAKEUP_TOKEN})\\s+${MAKEUP_PREP}|` +
  `(?:${MAKEUP_TOKEN})\\s+session(?:\\s+${MAKEUP_PREP})?|` +
  'original(?:\\s+date|\\s+dos)?|' +
  'for(?:\\s+date)?' +
  ')';

export const MAKEUP_WORD_RE = new RegExp(`\\b(?:${MAKEUP_TOKEN})\\b`, 'i');

/**
 * "Make up session" / "make-up for" / "makeup from" / "MMAKE-UP for" is a makeup.
 * Bare "will make up later" is not, so a later "missed on September 24"
 * must not steal a covered date.
 */
export const MAKEUP_PHRASE_RE = new RegExp(
  `\\b(?:${MAKEUP_TOKEN})\\s+(?:session|for|from)\\b`,
  'i',
);

const DATE_WITH_YEAR = '(\\d{1,2}/\\d{1,2}/\\d{2,4})';
const DATE_OPT_YEAR = '(\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)';

/** Month names / abbreviations (incl. "sept") → 1–12. */
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

/**
 * Captures month-name dates: sept 14 | Sep. 14 | September 14th | Sept 14, 2026 | Sept 14 26
 * Groups: 1=month, 2=day, 3=optional year.
 */
const MONTH_NAME_DATE =
  `((${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:(?:,\\s*|\\s+)(20\\d{2}|\\d{2}))?)`;

export type ExtractMakeupForDateOpts = {
  /** Session DOS used to infer calendar year when notes say "9/9" without a year. */
  referenceDos?: string;
};

function yearAndMonthFromReferenceDos(
  referenceDos?: string,
): { year: number; month: number } | null {
  const s = String(referenceDos || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]) };
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return { year, month: Number(m[1]) };
}

/** Attach a calendar year to bare M/D using the makeup session's DOS. */
export function inferMakeupCoveredYear(
  monthDay: string,
  referenceDos?: string,
): string {
  const raw = String(monthDay || '').trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) return raw;
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!md) return raw;
  const ref = yearAndMonthFromReferenceDos(referenceDos);
  if (!ref) return raw;
  const coveredMonth = Number(md[1]);
  // School-year wrap: makeup in Jan for a Dec miss → previous calendar year.
  let year = ref.year;
  if (coveredMonth > ref.month) year -= 1;
  return `${Number(md[1])}/${Number(md[2])}/${year}`;
}

/** Normalize a month-name RegExp match to M/D or M/D/YYYY (then infer year if needed). */
function monthNameMatchToSlash(
  match: RegExpMatchArray,
  referenceDos?: string,
): string {
  // Full match is group 1 when MONTH_NAME_DATE is nested; day/year depend on nesting.
  // Patterns use MONTH_NAME_DATE as one capturing group wrapping (month)(day)(year?).
  // When used as `${prefix}\\s*:?\\s*${MONTH_NAME_DATE}`:
  //   [1]=full month-name date text, [2]=month word, [3]=day, [4]=year?
  // When used as `\\b${MONTH_NAME_DATE}\\s+(?:makeup|...)`:
  //   same indices.
  const monthWord = String(match[2] || '').toLowerCase().replace(/\.$/, '');
  const day = Number(match[3]);
  const yearRaw = match[4];
  const month = MONTH_MAP[monthWord];
  if (!month || !day || day < 1 || day > 31) return '';
  if (yearRaw) {
    let year = Number(yearRaw);
    if (year < 100) year += 2000;
    return `${month}/${day}/${year}`;
  }
  return inferMakeupCoveredYear(`${month}/${day}`, referenceDos);
}

/**
 * Bare "missed on <date>" is a covered date only after a real makeup phrase
 * ("make up session", "makeup for"). "Will make up later" must not qualify.
 */
function coveredDatePrefix(notes: string, tight: boolean): string {
  const bareMissed = MAKEUP_PHRASE_RE.test(notes)
    ? 'missed(?:\\s+session)?(?:\\s+on)?|'
    : '';
  const tail = tight
    ? 'original(?:\\s+date|\\s+dos)?'
    : 'original(?:\\s+date|\\s+dos)?|' + 'for(?:\\s+date)?';
  return (
    '(?:' +
    `(?:${MAKEUP_TOKEN})\\s+${MAKEUP_PREP}\\s+missed(?:\\s+session)?(?:\\s+on)?|` +
    bareMissed +
    `(?:${MAKEUP_TOKEN})\\s+${MAKEUP_PREP}|` +
    `(?:${MAKEUP_TOKEN})\\s+session(?:\\s+${MAKEUP_PREP})?|` +
    tail +
    ')'
  );
}

/** Pull the "makeup for / make-up session / 9/9 makeup session / missed on …" date from notes. */
export function extractMakeupForDate(
  notes: string,
  opts?: ExtractMakeupForDateOpts,
): string {
  const n = String(notes || '');
  if (!MAKEUP_WORD_RE.test(n)) return '';
  const prefix = coveredDatePrefix(n, false);
  const tightPrefix = coveredDatePrefix(n, true);

  // 1) Prefix then date with year (existing Frontline / CPSE shapes).
  const afterYear = n.match(
    new RegExp(`${prefix}\\s*:?\\s*${DATE_WITH_YEAR}`, 'i'),
  );
  if (afterYear?.[1]) return afterYear[1];

  // 2) Date then "makeup" / "makeup session" — e.g. "Service Provided: 9/9 makeup session".
  const before = n.match(
    new RegExp(
      `\\b${DATE_OPT_YEAR}\\s+(?:${MAKEUP_TOKEN})(?:\\s+session)?\\b`,
      'i',
    ),
  );
  if (before?.[1]) {
    return inferMakeupCoveredYear(before[1], opts?.referenceDos);
  }

  // 3) Tight prefix then yearless M/D — e.g. "Make up for: 9/9".
  const afterYearless = n.match(
    new RegExp(
      `${tightPrefix}\\s*:?\\s*(\\d{1,2}/\\d{1,2})(?!/\\d)`,
      'i',
    ),
  );
  if (afterYearless?.[1]) {
    return inferMakeupCoveredYear(afterYearless[1], opts?.referenceDos);
  }

  // 4) Prefix then month-name date — e.g. "make up session for sept 14".
  const afterMonth = n.match(
    new RegExp(`${prefix}\\s*:?\\s*${MONTH_NAME_DATE}`, 'i'),
  );
  if (afterMonth) {
    const slash = monthNameMatchToSlash(afterMonth, opts?.referenceDos);
    if (slash) return slash;
  }

  // 5) Month-name date then "makeup" / "makeup session" — e.g. "sept 14 makeup session".
  const beforeMonth = n.match(
    new RegExp(
      `\\b${MONTH_NAME_DATE}\\s+(?:${MAKEUP_TOKEN})(?:\\s+session)?\\b`,
      'i',
    ),
  );
  if (beforeMonth) {
    const slash = monthNameMatchToSlash(beforeMonth, opts?.referenceDos);
    if (slash) return slash;
  }

  return '';
}
