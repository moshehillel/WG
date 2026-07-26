import { describe, expect, it } from 'vitest';
import {
  buildCaregiverCodeMap,
  lookupCaregiverCode,
  parseCaregiverCodesCsv,
} from './caregiver-codes.js';

describe('caregiver-codes', () => {
  it('parses provider name and code', () => {
    const csv = 'Provider Name,Caregiver Code,\nABBONDOLA GIORGIANNA,WGC-35595,\n';
    const entries = parseCaregiverCodesCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.caregiverCode).toBe('WGC-35595');
  });

  it('looks up by normalized provider name', () => {
    const map = buildCaregiverCodeMap([
      { providerName: 'FORTUNE JOHANA', caregiverCode: 'WGC-12345' },
    ]);
    expect(lookupCaregiverCode(map, '  fortune johana ')).toBe('WGC-12345');
    expect(lookupCaregiverCode(map, 'Unknown Person')).toBeUndefined();
  });
});
