/** Heuristic screen used when Bedrock is off; Bedrock wraps the same checklist. */
export function screenServiceNote(input: {
  notes: string;
  attendance: string;
  beginTime: string;
  endTime: string;
  makeupOfSessionId: string;
  dateOfService: string;
}): { flags: string[]; block: boolean } {
  const flags: string[] = [];
  const notes = String(input.notes || '').trim();
  if (input.attendance === 'attended' && notes.length < 20) {
    flags.push('Note looks incomplete (very short).');
  }
  if (input.attendance === 'attended' && !input.beginTime && !input.endTime) {
    flags.push('Attended session is missing time in / time out.');
  }
  if (input.attendance === 'makeup' && !input.makeupOfSessionId) {
    flags.push('Makeup note has no linked missed session.');
  }
  if (input.attendance === 'missed' && !/absent|not available|cancel|not in school/i.test(notes)) {
    flags.push('Missed session note may be missing a cancellation reason.');
  }
  if (/lorem ipsum|asdf|test test/i.test(notes)) {
    flags.push('Note may be placeholder text.');
  }
  return { flags, block: false };
}
