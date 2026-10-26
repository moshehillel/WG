import { describe, expect, it } from 'vitest';
import { extractMakeupForDate, resolveMakeupOfSessionId } from './makeup.js';
import { checkMandate } from './mandate.js';
import { attendanceFromNotes, parseWeeklySessionText } from './session-parse.js';
import type { Mandate, SessionRow } from './types.js';

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

  it('extracts Makeup for / makeup session for / missed session / date-before phrases', () => {
    const ref = { referenceDos: '09/30/2026' };
    // 1) Makeup for (date)
    expect(extractMakeupForDate('Makeup for 09/08/2026 gait', ref)).toBe('09/08/2026');
    expect(extractMakeupForDate('Makeup for 9/8 stairs', ref)).toBe('9/8/2026');
    // 2) makeup session for (date)
    expect(extractMakeupForDate('makeup session for 09/01/2026 balance', ref)).toBe('09/01/2026');
    expect(extractMakeupForDate('makeup session for 9/1 balance', ref)).toBe('9/1/2026');
    expect(extractMakeupForDate('make-up session for 9/3/26 walk', ref)).toBe('9/3/26');
    // 3) makeup for missed session on (date)
    expect(extractMakeupForDate('Makeup for missed session on 08/31/2026', ref)).toBe(
      '08/31/2026',
    );
    expect(extractMakeupForDate('Makeup for missed session on 8/31', ref)).toBe('8/31/2026');
    // 4) (date) makeup session
    expect(extractMakeupForDate('09/09/2026 makeup session gait', ref)).toBe('09/09/2026');
    expect(extractMakeupForDate('9/9 makeup session gait', ref)).toBe('9/9/2026');
  });

  it('extracts "make up session for sept 14" month-name covered dates', () => {
    const ref = { referenceDos: '09/30/2026' };
    // Fatimah Dawan / Aviesh Frontline shape
    expect(
      extractMakeupForDate('Service Provided: make up session for sept 14', ref),
    ).toBe('9/14/2026');
    expect(extractMakeupForDate('makeup session for sept 14', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('make-up session for Sept 14', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('Makeup for September 14', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('Make up for Sep. 14th', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('makeup session for Sept 14, 2026', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('makeup session for sept 14 2025', ref)).toBe('9/14/2025');
    // date-before month-name
    expect(extractMakeupForDate('sept 14 makeup session gait', ref)).toBe('9/14/2026');
    expect(extractMakeupForDate('September 14 make-up session', ref)).toBe('9/14/2026');
    // school-year wrap: makeup in Jan for a Sept miss → previous year
    expect(
      extractMakeupForDate('make up session for sept 14', { referenceDos: '01/10/2027' }),
    ).toBe('9/14/2026');
  });

  it('links "make up session for sept 14" to an unused miss on 09/14', () => {
    const missed = sess({
      id: 'miss-914',
      attendance: 'missed',
      dateOfService: '09/14/2026',
      beginTime: '',
      endTime: '',
      notes: 'Student Not Available',
    });
    const makeup = sess({
      id: 'mu-aviesh',
      attendance: 'makeup',
      makeupOfSessionId: '',
      dateOfService: '09/28/2026',
      beginTime: '1:00 pm',
      endTime: '1:30 pm',
      notes:
        'Service Provided: make up session for sept 14 Aviesh engaged in LE/ core PRE\'s.',
    });
    expect(resolveMakeupOfSessionId(makeup, [missed, makeup], [])).toEqual({
      makeupOfSessionId: 'miss-914',
      via: 'miss',
    });
  });

  it('extracts yearless "9/9 makeup session" using the makeup DOS year', () => {
    const notes =
      'Service Provided: 9/9 makeup session Lucas transitioned well today. Session cut short secondary to a schedule conflict';
    expect(extractMakeupForDate(notes, { referenceDos: '09/30/2026' })).toBe('9/9/2026');
    expect(extractMakeupForDate(notes, { referenceDos: '09/30/2026' })).not.toBe('');
    expect(extractMakeupForDate('Make up for: 9/9 ' + notes, { referenceDos: '09/30/2026' })).toBe(
      '9/9/2026',
    );
  });

  it('links "9/9 makeup session" to an unused miss on 09/09', () => {
    const missed = sess({
      id: 'miss-99',
      attendance: 'missed',
      dateOfService: '09/09/2026',
      beginTime: '',
      endTime: '',
      notes: 'Provider Not Available',
    });
    const makeup = sess({
      id: 'mu-930',
      attendance: 'makeup',
      makeupOfSessionId: '',
      dateOfService: '09/30/2026',
      beginTime: '1:45 pm',
      endTime: '2:00 pm',
      notes:
        'Service Provided: 9/9 makeup session Lucas transitioned well today. Session cut short secondary to a schedule conflict',
    });
    expect(resolveMakeupOfSessionId(makeup, [missed, makeup], [])).toEqual({
      makeupOfSessionId: 'miss-99',
      via: 'miss',
    });
  });

  it('parses Frontline "9/9 makeup session" without inventing a 9/9 phantom row', () => {
    const text = `
District/Agency/BOCES: Valley Stream Union Free School District Thirty
Summary of Related Service Session Notes (continued)
Service: Physical Therapy
Service Provider: Dawan, Fatimah
From: 09/28/2026 To: 10/02/2026
Student Name: Lucas Martinez Giron, D.O.B. 09/01/2020
09/28/2026 3:1 97150  1 1:15 pm 1:45 pm
Clear Stream Avenue School
Service Provided: Student participated in group session. LE PRE's 2x10r.
Provider Signature/Credentials  Date Fatimah Dawan PT Sep 28 2026 2:34PM
Telehealth: No
09/30/2026 2:1 97150  1 1:45 pm 2:00 pm
Clear Stream Avenue School
Service Provided: 9/9 makeup session Lucas transitioned well today. He engaged in LE PRE's x10r. Session cut short secondary to a schedule conflict
Provider Signature/Credentials  Date Fatimah Dawan PT Oct 5 2026 12:11PM
Telehealth: No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.filter((r) => /09\/09|9\/9/.test(r.dateOfService))).toEqual([]);
    const makeup = rows.find((r) => r.dateOfService === '09/30/2026');
    expect(makeup?.attendance).toBe('makeup');
    expect(extractMakeupForDate(makeup?.notes || '', { referenceDos: '09/30/2026' })).toBe(
      '9/9/2026',
    );
    expect(makeup?.notes).toMatch(/make\s*up\s*for:\s*9\/9\/2026/i);
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

  it('splits consecutive filled Student Not Available rows (CG Sep 9/17→9/21→9/24)', () => {
    const text = `
District/Agency/BOCES: Valley Stream Union Free School District No. 24
Service: Occupational Therapy
Service Provider:Donaldson Fortune, Shayena
Student Name: Christopher Ginda, D.O.B. 12/06/2019
09/17/2026
 0
Robert W. Carbonaro School
Student Not Available: 9/17- Received message from Christophers
father at 1:14pm requesting to reschedule OT scheduled session
due to an appt. he forgot he had today. OT session rescheduled for
9/22.
09/21/2026
 0
Robert W. Carbonaro School
Student Not Available: 9/22- Received message from Christophers
father at 1:33 pm requesting to cancel OT scheduled session due to
Christopher being sick.
09/24/2026
 0
Robert W. Carbonaro School
Student Not Available: 9/24- Received message from Christophers
father at 11:00 am requesting to cancel OT scheduled session due
to Christopher still being sick.
Page 1 of 1
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.map((r) => r.dateOfService)).toEqual([
      '09/17/2026',
      '09/21/2026',
      '09/24/2026',
    ]);
    expect(rows.every((r) => r.attendance === 'missed')).toBe(true);
    expect(rows.every((r) => /Student Not Available/i.test(r.cancelReason))).toBe(true);
    expect(rows[0]?.notes).not.toMatch(/09\/21\/2026/);
    expect(rows[1]?.notes).toMatch(/being sick/i);
    expect(rows[2]?.notes).toMatch(/still being sick/i);
  });

  it('splits a filled Student Not Available note from the next attended DOS (CG 9-7 shape)', () => {
    // Miss note mentions "Sept. 10th" then the next column DOS is 09/10/2026 with CPT/times.
    const text = `
District/Agency/BOCES: Valley Stream Union Free School District No. 24
Summary of Related Service Session Notes
Service: Occupational Therapy
From: 09/07/2026 To: 09/11/2026
Service Provider:Donaldson Fortune, Shayena
Student Name: Christopher Ginda, D.O.B. 12/06/2019
09/08/2026
 0
Robert W. Carbonaro School
Student Not Available: 9/8/26- Student unavailable per father's
request to start OT tx session Thursday Sept. 10th
09/10/2026
1:1
97530
 2
 3:43 pm
 4:13 pm
Robert W. Carbonaro School
Service Provided: 9/10/26- Christopher was seen for first OT 1:1
session in the Valley Stream Library for the 2026-2027 school year.
Provider Signature/Credentials
Date
Shayena Donaldson Fortune OTR/L (NPI# 1154846871) (License# 013641)
Sep 15 2026 9:18PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(2);
    const miss = rows.find((r) => r.dateOfService === '09/08/2026');
    const attend = rows.find((r) => r.dateOfService === '09/10/2026');
    expect(miss?.attendance).toBe('missed');
    expect(miss?.cancelReason).toMatch(/Student Not Available/i);
    expect(miss?.beginTime).toBe('');
    expect(attend?.attendance).toBe('attended');
    expect(attend?.beginTime).toMatch(/3:43/i);
    expect(attend?.endTime).toMatch(/4:13/i);
    expect(attend?.cptCodes).toContain('97530');
    expect(attend?.cptUnits).toBe(2);
    expect(attend?.signed).toBe(true);
    expect(attend?.notes).toMatch(/first OT 1:1/i);
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

const JULIAN_MAKEUP_NOTE =
  'Julian was seen for an occupational therapy Make up session that he missed on September 24 as he was sick. He was seen for one on one session that included visual perception, activity of completing 48 piece puzzle and a table top activity with cues 50% of the time. He also participated in involve push-ups of 10 reps times three sets with rest breaks in between.';

const JONATHAN_MMAKEUP_NOTE =
  'Service Provided: MMAKE-UP for 10/8/26 (Provider absence).No peer was present. Student\'s group mate was taken off this provider\'s caseload. Jonathan had difficulty transitioning to therapy. He walked to the cafeteria door and sat on the floor, unable to follow directions to get up and walk to therapy. The school psychologist helped Jonathan stood up and walked to the therapy room with reinforcement. He completed a step-up/down activity with handheld assistance x 10 reps x 2 sets and bounced on the therapy ball with contact guard assistance. He used a step to pattern to go down the stairs with 1 hand holding onto the rail and alternating pattern to go up with 1 hand holding onto the rail.';

describe('Service Provided "MMAKE-UP for 10/8/26 (Provider absence)"', () => {
  it('reads the extra-M makeup line as a makeup for 10/8/26, not a provider absence', () => {
    const ref = { referenceDos: '10/15/2026' };
    expect(extractMakeupForDate(JONATHAN_MMAKEUP_NOTE, ref)).toBe('10/8/26');
    expect(extractMakeupForDate('MMAKE-UP for 10/8/26 (Provider absence)', ref)).toBe('10/8/26');
    expect(extractMakeupForDate('MMAKEUP for 10/8/26', ref)).toBe('10/8/26');
    expect(attendanceFromNotes(JONATHAN_MMAKEUP_NOTE, '10:00 am', '10:30 am')).toBe('makeup');
    expect(
      attendanceFromNotes('MMAKE-UP for 10/8/26 (Provider absence). No peer was present.', '10:00 am', '10:30 am'),
    ).toBe('makeup');

    const text = `
District/Agency/BOCES: Example District
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Example, Therapist
Student Name: Jonathan Smith, D.O.B. 01/02/2018
10/15/2026
1:1
97530
 2
10:00 am
10:30 am
Example School
${JONATHAN_MMAKEUP_NOTE}
Provider Signature/Credentials
Date
Example Therapist PT
Oct 15 2026 2:00PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.filter((r) => /10\/8|10\/08/.test(r.dateOfService))).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendance).toBe('makeup');
    expect(rows[0]?.dateOfService).toBe('10/15/2026');
    expect(rows[0]?.notes).toMatch(/make\s*up\s*for:\s*10\/8\/26/i);
    expect(rows[0]?.notes).toMatch(/MMAKE-UP for 10\/8\/26/i);
  });
});

