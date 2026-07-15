import { describe, expect, it } from 'vitest';
import { lookupServiceCode, SERVICE_CODE_MAP } from './service-codes.js';

describe('lookupServiceCode', () => {
  it('finds by provider soft code case-insensitively', () => {
    const code = SERVICE_CODE_MAP[0]?.providerSoftCode;
    expect(code).toBeTruthy();
    expect(lookupServiceCode(code!.toLowerCase())?.hhaCode).toBe(SERVICE_CODE_MAP[0].hhaCode);
  });

  it('returns undefined for unknown codes', () => {
    expect(lookupServiceCode('NOPE')).toBeUndefined();
    expect(lookupServiceCode(undefined)).toBeUndefined();
  });
});
