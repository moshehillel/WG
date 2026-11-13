import { describe, expect, it } from 'vitest';
import { absenceFallbackWarning } from './bedrock.js';

describe('absenceFallbackWarning', () => {
  it('warns only when an attended row is read as missed or makeup', () => {
    expect(absenceFallbackWarning('attended', 'missed')).toMatch(/missed visit/);
    expect(absenceFallbackWarning('attended', 'makeup')).toMatch(/makeup visit/);
    expect(absenceFallbackWarning('attended', 'attended')).toBe('');
    expect(absenceFallbackWarning('missed', 'missed')).toBe('');
  });
});
