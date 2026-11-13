import { sessionIsSigned, type ParsedSessionNote } from '@white-glove/tms-db';
import { invokeClaudeText } from './bedrock.js';

const MAX_NOTES = 24;
const NOTE_CHARS = 900;

export type NoteReadInput = {
  studentName: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  rulesAttendance: string;
  notes: string;
};

export type NoteReading = {
  studentName: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  rulesAttendance: string;
  claudeAttendance: string;
  agrees: boolean;
  comment: string;
};

type ModelSession = { index?: number; attendance?: string; comment?: string };

function clip(value: string, max: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function noteReadInputs(rows: ParsedSessionNote[]): { inputs: NoteReadInput[]; truncated: boolean } {
  return {
    truncated: rows.length > MAX_NOTES,
    inputs: rows.slice(0, MAX_NOTES).map((row) => ({
      studentName: String(row.studentName || '').trim(),
      dateOfService: String(row.dateOfService || '').trim(),
      beginTime: String(row.beginTime || '').trim(),
      endTime: String(row.endTime || '').trim(),
      rulesAttendance: String(row.attendance || '').trim().toLowerCase(),
      notes: clip(row.notes || row.sourceSlice || '', NOTE_CHARS),
    })),
  };
}

export function noteReadPrompt(inputs: NoteReadInput[]): string {
  const lines = inputs.map((row, index) => {
    const when = [row.dateOfService, row.beginTime && row.endTime ? `${row.beginTime} to ${row.endTime}` : '']
      .filter(Boolean)
      .join(' ');
    return `${index}. rules=${row.rulesAttendance || 'unknown'}. ${when}. ${row.studentName}. Note: ${row.notes || '(empty)'}`;
  });
  return (
    'Read these therapy session notes. The keyword rules already labeled each one, and that label can be wrong when the wording is not an exact phrase. ' +
    'Reply with JSON only: {"sessions":[{"index":number,"attendance":"attended"|"missed"|"makeup"|"paid_absence","comment":"string"}]}. ' +
    'One object per note, using the same index. ' +
    'missed means the child or the provider was not there and no therapy was delivered, even without a standard absence label. ' +
    'paid_absence means the note says paid absence (for example "Student Not Available: Paid absence.") — still keep beginTime and endTime from the note. ' +
    'makeup means this visit makes up an earlier missed visit, even without the exact phrase "makeup for" plus a date. ' +
    'attended means therapy was delivered. A partner being absent, missing a turn, or planning to make work up later is still attended. ' +
    'comment is one short sentence only when your label differs from the rules label, otherwise "". ' +
    'Do not add sessions and do not repeat the note.\n' +
    lines.join('\n')
  );
}

function asAttendance(value: string): 'attended' | 'missed' | 'makeup' | 'paid_absence' | '' {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (text === 'attended' || text === 'missed' || text === 'makeup' || text === 'paid_absence') return text;
  return '';
}

export function applyClaudeNoteRead(inputs: NoteReadInput[], modelText: string): NoteReading[] {
  let sessions: ModelSession[] = [];
  try {
    const parsed = JSON.parse(String(modelText || '').match(/\{[\s\S]*\}/)?.[0] || '') as {
      sessions?: ModelSession[];
    };
    sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    sessions = [];
  }
  const byIndex = new Map<number, ModelSession>();
  for (const session of sessions) {
    const index = Number(session.index);
    if (Number.isInteger(index)) byIndex.set(index, session);
  }
  return inputs.map((row, index) => {
    const found = byIndex.get(index);
    const claudeAttendance = asAttendance(found?.attendance || '');
    const agrees = Boolean(claudeAttendance) && claudeAttendance === row.rulesAttendance;
    const comment = agrees
      ? ''
      : clip(found?.comment || '', 240) ||
        (claudeAttendance
          ? `Claude reads this as ${claudeAttendance}.`
          : 'Claude did not classify this note.');
    return {
      studentName: row.studentName,
      dateOfService: row.dateOfService,
      beginTime: row.beginTime,
      endTime: row.endTime,
      rulesAttendance: row.rulesAttendance,
      claudeAttendance,
      agrees,
      comment,
    };
  });
}

export type LunaRereadFacts = {
  studentName: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  attendance: 'attended' | 'missed' | 'makeup' | 'paid_absence' | '';
  makeupFor: string;
  signed: boolean;
  signatureQuote: string;
  cptCodes: string[];
  cptUnits: number;
  cptProcedures: string[];
  group: boolean;
  ratio: string;
  school: string;
};

/**
 * Same Bedrock reader as Read with other AI. Asks Claude what the note actually says.
 * Upload rules are applied afterward. This prompt is not a second rules engine.
 */
export function lunaRereadPrompt(noteText: string, errors: string[], therapistWords: string): string {
  return [
    'You are the Read with other AI note reader for White Glove TMS. Read this therapy note.',
    'Reply with JSON only: {"studentName":"","dateOfService":"","beginTime":"","endTime":"","attendance":"attended"|"missed"|"makeup"|"paid_absence","makeupFor":"","signed":false,"signatureQuote":"","cptCodes":[],"cptUnits":0,"cptProcedures":[],"group":false,"ratio":"","school":""}',
    'Copy only text that is written in the note. Do not invent a signature, a CPT code, a ratio, a school, or a date.',
    'signatureQuote is the exact signature line when one is written, otherwise "".',
    'makeupFor is the missed date this visit makes up, only when that date is written, otherwise "".',
    'paid_absence when the note says paid absence (e.g. "Student Not Available: Paid absence.") — still copy beginTime and endTime from the note.',
    'group is true only when the note says group or a ratio such as 2:1 or 3:1.',
    'school is the school name written on the note, otherwise "".',
    'Block:',
    ...errors.map((error, index) => `${index + 1}. ${error}`),
    'Therapist:',
    therapistWords,
    'Note:',
    String(noteText || '').slice(0, 8000),
  ].join('\n');
}

export function parseLunaReread(modelText: string): LunaRereadFacts | null {
  try {
    const parsed = JSON.parse(String(modelText || '').match(/\{[\s\S]*\}/)?.[0] || '') as Record<string, unknown>;
    const attendance = asAttendance(String(parsed.attendance || ''));
    const codes = Array.isArray(parsed.cptCodes) ? parsed.cptCodes.map((code) => String(code || '').trim()).filter(Boolean) : [];
    return {
      studentName: String(parsed.studentName || '').trim(),
      dateOfService: String(parsed.dateOfService || '').trim(),
      beginTime: String(parsed.beginTime || '').trim(),
      endTime: String(parsed.endTime || '').trim(),
      attendance,
      makeupFor: String(parsed.makeupFor || '').trim(),
      signed: parsed.signed === true,
      signatureQuote: String(parsed.signatureQuote || '').trim(),
      cptCodes: codes,
      cptUnits: Number(parsed.cptUnits) || 0,
      cptProcedures: Array.isArray(parsed.cptProcedures)
        ? parsed.cptProcedures.map((row) => String(row || '').trim()).filter(Boolean)
        : [],
      group: parsed.group === true,
      ratio: String(parsed.ratio || '').replace(/\s+/g, '').trim(),
      school: String(parsed.school || '').trim(),
    };
  } catch {
    return null;
  }
}

function writtenInNote(note: string, fragment: string): boolean {
  const hay = note.replace(/\s+/g, ' ').toLowerCase();
  const needle = String(fragment || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return Boolean(needle) && hay.includes(needle);
}

/** Keep only facts that are actually written in the note. */
export function rowFromLunaFacts(facts: LunaRereadFacts, noteText: string): ParsedSessionNote | null {
  const note = String(noteText || '');
  const studentName = writtenInNote(note, facts.studentName) ? facts.studentName : '';
  const dateOfService = writtenInNote(note, facts.dateOfService) ? facts.dateOfService : '';
  const beginTime = writtenInNote(note, facts.beginTime) ? facts.beginTime : '';
  const endTime = writtenInNote(note, facts.endTime) ? facts.endTime : '';
  if (!studentName || !dateOfService) return null;

  let attendance = facts.attendance;
  const makeupFor = writtenInNote(note, facts.makeupFor) ? facts.makeupFor : '';
  if (attendance === 'makeup' && (!makeupFor || !/\bmake[\s-]?up\b/i.test(note))) return null;
  if (attendance === 'paid_absence' && !/\bpaid\s+absence\b/i.test(note)) return null;
  if (
    attendance === 'missed' &&
    !/\b(?:absent|absence|missed|no[-\s]?show|not in school)\b/i.test(note)
  ) {
    return null;
  }
  if (
    attendance !== 'attended' &&
    attendance !== 'missed' &&
    attendance !== 'makeup' &&
    attendance !== 'paid_absence'
  ) {
    return null;
  }
  if (attendance !== 'missed' && (!beginTime || !endTime)) return null;

  const quoteOk = Boolean(facts.signatureQuote) && writtenInNote(note, facts.signatureQuote);
  const signed = quoteOk && (sessionIsSigned(note) || sessionIsSigned(facts.signatureQuote));
  const cptCodes = facts.cptCodes.filter((code) => writtenInNote(note, code));
  const procedures: string[] = [];
  let units = 0;
  for (const code of cptCodes) {
    const match = note.match(new RegExp(`\\b${code}\\s*[xX×]\\s*(\\d{1,2})\\b`));
    const count = match ? Number(match[1]) : 0;
    if (count > 0) {
      units += count;
      procedures.push(`${code}x${count}`);
    }
  }
  if (!units && cptCodes.length && facts.cptUnits > 0) units = facts.cptUnits;

  const ratioMatch = facts.ratio.match(/^(\d+):1$/);
  const ratioInNote = Boolean(facts.ratio) && writtenInNote(note, facts.ratio);
  const ratioNumber = ratioMatch ? Number(ratioMatch[1]) : 0;
  const group =
    (ratioInNote && ratioNumber >= 2) ||
    (facts.group && /\bgroup\b/i.test(note));
  const ratio = ratioInNote ? facts.ratio : group ? '' : '1:1';
  const serviceType = group
    ? `Physical Therapy ${ratio || 'Group'}`.trim()
    : 'Physical Therapy 1:1';
  const school = facts.school && writtenInNote(note, facts.school) ? facts.school : '';

  return {
    studentName,
    providerName: '',
    schoolName: school,
    dateOfService,
    beginTime: attendance === 'missed' ? '' : beginTime,
    endTime: attendance === 'missed' ? '' : endTime,
    attendance,
    cancelReason: '',
    notes: note.trim(),
    serviceType,
    location: school,
    ratio: group ? ratio : ratio === '1:1' ? '1:1' : '',
    cptCodes,
    cptUnits: units,
    cptProcedures: procedures,
    signed,
    sourceSlice: note,
  };
}

/** Reads an already-parsed note. Does not create sessions. */
export async function readSessionNotesWithBedrock(rows: ParsedSessionNote[]): Promise<{
  parsed: number;
  shown: number;
  truncated: boolean;
  readings: NoteReading[];
}> {
  const { inputs, truncated } = noteReadInputs(rows);
  const text = await invokeClaudeText(noteReadPrompt(inputs), 1200, 20000);
  return {
    parsed: rows.length,
    shown: inputs.length,
    truncated,
    readings: applyClaudeNoteRead(inputs, text),
  };
}
