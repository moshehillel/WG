import { describe, expect, it } from 'vitest';
import { noteNeedsAbsenceFallback } from './ai-screen.js';

describe('noteNeedsAbsenceFallback', () => {
  it('asks for a read when an attended note says the child did not come', () => {
    expect(
      noteNeedsAbsenceFallback({
        attendance: 'attended',
        notes: 'Service Provided: Julian was sick and did not come. He missed school on September 24.',
      }),
    ).toBe(true);
  });

  it('asks for a read when the only clue is the word missed', () => {
    expect(
      noteNeedsAbsenceFallback({
        attendance: 'attended',
        notes: 'Liam transitioned well. He missed a turn once then re-engaged.',
      }),
    ).toBe(true);
  });

  it('skips a clean attended note, a missed row, and a partner-absent note', () => {
    expect(
      noteNeedsAbsenceFallback({
        attendance: 'attended',
        notes: 'Service Provided: He completed a puzzle and an I-spy activity.',
      }),
    ).toBe(false);
    expect(
      noteNeedsAbsenceFallback({
        attendance: 'missed',
        notes: 'Student Absence: child was sick',
      }),
    ).toBe(false);
    expect(
      noteNeedsAbsenceFallback({
        attendance: 'attended',
        notes: 'Service Provided: The child was seen one on one because his partner was absent today.',
      }),
    ).toBe(false);
  });
});
