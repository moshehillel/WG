/**
 * Covered-miss slash-date phrases in Frontline / Therapist Activity notes.
 * Leaf module (no package imports) so session-parse and makeup can share it
 * without circular ESM init.
 */
export const MAKEUP_COVERED_DATE_PREFIX =
  '(?:missed(?:\\s+session)?(?:\\s+on)?|makeup for|make[\\s-]?up for|(?:makeup|make[\\s-]?up)\\s+session|original(?:\\s+date|\\s+dos)?|for(?:\\s+date)?)';

const MAKEUP_WORD_RE = /\bmakeup\b|\bmake[\s-]?up\b/i;

/** Pull the "makeup for / make-up session / missed on …" date from notes. */
export function extractMakeupForDate(notes: string): string {
  const n = String(notes || '');
  if (!MAKEUP_WORD_RE.test(n)) return '';
  const m = n.match(
    new RegExp(`${MAKEUP_COVERED_DATE_PREFIX}\\s*:?\\s*(\\d{1,2}/\\d{1,2}/\\d{2,4})`, 'i'),
  );
  return m?.[1] || '';
}
