import { describe, expect, it } from 'vitest';
import { applyClaudeNoteRead, noteReadPrompt, type NoteReadInput } from './note-read.js';

const rows: NoteReadInput[] = [
  {
    studentName: 'Julian',
    dateOfService: '10/09/2026',
    beginTime: '12:30',
    endTime: '1:00',
    rulesAttendance: 'attended',
    notes: 'Service Provided: Julian was sick and did not come.',
  },
  {
    studentName: 'Julian',
    dateOfService: '10/16/2026',
    beginTime: '12:30',
    endTime: '1:00',
    rulesAttendance: 'attended',
    notes: 'This visit covers the session he missed on September 24.',
  },
];

describe('applyClaudeNoteRead', () => {
  it('marks a disagreement without treating agreement as a comment', () => {
    const readings = applyClaudeNoteRead(
      rows,
      JSON.stringify({
        sessions: [
          { index: 0, attendance: 'missed', comment: 'The child did not come.' },
          { index: 1, attendance: 'makeup', comment: 'This covers an earlier missed visit.' },
        ],
      }),
    );
    expect(readings[0]?.agrees).toBe(false);
    expect(readings[0]?.claudeAttendance).toBe('missed');
    expect(readings[0]?.comment).toMatch(/did not come/);
    expect(readings[1]?.claudeAttendance).toBe('makeup');
    expect(readings[1]?.agrees).toBe(false);
  });

  it('leaves a matching label without a comment', () => {
    const readings = applyClaudeNoteRead(
      rows.slice(0, 1),
      '{"sessions":[{"index":0,"attendance":"attended","comment":"ignored"}]}',
    );
    expect(readings[0]?.agrees).toBe(true);
    expect(readings[0]?.comment).toBe('');
  });

  it('asks Claude about missed wording and inexact makeups, not one failure type', () => {
    const prompt = noteReadPrompt(rows);
    expect(prompt).toMatch(/not an exact phrase/);
    expect(prompt).toMatch(/makeup/);
    expect(prompt).toMatch(/missed/);
    expect(prompt).toMatch(/paid_absence/);
    expect(prompt).toMatch(/did not come/);
  });

  it('accepts paid_absence from Claude when rules already labeled it', () => {
    const readings = applyClaudeNoteRead(
      [
        {
          studentName: 'Child',
          dateOfService: '10/29/2026',
          beginTime: '2:00 pm',
          endTime: '2:30 pm',
          rulesAttendance: 'paid_absence',
          notes: 'Student Not Available: Paid absence.',
        },
      ],
      '{"sessions":[{"index":0,"attendance":"paid_absence","comment":""}]}',
    );
    expect(readings[0]?.agrees).toBe(true);
    expect(readings[0]?.claudeAttendance).toBe('paid_absence');
    expect(readings[0]?.beginTime).toBe('2:00 pm');
    expect(readings[0]?.endTime).toBe('2:30 pm');
  });
});
