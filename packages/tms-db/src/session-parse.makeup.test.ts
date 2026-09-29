import { describe, expect, it } from 'vitest';
import { extractMakeupForDate, resolveMakeupOfSessionId } from './makeup.js';
import { parseWeeklySessionText } from './session-parse.js';
import type { SessionRow } from './types.js';

function sess(partial: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    weekId: 'w1',
    studentId: 'st1',
    dateOfService: '09/01/2026',
    beginTime: '9:00 am',
    endTime: '9:30 am',
    attendance: 'attended',
    cancelReason: '',
    makeupOfSessionId: '',
    serviceType: 'PT School',
    location: '',
    notes: 'Service Provided: gait',
    aiFlags: [],
    ...partial,
  };
}

describe('Frontline makeup covered-miss date', () => {
  it('extracts date from "make-up session MM/DD/YY"', () => {
    expect(
      extractMakeupForDate(
        'Service Provided: Student was seen for therapy make-up session 9/3/26. student walked.',
      ),
    ).toBe('9/3/26');
    expect(extractMakeupForDate('Makeup for 09/08/2026 gait training')).toBe('09/08/2026');
    expect(extractMakeupForDate('Make up for 9/8/26 stairs')).toBe('9/8/26');
  });

  it('does not invent a missed row from the covered date inside a makeup note', () => {
    const text = `
District/Agency/BOCES: Elmont Union Free School District
Summary of Related Service Session Notes
Service: Physical Therapy
From: 09/07/2026 To: 09/11/2026
Service Provider: Patel PT*, Neelamben
Student Name: Anthony Duroseau, D.O.B. 05/15/2019
09/08/2026  0
Clara H. Carlson School
Provider Not Available:
09/10/2026 1:1 97110  1 11:10 am 11:40 am
Clara H. Carlson School
Service Provided: Student was seen for therapy make-up session 9/3/26. student performed walking on balance beam without missing 5 out of 8 feet.
Provider Signature/Credentials  Date Neelamben Patel PT* PT Sep 10 2026 1:49PM
Telehealth: No
`;
    const rows = parseWeeklySessionText(text);
    const phantom = rows.filter((r) => /9\/3\/26|09\/03/.test(r.dateOfService));
    expect(phantom).toEqual([]);
    const makeup = rows.filter((r) => r.attendance === 'makeup');
    expect(makeup).toHaveLength(1);
    expect(makeup[0]?.dateOfService).toBe('09/10/2026');
    expect(extractMakeupForDate(makeup[0]?.notes || '')).toBe('9/3/26');
    expect(makeup[0]?.notes).toMatch(/make[\s-]?up session 9\/3\/26/i);
    const realMiss = rows.filter((r) => r.attendance === 'missed');
    expect(realMiss).toHaveLength(1);
    expect(realMiss[0]?.dateOfService).toBe('09/08/2026');
  });

  it('links makeup to unused miss on the covered date from make-up session phrasing', () => {
    const missed = sess({
      id: 'miss-93',
      attendance: 'missed',
      dateOfService: '09/03/2026',
      beginTime: '',
      endTime: '',
      notes: 'Provider Not Available',
    });
    const makeup = sess({
      id: 'mu',
      attendance: 'makeup',
      makeupOfSessionId: '',
      dateOfService: '09/10/2026',
      notes:
        'Make up for: 9/3/26 Service Provided: Student was seen for therapy make-up session 9/3/26.',
    });
    expect(resolveMakeupOfSessionId(makeup, [missed, makeup], [])).toEqual({
      makeupOfSessionId: 'miss-93',
      via: 'miss',
    });
  });
});

