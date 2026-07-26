import { describe, expect, it } from 'vitest';
import { AmbiguousPatientNameError } from './patient-errors.js';

describe('AmbiguousPatientNameError', () => {
  it('includes match count and name in message', () => {
    const err = new AmbiguousPatientNameError('Jane', 'Doe', 2);
    expect(err.message).toContain('2 Active patients');
    expect(err.message).toContain('Jane Doe');
    expect(err.message).toContain('Program Id / admission lookup');
  });
});
