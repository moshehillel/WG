import { describe, expect, it } from 'vitest';
import { normalizeHhaGender } from './gender.js';

describe('normalizeHhaGender', () => {
  it('maps common ProviderSoft values to HHA labels', () => {
    expect(normalizeHhaGender('f')).toBe('Female');
    expect(normalizeHhaGender('Male')).toBe('Male');
    expect(normalizeHhaGender('')).toBeUndefined();
  });
});