describe('Frontline Log Type / note-embedded dates', () => {
  it('does not invent a miss from "first attend date MM/DD/YY" inside Service Provided', () => {
    const text = `
District/Agency/BOCES: Elmont Union Free School District
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Patel PT*, Neelamben
Student Name: Juliette Ingargiola, D.O.B. 10/26/2021
09/15/2026
1:1
97110
 1
11:00 am
11:30 am
Clara H. Carlson School
Service Provided: Student was seen for first attend date 9/15/26. therapist is establishing good rapport with this child and assessing her gross motor skills.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 15 2026 2:50PM
Telehealth:
No
09/15/2026
1:1
97116
 1
11:00 am
11:30 am
Clara H. Carlson School
Service Provided: Student was seen for first attend date 9/15/26. therapist is establishing good rapport with this child and assessing her gross motor skills.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 15 2026 2:50PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendance).toBe('attended');
    expect(rows[0]?.dateOfService).toBe('09/15/2026');
    expect(rows[0]?.beginTime).toMatch(/11:00/i);
    expect(rows[0]?.signed).toBe(true);
    expect(rows[0]?.cptUnits).toBe(2);
    expect(rows.filter((r) => /9\/15\/26/.test(r.dateOfService))).toEqual([]);
  });

  it('keeps Provider Not Available Log Type as missed with Frontline reason', () => {
    const text = `
Student Name: Michelle Benny, D.O.B. 08/04/2018
Service Provider: Patel PT*, Neelamben
Service: Physical Therapy
09/16/2026
 0
Clara H. Carlson School
Provider Not Available:
09/17/2026
1:1
97110
 1
11:30 am
12:00 pm
Clara H. Carlson School
Service Provided: Student was seen for first treatment session 9/17/26. student engaged in gross motor activity.
Provider Signature/Credentials
Date
Neelamben Patel PT* PT (NPI# 1699139774) (License# 039203)
Sep 20 2026 3:55PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    const miss = rows.find((r) => r.dateOfService === '09/16/2026');
    const attend = rows.find((r) => r.dateOfService === '09/17/2026');
    expect(miss?.attendance).toBe('missed');
    expect(miss?.cancelReason).toMatch(/Provider Not Available/i);
    expect(attend?.attendance).toBe('attended');
    expect(attend?.signed).toBe(true);
    expect(rows.filter((r) => /9\/17\/26/.test(r.dateOfService))).toEqual([]);
  });

  it('keeps a slash-date signature stamp on the session instead of splitting it off', () => {
    const text = `
Student Name: South, Sebastian
Service Provider: Rivera, Alex
Service: Speech Therapy
09/14/2026 12:15 pm 12:45 pm
Service Provided: articulation drills
Provider Signature/Credentials
Date
Alex Rivera TSSLD
09/14/2026 2:10PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dateOfService).toBe('09/14/2026');
    expect(rows[0]?.beginTime).toMatch(/12:15/i);
    expect(rows[0]?.signed).toBe(true);
    expect(rows[0]?.sourceSlice).toMatch(/TSSLD/);
    expect(rows[0]?.sourceSlice).toMatch(/09\/14\/2026 2:10PM/);
  });

  it('keeps Provider Signature when Frontline reprints Student Name after a page break', () => {
    // Netra Patel RSLog shape: note ends on page N; page N+1 reprints Student Name
    // then the cut-off Provider Signature (no Ratio/CPT / Log Type before the stamp).
    const text = `
District/Agency/BOCES: Hicksville UFSD
Service: Physical Therapy
From: 09/22/2026 To: 09/25/2026
Service Provider:White Glove -Baniqued, Jazel
Student Name: Netra Patel, D.O.B. 07/30/2020
09/24/2026 1:1 97530  212:05 pm 12:35 pm
Woodland School
Service Provided: Netra transitioned well to/from the therapy room.
He can maintain static standing on the incline to decreased toe-walking.
Page 6 of 13
Summary of Related Service Session Notes (continued)
District/Agency/BOCES: Hicksville UFSD
Service: Physical Therapy
From: 09/22/2026 To: 09/25/2026
Service Provider:White Glove -Baniqued, Jazel
Student Name: Netra Patel, D.O.B. 07/30/2020
Provider Signature/Credentials  DateJazel White Glove -Baniqued PT     (NPI# ) Sep 24 2026  1:01PMTelehealth: No
Page 7 of 13
Summary of Related Service Session Notes (continued)
Student Name: Zain Quazi, D.O.B. 03/14/2016
09/22/2026 1:1 97112  1 9:35 am 10:05 am
Woodland School
Service Provided: Zain transitioned well.
Provider Signature/Credentials  DateJazel White Glove -Baniqued PT     (NPI# ) Sep 22 2026 11:32AMTelehealth: No
`;
    const rows = parseWeeklySessionText(text);
    const netra = rows.find(
      (r) => /netra/i.test(r.studentName) && r.dateOfService === '09/24/2026',
    );
    expect(netra?.attendance).toBe('attended');
    expect(netra?.beginTime).toMatch(/12:05/i);
    expect(netra?.endTime).toMatch(/12:35/i);
    expect(netra?.signed).toBe(true);
    expect(netra?.sourceSlice).toMatch(/Provider Signature\/Credentials/i);
    expect(netra?.sourceSlice).toMatch(/Baniqued PT/i);
    expect(netra?.sourceSlice).toMatch(/Sep 24 2026/i);
  });

  it('keeps page-break signature then continues same-student split CPT row', () => {
    const text = `
Student Name: Zarrar Quazi, D.O.B. 03/14/2016
Service: Physical Therapy
Service Provider:White Glove -Baniqued, Jazel
09/24/2026 1:1 97530  110:05 am 10:35 am
Woodland School
Service Provided: Zarrar navigated a 2-step obstacle course.
Page 9 of 13
Student Name: Zarrar Quazi, D.O.B. 03/14/2016
Provider Signature/Credentials  DateJazel White Glove -Baniqued PT     (NPI# ) Sep 24 2026  1:31PMTelehealth: No
09/24/2026 1:1 97110  110:05 am 10:35 am
Woodland School
Service Provided: Zarrar navigated a 2-step obstacle course.
Provider Signature/Credentials  DateJazel White Glove -Baniqued PT     (NPI# ) Sep 24 2026  1:31PMTelehealth: No
`;
    const rows = parseWeeklySessionText(text);
    const zarrar = rows.filter((r) => /zarrar/i.test(r.studentName));
    expect(zarrar).toHaveLength(1);
    expect(zarrar[0]?.signed).toBe(true);
    expect(zarrar[0]?.cptCodes?.sort()).toEqual(['97110', '97530']);
    expect(zarrar[0]?.sourceSlice).toMatch(/Sep 24 2026/i);
  });
});
