import { describe, expect, it } from 'vitest';
import {
  cptDurationError,
  normalizeNoteForCompare,
  notesLookCopyPasted,
  parseCptCoverage,
  requiredCptUnitsForDuration,
  sessionIsSigned,
  sessionSignatureError,
} from './session-upload-validate.js';
import { parseWeeklySessionText } from './session-parse.js';

describe('CPT duration units', () => {
  it('requires 2 units for 30 minutes', () => {
    expect(requiredCptUnitsForDuration(30)).toBe(2);
    expect(requiredCptUnitsForDuration(15)).toBe(1);
    expect(requiredCptUnitsForDuration(45)).toBe(3);
    expect(requiredCptUnitsForDuration(42)).toBe(3);
  });

  it('parses 97110x2 and dual codes', () => {
    expect(parseCptCoverage('97110x2').totalUnits).toBe(2);
    expect(parseCptCoverage('97112x1, 97110x1').totalUnits).toBe(2);
    expect(parseCptCoverage('CPT Code: 97110 CPT Units: 2').totalUnits).toBe(2);
  });

  it('flags under-covered duration', () => {
    const err = cptDurationError('9:00 am', '9:30 am', '97110x1', 'attended');
    expect(err).toMatch(/need 2 unit/i);
    expect(cptDurationError('9:00 am', '9:30 am', '97110x2', 'attended')).toBeNull();
    expect(cptDurationError('9:00 am', '9:30 am', '97112x1, 97110x1', 'attended')).toBeNull();
  });

  it('allows untimed speech CPT 92507x1 for a 30-minute session', () => {
    expect(cptDurationError('10:00 AM', '10:30 AM', '92507x1', 'attended')).toBeNull();
    expect(cptDurationError('10:00 AM', '10:30 AM', '92508x1', 'attended')).toBeNull();
    expect(cptDurationError('9:00 am', '9:30 am', '97110x1', 'attended')).toMatch(/need 2 unit/i);
  });

  it('parses CPT from weekly session text slices', () => {
    const rows = parseWeeklySessionText(`
Student Name: Odne, Aiden
Service Provider: Pat Lee
Service: PT School
09/01/2026 9:00 am 9:30 am
Service Provided: gait work
97110x2
`);
    expect(rows[0]?.cptUnits).toBe(2);
    expect(rows[0]?.cptCodes).toContain('97110');
  });
});

describe('note copy-paste', () => {
  it('treats punctuation-only differences as the same', () => {
    expect(normalizeNoteForCompare('Service Provided: gait work!')).toBe(
      normalizeNoteForCompare('gait work'),
    );
    expect(
      notesLookCopyPasted('Service Provided: balance in gym', 'Service Provided: balance in gym.'),
    ).toBe(true);
    expect(notesLookCopyPasted('gait work', 'balance work')).toBe(false);
  });
});

describe('session signature', () => {
  it('detects Frontline Provider Signature/Credentials blocks from the sample shape', () => {
    const signed = `
Service Provided: PRE's to build strength
Provider Signature/Credentials
Date
James Vasaturo PT (NPI# ) (License# 1003072075)
Jun 1 2026 10:49AM
Telehealth:
No
`;
    expect(sessionIsSigned(signed)).toBe(true);
    expect(sessionSignatureError(signed, 'attended')).toBeNull();
    const unsigned = `
Service Provided: PRE's to build strength
Provider Signature/Credentials
Date
Telehealth:
No
`;
    expect(sessionIsSigned(unsigned)).toBe(false);
    expect(sessionSignatureError(unsigned, 'attended')).toMatch(/not signed/i);
  });

  it('detects Therapist Activity Signed blocks', () => {
    const signed = `
Notes Entered: 8/12/2026 7:15:26 PM
Signed: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Cosigned: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
`;
    expect(sessionIsSigned(signed)).toBe(true);
    expect(sessionSignatureError(signed, 'attended')).toBeNull();
  });
});
