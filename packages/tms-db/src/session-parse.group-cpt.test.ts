import { describe, expect, it } from 'vitest';
import { parseWeeklySessionText } from './session-parse.js';
import { soloGroupMandateNoteError } from './session-overlap.js';
import type { Mandate } from './types.js';

const MOMIN_NOTE =
  "Momin transitioned well to PT with some encouragement today. He engaged in LE PRE's, balance and coordination training (jumping on and off target, running activity). vc and visual demonstration required ModA. Improvement noted with jumping stance";

function groupMandate(): Mandate {
  return {
    id: 'm1',
    studentId: 'st1',
    providerId: 'p',
    schoolId: 's',
    serviceType: 'PT School Group',
    discipline: 'PT',
    ratioGroup: true,
    groupSize: 2,
    frequencyPerWeek: 2,
    sessionsPerPeriod: 2,
    period: 'week',
    startDate: '',
    endDate: '',
    mandateKind: 'regular',
    active: true,
    createdAt: '',
  } as Mandate;
}

describe('Frontline 2:1 / CPT 97150 is a group session', () => {
  it('reads ratio 2:1 printed before the service date and does not demand a no-peer note', () => {
    const text = `
District/Agency/BOCES: Valley Stream Union Free School District Thirty
Summary of Related Service Session Notes (continued)
Service: Physical Therapy
Service Provider: Dawan, Fatimah
From: 10/04/2026 To: 10/10/2026
Student Name: Momin Anees, D.O.B. 09/17/2021
Ratio
2:1
10/09/2026
8:40 am
9:10 am
Clear Stream Avenue School
Service Provided: ${MOMIN_NOTE}
97150
1
Telehealth: No
Provider Signature/Credentials
Fatimah Dawan PT (NPI# 1710165795) (License# 029347)
Date
Oct 9 2026 10:23AM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dateOfService).toBe('10/09/2026');
    expect(rows[0]?.beginTime).toMatch(/8:40/i);
    expect(rows[0]?.endTime).toMatch(/9:10/i);
    expect(rows[0]?.ratio).toBe('2:1');
    expect(rows[0]?.cptCodes).toContain('97150');
    expect(rows[0]?.serviceType).toMatch(/2\s*:\s*1/);
    expect(rows[0]?.notes).not.toMatch(/no peer|no partner/i);
    expect(
      soloGroupMandateNoteError({
        notes: rows[0]!.notes,
        serviceType: rows[0]!.serviceType,
        studentId: 'st1',
        attendance: rows[0]!.attendance,
        mandates: [groupMandate()],
        presentGroupPeerCount: 0,
        cptCodes: rows[0]!.cptCodes,
        ratio: rows[0]!.ratio,
      }),
    ).toBeNull();
  });

  it('treats CPT 97150 with no readable ratio as a group and keeps 1:1 individual', () => {
    const groupOnly = parseWeeklySessionText(`
Service: Physical Therapy
Student Name: Momin Anees, D.O.B. 09/17/2021
10/09/2026
8:40 am
9:10 am
Service Provided: ${MOMIN_NOTE}
97150
1
Provider Signature/Credentials
Date
Fatimah Dawan PT
Oct 9 2026 10:23AM
`);
    expect(groupOnly[0]?.ratio).toBe('');
    expect(groupOnly[0]?.serviceType).toMatch(/\bGroup\b/);
    expect(
      soloGroupMandateNoteError({
        notes: groupOnly[0]!.notes,
        serviceType: groupOnly[0]!.serviceType,
        studentId: 'st1',
        attendance: 'attended',
        mandates: [groupMandate()],
        presentGroupPeerCount: 0,
        cptCodes: groupOnly[0]!.cptCodes,
      }),
    ).toBeNull();

    const solo = parseWeeklySessionText(`
Service: Physical Therapy
Student Name: Momin Anees, D.O.B. 09/17/2021
10/09/2026
1:1
8:40 am
9:10 am
Service Provided: ${MOMIN_NOTE}
97110
1
Provider Signature/Credentials
Date
Fatimah Dawan PT
Oct 9 2026 10:23AM
`);
    expect(solo[0]?.ratio).toBe('1:1');
    expect(solo[0]?.serviceType).not.toMatch(/\bGroup\b/);
    expect(
      soloGroupMandateNoteError({
        notes: solo[0]!.notes,
        serviceType: solo[0]!.serviceType,
        studentId: 'st1',
        attendance: 'attended',
        mandates: [groupMandate()],
        cptCodes: solo[0]!.cptCodes,
        ratio: solo[0]!.ratio,
      }),
    ).toMatch(/no peer was available/i);
  });
});
