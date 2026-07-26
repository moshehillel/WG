import { describe, expect, it } from 'vitest';
import {
  buildPayCodeName,
  extractDisciplineFromServiceType,
  payRateSuffix,
} from './pay-codes.js';

describe('pay-codes', () => {
  it('extracts OT from OT CHHA EXTENDED', () => {
    expect(extractDisciplineFromServiceType('OT CHHA EXTENDED')).toBe('OT');
  });

  it('builds OT72 from OT discipline and 72 pay rate', () => {
    expect(buildPayCodeName('OT CHHA EXTENDED', 72)).toEqual({
      payCodeName: 'OT72',
      discipline: 'OT',
      rateSuffix: '72',
    });
  });

  it('truncates decimal pay rates', () => {
    expect(payRateSuffix('70.0000')).toBe('70');
    expect(buildPayCodeName('OT CHHA EXTENDED', '70.0000')?.payCodeName).toBe('OT70');
  });
});
