import { describe, expect, it } from 'vitest';
import {
  parseWeeklySessionText,
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
});
