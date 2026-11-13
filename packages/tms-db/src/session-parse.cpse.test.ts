import { describe, expect, it } from 'vitest';
import {
  extractCpseChildHeaderName,
  isCpseChildTreatmentLogText,
  isTherapistActivityText,
  parseCpseChildTreatmentLogText,
  parseWeeklySessionText,
} from './session-parse.js';

/**
 * Sanitized Child Treatment Log layout (pypdf / Tj flatten of CPSE-style pages):
 * child name labeled at the top of each page; one In/Out session per page.
 */
const CPSE_CHILD_TREATMENT_LOG_SAMPLE = `
ESID: CBRS2627W0089485 Physical Therapy- Individual
Child:  Almonte, Alexander
Date of Birth:  8/29/2022
Therapist:  Sruthi Job, PT, 049944
Date / Time
Setting
ICD/CPT
Codes
Notes
10/30/26
  In:
09:00
AM
Out:
09:30
AM
Make up for:
09/10/26
Preschool Fred S.
Keller School,
1
 Odell
Plaza, Yonkers NY
10701
F
84.0
97110
x
1
97116
x
1
Student participated in Halloween themed activities in the PT gym
through obstacle course addressing motor planning, static and
dynamic balance, and LE strength.
Notes Entered:
10/30/2026
10:46:11
 AM
Signed:
10/30/2026
          Sruthi Job, PT,
049944
Cosigned:
          NOT COSIGNED
Meets Medicaid Requirements:
          Yes
Child Treatment Log
Printed: 10/30/2026 2:03:52 PM
Page 1 of 2
10/30/2026 - 10/30/2026
ESID: CPSECBRS0000152740 Physical Therapy- Individual
Child:  Brunson, Jeremiah
Date of Birth:  6/11/2022
Therapist:  Sruthi Job, PT, 049944
Date / Time
Setting
ICD/CPT
Codes
Notes
10/30/26
  In:
12:30
PM
Out:
01:00
PM
Preschool Fred S.
Keller School,
1
 Odell
Plaza, Yonkers NY
10701
F
82
97110
x
1
97116
x
1
Student participated in Halloween themed activities in the PT gym.
Notes Entered:
10/30/2026
1:12:21
 PM
Signed:
10/30/2026
          Sruthi Job, PT,
049944
Child Treatment Log
Printed: 10/30/2026 2:03:52 PM
Page 2 of 2
`;

describe('CPSE Child Treatment Log parse', () => {
  it('detects CPSE Child Treatment Log and does not classify as Therapist Activity', () => {
    expect(isCpseChildTreatmentLogText(CPSE_CHILD_TREATMENT_LOG_SAMPLE)).toBe(true);
    expect(isTherapistActivityText(CPSE_CHILD_TREATMENT_LOG_SAMPLE)).toBe(false);
    expect(isCpseChildTreatmentLogText('Student Name: Aiden\n08/11/2026\nService Provided: gait')).toBe(
      false,
    );
  });

  it('reads child name from the page-top Child: header (not the street address)', () => {
    expect(extractCpseChildHeaderName(CPSE_CHILD_TREATMENT_LOG_SAMPLE)).toMatch(/Brunson,\s*Jeremiah/i);
    const firstPageOnly = CPSE_CHILD_TREATMENT_LOG_SAMPLE.split('Brunson')[0] || '';
    expect(extractCpseChildHeaderName(firstPageOnly)).toMatch(/Almonte,\s*Alexander/i);
  });

  it('parses child, date/time, CPT, PT service, makeup, and provider', () => {
    const rows = parseCpseChildTreatmentLogText(CPSE_CHILD_TREATMENT_LOG_SAMPLE);
    expect(rows).toHaveLength(2);

    expect(rows[0]?.studentName).toMatch(/Almonte,\s*Alexander/i);
    expect(rows[0]?.studentName).not.toMatch(/Odell|Yonkers|Plaza/i);
    expect(rows[0]?.dateOfService).toBe('10/30/26');
    expect(rows[0]?.beginTime.toLowerCase()).toContain('09:00');
    expect(rows[0]?.endTime.toLowerCase()).toContain('09:30');
    expect(rows[0]?.attendance).toBe('makeup');
    expect(rows[0]?.cptCodes).toEqual(expect.arrayContaining(['97110', '97116']));
    expect(rows[0]?.serviceType).toMatch(/PT Individual/i);
    expect(rows[0]?.signed).toBe(true);
    expect(rows[0]?.providerName).toMatch(/Sruthi Job/i);
    expect(rows[0]?.notes).toMatch(/Make up for:\s*09\/10\/26/i);

    expect(rows[1]?.studentName).toMatch(/Brunson,\s*Jeremiah/i);
    expect(rows[1]?.beginTime.toLowerCase()).toContain('12:30');
    expect(rows[1]?.endTime.toLowerCase()).toContain('01:00');
    expect(rows[1]?.attendance).toBe('attended');
  });

  it('routes through parseWeeklySessionText auto-detect', () => {
    const rows = parseWeeklySessionText(CPSE_CHILD_TREATMENT_LOG_SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.studentName).toMatch(/Almonte,\s*Alexander/i);
    expect(rows[0]?.dateOfService).toBe('10/30/26');
    expect(rows[0]?.beginTime.toLowerCase()).toContain('09:00');
  });
});
