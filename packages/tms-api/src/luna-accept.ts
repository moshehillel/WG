import {
  attendanceFromNotes,
  findStudentForActivityName,
  matchFrontlineMissedReason,
  sessionLooksGroup,
  type AppUser,
  type MemoryStore,
  type SessionRow,
  weekStartFromDos,
  newId,
} from '@white-glove/tms-db';
import {
  cptDurationError,
  cptSessionLooksGroup,
  parseCptCoverage,
  sessionIsSigned,
} from '@white-glove/tms-db';
import { explainBlockErrors, type LunaBlockExplanation } from './luna-knowledge.js';
import type { Mailer } from './mail.js';
import {
  blockReportPdfKey,
  buildPendingBlockReport,
  MOSHE_OWNER_EMAIL,
  newBlockReportPdfToken,
  therapistReportPdfEmailLine,
  withReportPdf,
  type BlockReportFileStore,
} from './block-reports.js';
import { putReportPdf } from './s3-state.js';

const NOTE_EXCERPT_MAX = 4000;

export function isMissingNotesPdfError(error: string): boolean {
  return /select a notes pdf first/i.test(String(error || ''));
}

export function isNotSignedBlock(error: string): boolean {
  return /not signed|needs a signature|missing signature/i.test(String(error || ''));
}

export function isCptShortBlock(error: string): boolean {
  return /cpt units|not enough cpt|cpt codes? (?:are )?not enough|cpt duration/i.test(
    String(error || ''),
  );
}

/** Signature and CPT-unit blocks are the only uploads Luna may approve. */
export function isLunaApprovableBlock(error: string): boolean {
  return isNotSignedBlock(error) || isCptShortBlock(error);
}

/** Weekly over-mandate text. A missed or makeup note can be a misread of this block. */
export function isOverMandateBlock(error: string): boolean {
  return /exceeds the mandate|mandate allows \d+/i.test(String(error || ''));
}

type ModelRead = {
  misread: boolean;
  summary: string;
  signatureEvidence: string;
};

export function lunaMisreadPrompt(errors: string[], noteExcerpt: string): string {
  return [
    'You are reading a therapy notes PDF for White Glove TMS. The upload was blocked.',
    'Reply with JSON only: {"misread":boolean,"summary":"one sentence about what the note shows","signatureEvidence":"exact quote from the note or empty"}',
    'Set misread to true only when the note shows a signature the block called missing, or CPT codes the block called missing.',
    'Quote only text that appears in the note. Do not invent a signature, a CPT code, a school, or a makeup date.',
    'Do not say a session was created and do not approve any other kind of block.',
    'Errors:',
    ...errors.map((error, index) => `${index + 1}. ${error}`),
    'Note:',
    String(noteExcerpt || '').slice(0, NOTE_EXCERPT_MAX),
  ].join('\n');
}

