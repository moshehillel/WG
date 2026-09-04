/** Heuristic screen used when Bedrock is off; Bedrock wraps the same checklist. */
export function screenServiceNote(input: {
  notes: string;
  attendance: string;
  beginTime: string;
  endTime: string;
  makeupOfSessionId: string;
  dateOfService: string;
}): { flags: string[]; blockFlags: string[]; warnFlags: string[]; block: boolean } {
  const blockFlags: string[] = [];
  const warnFlags: string[] = [];
  const notes = String(input.notes || '').trim();
  const needsServiceNote = input.attendance === 'attended' || input.attendance === 'makeup';

  if (needsServiceNote && notes.length < 20) {
    blockFlags.push('Note looks incomplete (very short).');
  }
  if (input.attendance === 'attended' && !input.beginTime && !input.endTime) {
    blockFlags.push('Attended session is missing time in / time out.');
  }
  // Miss link vs makeup-auth is enforced in validateMakeup; AI only checks the note word.
  if (input.attendance === 'makeup' && !/\bmakeup\b|\bmake[\s-]?up\b/i.test(notes)) {
    blockFlags.push('Makeup notes must include the word makeup.');
  }
  if (/lorem ipsum|asdf|test test/i.test(notes)) {
    blockFlags.push('Note may be placeholder text.');
  }
  if (input.attendance === 'missed' && !/absent|not available|cancel|not in school/i.test(notes)) {
    warnFlags.push('Missed session note may be missing a cancellation reason.');
  }

  const flags = [...blockFlags, ...warnFlags];
  return { flags, blockFlags, warnFlags, block: blockFlags.length > 0 };
}

/** Merge heuristic AI issues for week display (Bedrock runs on submit). */
export function collectHeuristicAiIssues(
  sessions: Array<{
    attendance: string;
    notes: string;
    beginTime: string;
    endTime: string;
    makeupOfSessionId: string;
    dateOfService: string;
    aiFlags?: string[];
    aiBlock?: boolean;
  }>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const s of sessions) {
    const local = screenServiceNote(s);
    for (const f of local.blockFlags) errors.push(f);
    for (const f of local.warnFlags) warnings.push(f);
    // Prior Bedrock/submit screening may have stored extra blocking flags.
    if (s.aiBlock && Array.isArray(s.aiFlags)) {
      for (const f of s.aiFlags) {
        if (!local.flags.includes(f) && !errors.includes(f)) errors.push(f);
      }
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
