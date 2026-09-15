import { describe, expect, it } from 'vitest';
import {
  apiReportAuthorizationNumber,
  sessionAuthPeriodMaximum,
} from './session-auth.js';

describe('sessionAuthPeriodMaximum', () => {
  it('uses Entire Period with 15 for ≤30 minute sessions', () => {
    expect(sessionAuthPeriodMaximum(30)).toEqual({ period: 'Entire Period', maximum: 15 });
    expect(sessionAuthPeriodMaximum(undefined)).toEqual({ period: 'Entire Period', maximum: 15 });
  });

  it('scales maximum for longer sessions', () => {
    expect(sessionAuthPeriodMaximum(60).maximum).toBe(15);
    expect(sessionAuthPeriodMaximum(90).maximum).toBe(15);
    expect(sessionAuthPeriodMaximum(120).maximum).toBe(15);
  });
});

describe('apiReportAuthorizationNumber', () => {
  it('prefixes API- and truncates', () => {
    expect(apiReportAuthorizationNumber('S-123')).toBe('API-S-123');
    expect(apiReportAuthorizationNumber('  ab cd  ')).toBe('API-abcd');
  });
});
