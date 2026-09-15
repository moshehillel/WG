import { describe, expect, it } from 'vitest';
import {
  isNonSchoolLikeSetting,
  looksLikeDistrictLabel,
  parseWeeklySessionText,
  pdfSchoolConflictsWithChild,
  schoolNamesConflict,
} from './session-parse.js';

describe('school name match / Frontline Setting', () => {
  it('does not flag Carle Place Middle School vs Carle Place MS/HS', () => {
    expect(schoolNamesConflict('Carle Place Middle School', 'Carle Place MS/HS')).toBe(false);
    expect(schoolNamesConflict('Carle Place MS/HS', 'Carle Place Middle School')).toBe(false);
    expect(schoolNamesConflict('Carle Place HS', 'Carle Place High School')).toBe(false);
  });

  it('still flags a different school', () => {
    expect(schoolNamesConflict('Carle Place MS/HS', 'Westbury Middle School')).toBe(true);
  });

  it('treats Westbury Union Free / UFSD as the same district label', () => {
    expect(looksLikeDistrictLabel('Westbury Union Free School District')).toBe(true);
    expect(looksLikeDistrictLabel('Westbury UFSD')).toBe(true);
    expect(looksLikeDistrictLabel('Powells Lane')).toBe(false);
    expect(looksLikeDistrictLabel('Westbury Middle School')).toBe(false);
    expect(schoolNamesConflict('Westbury Union Free School', 'Westbury UFSD')).toBe(false);
    expect(
      pdfSchoolConflictsWithChild(
        'Westbury Union Free School',
        { name: 'Powells Lane', district: '' },
        'Westbury UFSD',
      ),
    ).toBe(false);
    expect(
      pdfSchoolConflictsWithChild(
        'Westbury Middle School',
        { name: 'Powells Lane', district: '' },
        'Westbury UFSD',
      ),
    ).toBe(true);
    expect(
      pdfSchoolConflictsWithChild(
        'Carle Place UFSD',
        { name: 'Powells Lane', district: '' },
        'Westbury UFSD',
      ),
    ).toBe(true);
  });

  it('reads Setting Carle Place MS/HS instead of a header "... School" fallback', () => {
    const text = `
Summary of Related Service Session Notes
Student Name: Santos-Santiago, Nicolas
District/Agency: BOCES: Carle Place UFSD
Service Provider: Vasaturo, James (Physical Therapy)
Carle Place Middle School letterhead
09/02/2026 12:00 pm 12:30 pm
Setting: Carle Place MS/HS
Service Provided: gait training
Provider Signature/Credentials
Date
James Vasaturo PT
Sep 2 2026 12:40PM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.schoolName).toMatch(/Carle Place MS\/HS/i);
  });

  it('reads unlabeled Frontline setting Powells Lane over District/Agency header', () => {
    const text = `
District/Agency/BOCES: Westbury Union Free School District
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Dawan, Fatimah (White Glove)
Student Name: Daniel Amaya, D.O.B. 08/09/2019
09/08/2026 1:1 97110  1 9:27 am  9:57 am
Powells Lane
Service Provided: Daniel engaged in LE strengthening exercises
Provider Signature/Credentials  Date
Fatimah (White Glove) Dawan PT
Sep  8 2026 12:11PM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.schoolName).toMatch(/Powells Lane/i);
  });

  it('skips lone group-size "1" and reads Woodland School', () => {
    const text = `
District/Agency/BOCES: Westbury Union Free School District
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Test, Provider (White Glove)
Student Name: Matteo Mira, D.O.B. 01/01/2018
09/08/2026
1:1
97110
1
1:25 pm
1:55 pm
Woodland School
Service Provided: Matteo engaged in strengthening exercises
Provider Signature/Credentials  Date
Test Provider PT
Sep  8 2026 2:00PM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.schoolName).toMatch(/Woodland School/i);
    expect(rows[0]?.schoolName).not.toBe('1');
  });

  it('does not treat Setting: 1 as a school name', () => {
    const text = `
Student Name: Netra Patel, D.O.B. 01/01/2018
09/10/2026 12:05 pm 12:35 pm
Setting: 1
Woodland School
Service Provided: session note
Provider Signature/Credentials
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.schoolName).toMatch(/Woodland School/i);
  });

  it('rejects note fragments and ICD codes as school names', () => {
    expect(isNonSchoolLikeSetting('with reward (walking on hallway).')).toBe(true);
    expect(isNonSchoolLikeSetting('F82')).toBe(true);
    expect(isNonSchoolLikeSetting('poor body safety awareness.')).toBe(true);
    expect(isNonSchoolLikeSetting('Powells Lane')).toBe(false);
    expect(isNonSchoolLikeSetting('Clara H. Carlson School')).toBe(false);
  });

  it('ignores note scraps / F82 and prefers Clara H. Carlson School', () => {
    const text = `
District/Agency/BOCES: Elmont Union Free School District
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Test, Provider (White Glove)
Student Name: Anthony Duroseau, D.O.B. 01/01/2018
Clara H. Carlson School
09/03/2026 10:00 am 10:30 am
with reward (walking on hallway).
Service Provided: gait training with reward
Provider Signature/Credentials  Date
Test Provider PT
Sep  3 2026 10:40AM

Student Name: Valerie Eley, D.O.B. 01/01/2018
09/03/2026 11:00 am 11:30 am
F82
Service Provided: balance work
Provider Signature/Credentials  Date
Test Provider PT
Sep  3 2026 11:40AM

Student Name: Anthony Figueroa Contreras, D.O.B. 01/01/2018
09/03/2026 1:00 pm 1:30 pm
poor body safety awareness.
Service Provided: safety awareness practice
Provider Signature/Credentials  Date
Test Provider PT
Sep  3 2026 1:40PM
`;
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.schoolName).toMatch(/Clara H\. Carlson School/i);
      expect(row.schoolName).not.toMatch(/reward|F82|awareness/i);
    }
  });
});
