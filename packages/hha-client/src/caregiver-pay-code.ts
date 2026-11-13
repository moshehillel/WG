import type { PayCodeRow } from './pay-code-resolve.js';

/**
 * Pick a caregiver-assigned pay code for a discipline when ProviderSoft Pay Rate
 * is blank. Never invents office-catalog first-hits (e.g. OT $100 PL).
 *
 * Rules:
 * - Name must start with the discipline (or AM {Disc}).
 * - Exclude PL / placeholder names.
 * - Prefer non-group when the service is not a group visit.
 * - When preferEval, narrow to names containing "Eval" first.
 * - Only return when a single clear match remains (no guessing among rates).
 * - If the list looks like the office catalog (many discipline hits), return
 *   undefined so the caller can use a recent-visit pay code instead.
 */
export function pickCaregiverDisciplinePayCode(
  rows: PayCodeRow[],
  discipline: string | undefined,
  options?: { preferGroup?: boolean; preferEval?: boolean },
): PayCodeRow | undefined {
  const disc = discipline?.trim().toUpperCase();
  if (!disc) return undefined;
  const stDisc = disc === 'SLP' ? 'ST' : disc;
  const discs = new Set([disc, stDisc]);

  const preferGroup = options?.preferGroup === true;
  const preferEval = options?.preferEval === true;
  let candidates = rows.filter((row) => {
    const name = row.name.trim().toUpperCase();
    if (!name) return false;
    if (/\bPL\b/.test(name) || /\bPLACEHOLDER\b/.test(name)) return false;
    const m = name.match(/^(?:AM\s+)?([A-Z]{2,4})\b/);
    if (!m || !discs.has(m[1]!)) return false;
    const isGroup = /\bGROUP\b/.test(name);
    if (preferGroup) return isGroup;
    return !isGroup;
  });

  // GetCaregiverPayCodes often returns the whole office catalog even with CaregiverID.
  // Do not invent a first-hit from that dump.
  if (candidates.length > 8) return undefined;

  if (preferEval) {
    const evalOnes = candidates.filter((row) => /\beval\b/i.test(row.name));
    if (evalOnes.length === 1) return evalOnes[0];
    if (evalOnes.length > 1) candidates = evalOnes;
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0 && preferGroup) {
    // Fall back to individual when group was preferred but none assigned.
    return pickCaregiverDisciplinePayCode(rows, discipline, {
      preferGroup: false,
      preferEval,
    });
  }
  return undefined;
}
