import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BlockErrorReport } from '@white-glove/tms-db';
import { tmsPublicOrigin } from './public-origin.js';

/** In-memory stand-in for the reports bucket. Tests use this and never call S3. */
export interface BlockReportFileStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export const NO_THERAPIST_REPORT_PDF =
  'Therapist report PDF: none was attached to this report.';

/** Luna support tickets and incorrect-error reports. */
export const BILLU_TICKET_EMAIL = 'bmarkowitz@whiteglovecare.net';

/**
 * Owner address already used for TMS alerts and the previous Luna inbox.
 * Override notes go here so Moshe can change the rule.
 */
export const MOSHE_OWNER_EMAIL = 'moshe@advancedautomations.net';

/** Previous ticket inboxes. Never leave these on To or Cc. */
export const RETIRED_TICKET_EMAILS = [
  'moshe@advancedautomations.net',
  'miris@whiteglovecare.net',
] as const;

export const BLOCK_EXPLANATION_UNAVAILABLE =
  'A written explanation could not be generated. The raw errors are listed above.';

export const NOTE_COULD_NOT_BE_READ =
  'The note could not be read. The raw errors are listed above.';

export function normalizeTherapistMessage(value: unknown): string {
  const message = String(value ?? '').trim();
  if (!message) {
    const err = new Error('Write a message explaining why this error is wrong.');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return message.slice(0, 4000);
}

export function normalizeBilluNote(value: unknown): string {
  const note = String(value ?? '').trim();
  if (!note) {
    const err = new Error(
      'A note is required. Say why the block was wrong and why the override is correct.',
    );
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return note.slice(0, 4000);
}

export function normalizeReportErrors(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  const errors = rows
    .map((row) => String(row || '').trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((row) => row.slice(0, 2000));
  if (!errors.length) {
    const err = new Error('Report the error text that is on screen.');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return errors;
}

function norm(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when a replayed block is one Billu already allowed. */
export function uploadErrorOverridden(known: string[], error: string): boolean {
  const e = norm(error);
  if (!e) return false;
  return known.some((row) => {
    const n = norm(row);
    if (!n) return false;
    return e === n || e.includes(n) || n.includes(e);
  });
}

/** Structural misses cannot be imported even if someone overrides the text. */
export function canWaiveUploadError(error: string): boolean {
  if (/could not read the student name/i.test(error)) return false;
  if (/not found\. please reach out to your administrator/i.test(error)) return false;
  if (/provider in pdf does not match/i.test(error)) return false;
  return true;
}

export function summarizeBlockedRows(errors: string[]): { childSummary: string; dateSummary: string } {
  const children = new Set<string>();
  const dates = new Set<string>();
  for (const raw of errors) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const head = line.split(':')[0] || line;
    const parts = head.split(/\s+[—–-]\s+/);
    const who = String(parts[0] || '').trim();
    if (who && !/^upload blocked/i.test(who)) children.add(who);
    const slot = String(parts[1] || '').trim();
    if (slot) dates.add(slot);
    const dated = line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/);
    if (dated) dates.add(dated[0]);
  }
  return {
    childSummary: [...children].slice(0, 12).join(', '),
    dateSummary: [...dates].slice(0, 12).join(', '),
  };
}

export function blockReportExplanationPrompt(input: {
  errors: string[];
  therapistMessage: string;
  providerName: string;
  childSummary: string;
  dateSummary: string;
  noteExcerpt?: string;
}): string {
  const note = String(input.noteExcerpt || '').trim();
  return [
    'You are writing for Billu, an admin at White Glove Therapy.',
    'A therapist says a TMS upload block is wrong. Explain the errors in plain language.',
    'Include which rows were blocked, the exact error text, what the rule thought was wrong, and what would have to be true for the upload to be valid.',
    note
      ? 'Base that explanation on the notes PDF text below. Mention the fact in the note that relates to the error (school, date, makeup wording, signature, or CPT). Do not paste the whole note.'
      : '',
    'Be polished and detailed. Do not lecture. Do not rewrite or replace the therapist message. Do not say the upload was accepted or sent to HHA.',
    `Provider: ${input.providerName || '(unknown)'}`,
    `Child: ${input.childSummary || '(not named)'}`,
    `Dates: ${input.dateSummary || '(not named)'}`,
    'Exact errors:',
    ...input.errors.map((error, i) => `${i + 1}. ${error}`),
    'Therapist message (stored separately — do not change it):',
    input.therapistMessage,
    ...(note ? ['Notes PDF text:', note] : []),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function polishBlockReportExplanation(
  input: {
    errors: string[];
    therapistMessage: string;
    providerName: string;
    childSummary: string;
    dateSummary: string;
    noteExcerpt?: string;
    /** PDF was attached but its text could not be extracted. */
    noteUnreadable?: boolean;
  },
  invoke: (prompt: string) => Promise<string>,
): Promise<{ aiExplanation: string; aiExplanationStatus: 'ok' | 'unavailable' }> {
  const noteAttached = Boolean(String(input.noteExcerpt || '').trim()) || Boolean(input.noteUnreadable);
  if (input.noteUnreadable) {
    return { aiExplanation: NOTE_COULD_NOT_BE_READ, aiExplanationStatus: 'unavailable' };
  }
  try {
    const text = String(await invoke(blockReportExplanationPrompt(input)) || '').trim();
    if (!text) {
      return {
        aiExplanation: noteAttached ? NOTE_COULD_NOT_BE_READ : BLOCK_EXPLANATION_UNAVAILABLE,
        aiExplanationStatus: 'unavailable',
      };
    }
    return { aiExplanation: text.slice(0, 8000), aiExplanationStatus: 'ok' };
  } catch {
    return {
      aiExplanation: noteAttached ? NOTE_COULD_NOT_BE_READ : BLOCK_EXPLANATION_UNAVAILABLE,
      aiExplanationStatus: 'unavailable',
    };
  }
}

export function buildPendingBlockReport(input: {
  id: string;
  createdAt: string;
  providerId: string;
  providerName: string;
  therapistUserId: string;
  therapistName: string;
  therapistEmail: string;
  therapistMessage: unknown;
  errors: unknown;
  fileName?: string;
  schoolId?: string;
  programType?: string;
  pendingText: string;
  aiExplanation: string;
  aiExplanationStatus: 'ok' | 'unavailable';
}): BlockErrorReport {
  const therapistMessage = normalizeTherapistMessage(input.therapistMessage);
  const errors = normalizeReportErrors(input.errors);
  const summary = summarizeBlockedRows(errors);
  const pendingText = String(input.pendingText || '').trim();
  if (!pendingText) {
    const err = new Error('The blocked file could not be held. Import the PDF again, then report the error.');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return {
    id: input.id,
    status: 'pending',
    providerId: input.providerId,
    providerName: input.providerName,
    therapistUserId: input.therapistUserId,
    therapistName: input.therapistName,
    therapistEmail: input.therapistEmail,
    therapistMessage,
    errors,
    childSummary: summary.childSummary,
    dateSummary: summary.dateSummary,
    fileName: String(input.fileName || '').slice(0, 300),
    schoolId: String(input.schoolId || ''),
    programType: String(input.programType || ''),
    pdfKey: '',
    pdfToken: '',
    pendingText: pendingText.slice(0, 300_000),
    aiExplanation: String(input.aiExplanation || BLOCK_EXPLANATION_UNAVAILABLE),
    aiExplanationStatus: input.aiExplanationStatus === 'ok' ? 'ok' : 'unavailable',
    createdAt: input.createdAt,
    decidedAt: '',
    decidedByUserId: '',
    decidedByName: '',
    decidedByEmail: '',
    billuNote: '',
    overrideNotifiedAt: '',
    importedAt: '',
  };
}

export function allowBlockReport(
  report: BlockErrorReport,
  input: { note: unknown; actorId: string; actorName: string; actorEmail: string; at: string },
): BlockErrorReport {
  if (report.status === 'allowed' && report.overrideNotifiedAt) return report;
  const billuNote = normalizeBilluNote(input.note);
  return {
    ...report,
    status: 'allowed',
    billuNote,
    decidedAt: input.at,
    decidedByUserId: input.actorId,
    decidedByName: input.actorName,
    decidedByEmail: input.actorEmail,
  };
}

export function declineBlockReport(
  report: BlockErrorReport,
  input: { note: unknown; actorId: string; actorName: string; actorEmail: string; at: string },
): BlockErrorReport {
  const billuNote = normalizeBilluNote(input.note);
  if (report.status === 'declined' && report.billuNote === billuNote) return report;
  return {
    ...report,
    status: 'declined',
    billuNote,
    decidedAt: input.at,
    decidedByUserId: input.actorId,
    decidedByName: input.actorName,
    decidedByEmail: input.actorEmail,
    importedAt: '',
  };
}

export function markOverrideNotified(report: BlockErrorReport, at: string): BlockErrorReport {
  if (report.overrideNotifiedAt) return report;
  return { ...report, overrideNotifiedAt: at };
}

export function blockReportPdfKey(reportId: string): string {
  const id = String(reportId || '').replace(/[^\w.-]+/g, '').slice(0, 80);
  return `tms/block-reports/${id || 'report'}.pdf`;
}

export function newBlockReportPdfToken(): string {
  return randomBytes(24).toString('base64url');
}

/** True only for a real notes PDF. Text-only blocks, including a missing file, stay without one. */
export function notesPdfBytes(rawBase64: unknown): Buffer | null {
  const raw = typeof rawBase64 === 'string' ? rawBase64.trim() : '';
  if (!raw) return null;
  const buf = Buffer.from(raw.replace(/^data:application\/pdf;base64,/, ''), 'base64');
  if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  return buf;
}

export function withReportPdf(
  report: BlockErrorReport,
  pdf: { pdfKey: string; pdfToken: string },
): BlockErrorReport {
  return {
    ...report,
    pdfKey: String(pdf.pdfKey || ''),
    pdfToken: String(pdf.pdfToken || ''),
  };
}

export function blockReportPdfTokenMatches(stored: string, given: string): boolean {
  const a = Buffer.from(String(stored || ''));
  const b = Buffer.from(String(given || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function blockReportPdfUrl(
  report: Pick<BlockErrorReport, 'id' | 'pdfKey' | 'pdfToken'>,
  origin?: string,
): string {
  if (!String(report.pdfKey || '').trim() || !String(report.pdfToken || '').trim()) return '';
  const base = tmsPublicOrigin(origin);
  return `${base}/api/block-reports/${encodeURIComponent(report.id)}/file?t=${encodeURIComponent(report.pdfToken)}`;
}

/** Email line. A missing file is a sentence, never an empty or broken link. */
export function therapistReportPdfEmailLine(
  report: Pick<BlockErrorReport, 'id' | 'pdfKey' | 'pdfToken' | 'fileName'>,
  origin?: string,
): string {
  if (!String(report.pdfKey || '').trim()) return NO_THERAPIST_REPORT_PDF;
  const name = String(report.fileName || '').trim();
  const label = name ? `Therapist's report PDF (${name})` : "Therapist's report PDF";
  const url = blockReportPdfUrl(report, origin);
  if (!url) return `${label}: stored with this report. Open it in Admin → Error reports.`;
  return `${label}: ${url}`;
}

export function blockReportPublic(report: BlockErrorReport) {
  const { pendingText: _pending, pdfToken: _token, ...rest } = report;
  return { ...rest, pdfKey: String(report.pdfKey || '') };
}

export function buildBilluBlockReportEmail(report: BlockErrorReport): {
  to: string[];
  subject: string;
  text: string;
} {
  return {
    to: [BILLU_TICKET_EMAIL],
    subject: `[TMS] Incorrect-error report — ${report.providerName || report.therapistName || 'therapist'}`,
    text: [
      'A therapist reports that an upload block is wrong.',
      'The upload is pending. It has not been sent to HHA and is not an accepted timesheet.',
      '',
      `Provider: ${report.providerName || report.providerId}`,
      `Therapist: ${report.therapistName} <${report.therapistEmail}>`,
      `Child: ${report.childSummary || '(not named)'}`,
      `Dates: ${report.dateSummary || '(not named)'}`,
      `File: ${report.fileName || '(unnamed)'}`,
      therapistReportPdfEmailLine(report),
      '',
      'Therapist message (unchanged):',
      report.therapistMessage,
      '',
      'Exact errors:',
      ...report.errors.map((error) => `- ${error}`),
      '',
      'Explanation:',
      report.aiExplanation || BLOCK_EXPLANATION_UNAVAILABLE,
      '',
      'Review it in Admin → Error reports.',
    ].join('\n'),
  };
}

export function buildMosheOverrideEmail(report: BlockErrorReport): {
  to: string[];
  subject: string;
  text: string;
} {
  return {
    to: [MOSHE_OWNER_EMAIL],
    subject: `[TMS] Block override — ${report.childSummary || report.providerName || 'upload'}`,
    text: [
      'Billu allowed a blocked upload. The rule should be reviewed in code.',
      '',
      `Allowed by: ${report.decidedByName || report.decidedByEmail} <${report.decidedByEmail}>`,
      `Provider: ${report.providerName || report.providerId}`,
      `Therapist: ${report.therapistName} <${report.therapistEmail}>`,
      `Child: ${report.childSummary || '(not named)'}`,
      `Dates: ${report.dateSummary || '(not named)'}`,
      `File: ${report.fileName || '(unnamed)'}`,
      therapistReportPdfEmailLine(report),
      '',
      'Therapist message:',
      report.therapistMessage,
      '',
      "Billu's note:",
      report.billuNote,
      '',
      'Error that was overridden:',
      ...report.errors.map((error) => `- ${error}`),
    ].join('\n'),
  };
}

export function errorsAfterAllowedOverrides(
  reports: Array<Pick<BlockErrorReport, 'status' | 'providerId' | 'errors'>>,
  providerId: string,
  errors: string[],
): string[] {
  const known = reports
    .filter((row) => row.status === 'allowed' && row.providerId === providerId)
    .flatMap((row) => row.errors || []);
  if (!known.length) return errors;
  return errors.filter((error) => !uploadErrorOverridden(known, error));
}
