import { describe, expect, it } from 'vitest';
import { normalizeLiveDateRange } from './live-date-range.js';

describe('normalizeLiveDateRange', () => {
  it('keeps chronological ranges', () => {
    expect(normalizeLiveDateRange('2026-08-01', '2026-08-25')).toEqual({
      from: '2026-08-01',
      to: '2026-08-25',
      swapped: false,
    });
  });

  it('swaps when from is after to (closed_cases bug)', () => {
    expect(normalizeLiveDateRange('2026-08-25', '2026-08-01')).toEqual({
      from: '2026-08-01',
      to: '2026-08-25',
      swapped: true,
    });
  });

  it('trims whitespace', () => {
    expect(normalizeLiveDateRange(' 2026-08-25 ', ' 2026-08-25 ')).toEqual({
      from: '2026-08-25',
      to: '2026-08-25',
      swapped: false,
    });
  });
});