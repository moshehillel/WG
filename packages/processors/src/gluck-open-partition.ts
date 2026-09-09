import type { OpenedCaseRow } from '@white-glove/shared';
import { normalizeVisitDate } from '@white-glove/shared';

/** Service begin within this many days of intake counts as an intake-aligned new line. */
export const GLUCK_INTAKE_ALIGN_DAYS = 14;

export type GluckOpenPartition = {
  /** One row per caseId — full Gluck open (CreatePatient + first service). */
  primaries: OpenedCaseRow[];
  /**
   * Extra intake-aligned service lines on the same child — process as new_services
   * after the primary so the HHA patient already exists.
   */
  asNewServices: OpenedCaseRow[];
  /**
   * Historical / non-intake service periods on the Gluck export (same case, often
   * same Service Type, different Service Begin Dates). Not opened via Gluck.
   */
  skippedHistorical: OpenedCaseRow[];
};

function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.abs(dayMs(aIso) - dayMs(bIso)) / 86_400_000;
}

function isIntakeAligned(row: OpenedCaseRow): boolean {
  const start = normalizeVisitDate(row.startDate);
  const intake = normalizeVisitDate(row.intakeDate);
  if (!start || !intake) return false;
  return daysBetween(start, intake) <= GLUCK_INTAKE_ALIGN_DAYS;
}

/**
 * Pick the Gluck open primary for a case: prefer intake-aligned begin dates,
 * then closest begin to intake, then latest begin, then first row.
 */
export function pickGluckPrimary(rows: OpenedCaseRow[]): OpenedCaseRow {
  if (rows.length === 1) return rows[0]!;
  const intake = normalizeVisitDate(rows.find((r) => r.intakeDate)?.intakeDate);
  const scored = rows.map((row, index) => {
    const start = normalizeVisitDate(row.startDate);
    const aligned = isIntakeAligned(row);
    const distance =
      start && intake ? daysBetween(start, intake) : Number.POSITIVE_INFINITY;
    const startRank = start ? dayMs(start) : Number.NEGATIVE_INFINITY;
    return { row, index, aligned, distance, startRank };
  });
  scored.sort((a, b) => {
    if (a.aligned !== b.aligned) return a.aligned ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.startRank !== b.startRank) return b.startRank - a.startRank;
    return a.index - b.index;
  });
  return scored[0]!.row;
}

/**
 * Gluck Service Report is one row per service period. Business rule: open the
 * child once in HHA; additional service lines belong on the new service path
 * (or are historical and should not be re-opened from Gluck).
 */
export function partitionGluckOpenRows(rows: OpenedCaseRow[]): GluckOpenPartition {
  const byCase = new Map<string, OpenedCaseRow[]>();
  for (const row of rows) {
    const key = row.caseId?.trim() || `__missing__#${byCase.size}`;
    const list = byCase.get(key);
    if (list) list.push(row);
    else byCase.set(key, [row]);
  }

  const primaries: OpenedCaseRow[] = [];
  const asNewServices: OpenedCaseRow[] = [];
  const skippedHistorical: OpenedCaseRow[] = [];

  for (const group of byCase.values()) {
    if (group.length === 1) {
      primaries.push(group[0]!);
      continue;
    }
    const primary = pickGluckPrimary(group);
    primaries.push(primary);
    for (const row of group) {
      if (row === primary) continue;
      if (isIntakeAligned(row)) {
        asNewServices.push({ ...row, sourceReport: 'new_services' });
      } else {
        skippedHistorical.push(row);
      }
    }
  }

  return { primaries, asNewServices, skippedHistorical };
}
