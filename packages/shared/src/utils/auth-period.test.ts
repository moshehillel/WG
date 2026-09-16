import { describe, expect, it } from 'vitest';
import {
  mapMandateFrequencyToPeriod,
  parseAuthMaximum,
  resolveAuthMandate,
} from './auth-period.js';

describe('mapMandateFrequencyToPeriod', () => {
  it('maps common ProviderSoft frequencies', () => {
    expect(mapMandateFrequencyToPeriod('Weekly')).toBe('Weekly');
    expect(mapMandateFrequencyToPeriod('Authorization')).toBe('Entire Period');
    expect(mapMandateFrequencyToPeriod('')).toBeUndefined();
  });
});

describe('parseAuthMaximum', () => {
  it('rejects blank and zero', () => {
    expect(parseAuthMaximum('')).toBeUndefined();
    expect(parseAuthMaximum('0')).toBeUndefined();
    expect(parseAuthMaximum('2')).toBe(2);
  });
});

describe('resolveAuthMandate', () => {
  it('prefers Basic when both frequency and times are usable', () => {
    expect(
      resolveAuthMandate({
        mandateFrequency: 'Weekly',
        mandateTimes: '2',
        extendedMandateFrequency: 'Authorization',
        extendedMandateTimes: '1',
      }),
    ).toEqual({ period: 'Weekly', maximum: 2, source: 'basic' });
  });

  it('falls back to Extended when Basic frequency is blank and times are 0', () => {
    // NYS new-service rows: Basic empty/0, Extended Authorization / 1
    expect(
      resolveAuthMandate({
        mandateFrequency: '',
        mandateTimes: '0',
        extendedMandateFrequency: 'Authorization',
        extendedMandateTimes: '1',
      }),
    ).toEqual({ period: 'Entire Period', maximum: 1, source: 'extended' });
  });

  it('falls back to Extended when Basic has times but blank frequency', () => {
    expect(
      resolveAuthMandate({
        mandateFrequency: '',
        mandateTimes: '2',
        extendedMandateFrequency: 'Weekly',
        extendedMandateTimes: '2',
      }),
    ).toEqual({ period: 'Weekly', maximum: 2, source: 'extended' });
  });

  it('returns undefined when neither Basic nor Extended is usable', () => {
    expect(
      resolveAuthMandate({
        mandateFrequency: '',
        mandateTimes: '0',
        extendedMandateFrequency: '',
        extendedMandateTimes: '0',
      }),
    ).toBeUndefined();
  });
});
