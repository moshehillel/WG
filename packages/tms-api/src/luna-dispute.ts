import { newId, type AppUser, type MemoryStore } from '@white-glove/tms-db';
import {
  blockReportPdfKey,
  buildBilluBlockReportEmail,
  buildPendingBlockReport,
  newBlockReportPdfToken,
  polishBlockReportExplanation,
  summarizeBlockedRows,
  withReportPdf,
  type BlockReportFileStore,
} from './block-reports.js';
import { explainBlockErrors } from './luna-knowledge.js';
import { commitLunaFreshRead } from './luna-accept.js';
import { lunaRereadPrompt, parseLunaReread, rowFromLunaFacts } from './note-read.js';
import { readNotesAsUpload } from './note-upload-read.js';
import type { Mailer } from './mail.js';
import { putReportPdf } from './s3-state.js';

const NOTE_EXCERPT_MAX = 4000;

export const LUNA_FLAG_QUESTION = 'Did you feel that this error was wrongly flagged?';
export const LUNA_WHAT_WRONG = 'What do you think is wrong?';
export const LUNA_HOLD = 'Please hold while I read the PDF.';
export const LUNA_UPLOADED = 'I successfully uploaded it for you.';
export const LUNA_PENDING =
  'This is now pending. If it is rejected, support will reach out to you. If not, rest assured that it is uploaded.';
export const LUNA_CHOOSE_PDF = 'Choose the notes PDF first.';
export const LUNA_UNREADABLE = 'The note could not be read.';
export const LUNA_OKAY = 'Okay.';

export type LunaDisputeStage = 'explained' | 'awaiting-part' | 'closed';

export function lunaExplainText(errors: string[]): string {
  const rows = explainBlockErrors(errors);
  if (!rows.length) return 'Tell me which block is on the screen.';
  return rows.map((row) => [row.blocked, row.why].filter(Boolean).join(' ')).join('\n\n');
}

function asksWhatBlockMeans(text: string): boolean {
  return /\b(what (does|is) (this|that|the) (error|block|message)|what does this mean|explain this|why (was|is) (this|it) blocked)\b/i.test(
    text,
  );
}

function providerForUser(store: MemoryStore, user: AppUser, guest: boolean) {
  if (guest || user.role === 'admin') return undefined;
  return (
    store.data.providers.find((row) => row.id === user.providerId) ||
    store.data.providers.find((row) => row.userId === user.id)
  );
}

async function fileBilluPending(input: {
  store: MemoryStore;
  user: AppUser;
  guest: boolean;
  errors: string[];
  claim: string;
  noteText: string;
  pdfBytes: Buffer;
  fileName: string;
  explain: (prompt: string) => Promise<string>;
  mail?: Mailer;
  files?: BlockReportFileStore;
}): Promise<boolean> {
  const provider = providerForUser(input.store, input.user, input.guest);
  if (!provider) return false;
  const providerName = `${provider.firstName || ''} ${provider.lastName || ''}`.trim();
  const summary = summarizeBlockedRows(input.errors);
  const polished = await polishBlockReportExplanation(
    {
      errors: input.errors,
      therapistMessage: input.claim,
      providerName,
      childSummary: summary.childSummary,
      dateSummary: summary.dateSummary,
      noteExcerpt: input.noteText.slice(0, NOTE_EXCERPT_MAX),
    },
    input.explain,
  );
  const id = newId();
  let report = buildPendingBlockReport({
    id,
    createdAt: new Date().toISOString(),
    providerId: provider.id,
    providerName,
    therapistUserId: input.user.id,
    therapistName: input.user.displayName || input.user.email,
    therapistEmail: input.user.email,
    therapistMessage: input.claim,
    errors: input.errors,
    fileName: input.fileName,
    pendingText: input.noteText.slice(0, 300_000) || 'The notes PDF was attached.',
    aiExplanation: polished.aiExplanation,
    aiExplanationStatus: polished.aiExplanationStatus,
  });
  const pdfKey = blockReportPdfKey(id);
  if (input.files) await input.files.put(pdfKey, input.pdfBytes);
  else await putReportPdf(pdfKey, input.pdfBytes);
  report = withReportPdf(report, { pdfKey, pdfToken: newBlockReportPdfToken() });
  input.store.upsertBlockReport(report);
  input.store.audit(input.user.id, 'block_report_open', `blockReport:${report.id}`, null, {
    errors: report.errors,
    providerId: report.providerId,
    source: 'luna',
  });
  if (input.mail) {
    try {
      const letter = buildBilluBlockReportEmail(report);
      await input.mail.send({ to: letter.to, subject: letter.subject, text: letter.text });
    } catch {
      /* The pending report is already saved. */
    }
  }
  return true;
}

