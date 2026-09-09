import { describe, expect, it } from 'vitest';
import type { OpenedCaseRow } from '@white-glove/shared';
import { partitionGluckOpenRows, pickGluckPrimary } from './gluck-open-partition.js';

function row(partial: Partial<OpenedCaseRow> & Pick<OpenedCaseRow, 'caseId'>): OpenedCaseRow {
  return {
    firstName: 'Camden',
    lastName: 'Asare',
    serviceCode: 'PT CHHA',
    sourceReport: 'opened_cases',
    ...partial,
  };
}

describe('partitionGluckOpenRows', () => {
  it('keeps a single row per case as the primary open', () => {
    const one = row({ caseId: '1', startDate: '09/04/2026', intakeDate: '09/04/2026' });
    const part = partitionGluckOpenRows([one]);
    expect(part.primaries).toEqual([one]);
    expect(part.asNewServices).toEqual([]);
    expect(part.skippedHistorical).toEqual([]);
  });

  it('opens once for Camden-style 11 same-code historical periods and skips the rest', () => {
    const intake = '09/04/2026';
    const begins = [
      '01/15/2024',
      '03/01/2024',
      '06/10/2024',
      '09/01/2024',
      '01/02/2025',
      '03/15/2025',
      '06/01/2025',
      '08/20/2025',
      '10/01/2025',
      '11/15/2025',
      '12/01/2025',
    ];
    const rows = begins.map((startDate) =>
      row({ caseId: '102661', startDate, intakeDate: intake }),
    );
    const part = partitionGluckOpenRows(rows);
    expect(part.primaries).toHaveLength(1);
    expect(part.primaries[0]!.startDate).toBe('12/01/2025'); // closest to intake
    expect(part.asNewServices).toHaveLength(0);
    expect(part.skippedHistorical).toHaveLength(10);
  });

  it('routes extra intake-aligned service lines to new_services', () => {
    const ot = row({
      caseId: 'c1',
      serviceCode: 'OT CHHA',
      startDate: '09/04/2026',
      intakeDate: '09/04/2026',
    });
    const pt = row({
      caseId: 'c1',
      serviceCode: 'PT CHHA',
      startDate: '09/05/2026',
      intakeDate: '09/04/2026',
    });
    const part = partitionGluckOpenRows([ot, pt]);
    expect(part.primaries).toHaveLength(1);
    expect(part.primaries[0]!.serviceCode).toBe('OT CHHA');
    expect(part.asNewServices).toHaveLength(1);
    expect(part.asNewServices[0]).toMatchObject({
      serviceCode: 'PT CHHA',
      sourceReport: 'new_services',
    });
    expect(part.skippedHistorical).toHaveLength(0);
  });

  it('mixes intake-aligned primary with historical skips', () => {
    const current = row({
      caseId: 'c2',
      startDate: '09/04/2026',
      intakeDate: '09/04/2026',
    });
    const old = row({
      caseId: 'c2',
      startDate: '01/01/2025',
      intakeDate: '09/04/2026',
    });
    const part = partitionGluckOpenRows([old, current]);
    expect(part.primaries[0]).toBe(current);
    expect(part.skippedHistorical).toEqual([old]);
    expect(part.asNewServices).toHaveLength(0);
  });
});

describe('pickGluckPrimary', () => {
  it('prefers the begin date closest to intake', () => {
    const a = row({ caseId: 'x', startDate: '01/01/2024', intakeDate: '09/01/2026' });
    const b = row({ caseId: 'x', startDate: '08/20/2026', intakeDate: '09/01/2026' });
    expect(pickGluckPrimary([a, b])).toBe(b);
  });
});