describe('Service Provided "Make up session" that he missed on September 24', () => {
  it('classifies the Julian occupational therapy note as makeup and keeps the missed date', () => {
    const ref = { referenceDos: '10/01/2026' };
    const serviceProvided = `Service Provided: ${JULIAN_MAKEUP_NOTE}`;
    expect(extractMakeupForDate(serviceProvided, ref)).toBe('9/24/2026');
    expect(extractMakeupForDate(JULIAN_MAKEUP_NOTE, ref)).toBe('9/24/2026');
    expect(
      extractMakeupForDate(
        'Service Provided: Make up session that he missed on Sept 24',
        ref,
      ),
    ).toBe('9/24/2026');
    expect(attendanceFromNotes(serviceProvided, '10:00 am', '10:30 am')).toBe('makeup');
    expect(attendanceFromNotes(JULIAN_MAKEUP_NOTE, '10:00 am', '10:30 am')).toBe('makeup');
    expect(attendanceFromNotes('make-up session visual perception', '10:00 am', '10:30 am')).toBe(
      'makeup',
    );
    expect(attendanceFromNotes('makeup session visual perception', '10:00 am', '10:30 am')).toBe(
      'makeup',
    );

    const text = `
District/Agency/BOCES: Valley Stream Union Free School District No. 24
Summary of Related Service Session Notes
Service: Occupational Therapy
Service Provider: Example, Therapist
Student Name: Julian Smith, D.O.B. 01/02/2018
10/01/2026
1:1
97530
 2
10:00 am
10:30 am
Robert W. Carbonaro School
Service Provided: ${JULIAN_MAKEUP_NOTE}
Provider Signature/Credentials
Date
Example Therapist OTR/L
Oct 1 2026 2:00PM
Telehealth:
No
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.filter((r) => /9\/24|09\/24/.test(r.dateOfService))).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendance).toBe('makeup');
    expect(rows[0]?.dateOfService).toBe('10/01/2026');
    expect(rows[0]?.notes).toMatch(/make\s*up\s*for:\s*9\/24\/2026/i);
    expect(rows[0]?.notes).toMatch(/Make up session/i);

    const activity = `
Therapist Activity Printed: 10/1/2026 2:00:00 PM Page 1 of 1 Example, Therapist
Date / Time Setting Child ICD/CPT Codes Notes
10/01/26 In: 10:00 AM Out: 10:30 AM School SMITH, JULIAN CBRS2627S0093066(OT-I) F82.0 97530x2
${JULIAN_MAKEUP_NOTE}
Notes Entered: 10/1/2026 2:00:00 PM
Signed: 10/1/2026 Example Therapist, OTR/L
`;
    const activityRows = parseWeeklySessionText(activity);
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]?.attendance).toBe('makeup');
    expect(extractMakeupForDate(activityRows[0]?.notes || '', ref)).toBe('9/24/2026');
  });

  it('does not treat a sick note with no makeup language as makeup', () => {
    const sick =
      'Service Provided: Julian was sick and did not come. He missed school on September 24.';
    expect(extractMakeupForDate(sick, { referenceDos: '10/01/2026' })).toBe('');
    expect(attendanceFromNotes(sick, '10:00 am', '10:30 am')).toBe('attended');
    expect(
      attendanceFromNotes(
        'Student Absence: child was sick on September 24',
        '10:00 am',
        '10:30 am',
      ),
    ).toBe('missed');
    expect(
      attendanceFromNotes(
        'Student Not Available: will make up later because he was sick',
        '',
        '',
      ),
    ).toBe('missed');
    expect(
      extractMakeupForDate(
        'Service Provided: we will make up later the work he missed on September 24 as he was sick',
        { referenceDos: '10/01/2026' },
      ),
    ).toBe('');
    expect(
      attendanceFromNotes(
        'Service Provided: we will make up later the work he missed on September 24 as he was sick',
        '10:00 am',
        '10:30 am',
      ),
    ).toBe('attended');
    expect(
      attendanceFromNotes(
        'Service Provided: He participated in involve push-ups of 10 reps times three sets.',
        '10:00 am',
        '10:30 am',
      ),
    ).toBe('attended');
  });
});

const JOSHUA_MAKEUP_FROM =
  'Service Provided: This is a makeup from 10/8/26. Josh again very interested in playing with squigz toys.';
const MATTHEW_MAKEUP_SESSION_FROM =
  "Service Provided: This is a makeup session from 10/6/26. We continue to work on Matthew's endurance when performing exercises.";

function frontlineVisit(opts: {
  student: string;
  dob: string;
  dos: string;
  begin: string;
  end: string;
  note: string;
}): string {
  return `
Student Name: ${opts.student}, D.O.B. ${opts.dob}
Service: Physical Therapy
Service Provider: Stein, Bari
${opts.dos}
1:1
97110
 2
${opts.begin}
${opts.end}
Alden Terrace School
${opts.note}
Provider Signature/Credentials
Date
Bari Rachel Stein PT
Oct 24 2026 8:32AM
Telehealth:
No
`;
}

function weeklyMandate(): Mandate {
  return {
    id: 'm-pt',
    studentId: 'st1',
    providerId: 'p1',
    serviceType: 'PT School',
    discipline: 'PT',
    frequencyPerWeek: 2,
    ratioGroup: false,
    sourcePdfKey: '',
    parsedAt: '',
    startOn: '',
    endOn: '',
    createdAt: '',
  };
}

describe('Service Provided "makeup from" / "makeup session from"', () => {
  it('reads Joshua "makeup from 10/8/26" as a makeup for that date', () => {
    const ref = { referenceDos: '10/21/2026' };
    expect(extractMakeupForDate(JOSHUA_MAKEUP_FROM, ref)).toBe('10/8/26');
    expect(attendanceFromNotes(JOSHUA_MAKEUP_FROM, '1:05 pm', '1:35 pm')).toBe('makeup');
    const rows = parseWeeklySessionText(
      frontlineVisit({
        student: 'Joshua Artis',
        dob: '01/02/2018',
        dos: '10/21/2026',
        begin: '1:05 pm',
        end: '1:35 pm',
        note: JOSHUA_MAKEUP_FROM,
      }),
    );
    expect(rows.filter((r) => /10\/8/.test(r.dateOfService))).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendance).toBe('makeup');
    expect(rows[0]?.dateOfService).toBe('10/21/2026');
    expect(rows[0]?.notes).toMatch(/make\s*up\s*for:\s*10\/8\/26/i);
  });

  it('reads Matthew "makeup session from 10/6/26" as a makeup for that date', () => {
    const ref = { referenceDos: '10/22/2026' };
    expect(extractMakeupForDate(MATTHEW_MAKEUP_SESSION_FROM, ref)).toBe('10/6/26');
    expect(attendanceFromNotes(MATTHEW_MAKEUP_SESSION_FROM, '1:05 pm', '1:35 pm')).toBe('makeup');
    const rows = parseWeeklySessionText(
      frontlineVisit({
        student: 'Matthew Iniguez',
        dob: '03/04/2017',
        dos: '10/22/2026',
        begin: '1:05 pm',
        end: '1:35 pm',
        note: MATTHEW_MAKEUP_SESSION_FROM,
      }),
    );
    expect(rows.filter((r) => /10\/6/.test(r.dateOfService))).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attendance).toBe('makeup');
    expect(rows[0]?.dateOfService).toBe('10/22/2026');
    expect(rows[0]?.notes).toMatch(/make\s*up\s*for:\s*10\/6\/26/i);
  });

  it('does not take a later "from <date>" as the covered miss', () => {
    const note =
      'Service Provided: This is a makeup session. He walked from 10/6/26 to the gym.';
    expect(extractMakeupForDate(note, { referenceDos: '10/22/2026' })).toBe('');
    expect(attendanceFromNotes(note, '1:05 pm', '1:35 pm')).toBe('makeup');
  });

  it('links each from-date makeup to the unused miss and keeps Joshua inside a 2/week mandate', () => {
    const joshuaMiss = sess({
      id: 'miss-108',
      attendance: 'missed',
      dateOfService: '10/08/2026',
      beginTime: '',
      endTime: '',
      notes: 'Provider Absence',
    });
    const joshuaMakeup = sess({
      id: 'mu-1021',
      attendance: 'makeup',
      dateOfService: '10/21/2026',
      beginTime: '1:05 pm',
      endTime: '1:35 pm',
      notes: JOSHUA_MAKEUP_FROM,
    });
    expect(resolveMakeupOfSessionId(joshuaMakeup, [joshuaMiss, joshuaMakeup], [])).toEqual({
      makeupOfSessionId: 'miss-108',
      via: 'miss',
    });

    const matthewMiss = sess({
      id: 'miss-106',
      attendance: 'missed',
      dateOfService: '10/06/2026',
      beginTime: '',
      endTime: '',
      notes: 'Student Absence',
    });
    const matthewMakeup = sess({
      id: 'mu-1022',
      attendance: 'makeup',
      dateOfService: '10/22/2026',
      beginTime: '1:05 pm',
      endTime: '1:35 pm',
      notes: MATTHEW_MAKEUP_SESSION_FROM,
    });
    expect(resolveMakeupOfSessionId(matthewMakeup, [matthewMiss, matthewMakeup], [])).toEqual({
      makeupOfSessionId: 'miss-106',
      via: 'miss',
    });
    expect(resolveMakeupOfSessionId(matthewMakeup, [matthewMakeup], [])).toMatchObject({
      error: expect.stringMatching(/No unused missed session on 10\/6\/26/i),
    });

    const week = [
      sess({ id: 'a', dateOfService: '10/20/2026', beginTime: '11:45 am', endTime: '12:15 pm' }),
      { ...joshuaMakeup, makeupOfSessionId: 'miss-108' },
      sess({ id: 'c', dateOfService: '10/22/2026', beginTime: '11:29 am', endTime: '11:59 am' }),
    ];
    const linked = checkMandate(weeklyMandate(), week, [joshuaMiss, ...week], {
      studentLabel: 'Joshua Artis',
    });
    expect(linked.over).toBe(false);
    expect(linked.used).toBe(2);

    const countedAsAttended = checkMandate(
      weeklyMandate(),
      week.map((s) => (s.id === 'mu-1021' ? { ...s, attendance: 'attended' as const, makeupOfSessionId: '' } : s)),
      week,
      { studentLabel: 'Joshua Artis' },
    );
    expect(countedAsAttended.over).toBe(true);
    expect(countedAsAttended.used).toBe(3);
  });
});
