import { describe, expect, it } from 'vitest';
import { attendanceFromNotes, parseWeeklySessionText } from './session-parse.js';

describe('Frontline paid absence', () => {
  it('classifies Student Not Available: Paid absence as paid_absence', () => {
    expect(
      attendanceFromNotes('Student Not Available: Paid absence.', '2:00 pm', '2:30 pm'),
    ).toBe('paid_absence');
    expect(attendanceFromNotes('Paid absence — school closed', '9:00 am', '9:30 am')).toBe(
      'paid_absence',
    );
  });

  it('keeps unpaid Student Not Available as missed', () => {
    expect(
      attendanceFromNotes(
        'Student Not Available: Received message from father. Still being sick.',
        '2:00 pm',
        '2:30 pm',
      ),
    ).toBe('missed');
  });

  it('parses Frontline paid absence with Session Start/End times', () => {
    const text = `
Student Name: Test Child
Service Provider: Jazel White Glove - Baniqued PT
Service: Physical Therapy
District/Agency: East Street School

10/29/2026 1:1 2:00 pm 2:30 pm Student Not Available: Paid absence.
East Street School
0
Telehealth: No
Provider Signature / Credentials: Jazel White Glove - Baniqued PT (NPI# )
Oct 27 2026 3:23PM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.dateOfService === '10/29/2026') || rows[0];
    expect(row?.attendance).toBe('paid_absence');
    expect(row?.beginTime.replace(/\./g, '').toLowerCase()).toMatch(/2:00\s*pm/);
    expect(row?.endTime.replace(/\./g, '').toLowerCase()).toMatch(/2:30\s*pm/);
    expect(row?.notes).toMatch(/Paid absence/i);
  });
});
