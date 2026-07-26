import { describe, expect, it } from 'vitest';
import { matchByName, normalizeRefName } from './reference-resolve.js';

describe('reference-resolve', () => {
  it('normalizes names for matching', () => {
    expect(normalizeRefName('Extended Home Care Therapy')).toBe('extended home care therapy');
  });

  it('matches contract by exact and fuzzy name', () => {
    const haystack = [{ id: '61591', name: 'Extended Home Care Therapy' }];
    expect(matchByName('extended home care therapy', haystack)?.id).toBe('61591');
  });
});
