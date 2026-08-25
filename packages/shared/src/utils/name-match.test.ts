import { describe, expect, it } from 'vitest';
import {
  namesMatch,
  normalizeLookupName,
  providerNameMatchKeys,
} from './name-match.js';

describe('normalizeLookupName', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeLookupName('  Extended Home Care Therapy  ')).toBe(
      'extended home care therapy',
    );
    expect(normalizeLookupName('GHI THERAPY')).toBe('ghi therapy');
  });

  it('ignores punctuation differences', () => {
    expect(normalizeLookupName('OT CHHA EXTENDED')).toBe(normalizeLookupName('OT CHHA EXTENDED.'));
    expect(normalizeLookupName("BOYCE TRUDY")).toBe(normalizeLookupName('BOYCE TRUDY '));
  });
});

describe('namesMatch', () => {
  it('matches case-insensitive service types', () => {
    expect(namesMatch('ot chha extended', 'OT CHHA EXTENDED')).toBe(true);
    expect(namesMatch('SLP school Group', 'slp school group')).toBe(true);
  });
});

describe('providerNameMatchKeys', () => {
  it('matches reversed name order', () => {
    const a = providerNameMatchKeys('BOYCE TRUDY');
    const b = providerNameMatchKeys('TRUDY BOYCE');
    expect(a.some((k) => b.includes(k))).toBe(true);
  });
});
