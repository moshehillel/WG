/** ISO YYYY-MM-DD (and similar) compare lexicographically; swap if from > to. */
export function normalizeLiveDateRange(
  from: string,
  to: string,
): { from: string; to: string; swapped: boolean } {
  const f = String(from).trim();
  const t = String(to).trim();
  if (f && t && f > t) return { from: t, to: f, swapped: true };
  return { from: f, to: t, swapped: false };
}