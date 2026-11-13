import { notesMentionNoPeerAvailable } from './mandate.js';

/**
 * Words that can mean the child was not seen, including sentences the exact
 * labels miss ("was sick and did not come", "missed a turn").
 */
const ABSENCE_HINT_RE =
  /\b(?:sick|absent|absence|missed|no[-\s]?show|did not come|didn't come|did not attend|didn't attend|stayed home|not in school|did not happen|was not there|wasn't there|out sick)\b/i;

/** Child-was-not-seen phrases. A partner being absent is a different fact. */
const CHILD_ABSENCE_RE =
  /\b(?:was sick|were sick|out sick|did not come|didn't come|did not attend|didn't attend|stayed home|not in school|did not happen|no[-\s]?show|was not there|wasn't there)\b/i;

/**
 * True only when keyword rules can still be wrong about a missed visit.
 * An already-missed row, a peer-absent note, and a note with no absence
 * language skip the model.
 */
export function noteNeedsAbsenceFallback(input: {
  notes: string;
  attendance: string;
}): boolean {
  const attendance = String(input.attendance || '').trim().toLowerCase();
  if (attendance !== 'attended') return false;
  const notes = String(input.notes || '');
  if (!ABSENCE_HINT_RE.test(notes)) return false;
  if (notesMentionNoPeerAvailable(notes) && !CHILD_ABSENCE_RE.test(notes)) return false;
  return true;
}

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

  // Empty notes block; brevity alone is allowed (1–few words OK).
  if (needsServiceNote && !notes) {
    blockFlags.push('Service note is required.');
  }
  if (input.attendance === 'attended' && !input.beginTime && !input.endTime) {
    blockFlags.push('Attended session is missing time in / time out.');
  }
  // Miss link vs makeup-auth is enforced in validateMakeup; AI only checks the note word.
  if (input.attendance === 'makeup' && !/\bm+ake[\s-]?up\b/i.test(notes)) {
    blockFlags.push('Makeup notes must include the word makeup.');
  }
  if (/lorem ipsum|asdf|test test/i.test(notes)) {
    blockFlags.push('Note may be placeholder text.');
  }
  // Missed sessions only need date + time (+ missed status) for later makeup linking.
  // Empty notes are allowed — do not warn or block when there is no service note.

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