export function parseModelRead(modelText: string): ModelRead | null {
  try {
    const parsed = JSON.parse(String(modelText || '').match(/\{[\s\S]*\}/)?.[0] || '') as {
      misread?: boolean;
      summary?: string;
      signatureEvidence?: string;
    };
    return {
      misread: parsed.misread === true,
      summary: String(parsed.summary || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      signatureEvidence: String(parsed.signatureEvidence || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    };
  } catch {
    return null;
  }
}

function childFromError(error: string): string {
  const head = String(error || '').split(':')[0] || '';
  return String(head.split(/\s+[—–-]\s+/)[0] || '').trim();
}

function visitClock(text: string): { begin: string; end: string; dos: string } {
  const dos = (String(text || '').match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) || [])[0] || '';
  const ranged = String(text || '').match(
    /\b(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?)\s*[–—-]\s*(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
  );
  if (ranged) {
    return {
      dos,
      begin: ranged[1]!.replace(/\s+/g, ' ').trim(),
      end: ranged[2]!.replace(/\s+/g, ' ').trim(),
    };
  }
  const clocks = String(text || '').match(/\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\b/gi) || [];
  return { dos, begin: clocks[0] || '', end: clocks[1] || '' };
}

function ratioFromText(text: string): string {
  const match = String(text || '').match(/\b(\d+\s*:\s*1)\b/);
  return match ? match[1]!.replace(/\s+/g, '') : '';
}

function signatureQuote(note: string, modelQuote: string): string {
  if (!sessionIsSigned(note)) return '';
  const flat = note.replace(/\s+/g, ' ');
  const quoted = String(modelQuote || '').trim();
  if (quoted && flat.includes(quoted)) return quoted.slice(0, 240);
  const idx = note.search(/Provider\s+Signature\s*\/?\s*Credentials|Signed:/i);
  const slice = (idx >= 0 ? note.slice(idx, idx + 180) : note.slice(0, 180)).replace(/\s+/g, ' ').trim();
  return slice.slice(0, 240);
}

function notesKeepingSignature(note: string): string {
  const text = String(note || '').trim();
  if (text.length <= 8000) return text;
  const idx = text.search(/Provider\s+Signature\s*\/?\s*Credentials|Signed:|License#/i);
  if (idx >= 0) return text.slice(Math.max(0, idx - 400), idx + 1200).trim();
  return text.slice(0, 8000);
}

export type LunaMisreadDecision =
  | {
      approve: true;
      kind: 'signed' | 'cpt' | 'signed-cpt' | 'missed' | 'makeup';
      signatureEvidence: string;
      cptProcedures: string[];
      cptCodes: string[];
      cptUnits: number;
      summary: string;
      attendance: 'attended' | 'missed' | 'makeup';
      cancelReason: string;
    }
  | {
      approve: false;
      reason: 'other' | 'unsigned' | 'cpt' | 'unreadable' | 'no-file';
      summary: string;
    };

/**
 * Approve only a not-signed or not-enough-CPT block when the note itself proves the misread.
 * Frequency, makeup, school, and every other block stay refused.
 */
export function decideLunaMisread(input: {
  errors: string[];
  noteText: string;
  model: ModelRead | null;
}): LunaMisreadDecision {
  const errors = input.errors.map((row) => String(row || '').trim()).filter(Boolean);
  const note = String(input.noteText || '');
  const summary = input.model?.summary || '';
  if (!input.model) return { approve: false, reason: 'unreadable', summary: '' };
  if (!input.model.misread) return { approve: false, reason: 'other', summary };
  const other = errors.filter((error) => !isLunaApprovableBlock(error));
  const wantsSign = errors.some(isNotSignedBlock);
  const wantsCpt = errors.some(isCptShortBlock);
  if (!wantsSign && !wantsCpt) return { approve: false, reason: 'other', summary };
  if (other.length) return { approve: false, reason: 'other', summary };

  const evidence = wantsSign ? signatureQuote(note, input.model.signatureEvidence) : '';
  if (wantsSign && !evidence) return { approve: false, reason: 'unsigned', summary };

  let procedures: string[] = [];
  let codes: string[] = [];
  let units = 0;
  if (wantsCpt) {
    const clock = visitClock(`${errors.join('\n')}\n${note}`);
    if (!clock.begin || !clock.end) return { approve: false, reason: 'cpt', summary };
    const coverage = parseCptCoverage(note);
    const ratio = ratioFromText(`${note}\n${errors.join('\n')}`);
    const group = cptSessionLooksGroup('', ratio) || /\bgroup\b/i.test(note);
    const cptError = cptDurationError(clock.begin, clock.end, coverage, 'attended', {
      ratio,
      groupSession: group,
    });
    if (cptError || !coverage.codes.length) return { approve: false, reason: 'cpt', summary };
    procedures = coverage.procedures;
    codes = coverage.codes;
    units = coverage.totalUnits;
  }

  const kind = wantsSign && wantsCpt ? 'signed-cpt' : wantsSign ? 'signed' : 'cpt';
  return {
    approve: true,
    kind,
    signatureEvidence: evidence,
    cptProcedures: procedures,
    cptCodes: codes,
    cptUnits: units,
    summary,
    attendance: 'attended',
    cancelReason: '',
  };
}

function asReaderAttendance(value: string): 'attended' | 'missed' | 'makeup' | 'paid_absence' | '' {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (text === 'attended' || text === 'missed' || text === 'makeup' || text === 'paid_absence') {
    return text;
  }
  return '';
}

/** Missed or makeup only when the existing note readers agree it is not an extra attended visit. */
export function confirmedMissedOrMakeup(
  rulesAttendance: string,
  aiAttendance: string,
): 'missed' | 'makeup' | '' {
  const rules = asReaderAttendance(rulesAttendance);
  const ai = asReaderAttendance(aiAttendance);
  const soft = (value: string) => value === 'missed' || value === 'makeup';
  if (soft(rules) && (!ai || ai === rules)) return rules === 'makeup' ? 'makeup' : 'missed';
  if (rules === 'attended' && soft(ai)) return ai === 'makeup' ? 'makeup' : 'missed';
  if (!rules && soft(ai)) return ai === 'makeup' ? 'makeup' : 'missed';
  return '';
}

/**
 * Decide a reader misread from the existing signature, CPT, and attendance readers.
 * The therapist's claim does not make the error wrong.
 */
export function classifyLunaReaderMisread(input: {
  errors: string[];
  noteText: string;
  aiAttendance?: string;
}): LunaMisreadDecision {
  const errors = input.errors.map((row) => String(row || '').trim()).filter(Boolean);
  const note = String(input.noteText || '');
  const other = errors.filter(
    (error) => !isNotSignedBlock(error) && !isCptShortBlock(error) && !isOverMandateBlock(error),
  );
  if (!note.trim()) return { approve: false, reason: 'unreadable', summary: '' };
  if (other.length) return { approve: false, reason: 'other', summary: '' };
  const wantsSign = errors.some(isNotSignedBlock);
  const wantsCpt = errors.some(isCptShortBlock);
  const wantsMandate = errors.some(isOverMandateBlock);
  if (wantsSign && wantsCpt) return { approve: false, reason: 'other', summary: '' };
  if (wantsMandate && (wantsSign || wantsCpt)) return { approve: false, reason: 'other', summary: '' };

  if (wantsSign) {
    const evidence = signatureQuote(note, '');
    if (!evidence) return { approve: false, reason: 'unsigned', summary: '' };
    return {
      approve: true,
      kind: 'signed',
      signatureEvidence: evidence,
      cptProcedures: [],
      cptCodes: [],
      cptUnits: 0,
      summary: evidence,
      attendance: 'attended',
      cancelReason: '',
    };
  }

  if (wantsCpt) {
    const clock = visitClock(`${errors.join('\n')}\n${note}`);
    if (!clock.begin || !clock.end) return { approve: false, reason: 'cpt', summary: '' };
    const coverage = parseCptCoverage(note);
    const ratio = ratioFromText(`${note}\n${errors.join('\n')}`);
    const group = cptSessionLooksGroup('', ratio) || /\bgroup\b/i.test(note);
    const cptError = cptDurationError(clock.begin, clock.end, coverage, 'attended', {
      ratio,
      groupSession: group,
    });
    if (cptError || !coverage.codes.length) return { approve: false, reason: 'cpt', summary: '' };
    const shown = coverage.procedures.join(', ') || coverage.codes.join(', ');
    return {
      approve: true,
      kind: 'cpt',
      signatureEvidence: '',
      cptProcedures: coverage.procedures,
      cptCodes: coverage.codes,
      cptUnits: coverage.totalUnits,
      summary: shown,
      attendance: 'attended',
      cancelReason: '',
    };
  }

  if (wantsMandate) {
    const clock = visitClock(`${errors.join('\n')}\n${note}`);
    const rulesAttendance = attendanceFromNotes(note, clock.begin, clock.end);
    const attendance = confirmedMissedOrMakeup(rulesAttendance, input.aiAttendance || '');
    if (!attendance) return { approve: false, reason: 'other', summary: '' };
    const phrase = note.match(/\bmakeup\s+for\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i)?.[0] || '';
    const reason = attendance === 'missed' ? matchFrontlineMissedReason(note) : '';
    return {
      approve: true,
      kind: attendance,
      signatureEvidence: '',
      cptProcedures: [],
      cptCodes: [],
      cptUnits: 0,
      summary: phrase || reason || `The note is a ${attendance} session.`,
      attendance,
      cancelReason: reason,
    };
  }

  return { approve: false, reason: 'other', summary: '' };
}

function catalogReply(errors: string[]): string {
  return explainBlockErrors(errors)
    .map((row) => [row.title, row.blocked, row.why, row.next].filter(Boolean).join(' '))
    .join('\n\n');
}

function savedSentence(decision: Extract<LunaMisreadDecision, { approve: true }>): string {
  if (decision.kind === 'missed') return 'I approved this upload and saved the session as missed.';
  if (decision.kind === 'makeup') return 'I approved this upload and saved the session as a makeup.';
  if (decision.kind === 'signed') {
    return `I approved this upload and saved the session as signed. The note shows: ${decision.signatureEvidence}`;
  }
  if (decision.kind === 'cpt') {
    return `I approved this upload and saved the session with CPT ${decision.cptProcedures.join(', ') || decision.cptCodes.join(', ')}.`;
  }
  return `I approved this upload and saved the session as signed with CPT ${decision.cptProcedures.join(', ')}. The note shows: ${decision.signatureEvidence}`;
}

function refusalSentence(reason: Extract<LunaMisreadDecision, { approve: false }>['reason']): string {
  if (reason === 'unsigned') {
    return 'I read the note. It does not show a signature, so I did not approve the upload. It stays blocked. You can still Report incorrect error and Billu can review it.';
  }
  if (reason === 'cpt') {
    return 'I read the note. It does not show CPT codes that cover this visit, so I did not approve the upload. It stays blocked. You can still Report incorrect error and Billu can review it.';
  }
  if (reason === 'unreadable') {
    return 'The note could not be read. I did not approve the upload.';
  }
  if (reason === 'no-file') return '';
  return 'I read the note. This block is not a missing signature or a not-enough-CPT misread, so I did not approve the upload. It stays blocked. You can still Report incorrect error and Billu can review it.';
}

export function buildMosheMisreadEmail(input: {
  errors: string[];
  decision: Extract<LunaMisreadDecision, { approve: true }>;
  pdfLine: string;
  providerName: string;
  therapistName: string;
  therapistEmail: string;
}): { to: string[]; subject: string; text: string } {
  const showed =
    input.decision.kind === 'cpt'
      ? `CPT on the note: ${input.decision.cptProcedures.join(', ')} (${input.decision.cptUnits} unit(s)).`
      : input.decision.kind === 'makeup'
        ? `The note is a makeup, not an extra attended visit. ${input.decision.summary}`
        : input.decision.kind === 'missed'
          ? `The note is a missed session, not an extra attended visit. ${input.decision.summary}`
          : input.decision.kind === 'signed'
            ? `Signature on the note: ${input.decision.signatureEvidence}`
            : `Signature on the note: ${input.decision.signatureEvidence}\nCPT on the note: ${input.decision.cptProcedures.join(', ')} (${input.decision.cptUnits} unit(s)).`;
  const saved =
    input.decision.kind === 'signed'
      ? 'Saved the session as signed.'
      : input.decision.kind === 'cpt'
        ? `Saved the session with CPT ${input.decision.cptProcedures.join(', ')}.`
        : input.decision.kind === 'makeup'
          ? 'Saved the session as a makeup.'
          : input.decision.kind === 'missed'
            ? 'Saved the session as missed.'
            : `Saved the session as signed with CPT ${input.decision.cptProcedures.join(', ')}.`;
  return {
    to: [MOSHE_OWNER_EMAIL],
    subject: '[TMS] Luna approved a reader misread',
    text: [
      'Luna approved a blocked upload because the notes PDF shows the rule reader misread it.',
      'This is so the non-AI reader can be updated. This email does not change the parser.',
      'The visit was not sent to HHA.',
      '',
      `Provider: ${input.providerName || '(unknown)'}`,
      `Therapist: ${input.therapistName} <${input.therapistEmail}>`,
      '',
      'Error text:',
      ...input.errors.map((error) => `- ${error}`),
      '',
      'What the PDF showed:',
      showed,
      '',
      'What Luna saved:',
      saved,
      '',
      input.pdfLine,
    ].join('\n'),
  };
}

export function freshReadSavedLines(session: SessionRow, noteText: string): string[] {
  const lines = [`Saved the session as ${session.attendance}.`];
  if (sessionLooksGroup(session.serviceType) === true) lines.push('Saved the session as group.');
  if (sessionLooksGroup(session.serviceType) === false) lines.push('Saved the session as individual.');
  if (session.attendance === 'makeup') lines.push('Saved the session as a makeup.');
  if (session.attendance === 'missed') lines.push('Saved the session as missed.');
  if (sessionIsSigned(noteText) || sessionIsSigned(session.notes)) lines.push('saved the session as signed');
  if (session.cptLabel || session.cptCodes?.length) {
    lines.push(`Saved the session with CPT ${session.cptLabel || session.cptCodes?.join(', ')}.`);
  }
  if (session.serviceType) lines.push(`Service type: ${session.serviceType}.`);
  return lines;
}

export function buildMosheFreshReadEmail(input: {
  errors: string[];
  showed: string;
  savedLines: string[];
  pdfLine: string;
  providerName: string;
  therapistName: string;
  therapistEmail: string;
}): { to: string[]; subject: string; text: string } {
  return {
    to: [MOSHE_OWNER_EMAIL],
    subject: '[TMS] Luna approved a reader misread',
    text: [
      'Luna approved a blocked upload because a fresh read of the notes PDF accepted it.',
      'She saved the session the way that fresh read classified it.',
      'This is so the non-AI reader can be updated. This email does not change the parser.',
      'The visit was not sent to HHA.',
      '',
      `Provider: ${input.providerName || '(unknown)'}`,
      `Therapist: ${input.therapistName} <${input.therapistEmail}>`,
      '',
      'Error text:',
      ...input.errors.map((error) => `- ${error}`),
      '',
      'What the fresh read found:',
      input.showed || '(no session text)',
      '',
      'What Luna saved:',
      ...input.savedLines,
      '',
      input.pdfLine,
    ].join('\n'),
  };
}

export async function commitLunaFreshRead(input: {
  store: MemoryStore;
  user: AppUser;
  errors: string[];
  noteText: string;
  showed: string;
  sessions: SessionRow[];
  pdfBytes: Buffer | null;
  fileName: string;
  mail?: Mailer;
  files?: BlockReportFileStore;
}): Promise<boolean> {
  if (!input.sessions.length) return false;
  const provider =
    input.user.role === 'admin'
      ? undefined
      : input.store.data.providers.find((row) => row.id === input.user.providerId) ||
        input.store.data.providers.find((row) => row.userId === input.user.id);
  if (!provider) return false;
  const savedLines: string[] = [];
  for (const session of input.sessions) {
    const weekStart = weekStartFromDos(session.dateOfService);
    let week = input.store.data.weeks.find(
      (row) => row.providerId === provider.id && row.weekStart === weekStart,
    );
    if (!week && weekStart) {
      const student = input.store.data.students.find((row) => row.id === session.studentId);
      week = input.store.upsertWeek({
        id: newId(),
        providerId: provider.id,
        weekStart,
        schoolId: student?.schoolId || '',
        programType: student?.programType || '',
        status: 'draft',
        signerName: '',
        signerEmail: '',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
      });
    }
    if (!week) return false;
    const row = { ...session, weekId: session.weekId || week.id };
    input.store.upsertSession(row);
    savedLines.push(...freshReadSavedLines(row, input.noteText));
  }
  input.store.audit(input.user.id, 'luna_misread_approve', `provider:${provider.id}`, null, {
    errors: input.errors,
    sessions: input.sessions.map((row) => row.id),
  });
  let pdfLine = 'Therapist report PDF: none was attached to this approval.';
  if (input.pdfBytes) {
    try {
      pdfLine = await storePdfLink(input.store, {
        user: input.user,
        providerId: provider.id,
        providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),
        errors: input.errors,
        fileName: input.fileName,
        pdfBytes: input.pdfBytes,
        files: input.files,
      });
    } catch {
      pdfLine = 'Therapist report PDF: the file could not be stored. The session was still saved.';
    }
  }
  if (input.mail) {
    try {
      const letter = buildMosheFreshReadEmail({
        errors: input.errors,
        showed: input.showed,
        savedLines,
        pdfLine,
        providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),
        therapistName: input.user.displayName || input.user.email,
        therapistEmail: input.user.email,
      });
      await input.mail.send({ to: letter.to, subject: letter.subject, text: letter.text });
    } catch {
      /* The session is already saved. */
    }
  }
  return true;
}

async function storePdfLink(
  store: MemoryStore,
  input: {
    user: AppUser;
    providerId: string;
    providerName: string;
    errors: string[];
    fileName: string;
    pdfBytes: Buffer;
    files?: BlockReportFileStore;
  },
): Promise<string> {
  const id = newId();
  let report = buildPendingBlockReport({
    id,
    createdAt: new Date().toISOString(),
    providerId: input.providerId,
    providerName: input.providerName,
    therapistUserId: input.user.id,
    therapistName: input.user.displayName || input.user.email,
    therapistEmail: input.user.email,
    therapistMessage: 'Luna approved a reader misread. This record only holds the PDF link.',
    errors: input.errors,
    fileName: input.fileName,
    pendingText: 'PDF link only. Luna already saved the session.',
    aiExplanation: 'Luna approved a reader misread.',
    aiExplanationStatus: 'ok',
  });
  report = { ...withReportPdf(report, { pdfKey: blockReportPdfKey(id), pdfToken: newBlockReportPdfToken() }), status: 'luna' };
  if (input.files) await input.files.put(report.pdfKey, input.pdfBytes);
  else await putReportPdf(report.pdfKey, input.pdfBytes);
  store.upsertBlockReport(report);
  return therapistReportPdfEmailLine(report);
}

function serviceTypeFor(store: MemoryStore, studentId: string, providerId: string): string {
  const mandate = store.data.mandates.find(
    (row) => row.studentId === studentId && row.providerId === providerId && row.serviceType,
  );
  return String(mandate?.serviceType || '').trim();
}

export async function reviewLunaMisread(input: {
  store: MemoryStore;
  user: AppUser;
  guest: boolean;
  errors: string[];
  noteText: string;
  pdfBytes: Buffer | null;
  fileName: string;
  invoke: ((prompt: string) => Promise<string>) | null;
  mail?: Mailer;
  files?: BlockReportFileStore;
  /** When set, the PDF was already read. Do not call Bedrock again. */
  readPrepared?: boolean;
  preparedModel?: ModelRead | null;
  decisionOverride?: LunaMisreadDecision;
}): Promise<{ explanations: LunaBlockExplanation[]; reply: string; approved: boolean }> {
  const errors = [...new Set(input.errors.map((row) => String(row || '').trim()).filter(Boolean))].slice(0, 40);
  const explanations = explainBlockErrors(errors);
  const catalog = catalogReply(errors);
  if (!errors.length) {
    return { explanations, reply: catalog, approved: false };
  }
  if (errors.every(isMissingNotesPdfError)) {
    return { explanations, reply: catalog, approved: false };
  }
  const noteText = String(input.noteText || '').trim();
  if (!noteText) {
    const unread = input.pdfBytes
      ? 'The note could not be read. I did not approve the upload.'
      : '';
    return {
      explanations,
      reply: [catalog, unread].filter(Boolean).join('\n\n'),
      approved: false,
    };
  }
  let model: ModelRead | null = null;
  if (input.readPrepared) {
    model = input.preparedModel || null;
  } else if (!input.invoke) {
    return {
      explanations,
      reply: `${catalog}\n\nThe note could not be read. I did not approve the upload.`,
      approved: false,
    };
  } else {
    try {
      const raw = await input.invoke(lunaMisreadPrompt(errors, noteText.slice(0, NOTE_EXCERPT_MAX)));
      model = parseModelRead(raw);
    } catch {
      model = null;
    }
  }
  if (!model && !input.decisionOverride) {
    return {
      explanations,
      reply: `${catalog}\n\nThe note could not be read. I did not approve the upload.`,
      approved: false,
    };
  }
  const decision = input.decisionOverride || decideLunaMisread({ errors, noteText, model });
  if (!decision.approve) {
    const extra = refusalSentence(decision.reason);
    const fromNote = decision.summary ? `What the note shows: ${decision.summary}` : '';
    return {
      explanations,
      reply: [catalog, fromNote, extra].filter(Boolean).join('\n\n'),
      approved: false,
    };
  }

  const provider =
    input.guest || input.user.role === 'admin'
      ? undefined
      : input.store.data.providers.find((row) => row.id === input.user.providerId) ||
        input.store.data.providers.find((row) => row.userId === input.user.id);
  const childName =
    errors.map(childFromError).find((name) => name && !/^upload blocked/i.test(name)) ||
    '';
  const student = childName ? findStudentForActivityName(input.store.data.students, childName) : undefined;
  const clock = visitClock(`${errors.join('\n')}\n${noteText}`);
  if (!provider || !student || !clock.dos) {
    return {
      explanations,
      reply: `${catalog}\n\nThe note shows a signature or CPT misread, but I could not match it to this therapist’s caseload, so I did not approve the upload. It stays blocked. You can still Report incorrect error and Billu can review it.`,
      approved: false,
    };
  }

  const weekStart = weekStartFromDos(clock.dos);
  let week = input.store.data.weeks.find(
    (row) => row.providerId === provider.id && row.weekStart === weekStart,
  );
  if (!week && weekStart) {
    week = input.store.upsertWeek({
      id: newId(),
      providerId: provider.id,
      weekStart,
      schoolId: student.schoolId,
      programType: student.programType,
      status: 'draft',
      signerName: '',
      signerEmail: '',
      timesheetKey: '',
      signedKey: '',
      envelopeId: '',
      hhaStatus: 'none',
    });
  }
  if (!week) {
    return {
      explanations,
      reply: `${catalog}\n\nI did not approve the upload because the visit date is missing. It stays blocked.`,
      approved: false,
    };
  }

  const session: SessionRow = {
    id: newId(),
    weekId: week.id,
    studentId: student.id,
    dateOfService: clock.dos,
    beginTime: clock.begin,
    endTime: clock.end,
    attendance: decision.attendance || 'attended',
    cancelReason: decision.cancelReason || '',
    makeupOfSessionId: '',
    serviceType: serviceTypeFor(input.store, student.id, provider.id),
    location: '',
    notes: notesKeepingSignature(noteText),
    cptCodes: decision.cptCodes,
    cptUnits: decision.cptUnits,
    cptLabel: decision.cptProcedures.join(', '),
    aiFlags: [],
    aiBlock: false,
  };
  input.store.upsertSession(session);
  input.store.audit(input.user.id, 'luna_misread_approve', `session:${session.id}`, null, {
    kind: decision.kind,
    errors,
    cptLabel: session.cptLabel || '',
  });

  let pdfLine = 'Therapist report PDF: none was attached to this approval.';
  if (input.pdfBytes) {
    try {
      pdfLine = await storePdfLink(input.store, {
        user: input.user,
        providerId: provider.id,
        providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),
        errors,
        fileName: input.fileName,
        pdfBytes: input.pdfBytes,
        files: input.files,
      });
    } catch {
      pdfLine = 'Therapist report PDF: the file could not be stored. The session was still saved.';
    }
  }
  if (input.mail) {
    try {
      const letter = buildMosheMisreadEmail({
        errors,
        decision,
        pdfLine,
        providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),
        therapistName: input.user.displayName || input.user.email,
        therapistEmail: input.user.email,
      });
      await input.mail.send({ to: letter.to, subject: letter.subject, text: letter.text });
    } catch {
      /* The session is already saved. A mail outage must not undo the approval. */
    }
  }

  const fromNote = decision.summary ? `What the note shows: ${decision.summary}` : '';
  return {
    explanations,
    reply: [
      catalog,
      fromNote,
      savedSentence(decision),
      'I emailed Moshe so the note reader can recognize this next time. The visit was not sent to HHA.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    approved: true,
  };
}
