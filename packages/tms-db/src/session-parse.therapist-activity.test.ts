import { describe, expect, it } from 'vitest';
import {
  isTherapistActivityText,
  parseTherapistActivityText,
  parseWeeklySessionText,
} from './session-parse.js';

/** Flattened shape matching extractPdfLatinText output from Therapist Activity PDFs. */
const THERAPIST_ACTIVITY_SAMPLE = `
Date / Time Setting Child ICD/CPT Codes Notes
08/12/26 In: 10:00 AM Out: 10:30 AM Preschool MORTE III, ROBERTO CBRS2627S0093066(ST-I) F80.2 92507x1
Roberto transitioned well to and from the speech therapy room and presented with positive engagement.
Notes Entered: 8/12/2026 7:15:26 PM Notes Last Modified: 8/12/2026 7:15:26 PM
Signed: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Cosigned: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Meets Medicaid Requirements: Yes
Therapist Activity Printed: 8/14/2026 12:02:32 PM Page 1 of 3 Astacio, Wiglishai
Date / Time Setting Child ICD/CPT Codes Notes
08/13/26 In: 11:30 AM Out: 12:00 PM Preschool # Children in Group: 2 SOTO D. SOTO, DAVID CBRS2627S0089446(ST1-G) F80.2 92508x1
David participated in a group speech therapy session with peer.
Notes Entered: 8/13/2026 12:51:35 PM
Signed: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Therapist Activity Printed: 8/14/2026 12:02:32 PM Page 2 of 3 Astacio, Wiglishai
Date / Time Setting Child ICD/CPT Codes Notes
08/14/26 In: 09:30 AM Out: 10:00 AM Make up for: 08/05/26 Preschool MORTE III, ROBERTO CBRS2627S0093066(ST-I) F80.2 92507x1
Roberto transitioned smoothly to and from the speech therapy room.
Notes Entered: 8/14/2026 10:45:08 AM
Signed: 8/14/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Therapist Activity Printed: 8/14/2026 12:02:32 PM Page 3 of 3 Astacio, Wiglishai
`;

describe('Therapist Activity Output parse', () => {
  it('detects Therapist Activity format', () => {
    expect(isTherapistActivityText(THERAPIST_ACTIVITY_SAMPLE)).toBe(true);
    expect(isTherapistActivityText('Student Name: Aiden\n08/11/2026\nService Provided: gait')).toBe(
      false,
    );
  });

  it('parses child, times, CPT, service, makeup, and provider', () => {
    const rows = parseTherapistActivityText(THERAPIST_ACTIVITY_SAMPLE);
    expect(rows).toHaveLength(3);

    expect(rows[0]?.studentName).toMatch(/MORTE III,\s*ROBERTO/i);
    expect(rows[0]?.dateOfService).toBe('08/12/26');
    expect(rows[0]?.beginTime.toLowerCase()).toContain('10:00');
    expect(rows[0]?.endTime.toLowerCase()).toContain('10:30');
    expect(rows[0]?.attendance).toBe('attended');
    expect(rows[0]?.cptCodes).toContain('92507');
    expect(rows[0]?.cptUnits).toBe(1);
    expect(rows[0]?.serviceType).toMatch(/Speech Individual/i);
    expect(rows[0]?.signed).toBe(true);
    expect(rows[0]?.notes).toMatch(/transitioned well/i);
    expect(rows[0]?.providerName).toMatch(/Astacio/i);

    expect(rows[1]?.studentName).toMatch(/^SOTO,\s*DAVID$/i);
    expect(rows[1]?.serviceType).toMatch(/Speech Group/i);
    expect(rows[1]?.ratio).toBe('2:1');
    expect(rows[1]?.cptCodes).toContain('92508');

    expect(rows[2]?.attendance).toBe('makeup');
    expect(rows[2]?.notes).toMatch(/Make up for:\s*08\/05\/26/i);
  });

  it('routes through parseWeeklySessionText auto-detect', () => {
    const rows = parseWeeklySessionText(THERAPIST_ACTIVITY_SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.studentName).toMatch(/ROBERTO/i);
  });

  it('handles fragmented Tj-style tokens after normalize', () => {
    const fragmented = `
Therapist Activity Printed: 8/14/2026
08/12/26
In:
10:00
AM
Out:
10:30
AM
Preschool
Brunson, Jeremiah
CBRS
2627
S
0093471
(ST-I)
F
82
97530
x
1
97533
x
1
Jeremiah required support to transition.
Notes Entered:
Signed:
8/14/2026
Wiglishai Astacio, M.S.,
CCC-SLP, TSSLD
Page 1 of 1
Astacio, Wiglishai
`;
    const rows = parseWeeklySessionText(fragmented);
    expect(rows.length).toBe(1);
    expect(rows[0]?.studentName).toMatch(/Brunson,\s*Jeremiah/i);
    expect(rows[0]?.cptCodes).toEqual(expect.arrayContaining(['97530', '97533']));
    expect(rows[0]?.cptUnits).toBe(2);
    expect(rows[0]?.signed).toBe(true);
  });
});
