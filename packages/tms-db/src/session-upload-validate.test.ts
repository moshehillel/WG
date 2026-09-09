import { describe, expect, it } from 'vitest';
import {
  cptDurationError,
  missedSessionReasonError,
  normalizeNoteForCompare,
  noteIsCopyPasteSource,
  notesLookCopyPasted,
  parseCptCoverage,
  requiredCptUnitsForDuration,
  sessionIsSigned,
  sessionSignatureError,
} from './session-upload-validate.js';
import { mergeFrontlineSplitCptRows, parseWeeklySessionText } from './session-parse.js';

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

  it('skips CPT and signature requirements for missed sessions', () => {
    expect(cptDurationError('9:00 am', '9:30 am', '', 'missed')).toBeNull();
    expect(sessionSignatureError('no signature block here', 'missed')).toBeNull();
  });

  it('requires a recognizable reason for missed sessions', () => {
    expect(missedSessionReasonError('missed', '', '')).toMatch(/needs a reason/i);
    expect(missedSessionReasonError('missed', '', 'Provider Absence:')).toBeNull();
    expect(missedSessionReasonError('missed', 'Provider Absence', '')).toBeNull();
    expect(missedSessionReasonError('attended', '', '')).toBeNull();
  });

  it('does not treat missed notes as copy-paste sources', () => {
    expect(noteIsCopyPasteSource('missed', 'Provider Absence:')).toBe(false);
    expect(noteIsCopyPasteSource('attended', 'Service Provided: gait work')).toBe(true);
    expect(
      notesLookCopyPasted(
        'Service Provided: Student performed gross motor activity',
        'Provider Absence:',
      ),
    ).toBe(false);
  });

  it('blocks attended sessions with no CPT even when duration cannot be parsed', () => {
    expect(cptDurationError('', '', '', 'attended')).toMatch(/CPT units missing/i);
    expect(cptDurationError('bad', 'time', '', 'makeup')).toMatch(/CPT units missing/i);
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

  it('merges Frontline multi-CPT split rows into one session', () => {
    const rows = parseWeeklySessionText(`
Student Name: Flores, Milan
Service Provider: Patel PT*, Neelamben
Service: Physical Therapy
09/04/2026
1:1
97110
 1
11:35 am
12:05 pm
Clara H. Carlson School
Service Provided: Student engaged in gross motor activity to improve his strength.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 4 2026 2:03PM
Telehealth:
No
09/04/2026
1:1
97112
 1
11:35 am
12:05 pm
Clara H. Carlson School
Service Provided: Student engaged in gross motor activity to improve his strength.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 4 2026 2:03PM
Telehealth:
No
`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cptUnits).toBe(2);
    expect(rows[0]?.cptCodes.sort()).toEqual(['97110', '97112']);
    expect(
      cptDurationError(
        rows[0]!.beginTime,
        rows[0]!.endTime,
        { codes: rows[0]!.cptCodes, totalUnits: rows[0]!.cptUnits, procedures: rows[0]!.cptProcedures },
        'attended',
      ),
    ).toBeNull();
  });

  it('keeps Provider Absence misses without times or CPT bleed', () => {
    const rows = parseWeeklySessionText(`
Student Name: Keshwani, Ayan
Service Provider: Patel PT*, Neelamben
Service: Physical Therapy
09/02/2026
 0
Clara H. Carlson School
Provider Absence:
09/03/2026
 0
Clara H. Carlson School
Provider Absence:
Student Name: Legagneur, Samuel
Service Provider: Patel PT*, Neelamben
Service: Physical Therapy
09/04/2026
1:1
97112
 1
 1:05 pm
 1:35 pm
Clara H. Carlson School
Service Provided: Student performed gross motor activity.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 4 2026 2:03PM
Telehealth:
No
09/04/2026
1:1
97110
 1
 1:05 pm
 1:35 pm
Clara H. Carlson School
Service Provided: Student performed gross motor activity.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 4 2026 2:03PM
Telehealth:
No
`);
    const ayan = rows.filter((r) => /Ayan|Keshwani/i.test(r.studentName));
    expect(ayan).toHaveLength(2);
    expect(ayan.every((r) => r.attendance === 'missed')).toBe(true);
    expect(ayan.every((r) => !r.beginTime && !r.endTime)).toBe(true);
    expect(ayan.every((r) => r.cptUnits === 0)).toBe(true);
    expect(ayan.every((r) => /provider absence/i.test(r.cancelReason || r.notes))).toBe(true);
    const samuel = rows.filter((r) => /Samuel|Legagneur/i.test(r.studentName));
    expect(samuel).toHaveLength(1);
    expect(samuel[0]?.cptUnits).toBe(2);
  });
});

describe('mergeFrontlineSplitCptRows', () => {
  it('combines different CPT codes on the same clock window', () => {
    const merged = mergeFrontlineSplitCptRows([
      {
        studentName: 'A',
        providerName: '',
        schoolName: '',
        dateOfService: '09/04/2026',
        beginTime: '10:05 am',
        endTime: '10:35 am',
        attendance: 'attended',
        cancelReason: '',
        notes: 'n1',
        serviceType: 'PT',
        location: '',
        ratio: '1:1',
        cptCodes: ['97110'],
        cptUnits: 1,
        cptProcedures: ['97110x1'],
        signed: true,
        sourceSlice: 'a',
      },
      {
        studentName: 'A',
        providerName: '',
        schoolName: '',
        dateOfService: '09/04/2026',
        beginTime: '10:05 am',
        endTime: '10:35 am',
        attendance: 'attended',
        cancelReason: '',
        notes: 'n1 longer text',
        serviceType: 'PT',
        location: '',
        ratio: '1:1',
        cptCodes: ['97116'],
        cptUnits: 1,
        cptProcedures: ['97116x1'],
        signed: true,
        sourceSlice: 'b',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.cptUnits).toBe(2);
    expect(merged[0]?.cptCodes.sort()).toEqual(['97110', '97116']);
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
