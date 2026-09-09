import { describe, expect, it } from 'vitest';
import {
  buildPayCodeName,
  extractDisciplineFromServiceType,
  payRateSuffix,
  pickFirstPayCodeForDiscipline,
  serviceTypeLooksGroup,
} from './pay-codes.js';

describe('pay-codes', () => {
  it('extracts OT from OT CHHA EXTENDED', () => {
    expect(extractDisciplineFromServiceType('OT CHHA EXTENDED')).toBe('OT');
  });

  it('builds OT $72 from OT discipline and 72 pay rate', () => {
    expect(buildPayCodeName('OT CHHA EXTENDED', 72)).toEqual({
      payCodeName: 'OT $72',
      discipline: 'OT',
      rateSuffix: '72',
      isGroup: false,
    });
  });

  it('builds OT Group $34 when service type is group', () => {
    expect(buildPayCodeName('OT School Group', 34)).toEqual({
      payCodeName: 'OT Group $34',
      discipline: 'OT',
      rateSuffix: '34',
      isGroup: true,
    });
  });

  it('honors explicit group option over individual service type', () => {
    expect(buildPayCodeName('OT School', 34, { group: true })?.payCodeName).toBe('OT Group $34');
    expect(buildPayCodeName('OT School Group', 62.5, { group: false })?.payCodeName).toBe('OT $62.5');
  });

  it('truncates integer-like decimal pay rates', () => {
    expect(payRateSuffix('70.0000')).toBe('70');
    expect(buildPayCodeName('OT CHHA EXTENDED', '70.0000')?.payCodeName).toBe('OT $70');
  });

  it('keeps meaningful decimal pay rates', () => {
    expect(payRateSuffix('52.50')).toBe('52.5');
    expect(buildPayCodeName('SLP HC EVAL', '52.50')?.payCodeName).toBe('SLP $52.5');
    expect(buildPayCodeName('OT School', 62.5)?.payCodeName).toBe('OT $62.5');
  });

  it('rejects zero / blank pay rates (missed sessions)', () => {
    expect(payRateSuffix('0.0000')).toBeUndefined();
    expect(buildPayCodeName('OT CHHA', '0.0000')).toBeUndefined();
    expect(payRateSuffix('')).toBeUndefined();
  });

  it('detects group tokens', () => {
    expect(serviceTypeLooksGroup('PT School Group')).toBe(true);
    expect(serviceTypeLooksGroup('OT 2:1')).toBe(true);
    expect(serviceTypeLooksGroup('PT School')).toBe(false);
  });

  it('picks first catalog pay code for a discipline (placeholder fallback)', () => {
    const rows = [
      { id: '200431', name: 'OT $70' },
      { id: '200432', name: 'OT $70.50' },
      { id: '176130', name: 'PT $70' },
      { id: '260780', name: 'ST $70' },
    ];
    expect(pickFirstPayCodeForDiscipline('OT', rows)).toEqual({
      id: '200431',
      name: 'OT $70',
      rateSuffix: '70',
      isGroup: false,
    });
    expect(pickFirstPayCodeForDiscipline('SLP', rows)?.id).toBe('260780');
  });

  it('prefers group pay codes when wantGroup', () => {
    const rows = [
      { id: '200431', name: 'OT $70' },
      { id: 'g34', name: 'OT Group $34' },
      { id: 'g40', name: 'OT Group $40' },
    ];
    expect(pickFirstPayCodeForDiscipline('OT', rows, { group: true })).toEqual({
      id: 'g34',
      name: 'OT Group $34',
      rateSuffix: '34',
      isGroup: true,
    });
  });
});

