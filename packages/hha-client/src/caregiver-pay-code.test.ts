import { describe, expect, it } from 'vitest';
import { pickCaregiverDisciplinePayCode } from './caregiver-pay-code.js';

describe('pickCaregiverDisciplinePayCode', () => {
  it('picks the sole non-PL OT rate and ignores OT $100 PL', () => {
    expect(
      pickCaregiverDisciplinePayCode(
        [
          { id: '263113', name: 'OT $100 PL' },
          { id: 'pay-ot72', name: 'OT $72' },
        ],
        'OT',
      ),
    ).toEqual({ id: 'pay-ot72', name: 'OT $72' });
  });

  it('returns undefined when only PL remains or multiple OT rates compete', () => {
    expect(
      pickCaregiverDisciplinePayCode([{ id: '263113', name: 'OT $100 PL' }], 'OT'),
    ).toBeUndefined();
    expect(
      pickCaregiverDisciplinePayCode(
        [
          { id: 'a', name: 'OT $70' },
          { id: 'b', name: 'OT $72' },
        ],
        'OT',
      ),
    ).toBeUndefined();
  });

  it('returns undefined for office-catalog dumps (too many discipline hits)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `OT $${50 + i}`,
    }));
    expect(pickCaregiverDisciplinePayCode(rows, 'OT')).toBeUndefined();
  });

  it('prefers a sole Eval-named code when preferEval is set', () => {
    expect(
      pickCaregiverDisciplinePayCode(
        [
          { id: 'a', name: 'OT $70' },
          { id: 'b', name: 'OT Eval $90' },
        ],
        'OT',
        { preferEval: true },
      ),
    ).toEqual({ id: 'b', name: 'OT Eval $90' });
  });

  it('maps SLP discipline to ST pay codes', () => {
    expect(
      pickCaregiverDisciplinePayCode([{ id: 'st', name: 'ST $52.5' }], 'SLP'),
    ).toEqual({ id: 'st', name: 'ST $52.5' });
  });
});