export async function runLunaDispute(input: {
  store: MemoryStore;
  user: AppUser;
  guest: boolean;
  errors: string[];
  stage?: string;
  choice?: string;
  userText?: string;
  noteText: string;
  pdfBytes: Buffer | null;
  fileName: string;
  invoke: ((prompt: string) => Promise<string>) | null;
  explain?: (prompt: string) => Promise<string>;
  mail?: Mailer;
  files?: BlockReportFileStore;
}): Promise<{
  reply: string;
  replyKeys: string[];
  stage: LunaDisputeStage;
  buttons: boolean;
  approved: boolean;
  pending: boolean;
}> {
  const errors = [...new Set(input.errors.map((row) => String(row || '').trim()).filter(Boolean))].slice(0, 40);
  const stage: LunaDisputeStage = input.stage === 'awaiting-part' || input.stage === 'closed' ? input.stage : 'explained';
  const choice = String(input.choice || '').trim().toLowerCase();
  const userText = String(input.userText || '').trim();
  const idle = {
    reply: lunaExplainText(errors),
    replyKeys: [] as string[],
    stage: 'explained' as const,
    buttons: true,
    approved: false,
    pending: false,
  };
  if (!errors.length) return { ...idle, buttons: false };
  if (asksWhatBlockMeans(userText) && choice !== 'yes' && choice !== 'no') {
    return idle;
  }
  if (stage === 'explained') {
    if (choice === 'no') {
      return { reply: LUNA_OKAY, replyKeys: ['luna.okay'], stage: 'closed', buttons: false, approved: false, pending: false };
    }
    if (choice === 'yes') {
      return {
        reply: LUNA_WHAT_WRONG,
        replyKeys: ['luna.whatWrong'],
        stage: 'awaiting-part',
        buttons: false,
        approved: false,
        pending: false,
      };
    }
    return {
      reply: LUNA_FLAG_QUESTION,
      replyKeys: ['luna.wronglyFlagged'],
      stage: 'explained',
      buttons: true,
      approved: false,
      pending: false,
    };
  }
  if (stage === 'closed' || choice === 'no') {
    return { reply: LUNA_OKAY, replyKeys: ['luna.okay'], stage: 'closed', buttons: false, approved: false, pending: false };
  }
  if (!userText) {
    return {
      reply: LUNA_WHAT_WRONG,
      replyKeys: ['luna.whatWrong'],
      stage: 'awaiting-part',
      buttons: false,
      approved: false,
      pending: false,
    };
  }
  if (!input.pdfBytes) {
    return {
      reply: LUNA_CHOOSE_PDF,
      replyKeys: ['luna.choosePdf'],
      stage: 'awaiting-part',
      buttons: false,
      approved: false,
      pending: false,
    };
  }
  const noteText = String(input.noteText || '').trim();
  if (!noteText) {
    return { reply: LUNA_UNREADABLE, replyKeys: ['luna.unreadable'], stage: 'awaiting-part', buttons: false, approved: false, pending: false };
  }

  if (!input.invoke) {
    return { reply: LUNA_UNREADABLE, replyKeys: ['luna.unreadable'], stage: 'awaiting-part', buttons: false, approved: false, pending: false };
  }
  let modelText = '';
  try {
    modelText = await input.invoke(lunaRereadPrompt(noteText, errors, userText));
  } catch {
    return { reply: LUNA_UNREADABLE, replyKeys: ['luna.unreadable'], stage: 'awaiting-part', buttons: false, approved: false, pending: false };
  }
  const facts = parseLunaReread(modelText);
  if (!facts) {
    return { reply: LUNA_UNREADABLE, replyKeys: ['luna.unreadable'], stage: 'awaiting-part', buttons: false, approved: false, pending: false };
  }
  const row = rowFromLunaFacts(facts, noteText);
  const fresh = row
    ? readNotesAsUpload({
        store: input.store,
        user: input.user,
        noteText,
        rows: [row],
      })
    : null;
  if (fresh && !fresh.errors.length && fresh.sessions.length) {
    const saved = await commitLunaFreshRead({
      store: input.store,
      user: input.user,
      errors,
      noteText,
      showed: fresh.showed,
      sessions: fresh.sessions,
      pdfBytes: input.pdfBytes,
      fileName: input.fileName,
      mail: input.mail,
      files: input.files,
    });
    if (saved) {
      return {
        reply: `${LUNA_HOLD}\n\n${LUNA_UPLOADED}`,
        replyKeys: ['luna.hold', 'luna.uploaded'],
        stage: 'closed',
        buttons: false,
        approved: true,
        pending: false,
      };
    }
  }

  const explainFn =
    input.explain ||
    (async (prompt: string) => {
      const { invokeClaudeText } = await import('./bedrock.js');
      return invokeClaudeText(prompt, 1200, 12000);
    });
  let filed = false;
  try {
    filed = await fileBilluPending({
      store: input.store,
      user: input.user,
      guest: input.guest,
      errors,
      claim: userText,
      noteText,
      pdfBytes: input.pdfBytes,
      fileName: input.fileName,
      explain: explainFn,
      mail: input.mail,
      files: input.files,
    });
  } catch {
    filed = false;
  }
  if (!filed) {
    return { reply: LUNA_UNREADABLE, replyKeys: ['luna.unreadable'], stage: 'awaiting-part', buttons: false, approved: false, pending: false };
  }
  return {
    reply: `${LUNA_HOLD}\n\n${LUNA_PENDING}`,
    replyKeys: ['luna.hold', 'luna.pending'],
    stage: 'closed',
    buttons: false,
    approved: false,
    pending: true,
  };
}
