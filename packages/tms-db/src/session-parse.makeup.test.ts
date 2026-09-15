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
