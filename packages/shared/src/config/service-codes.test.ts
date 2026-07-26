import { describe, expect, it } from 'vitest';
import {
  isUnmatchedServiceType,
  isUnknownServiceType,
  lookupServiceCode,
  SERVICE_CODE_MAP,
} from './service-codes.js';

describe('lookupServiceCode', () => {
  it('finds by ProviderSoft Service Type name case-insensitively', () => {
    expect(lookupServiceCode('ot hc eval')?.hhaCode).toBe('973449');
    expect(lookupServiceCode('OT HC Eval')?.providerSoftCode).toBe('OT HC Eval');
  });

  it('returns undefined for unknown codes', () => {
    expect(lookupServiceCode('NOPE')).toBeUndefined();
    expect(lookupServiceCode(undefined)).toBeUndefined();
  });

  it('has mapped entries from prod lookup', () => {
    expect(SERVICE_CODE_MAP.length).toBeGreaterThan(40);
  });

  it('flags known unmatched SI/ABA types', () => {
    expect(isUnmatchedServiceType('SI- ABA 1 NYC')).toBe(true);
    expect(isUnmatchedServiceType('OT HC Eval')).toBe(false);
  });

  it('treats unmapped types as unknown', () => {
    expect(isUnknownServiceType('SI- ABA 1 NYC')).toBe(true);
    expect(isUnknownServiceType('OT HC Eval')).toBe(false);
  });
});
