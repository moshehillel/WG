import {
  adminProviderDetail,
  adminSchoolDetail,
  adminStudentDetail,
  adminStudentsList,
  adminWeeksList,
  applyCaseloadImport,
  checkMandatesForWeek,
  manualSessionNeedsSignature,
  manualSignatureError,
  sessionProviderDisciplineMismatchError,
  collectHeuristicAiIssues,
  dashboard,
  dueDateReport,
  findProviderByName,
  isOrphanProvider,
  providerDisplayNameKey,
  purgeOrphanProviders,
  lastServiceByStudent,
  adminInternalNotesReport,
  missingNotes,
  sessionNotesReport,
  hhaTransfersReport,
  weekProgressReport,
  newId,
  nowIso,
  parseCaseloadUpload,
  parseDos,
  parseMandatePdfText,
  parseWeeklySessionText,
  isGenericSettingLabel,
  isNonSchoolLikeSetting,
  pdfSchoolConflictsWithChild,
  sameDistrictSchoolNames,
  screenServiceNote,
  sessionSlotLabel,
  cptDurationError,
  notesLookCopyPasted,
  noteIsCopyPasteSource,
  noteCopyPasteError,
  missedSessionReasonError,
  sessionSignatureError,
  sessionServiceTypeRequiredError,
  sessionOverlapError,
  providerDaySessions,
  presentGroupPeerCount,
  mandateDurationMinutesForSession,
  soloGroupMandateNoteError,
  findStudentForActivityName,
  afterReopen,
  planSignatureRequestEnd,
  therapistCanEdit,
  therapistCanImportOrAddServices,
  therapistCanMutateExistingSession,
  weekIsProcessed,
  resolveMakeupOfSessionId,
  unusedMissedForStudent,
  validateMakeup,
  weekStartFromDos,
  additionalServiceLabel,
  isNoChildPlaceholderName,
  isAdditionalServiceType,
  sessionListedChildName,
  emptySchoolCalendar,
  isIsoDate,
  mergeSchoolCalendarParse,
  normalizeOffDays,
  parseOffDaysCsv,
  parseSchoolCalendarPdfText,
  parseSchoolCycleDays,
  SCHOOL_CALENDAR_PDF_HINT,
  SCHOOL_CALENDAR_PDF_NO_TEXT_ERROR,
  schoolSetupIncomplete,
  shouldNagDue,
  blankProviderPay,
  sessionPayAmount,
  DEFAULT_ADMIN_NOTE_TAGS,
  rowsToXlsxBuffer,
  appSettingsFromStore,
  sessionImportAgeError,
  defaultAppSettings,
  schoolBillingServiceNameForMandate,
  splitWeekBySchoolBins,
  timesheetBinKeyForWeek,
  weeksMatchingSchoolBin,
  weekMatchesSchoolBin,
  foldOrphanNoChildAdditionalWeeks,
  alignEditableProgramStamp,
  canonicalTimesheetProgramKey,
  resolveWeekSchoolId,
  resolveWeekProgramType,
  dominantSchoolIdForSessions,
  districtLabelForStudent,
  listDistrictDirectory,
  findDistrictByName,
  findDistrictDirectoryRow,
  decodeDistrictPathId,
  resolveSchoolOrDistrictSigner,
  weekHhaFailures,
  weekHhaRollup,
  isHhaTransferSession,
  normalizeProgramTypeKey,
  type AppSettings,
  type ArchiveRecord,
  type BlockErrorReport,
  type AppUser,
  type Discipline,
  type FrequencyKind,
  type MandateKind,
  type MemoryStore,
  type SchoolCalendar,
  type SessionRow,
  type StoredFile,
  type Student,
  type WeeklyPeriod,
} from '@white-glove/tms-db';
import { canonicalContractProgramName } from '@white-glove/shared';
import {
  archiveDownloadName,
  isPdfBytes,
  mergePdfBuffers,
  mergedArchiveFilename,
  sortArchivesByDate,
  zipStoredFiles,
} from './archive-bundle.js';
import { authenticate, requireAdmin, type AuthContext } from './auth.js';
import { invokeClaudeText, screenNoteWithOptionalBedrock } from './bedrock.js';
import { readSessionNotesWithBedrock } from './note-read.js';
import { markSessionAlreadyInHha, transferLockedWeek } from './hha-transfer.js';
import {
  buildManualSessionNotePdf,
  manualSessionNoteApplies,
  manualSessionNoteArchiveId,
} from './manual-session-note.js';
import { buildTimesheetPdf, formatTimesheetSignDate, isPaidAbsenceSession } from './timesheet.js';
import {
  createSignEnvelope,
  downloadSignedDocument,
  endOpenSignRequest,
  envelopeCompleted,
  resendSignEnvelopeInvite,
  SignNowApiError,
  SignNowNotConfiguredError,
  voidSignEnvelope,
} from './esign.js';
import { deactivateCognitoLogin, deleteCognitoLogin, inviteTherapist } from './invite.js';
import { clearAllCognitoMfaPreferences } from './mfa-clear.js';
import { PDF_NO_TEXT_ERROR, bodyHasPdfBytes, pdfTextFromBody } from './pdf-text.js';
import { runDueNags } from './due-nags.js';
import { runHhaErrorDigest } from './hha-error-digest.js';
import { runHhaAutoTransfer } from './hha-auto-transfer.js';
import { getPdfFromS3, putLockerPdf, putReportPdf, deletePdfFromS3 } from './s3-state.js';
import type { Mailer } from './mail.js';
import type { HhaClient } from '@white-glove/hha-client';
import {
  buildHandoffConfirmationReply,
  checkLunaGuestRateLimit,
  isLunaGuestUser,
  LUNA_GUEST_USER,
  lunaClientIp,
  runLunaChat,
  sendLunaHandoff,
} from './luna.js';
import { lunaExplainText, runLunaDispute } from './luna-dispute.js';
import { explainBlockErrors } from './luna-knowledge.js';
import {
  allowBlockReport,
  blockReportPdfKey,
  blockReportPdfTokenMatches,
  blockReportPublic,
  buildBilluBlockReportEmail,
  buildMosheOverrideEmail,
  buildPendingBlockReport,
  canWaiveUploadError,
  declineBlockReport,
  errorsAfterAllowedOverrides,
  markOverrideNotified,
  newBlockReportPdfToken,
  notesPdfBytes,
  polishBlockReportExplanation,
  summarizeBlockedRows,
  uploadErrorOverridden,
  withReportPdf,
  type BlockReportFileStore,
} from './block-reports.js';
import {
  archiveListItem,
  archivesForProviderIds,
  canAccessArchive,
  detectUploadSourceType,
  filterArchives,
  findTimesheetArchive,
  markTimesheetArchivesStatus,
  persistArchivePdf,
} from './archive.js';

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): HttpResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function textBody(req: HttpRequest): string {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && 'pdfText' in req.body) {
    return String((req.body as { pdfText?: string }).pdfText || '');
  }
  if (req.body && typeof req.body === 'object' && 'text' in req.body) {
    return String((req.body as { text?: string }).text || '');
  }
  return '';
}

function obj(req: HttpRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

/** Accept real booleans or common string/number encodings from proxies. */
function coerceOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

/** Luna works signed-in or as a rate-limited guest (login screen). */
async function resolveLunaCaller(
  store: MemoryStore,
  headers: Record<string, string | undefined>,
): Promise<{ user: AppUser; guest: boolean }> {
  const auth = await authenticate(store, headers);
  if ('error' in auth) {
    // Login page and stale JWTs still get guest support chat.
    return { user: LUNA_GUEST_USER, guest: true };
  }
  return { user: auth.user, guest: false };
}

async function handleLunaRoutes(
  store: MemoryStore,
  req: HttpRequest,
  path: string,
  deps: TmsRequestDeps,
): Promise<HttpResponse | null> {
  if (req.method !== 'POST') return null;
  if (
    path !== '/support/luna/chat' &&
    path !== '/support/luna/handoff' &&
    path !== '/support/luna/explain' &&
    path !== '/support/luna/dispute'
  ) {
    return null;
  }

  const { user, guest } = await resolveLunaCaller(store, req.headers);
  if (guest) {
    const ip = lunaClientIp(req.headers);
    const limited =
      path === '/support/luna/handoff'
        ? checkLunaGuestRateLimit(`luna-handoff:${ip}`, 5, 60 * 60_000)
        : checkLunaGuestRateLimit(`luna-chat:${ip}`, 30, 15 * 60_000);
    if (limited) return json(429, { error: limited });
  }

  const b = obj(req);
  if (path === '/support/luna/explain') {
    const errors = Array.isArray(b.errors) ? b.errors.map((row) => String(row || '')) : [];
    return json(200, {
      explanations: explainBlockErrors(errors),
      reply: lunaExplainText(errors),
      replyKeys: [],
      stage: 'explained',
      approved: false,
      pending: false,
    });
  }
  if (path === '/support/luna/dispute') {
    const errors = Array.isArray(b.errors) ? b.errors.map((row) => String(row || '')) : [];
    const pdfBytes = notesPdfBytes(b.pdfBase64);
    let noteText = '';
    try {
      noteText = pdfTextFromBody(b).trim();
    } catch {
      noteText = '';
    }
    const reviewed = await runLunaDispute({
      store,
      user,
      guest,
      errors,
      stage: String(b.stage || ''),
      choice: String(b.choice || ''),
      userText: String(b.userText || ''),
      noteText,
      pdfBytes,
      fileName: String(b.fileName || b.filename || ''),
      invoke: deps.readLunaNote
        ? (prompt) => deps.readLunaNote!(prompt)
        : (prompt) => invokeClaudeText(prompt, 800, 12000),
      explain: deps.explainBlockReport
        ? (prompt) => deps.explainBlockReport!(prompt)
        : undefined,
      mail: deps.mail,
      files: deps.blockReportFiles,
    });
    return json(200, reviewed);
  }
  if (path === '/support/luna/chat') {
    try {
      const out = await runLunaChat({
        messages: b.messages,
        pageUrl: String(b.pageUrl || '').trim(),
        user,
      });
      return json(200, out);
    } catch (err) {
      const status = Number((err as { status?: number })?.status) || 502;
      return json(status, {
        error: err instanceof Error ? err.message : 'Luna is unavailable.',
      });
    }
  }

  if (!deps.mail) return json(503, { error: 'Mailer is not configured.' });
  try {
    const out = await sendLunaHandoff({
      mail: deps.mail,
      user,
      messages: b.messages,
      summary: String(b.summary || '').trim(),
      pageUrl: String(b.pageUrl || '').trim(),
      contactName: b.contactName,
      contactEmail: b.contactEmail,
    });
    const actorId = isLunaGuestUser(user) ? 'guest' : user.id;
    store.audit(actorId, 'luna_handoff', `user:${actorId}`, null, {
      to: out.to,
      mailId: out.id,
      contactName: out.contactName,
      contactEmail: out.contactEmail,
      guest,
    });
    return json(200, {
      ok: true,
      id: out.id,
      contactEmail: out.contactEmail,
      reply: buildHandoffConfirmationReply(out.contactEmail),
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 502;
    return json(status, {
      error: err instanceof Error ? err.message : 'Unable to send the support handoff.',
    });
  }
}

/** Child id → "First Last" for mandate over/under messages. */
function studentNameById(store: MemoryStore): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of store.data.students) {
    const name = `${s.firstName} ${s.lastName}`.trim();
    map.set(s.id, name || s.id);
  }
  return map;
}

/** Child id → school calendar for school-day / cycle mandate windows. */
function calendarByStudentId(store: MemoryStore): Map<string, SchoolCalendar | null> {
  const map = new Map<string, SchoolCalendar | null>();
  for (const s of store.data.students) {
    const schoolId = String(s.schoolId || '').trim();
    map.set(s.id, schoolId ? store.schoolCalendarForSchool(schoolId) ?? null : null);
  }
  return map;
}

/** Child id → school display name for calendar fallback warnings. */
function schoolNameByStudentId(store: MemoryStore): Map<string, string> {
  const schoolName = new Map(store.data.schools.map((s) => [s.id, String(s.name || '').trim()]));
  const map = new Map<string, string>();
  for (const s of store.data.students) {
    const schoolId = String(s.schoolId || '').trim();
    map.set(s.id, schoolId ? schoolName.get(schoolId) || schoolId : '');
  }
  return map;
}

function mandateWeekOpts(store: MemoryStore): {
  calendarByStudentId: Map<string, SchoolCalendar | null>;
  schoolNameByStudentId: Map<string, string>;
  allowShortSession: boolean;
} {
  return {
    calendarByStudentId: calendarByStudentId(store),
    schoolNameByStudentId: schoolNameByStudentId(store),
    // Admin locker, default OFF.
    allowShortSession: getAppSettings(store).allowShortSessionVsMandate === true,
  };
}

/**
 * Week-screen mandate check: yellow under-mandate only for this provider's
 * caseload, and only while the mandate is active for the week being viewed.
 */
function providerWeekMandateOpts(store: MemoryStore, providerId: string, weekStart: string) {
  const id = String(providerId || '').trim();
  return {
    ...mandateWeekOpts(store),
    ...(id ? { caseloadProviderIds: providerLookupIds(store, id) } : {}),
    weekStart: String(weekStart || '').trim(),
    asOf: new Date().toISOString().slice(0, 10),
  };
}

function overMandateSummary(errors: string[]): string {
  if (!errors.length) return 'This upload exceeds the mandate.';
  if (errors.length === 1) return errors[0]!;
  return `Upload blocked — ${errors.length} sessions exceed the mandate. See details for each child and date/time.`;
}

/** Identity for upload dedupe / skip-already-saved (child + DOS + times + attendance). */
function uploadSessionKey(s: {
  studentId: string;
  dateOfService: string;
  beginTime: string;
  endTime: string;
  attendance?: string;
}): string {
  const attendance = String(s.attendance || 'attended')
    .trim()
    .toLowerCase();
  return [
    String(s.studentId || '').trim().toLowerCase(),
    String(s.dateOfService || '').trim().toLowerCase(),
    String(s.beginTime || '').trim().toLowerCase().replace(/\./g, ''),
    String(s.endTime || '').trim().toLowerCase().replace(/\./g, ''),
    attendance || 'attended',
  ].join('|');
}

function formatUploadRowLabel(row: {
  studentName?: string;
  dateOfService?: string;
  beginTime?: string;
  endTime?: string;
}): string {
  const who = String(row.studentName || '').trim() || 'Unknown child';
  const slot = sessionSlotLabel({
    dateOfService: String(row.dateOfService || ''),
    beginTime: String(row.beginTime || ''),
    endTime: String(row.endTime || ''),
  } as SessionRow);
  return `${who} — ${slot}`;
}

/**
 * Single unlock for a signed/locked week (admin Reopen and provider Revoke signature).
 * Sessions stay. HHA visit rows and hhaStatus stay. School signer name/email stay so the
 * timesheet bin does not change. Signature artifacts are cleared.
 */
async function revokeWeekSignature(
  store: MemoryStore,
  ctx: AuthContext,
  weekId: string,
): Promise<HttpResponse> {
  const week = store.data.weeks.find((w) => w.id === weekId);
  if (!week) return json(404, { error: 'Week not found.' });
  if (ctx.user.role !== 'admin') {
    const provider = providerFor(store, ctx.user);
    if (!provider || week.providerId !== provider.id) {
      return json(403, { error: 'You can only revoke the signature on your own week.' });
    }
  }
  const nextStatus = afterReopen(week.status);
  if (!nextStatus) {
    return json(409, { error: 'Only a signed or locked week can have its signature revoked.' });
  }
  if (week.envelopeId) {
    await voidSignEnvelope(week.envelopeId, 'Timesheet signature revoked in TMS');
  }
  const next = store.upsertWeek({
    ...week,
    status: nextStatus,
    hhaStatus: week.hhaStatus,
    providerSignedKey: '',
    providerSignedAt: '',
    envelopeId: '',
    signedKey: '',
    timesheetKey: '',
  });
  markTimesheetArchivesStatus(store, week.id, nextStatus);
  store.audit(ctx.user.id, 'revoke_signature', `week:${week.id}`, week, next);
  return json(200, {
    week: next,
    message: 'Signature revoked. The week is unsigned and can be edited and signed again.',
  });
}

/**
 * Cancel or retrieve an outstanding school signature request.
 * The week returns to draft (unsigned, sendable). Timesheet PDF history is kept.
 * A completed signature is not voided. A repeat of the same outcome is a no-op.
 */
async function endWeekSignatureRequest(
  store: MemoryStore,
  ctx: AuthContext,
  weekId: string,
  mode: 'cancel' | 'retrieve',
): Promise<HttpResponse> {
  const week = store.data.weeks.find((w) => w.id === weekId);
  if (!week) return json(404, { error: 'Week not found.' });
  if (ctx.user.role !== 'admin') {
    const provider = providerFor(store, ctx.user);
    if (!provider || week.providerId !== provider.id) {
      return json(403, {
        error:
          mode === 'cancel'
            ? 'You can only cancel your own signature request.'
            : 'You can only retrieve your own signature request.',
      });
    }
  }
  const plan = planSignatureRequestEnd(week, mode);
  if (!plan.ok) return json(plan.status, { error: plan.message });
  if (plan.noop) {
    return json(200, { week, noop: true, message: plan.message });
  }

  const envelopeId = String(week.envelopeId || '').trim();
  let retrievedPdf: Uint8Array | null = null;
  if (envelopeId) {
    const ended = await endOpenSignRequest(envelopeId, {
      mode,
      reason:
        mode === 'cancel'
          ? 'Timesheet signature request cancelled in TMS'
          : 'Timesheet signature request retrieved in TMS',
    });
    if (!ended.ok) {
      return json(ended.alreadyComplete ? 409 : 502, { error: ended.error });
    }
    retrievedPdf = ended.pdf;
  }

  const signatureRequestStatus = mode === 'cancel' ? 'cancelled' : 'retrieved';
  const retrievedTimesheetKey =
    mode === 'retrieve' && retrievedPdf?.length ? `tms/retrieved/${week.id}.pdf` : week.retrievedTimesheetKey || '';
  const next = store.upsertWeek({
    ...week,
    status: 'draft',
    signatureRequestStatus,
    signatureRequestAt: nowIso(),
    envelopeId: '',
    retrievedTimesheetKey,
    hhaStatus: week.hhaStatus,
  });
  markTimesheetArchivesStatus(store, week.id, signatureRequestStatus);

  let archiveId = '';
  if (mode === 'retrieve' && retrievedPdf?.length) {
    const saved = await persistArchivePdf({
      store,
      kind: 'timesheet',
      sourceType: 'timesheet',
      userId: ctx.user.id,
      providerId: week.providerId,
      schoolId: week.schoolId,
      weekId: week.id,
      weekStart: week.weekStart,
      filename: `timesheet-${week.weekStart}-retrieved.pdf`,
      s3Key: retrievedTimesheetKey,
      status: 'retrieved',
      pdf: Buffer.from(retrievedPdf),
    });
    archiveId = saved?.id || '';
  }

  store.audit(
    ctx.user.id,
    mode === 'cancel' ? 'cancel_signature_request' : 'retrieve_signature_request',
    `week:${week.id}`,
    week,
    next,
  );
  const message =
    mode === 'cancel'
      ? 'Signature request cancelled. The signer link is closed. This week is unsigned and can be sent again. The timesheet PDF stays in history as cancelled.'
      : retrievedPdf?.length
        ? 'Signature request retrieved. The current timesheet is ready to review, the signer link is closed, and this week can be edited and sent again.'
        : 'Signature request retrieved. The signer link is closed and this week can be edited and sent again.';
  return json(200, {
    week: next,
    noop: false,
    ...(archiveId ? { archiveId } : {}),
    message,
  });
}

function providerFor(store: MemoryStore, user: AppUser) {
  // Explicit admin role wins over any leftover provider link (therapist chrome).
  if (user.role === 'admin') return undefined;
  if (user.providerId) {
    return store.data.providers.find((p) => p.id === user.providerId);
  }
  return store.data.providers.find((p) => p.userId === user.id);
}

/** MIME type for locker / provider-report downloads (S3 key extension preferred). */
function contentTypeForStoredFile(s3Key: string, label?: string): string {
  const fromKey = String(s3Key || '').split('/').pop() || '';
  const fromLabel = String(label || '').trim();
  const name = (/\.[a-z0-9]{1,8}$/i.test(fromKey) ? fromKey : fromLabel).toLowerCase();
  const ext = (name.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || '';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** Bytes for an archive row, including signed-timesheet fallbacks when S3 expired the object. */
async function loadArchiveFile(store: MemoryStore, row: ArchiveRecord): Promise<Buffer | null> {
  if (!row.s3Key) return null;
  let pdf = await getPdfFromS3(row.s3Key);
  if (!pdf?.length && row.kind === 'timesheet' && row.weekId) {
    const week = store.data.weeks.find((w) => w.id === row.weekId);
    const alts = [
      week?.signedKey,
      week ? `tms/signed/${week.id}.pdf` : '',
      week?.timesheetKey,
      week ? `tms/timesheets/${week.id}.pdf` : '',
      week?.providerSignedKey,
    ].filter((k, i, arr): k is string => Boolean(k) && k !== row.s3Key && arr.indexOf(k) === i);
    for (const alt of alts) {
      pdf = await getPdfFromS3(alt);
      if (pdf?.length) {
        store.upsertArchive({ ...row, s3Key: alt, status: row.status || week?.status || '' });
        break;
      }
    }
    const envelopeId = String(week?.envelopeId || '').trim();
    if (!pdf?.length && week && envelopeId && !envelopeId.startsWith('email:')) {
      try {
        const bytes = await downloadSignedDocument(envelopeId);
        if (bytes?.length) {
          pdf = Buffer.from(bytes);
          const signedKey = week.signedKey || `tms/signed/${week.id}.pdf`;
          const timesheetKey = week.timesheetKey || `tms/timesheets/${week.id}.pdf`;
          await putLockerPdf(signedKey, pdf);
          if (timesheetKey !== signedKey) await putLockerPdf(timesheetKey, pdf);
          store.upsertWeek({ ...week, signedKey, timesheetKey });
          store.upsertArchive({
            ...row,
            s3Key: signedKey,
            status: row.status || week.status || 'locked',
            filename: row.filename || `timesheet-${week.weekStart}-signed.pdf`,
          });
          console.info('[tms-esign] archive open restored signed PDF', {
            weekId: week.id,
            bytes: pdf.length,
          });
        }
      } catch (err) {
        console.warn(
          '[tms-esign] archive open signed PDF restore failed',
          err instanceof Error ? err.message : err,
          { weekId: week.id },
        );
      }
    }
  }
  return pdf?.length ? pdf : null;
}

/** Same-name provider ids (orphan twins) so week/session lookup matches admin detail. */
function providerLookupIds(store: MemoryStore, providerId: string): string[] {
  const id = String(providerId || '').trim();
  if (!id) return [];
  const opened = store.data.providers.find((p) => p.id === id);
  if (!opened) return [id];
  const key = providerDisplayNameKey(opened);
  if (!key) return [id];
  const ids = store.data.providers
    .filter((p) => providerDisplayNameKey(p) === key)
    .map((p) => p.id);
  return ids.length ? ids : [id];
}

function weeksForProviderStart(
  store: MemoryStore,
  providerId: string,
  weekStart: string,
): typeof store.data.weeks {
  const ids = new Set(providerLookupIds(store, providerId));
  const start = String(weekStart || '').trim();
  return store.data.weeks.filter(
    (w) => ids.has(w.providerId) && (!start || w.weekStart === start),
  );
}

/** Prefer keeping provider-signed / enveloped draft when folding fragments. */
function weekMergeRank(
  store: MemoryStore,
  w: (typeof store.data.weeks)[number],
): number {
  let score = 0;
  if (String(w.providerSignedKey || '').trim()) score += 1000;
  if (String(w.envelopeId || '').trim()) score += 500;
  if (String(w.timesheetKey || '').trim()) score += 100;
  if (String(w.signerEmail || '').trim()) score += 50;
  if (String(w.programType || '').trim()) score += 10;
  score += store.sessionsForWeek(w.id).length;
  return score;
}

/** Fold duplicate Monday weeks in the *same* program-type bin onto one row. */
function foldWeeksOnto(
  store: MemoryStore,
  target: (typeof store.data.weeks)[number],
  extras: Array<(typeof store.data.weeks)[number]>,
): void {
  const targetBin = timesheetBinKeyForWeek(store, target);
  let keep = target;
  for (const extra of extras) {
    if (!extra || extra.id === keep.id) continue;
    // Never fold across providers — send lock is per providerId + program + week.
    if (extra.providerId !== keep.providerId) continue;
    if (timesheetBinKeyForWeek(store, extra) !== targetBin) continue;
    const moved = store.sessionsForWeek(extra.id).length;
    for (const s of store.sessionsForWeek(extra.id)) {
      store.upsertSession({ ...s, weekId: keep.id });
    }
    // Preserve signing / send work from the discarded fragment.
    const patch: Partial<(typeof store.data.weeks)[number]> = {};
    if (!String(keep.providerSignedKey || '').trim() && String(extra.providerSignedKey || '').trim()) {
      patch.providerSignedKey = extra.providerSignedKey;
      if (extra.providerSignedAt) patch.providerSignedAt = extra.providerSignedAt;
    }
    if (!String(keep.envelopeId || '').trim() && String(extra.envelopeId || '').trim()) {
      patch.envelopeId = extra.envelopeId;
    }
    if (!String(keep.timesheetKey || '').trim() && String(extra.timesheetKey || '').trim()) {
      patch.timesheetKey = extra.timesheetKey;
    }
    if (!String(keep.signedKey || '').trim() && String(extra.signedKey || '').trim()) {
      patch.signedKey = extra.signedKey;
    }
    if (!String(keep.signerEmail || '').trim() && String(extra.signerEmail || '').trim()) {
      patch.signerName = extra.signerName;
      patch.signerEmail = extra.signerEmail;
    }
    if (!String(keep.programType || '').trim() && String(extra.programType || '').trim()) {
      patch.programType = extra.programType;
    }
    if (!String(keep.schoolId || '').trim() && String(extra.schoolId || '').trim()) {
      patch.schoolId = extra.schoolId;
    }
    // Sessions were added onto a previously provider-signed PDF — force re-sign.
    if (moved > 0 && String(keep.providerSignedKey || patch.providerSignedKey || '').trim()) {
      patch.providerSignedKey = '';
      patch.providerSignedAt = '';
      patch.timesheetKey = '';
      patch.envelopeId = '';
    }
    if (Object.keys(patch).length) {
      keep = store.upsertWeek({ ...keep, ...patch });
    }
    store.removeWeek(extra.id);
  }
}

/**
 * Collapse fragmented editable bins that share a program-type key (e.g. Carle Place
 * signed building vs unsigned Middle/High leftovers).
 */
function foldEditableSameBinWeeks(
  store: MemoryStore,
  weeks: Array<(typeof store.data.weeks)[number]>,
  opts?: { preferProgramType?: string },
): void {
  const groups = new Map<string, Array<(typeof store.data.weeks)[number]>>();
  for (const w of weeks) {
    if (!therapistCanEdit(w.status)) continue;
    const key = `${w.providerId}::${w.weekStart}::${timesheetBinKeyForWeek(store, w)}`;
    const list = groups.get(key) || [];
    list.push(w);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => weekMergeRank(store, b) - weekMergeRank(store, a));
    const keep = group[0]!;
    foldWeeksOnto(store, keep, group.slice(1));
  }
  // After same-bin folds, absorb orphan no-child additional-service drafts.
  foldOrphanNoChildAdditionalWeeks(store, weeks, {
    preferProgramType: opts?.preferProgramType,
  });
  for (const w of weeks) {
    const live = store.data.weeks.find((row) => row.id === w.id);
    if (live) alignEditableProgramStamp(store, live);
  }
}

/**
 * New sessions after a week is signed/locked stay on one open draft
 * (same provider + Monday + district). Never appended to the locked sheet.
 */
function openDraftBesideProcessed(
  store: MemoryStore,
  locked: WeeklyPeriod,
  opts: { providerId: string; programType?: string; schoolId?: string },
): WeeklyPeriod {
  const programType =
    String(opts.programType || '').trim() ||
    resolveWeekProgramType(store, locked) ||
    String(locked.programType || '').trim();
  const siblings = weeksForProviderStart(store, locked.providerId, locked.weekStart);
  foldEditableSameBinWeeks(store, siblings, { preferProgramType: programType || undefined });
  const want = canonicalTimesheetProgramKey(programType);
  const existing = weeksForProviderStart(store, locked.providerId, locked.weekStart).find(
    (w) =>
      therapistCanEdit(w.status) &&
      canonicalTimesheetProgramKey(resolveWeekProgramType(store, w) || w.programType) === want,
  );
  if (existing) return existing;
  const schoolId = String(opts.schoolId || locked.schoolId || '').trim();
  const school = schoolId ? store.data.schools.find((s) => s.id === schoolId) : undefined;
  const signer = resolveSchoolOrDistrictSigner(store, school, programType);
  return store.upsertWeek({
    id: newId(),
    providerId: opts.providerId || locked.providerId,
    weekStart: locked.weekStart,
    schoolId,
    programType,
    status: 'draft',
    signerName: signer.signerName || locked.signerName || '',
    signerEmail: signer.signerEmail || locked.signerEmail || '',
    timesheetKey: '',
    signedKey: '',
    envelopeId: '',
    hhaStatus: 'none',
    hhaError: '',
  });
}

/**
 * Prefer school/program-scoped week; never fold different program-type bins together.
 * Timesheet send lock is per providerId + program + weekStart — never adopt or
 * reassign another provider's submitted/signed/locked week (name-alias twins used
 * to steal a submitted bin and block a second therapist on the same program).
 */
function pickWeekForScope(
  store: MemoryStore,
  matchedWeeks: WeeklyPeriod[],
  opts?: { providerId?: string; schoolId?: string; programType?: string },
): WeeklyPeriod | undefined {
  if (!matchedWeeks.length) return undefined;
  const providerId = String(opts?.providerId || '').trim();
  const schoolId = String(opts?.schoolId || '').trim();
  const programType = String(opts?.programType || '').trim();
  let pool = matchedWeeks;
  if (providerId) {
    const exact = matchedWeeks.filter((w) => w.providerId === providerId);
    // Prefer this provider's own bins. Fall back to alias weeks only when they are
    // still editable (draft/reopened) so a name twin can share an open draft —
    // never fall back onto a submitted/signed/locked alias week.
    if (exact.length) {
      pool = exact;
    } else {
      const editableAlias = matchedWeeks.filter((w) => therapistCanEdit(w.status));
      if (!editableAlias.length) return undefined;
      pool = editableAlias;
    }
  }
  let candidates = pool;
  if (schoolId || programType) {
    const scoped = weeksMatchingSchoolBin(
      store,
      pool,
      schoolId || undefined,
      programType || undefined,
    );
    // Empty scoped list means no existing bin for this program/signer — caller should create one.
    candidates = scoped;
  }
  if (!candidates.length) return undefined;
  // A signed/locked sheet stays signed. Later sessions belong on the open draft.
  const openDrafts = candidates.filter((w) => therapistCanEdit(w.status));
  if (openDrafts.length) candidates = openDrafts;
  let week =
    (providerId ? candidates.find((w) => w.providerId === providerId) : undefined) ||
    candidates[0];
  if (!week) return undefined;
  // Only retarget editable alias drafts onto the requested providerId. Never move
  // ownership of a submitted/signed/locked timesheet across provider rows.
  if (providerId && week.providerId !== providerId) {
    if (!therapistCanEdit(week.status)) return undefined;
    week = store.upsertWeek({ ...week, providerId });
  }
  // Program-type-only scope: merge every editable matching bin (multi-building programs).
  if (programType && !schoolId && therapistCanEdit(week.status)) {
    const want = canonicalTimesheetProgramKey(programType);
    const extras = candidates.filter(
      (w) =>
        w.id !== week!.id &&
        therapistCanEdit(w.status) &&
        (w.providerId === week!.providerId || w.providerId === providerId) &&
        canonicalTimesheetProgramKey(resolveWeekProgramType(store, w)) === want,
    );
    if (extras.length) foldWeeksOnto(store, week, extras);
  } else if (therapistCanEdit(week.status)) {
    const sameBin = pool.filter(
      (w) =>
        w.id !== week!.id &&
        therapistCanEdit(w.status) &&
        (w.providerId === week!.providerId || w.providerId === providerId) &&
        timesheetBinKeyForWeek(store, w) === timesheetBinKeyForWeek(store, week!),
    );
    if (sameBin.length) foldWeeksOnto(store, week, sameBin);
  }
  // Repair mixed program/signer weeks left over from pre-split imports.
  const split = splitWeekBySchoolBins(store, week, () => newId());
  if (schoolId || programType) {
    const match = split.find((w) =>
      weekMatchesSchoolBin(store, w, schoolId, programType || undefined),
    );
    if (match) week = match;
  } else {
    week = split[0] || week;
  }
  if (therapistCanEdit(week.status)) {
    const patch: Partial<WeeklyPeriod> = {};
    if (schoolId && !String(week.schoolId || '').trim()) {
      const school = store.data.schools.find((s) => s.id === schoolId);
      const signer = resolveSchoolOrDistrictSigner(
        store,
        school,
        programType || week.programType,
      );
      patch.schoolId = schoolId;
      patch.signerName = signer.signerName || week.signerName;
      patch.signerEmail = signer.signerEmail || week.signerEmail;
    }
    if (programType && therapistCanEdit(week.status)) {
      const stamped = String(week.programType || '').trim();
      const sameDistrict =
        !stamped ||
        (canonicalTimesheetProgramKey(stamped) === canonicalTimesheetProgramKey(programType) &&
          programType.length > stamped.length);
      if (sameDistrict && stamped !== programType) {
        patch.programType = programType;
      }
    }
    if (Object.keys(patch).length) {
      week = store.upsertWeek({ ...week, ...patch });
    }
  }
  return week;
}

function getAppSettings(store: MemoryStore): AppSettings {
  return appSettingsFromStore(store.data.settings);
}

function upsertAppSettings(store: MemoryStore, next: AppSettings): AppSettings {
  // enforceProviderDisciplineMatch was an admin switch. Discipline match is always on now,
  // so a stored value from an older save is dropped here.
  const { enforceProviderDisciplineMatch: _legacyDisciplineSwitch, ...rest } = {
    ...defaultAppSettings(),
    ...next,
    id: 'global',
  } as AppSettings & { enforceProviderDisciplineMatch?: unknown };
  const row: AppSettings = rest as AppSettings;
  store.data.settings = [row];
  return row;
}

/**
 * Schools on this provider's caseload only.
 * Unique schoolIds from students linked by mandates where providerId matches —
 * never org-wide schools, never other therapists' caseloads, never unassigned mandates.
 */
function schoolsForProvider(store: MemoryStore, providerId: string) {
  if (!providerId) return [];
  const studentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === providerId).map((m) => m.studentId),
  );
  const schoolIds = new Set(
    store.data.students.filter((s) => studentIds.has(s.id)).map((s) => s.schoolId).filter(Boolean),
  );
  return store.data.schools.filter((s) => schoolIds.has(s.id));
}

/** Distinct program types on this provider's caseload (district/payer scope, not building). */
function programTypesForProvider(store: MemoryStore, providerId: string): string[] {
  if (!providerId) return [];
  const studentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === providerId).map((m) => m.studentId),
  );
  const types = new Set<string>();
  for (const s of store.data.students) {
    if (!studentIds.has(s.id)) continue;
    const pt = String(s.programType || '').trim();
    if (pt) types.add(pt);
  }
  return [...types].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function programTypeKey(v: string): string {
  return normalizeProgramTypeKey(v);
}

function sessionMatchesProgramType(
  store: MemoryStore,
  session: { studentId: string },
  programType?: string,
): boolean {
  const pt = String(programType || '').trim();
  if (!pt) return true;
  // No-child additional services stay on the week they were saved to.
  if (!String(session.studentId || '').trim()) return true;
  const student = store.data.students.find((s) => s.id === session.studentId);
  return programTypeKey(student?.programType) === programTypeKey(pt);
}

function filterSessionsByProgramType<T extends { studentId: string }>(
  store: MemoryStore,
  sessions: T[],
  programType?: string,
): T[] {
  const pt = String(programType || '').trim();
  if (!pt) return sessions;
  return sessions.filter((s) => sessionMatchesProgramType(store, s, pt));
}

/** Schools on this provider's caseload that have at least one child in the program type. */
function schoolIdsForProviderProgramType(
  store: MemoryStore,
  providerId: string,
  programType: string,
): Set<string> {
  const key = programTypeKey(programType);
  if (!key || !providerId) return new Set();
  const myStudentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === providerId).map((m) => m.studentId),
  );
  return new Set(
    store.data.students
      .filter((s) => myStudentIds.has(s.id) && programTypeKey(s.programType) === key)
      .map((s) => s.schoolId)
      .filter(Boolean),
  );
}

/** Majority student.schoolId among sessions on this week (child's school, not picker). */
function dominantSchoolIdForWeek(store: MemoryStore, weekId: string): string {
  return dominantSchoolIdForSessions(store, store.sessionsForWeek(weekId));
}

/**
 * Timesheet signer school = school of the children on the week (session majority).
 * Therapist selected-school filter / first caseload school only apply when the week
 * has no sessions yet. Never stamp a sibling school's signer onto another school.
 */
function resolveWeekSchool(
  store: MemoryStore,
  providerId: string,
  opts?: { weekId?: string; preferredSchoolId?: string },
) {
  const weekId = String(opts?.weekId || '').trim();
  if (weekId) {
    const dominantId = dominantSchoolIdForWeek(store, weekId);
    if (dominantId) {
      const fromSessions = store.data.schools.find((s) => s.id === dominantId);
      if (fromSessions) return fromSessions;
    }
  }
  const preferredId = String(opts?.preferredSchoolId || '').trim();
  if (preferredId) {
    const preferred = store.data.schools.find((s) => s.id === preferredId);
    if (preferred) return preferred;
  }
  return schoolsForProvider(store, providerId)[0] || store.data.schools[0];
}

function stampWeekSignerFromSchool(
  store: MemoryStore,
  week: WeeklyPeriod,
  school:
    | { district?: string; signerName?: string; signerEmail?: string }
    | undefined,
): WeeklyPeriod {
  if (!therapistCanEdit(week.status)) return week;
  const programType =
    String(week.programType || '').trim() ||
    resolveWeekProgramType(store, week);
  const resolved = resolveSchoolOrDistrictSigner(store, school, programType);
  const signerName = resolved.signerName || String(school?.signerName || '');
  const signerEmail = resolved.signerEmail || String(school?.signerEmail || '');
  if (!signerEmail && !signerName) return week;
  if (week.signerName === signerName && week.signerEmail === signerEmail) return week;
  return store.upsertWeek({ ...week, signerName, signerEmail });
}

function schoolDistrictForWeek(
  store: MemoryStore,
  weekId: string,
  preferredSchoolId?: string,
): string {
  // Prefer caseload programType (district/payer), then school.district — same as reports.
  const week = store.data.weeks.find((w) => w.id === weekId);
  const stampedPt = String(week?.programType || '').trim();
  if (stampedPt) return stampedPt;
  const sessions = store.sessionsForWeek(weekId);
  if (sessions.length) {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const student = store.data.students.find((st) => st.id === s.studentId);
      const school = student
        ? store.data.schools.find((sc) => sc.id === student.schoolId)
        : undefined;
      const label = districtLabelForStudent(student, school);
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    let best = '';
    let bestN = 0;
    for (const [label, n] of counts) {
      if (n > bestN) {
        best = label;
        bestN = n;
      }
    }
    if (best) return best;
  }
  if (preferredSchoolId) {
    const preferred = store.data.schools.find((s) => s.id === preferredSchoolId);
    const label = String(preferred?.district || preferred?.name || '').trim();
    if (label) return label;
  }
  return '';
}

function uniqueTrimmed(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const t = String(value || '').trim();
    const key = t.toLocaleLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Same row payload as a single-week timesheet, so merge can sort through buildTimesheetPdf. */
function timesheetSourceRowsForWeek(store: MemoryStore, week: WeeklyPeriod) {
  const provider = store.data.providers.find((p) => p.id === week.providerId);
  return store.sessionsForWeek(week.id).map((session) => {
    const dayPeers = providerDaySessions(
      store.data.sessions,
      store.data.weeks,
      week.providerId,
      session.dateOfService,
      session.id,
    );
    const payOpts = {
      presentGroupPeerCount: presentGroupPeerCount({
        candidate: session,
        peers: dayPeers,
        mandates: store.data.mandates,
      }),
      mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
    };
    return {
      session,
      student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
      payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
    };
  });
}

function cptLabelFromParts(codes: string[], procedures: string[], units: number): string {
  if (procedures.length) return procedures.join(', ');
  if (codes.length) return codes.map((c) => (units > 0 && codes.length === 1 ? `${c}x${units}` : c)).join(', ');
  return '';
}

/**
 * School-scoped due dates visible to the signed-in user (admins see all).
 * Optional programType further scopes to schools that have caseload kids in that program
 * (district/payer), so switching program type does not leak another school's progress dues.
 */
function dueDatesForUser(store: MemoryStore, user: AppUser, programType?: string) {
  const open = dueDateReport(store).filter((d) => d.status !== 'done');
  const pt = String(programType || '').trim();
  if (user.role === 'admin') {
    if (!pt) return open;
    const key = programTypeKey(pt);
    const schoolIds = new Set(
      store.data.students
        .filter((s) => programTypeKey(s.programType) === key)
        .map((s) => s.schoolId)
        .filter(Boolean),
    );
    return open.filter((d) => schoolIds.has(d.schoolId));
  }
  const provider = providerFor(store, user);
  if (!provider) return [];
  const myStudentIds = new Set(
    store.data.mandates.filter((m) => m.providerId === provider.id).map((m) => m.studentId),
  );
  const mySchoolIds = new Set(
    store.data.students.filter((s) => myStudentIds.has(s.id)).map((s) => s.schoolId),
  );
  let rows = open.filter((d) => mySchoolIds.has(d.schoolId));
  if (pt) {
    const scoped = schoolIdsForProviderProgramType(store, provider.id, pt);
    rows = rows.filter((d) => scoped.has(d.schoolId));
  }
  // Therapists only see reminders that matter to them now: overdue or due within the nag
  // window (14 days), and for per-child rows only children on their own caseload.
  // The full list stays on the admin Due dates report.
  const seenDueIds = new Set<string>();
  return rows.filter((d) => {
    const childId = String((d as { studentId?: string }).studentId || '').trim();
    if (childId && !myStudentIds.has(childId)) return false;
    if (!shouldNagDue({ completedAt: d.completedAt || '', dueOn: d.dueOn })) return false;
    // One banner line per due date (reports expand it once per child).
    if (seenDueIds.has(d.id)) return false;
    seenDueIds.add(d.id);
    return true;
  });
}

function linkUserToProvider(store: MemoryStore, userId: string, providerId: string): void {
  const user = store.userById(userId);
  if (user) store.upsertUser({ ...user, providerId });
  const provider = store.data.providers.find((p) => p.id === providerId);
  if (provider) store.upsertProvider({ ...provider, userId });
}

function parseDiscipline(raw: unknown, fallback: Discipline = 'PT'): Discipline {
  const d = String(raw || fallback);
  return ['OT', 'PT', 'SLP'].includes(d) ? (d as Discipline) : fallback;
}

function therapistDisplayName(b: Record<string, unknown>, email: string): string {
  const fromParts = `${String(b.firstName || '')} ${String(b.lastName || '')}`.trim();
  return String(b.displayName || fromParts || email).trim() || email;
}

function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Create Cognito invite (best-effort) + AppUser + Provider and link both ways. Links existing login by email. */
async function upsertTherapistAsProvider(
  store: MemoryStore,
  b: Record<string, unknown>,
): Promise<{ user: AppUser; provider: ReturnType<MemoryStore['upsertProvider']>; createdUser: boolean }> {
  const email = String(b.email || '').trim().toLowerCase();
  if (!email) throw new Error('Email is required.');
  const displayName = therapistDisplayName(b, email);
  const fromDisplay = splitDisplayName(displayName);
  const firstName = String(b.firstName || fromDisplay.firstName || '').trim();
  const lastName = String(b.lastName || fromDisplay.lastName || '').trim();
  const discipline = parseDiscipline(b.discipline);
  const hhaCaregiverCode = String(b.hhaCaregiverCode || '');

  let user = store.userByEmail(email);
  let createdUser = false;
  if (user?.role === 'admin') {
    throw new Error('That login is an admin. Create a separate therapist account or demote them first.');
  }
  if (!user) {
    let cognitoSub = `invite-${email}`;
    try {
      cognitoSub = await inviteTherapist(email, displayName, 'therapist');
    } catch {
      cognitoSub = `invite-${email}`;
    }
    user = store.upsertUser({
      id: newId(),
      cognitoSub,
      email,
      role: 'therapist',
      displayName,
      providerId: '',
      active: true,
      createdAt: nowIso(),
    });
    createdUser = true;
  } else {
    user = store.upsertUser({
      ...user,
      displayName: displayName || user.displayName,
      role: 'therapist',
      active: true,
    });
  }

  let provider = providerFor(store, user);
  if (!provider) {
    // Prefer adopting a same-name orphan instead of creating a linked twin.
    const byName = findProviderByName(
      store.data.providers,
      `${firstName} ${lastName}`.trim() || displayName,
    );
    if (byName && isOrphanProvider(store, byName)) {
      provider = store.upsertProvider({
        ...byName,
        userId: user.id,
        firstName: firstName || byName.firstName,
        lastName: lastName || byName.lastName,
        discipline: b.discipline != null && String(b.discipline) ? discipline : byName.discipline,
        ...providerPayFields(b, byName),
        hhaCaregiverCode:
          b.hhaCaregiverCode === undefined ? byName.hhaCaregiverCode : hhaCaregiverCode,
        active: true,
      });
    } else {
      provider = store.upsertProvider({
        id: newId(),
        userId: user.id,
        firstName,
        lastName,
        discipline,
        ...providerPayFields(b),
        hhaCaregiverCode,
        active: true,
        createdAt: nowIso(),
      });
    }
  } else {
    provider = store.upsertProvider({
      ...provider,
      firstName: firstName || provider.firstName,
      lastName: lastName || provider.lastName,
      discipline: b.discipline != null && String(b.discipline) ? discipline : provider.discipline,
      ...providerPayFields(b, provider),
      hhaCaregiverCode:
        b.hhaCaregiverCode === undefined ? provider.hhaCaregiverCode : hhaCaregiverCode,
      active: true,
      userId: user.id,
    });
  }
  linkUserToProvider(store, user.id, provider.id);
  // Drop empty / merged orphan duplicates left after linking.
  purgeOrphanProviders(store);
  return {
    user: store.userById(user.id)!,
    provider: store.data.providers.find((p) => p.id === provider!.id)!,
    createdUser,
  };
}

function visibleStudents(
  store: MemoryStore,
  user: AppUser,
  weekStart: string,
  schoolId?: string,
  programType?: string,
): Student[] {
  if (user.role === 'admin') {
    let all = store.data.students.filter((s) => !isNoChildPlaceholderName(s));
    const pt = String(programType || '').trim();
    if (pt) {
      const key = programTypeKey(pt);
      all = all.filter((s) => programTypeKey(s.programType) === key);
    } else if (schoolId) {
      all = all.filter((s) => s.schoolId === schoolId);
    }
    return all;
  }
  const provider = providerFor(store, user);
  const providerId = provider?.id || '';
  const mandated = new Set(
    store.data.mandates
      .filter((m) => !!providerId && m.providerId === providerId)
      .map((m) => m.studentId),
  );
  const weekRows = weekStart ? weeksForProviderStart(store, providerId, weekStart) : [];
  const fromWeek = new Set(
    weekRows.flatMap((w) => store.sessionsForWeek(w.id).map((s) => s.studentId)),
  );
  let students = store.data.students.filter(
    (s) => (mandated.has(s.id) || fromWeek.has(s.id)) && !isNoChildPlaceholderName(s),
  );
  const pt = String(programType || '').trim();
  // Prefer program-type scope (district/payer) over building-level schoolId.
  if (pt) {
    const key = programTypeKey(pt);
    students = students.filter((s) => programTypeKey(s.programType) === key);
  } else if (schoolId) {
    students = students.filter((s) => s.schoolId === schoolId);
  }
  return students;
}

function pickStr(v: unknown, fallback: string): string {
  return v != null ? String(v) : fallback;
}

function parseNoteTags(b: Record<string, unknown>, existing: string[] = []): string[] {
  if (b.tags === undefined) return existing;
  const raw = b.tags;
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(',')
        .map((t) => t.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const s = String(t || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function parseMandateKind(raw: unknown, fallback: MandateKind = 'regular'): MandateKind {
  const v = String(raw || fallback);
  if (v === 'makeup_auth') return 'makeup_auth';
  if (v === 'makeup_weekly') return 'makeup_weekly';
  return 'regular';
}

function parseNullableNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Prefer `payRatePerHour`; accept legacy `payRate` as alias for per-hour. */
function resolvePayRatePerHour(
  b: Record<string, unknown>,
  existing: number | null | undefined,
): number | null {
  if (b.payRatePerHour !== undefined) return parseNullableNumber(b.payRatePerHour);
  if (b.payRate !== undefined) return parseNullableNumber(b.payRate);
  return existing ?? null;
}

function resolveOptionalPayField(
  b: Record<string, unknown>,
  key: string,
  existing: number | null | undefined,
): number | null {
  if (b[key] !== undefined) return parseNullableNumber(b[key]);
  return existing ?? null;
}

function providerPayFields(
  b: Record<string, unknown>,
  existing?: Partial<ReturnType<typeof blankProviderPay>> & { payRatePerHour?: number | null },
) {
  const payKeys = [
    'payRate30Min',
    'payRate42Min',
    'payRate45Min',
    'payRateGroup15Min',
    'payRateGroup30Min',
    'payRateGroup42Min',
    'payRateGroup45Min',
    'payRateEval',
    'payRateAdditionalHourly',
  ] as const;
  const out = {
    ...blankProviderPay(),
    payRatePerHour: resolvePayRatePerHour(b, existing?.payRatePerHour),
  };
  for (const key of payKeys) {
    out[key] = resolveOptionalPayField(b, key, existing?.[key]);
  }
  if (b.payRateAdditionalServices !== undefined && b.payRateAdditionalHourly === undefined) {
    out.payRateAdditionalHourly = parseNullableNumber(b.payRateAdditionalServices);
  }
  return out;
}

function pdfBufferFromBody(b: Record<string, unknown>): Buffer | null {
  const raw = typeof b.pdfBase64 === 'string' ? b.pdfBase64.trim() : '';
  if (!raw) return null;
  return Buffer.from(raw.replace(/^data:application\/pdf;base64,/, ''), 'base64');
}

function anyFileBufferFromBody(b: Record<string, unknown>): Buffer | null {
  const pdf = pdfBufferFromBody(b);
  if (pdf) return pdf;
  const raw = typeof b.fileBase64 === 'string' ? b.fileBase64.trim() : '';
  if (!raw) return null;
  return Buffer.from(raw.replace(/^data:[^;]+;base64,/, ''), 'base64');
}

function xlsxResponse(filename: string, buf: Buffer): HttpResponse {
  return {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filename}"`,
    },
    body: buf,
  };
}

function reportRange(query: Record<string, string | undefined>) {
  return { from: String(query.from || '').trim(), to: String(query.to || '').trim() };
}

function reportXlsxWeekProgress(
  store: MemoryStore,
  query: Record<string, string | undefined>,
): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = weekProgressReport(store, { from, to });
  return xlsxResponse(
    'sessions-notes-progress.xlsx',
    rowsToXlsxBuffer(
      'Sessions & notes',
      [
        'Child',
        'Provider',
        'School',
        'Service type',
        'Week',
        'Mandate expected',
        'Sessions delivered',
        'Sessions delivered %',
        'Notes posted',
        'Notes posted %',
        'Below mandate',
      ],
      rows.map((r) => [
        r.childName,
        r.providerName,
        r.schoolName,
        r.mandateLabel,
        r.weekLabel,
        r.mandateExpected,
        r.sessionsProvided,
        r.sessionsDeliveredPct,
        r.notesPosted,
        r.notesPostedPct,
        r.belowMandate ? 'yes' : 'no',
      ]),
    ),
  );
}

function reportXlsxMissing(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = missingNotes(store, undefined, { from, to, includeMissed: true });
  return xlsxResponse(
    'missing-notes.xlsx',
    rowsToXlsxBuffer(
      'Note follow-ups',
      ['Child', 'Date', 'Week', 'Attendance', 'Reason', 'Notes'],
      rows.map((r) => [r.studentName, r.date, r.weekStart || r.weekId, r.attendance, r.reason, r.notes]),
    ),
  );
}

function reportXlsxLastService(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const providerId = String(query.providerId || '').trim();
  const rows = lastServiceByStudent(store, { providerId: providerId || undefined });
  return xlsxResponse(
    'last-service.xlsx',
    rowsToXlsxBuffer(
      'Last service',
      ['Child', 'Provider', 'School', 'Last DOS'],
      rows.map((r) => [r.name, r.providerName, r.schoolName, r.lastDos]),
    ),
  );
}

function reportXlsxDueDates(store: MemoryStore, query: Record<string, string | undefined>): HttpResponse {
  const { from, to } = reportRange(query);
  const rows = dueDateReport(store, new Date(), {
    from,
    to,
    excludeCompleted: true,
    expandSchoolWide: true,
  });
  return xlsxResponse(
    'due-dates.xlsx',
    rowsToXlsxBuffer(
      'Due dates',
      ['District', 'Child', 'Provider', 'Type', 'Due Date', 'Notes', 'Status'],
      rows.map((r) => [
        r.districtName || r.schoolName,
        r.studentName || '',
        r.providerName || '',
        r.kind,
        r.dueOn,
        r.notes || '',
        r.status,
      ]),
    ),
  );
}

function reportXlsxInternalNotes(
  store: MemoryStore,
  query: Record<string, string | undefined>,
): HttpResponse {
  const { from, to } = reportRange(query);
  const providerId = String(query.providerId || '').trim();
  const rows = adminInternalNotesReport(store, {
    from,
    to,
    providerId: providerId || undefined,
  });
  return xlsxResponse(
    'internal-notes.xlsx',
    rowsToXlsxBuffer(
      'Internal notes',
      ['When', 'On', 'Name', 'Author', 'Tags', 'Note'],
      rows.map((r) => [
        String(r.createdAt || '').slice(0, 16).replace('T', ' '),
        r.subjectKind === 'child' ? 'Child' : 'Provider',
        r.subjectName,
        r.authorName,
        (r.tags || []).join(', '),
        r.body,
      ]),
    ),
  );
}

function reportXlsxHhaTransfers(
  store: MemoryStore,
  query: Record<string, string | undefined>,
): HttpResponse {
  const report = hhaTransfersReport(store, reportRange(query));
  if (!report.ok) return json(400, { error: report.error });
  return xlsxResponse(
    'hha-transfers.xlsx',
    rowsToXlsxBuffer(
      'HHA transfers',
      [
        'Transfer date/time (ET)',
        'VisitID',
        'Child',
        'Provider',
        'District/program',
        'School',
        'Date of service',
        'Time',
        'Attendance',
        'Service',
        'HHA status',
      ],
      report.rows.map((r) => [
        r.transferAtDisplay,
        r.visitId,
        r.childName,
        r.providerName,
        r.district,
        r.schoolName,
        r.dateOfService,
        r.time,
        r.attendance,
        r.service,
        r.hhaStatus,
      ]),
    ),
  );
}

function reportXlsxSessionNotes(
  store: MemoryStore,
  query: Record<string, string | undefined>,
): HttpResponse {
  const { from, to } = reportRange(query);
  const providerId = String(query.providerId || '').trim();
  const district = String(query.district || '').trim();
  const report = sessionNotesReport(store, {
    from,
    to,
    providerId: providerId || undefined,
    district: district || undefined,
  });
  const t = report.totals;
  return xlsxResponse(
    'session-notes.xlsx',
    rowsToXlsxBuffer(
      'Session notes',
      [
        'Child',
        'Provider',
        'School',
        'District',
        'Date of service',
        'Attendance',
        'Begin',
        'End',
        'Note posted',
        'Attended total',
        'Missed total',
        'Sessions total',
      ],
      report.rows.map((r, i) => [
        r.childName,
        r.providerName,
        r.schoolName,
        r.district,
        r.dateOfService,
        r.attendance,
        r.beginTime,
        r.endTime,
        r.notesPosted ? 'yes' : 'no',
        i === 0 ? t.attended : '',
        i === 0 ? t.missed : '',
        i === 0 ? t.total : '',
      ]),
    ),
  );
}

export type TmsRequestDeps = {
  hha?: HhaClient;
  mail?: Mailer;
  /** Flush in-memory store to durable state mid-request (e.g. before slow Cognito MFA clear). */
  persistNow?: () => Promise<void>;
  /** Fresh Dynamo (or store) settings row — used to avoid stale requireMfa clobbers. */
  readLiveSettings?: () => Promise<AppSettings | null | undefined>;
  /** Test seam. Production uses Bedrock invokeClaudeText. */
  explainBlockReport?: (prompt: string) => Promise<string>;
  /** Test seam for Luna reading a disputed notes PDF. Production uses Bedrock. */
  readLunaNote?: (prompt: string) => Promise<string>;
  /** Test seam. Production uses the reports bucket. */
  blockReportFiles?: BlockReportFileStore;
};

function auditBlockReport(report: BlockErrorReport) {
  const { pdfToken: _token, pendingText: _pending, ...rest } = report;
  return rest;
}

async function saveBlockReportPdf(key: string, body: Buffer, deps: TmsRequestDeps): Promise<void> {
  if (deps.blockReportFiles) {
    await deps.blockReportFiles.put(key, body);
    return;
  }
  await putReportPdf(key, body);
}

async function readBlockReportPdf(key: string, deps: TmsRequestDeps): Promise<Buffer | null> {
  if (deps.blockReportFiles) return deps.blockReportFiles.get(key);
  return getPdfFromS3(key);
}

function blockReportPdfResponse(bytes: Buffer, fileName: string): HttpResponse {
  const raw = String(fileName || '').trim() || 'therapist-report.pdf';
  const cleaned = raw.replace(/[^\w.\-]+/g, '_') || 'therapist-report.pdf';
  const safeName = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
  return {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${safeName}"`,
    },
    body: bytes,
  };
}

async function handleBlockReportRoutes(
  store: MemoryStore,
  req: HttpRequest,
  path: string,
  ctx: AuthContext,
  deps: TmsRequestDeps,
): Promise<HttpResponse | null> {
  const decision = path.match(/^\/block-reports\/([^/]+)\/decision$/);
  const reportFile = path.match(/^\/block-reports\/([^/]+)\/file$/);
  if (req.method === 'GET' && reportFile) {
    const report = (store.data.blockReports || []).find((row) => row.id === reportFile[1]);
    if (!report || !String(report.pdfKey || '').trim()) {
      return json(404, { error: 'Report PDF not found.' });
    }
    const provider = providerFor(store, ctx.user);
    const owns =
      ctx.user.role === 'admin' ||
      report.therapistUserId === ctx.user.id ||
      Boolean(provider?.id && report.providerId === provider.id);
    if (!owns) return json(403, { error: 'You can only open your own report PDF.' });
    const bytes = await readBlockReportPdf(report.pdfKey, deps);
    if (!bytes?.length) return json(404, { error: 'Report PDF not found.' });
    return blockReportPdfResponse(bytes, report.fileName || 'therapist-report.pdf');
  }
  if (req.method === 'GET' && path === '/block-reports') {
    const provider = providerFor(store, ctx.user);
    const rows = (store.data.blockReports || []).filter((row) => {
      if (ctx.user.role === 'admin') return true;
      return row.therapistUserId === ctx.user.id || (provider?.id && row.providerId === provider.id);
    });
    return json(200, {
      reports: rows
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(blockReportPublic),
    });
  }

  if (req.method === 'POST' && path === '/block-reports') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    let providerId = String(b.providerId || provider?.id || '');
    if (ctx.user.role !== 'admin' && provider?.id && provider.id !== providerId) {
      return json(403, { error: 'You can only report an error on your own upload.' });
    }
    if (ctx.user.role !== 'admin' && provider?.id) providerId = provider.id;
    const account = store.data.providers.find((p) => p.id === providerId);
    if (!account) return json(404, { error: 'Provider not found.' });
    const pendingFromFile = (pdfTextFromBody(b) || textBody(req) || String(b.pdfText || '')).trim();
    const notesPdfEarly = notesPdfBytes(b.pdfBase64);
    const noteUnreadable = Boolean(notesPdfEarly) && !pendingFromFile;
    const pendingText = pendingFromFile || (noteUnreadable
      ? 'The notes PDF was attached but its text could not be read.'
      : '');
    const noteExcerpt = notesPdfEarly && pendingFromFile ? pendingFromFile.slice(0, 4000) : '';
    const providerName = `${account.firstName || ''} ${account.lastName || ''}`.trim();
    try {
      const errors = (Array.isArray(b.errors) ? b.errors : [])
        .map((row) => String(row || '').trim())
        .filter(Boolean);
      const therapistMessage = String(b.message ?? b.therapistMessage ?? '').trim();
      if (!therapistMessage) {
        return json(400, { error: 'Write a message explaining why this error is wrong.' });
      }
      if (!errors.length) return json(400, { error: 'Report the error text that is on screen.' });
      if (!pendingText) {
        return json(400, {
          error: 'The blocked file could not be held. Import the PDF again, then report the error.',
        });
      }
      const summary = summarizeBlockedRows(errors);
      const polished = await polishBlockReportExplanation(
        {
          errors,
          therapistMessage,
          providerName,
          childSummary: summary.childSummary,
          dateSummary: summary.dateSummary,
          noteExcerpt,
          noteUnreadable,
        },
        deps.explainBlockReport
          ? (prompt) => deps.explainBlockReport!(prompt)
          : (prompt) => invokeClaudeText(prompt, 1200, 12000),
      );
      let report = buildPendingBlockReport({
        id: newId(),
        createdAt: nowIso(),
        providerId,
        providerName,
        therapistUserId: ctx.user.id,
        therapistName: ctx.user.displayName || ctx.user.email,
        therapistEmail: ctx.user.email,
        therapistMessage: b.message ?? b.therapistMessage,
        errors: b.errors,
        fileName: String(b.fileName || b.filename || ''),
        schoolId: String(b.schoolId || ''),
        programType: String(b.programType || ''),
        pendingText,
        aiExplanation: polished.aiExplanation,
        aiExplanationStatus: polished.aiExplanationStatus,
      });
      const notesPdf = notesPdfBytes(b.pdfBase64);
      if (notesPdf) {
        const pdfKey = blockReportPdfKey(report.id);
        await saveBlockReportPdf(pdfKey, notesPdf, deps);
        report = withReportPdf(report, { pdfKey, pdfToken: newBlockReportPdfToken() });
      }
      store.upsertBlockReport(report);
      store.audit(ctx.user.id, 'block_report_open', `blockReport:${report.id}`, null, {
        errors: report.errors,
        providerId: report.providerId,
        aiExplanationStatus: report.aiExplanationStatus,
        pdfKey: report.pdfKey || '',
      });
      let emailed = false;
      if (deps.mail) {
        try {
          const letter = buildBilluBlockReportEmail(report);
          await deps.mail.send({ to: letter.to, subject: letter.subject, text: letter.text });
          emailed = true;
        } catch {
          emailed = false;
        }
      }
      return json(200, { ok: true, report: blockReportPublic(report), emailed, pending: true });
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 400;
      return json(status, { error: err instanceof Error ? err.message : 'Could not file the report.' });
    }
  }

  if (req.method === 'POST' && decision) {
    if (ctx.user.role !== 'admin') return json(403, { error: 'Only an admin can review this report.' });
    const report = (store.data.blockReports || []).find((row) => row.id === decision[1]);
    if (!report) return json(404, { error: 'Report not found.' });
    if (report.status === 'luna') {
      return json(400, { error: 'Luna already saved this upload. It is not a Billu override.' });
    }
    const b = obj(req);
    const action = String(b.action || '').trim().toLowerCase();
    if (action !== 'allow' && action !== 'decline') {
      return json(400, { error: 'Choose allow or decline.' });
    }
    if (action === 'decline') {
      try {
        const next = declineBlockReport(report, {
          note: b.note,
          actorId: ctx.user.id,
          actorName: ctx.user.displayName || ctx.user.email,
          actorEmail: ctx.user.email,
          at: nowIso(),
        });
        store.upsertBlockReport(next);
        store.audit(ctx.user.id, 'block_report_decline', `blockReport:${next.id}`, auditBlockReport(report), {
          billuNote: next.billuNote,
          pdfKey: next.pdfKey || '',
        });
        return json(200, { ok: true, report: blockReportPublic(next) });
      } catch (err) {
        const status = Number((err as { status?: number }).status) || 400;
        return json(status, { error: err instanceof Error ? err.message : 'Could not decline the report.' });
      }
    }
    if (report.status === 'allowed' && report.overrideNotifiedAt) {
      return json(200, { ok: true, report: blockReportPublic(report), duplicate: true });
    }
    let decided = report;
    try {
      decided = allowBlockReport(report, {
        note: b.note,
        actorId: ctx.user.id,
        actorName: ctx.user.displayName || ctx.user.email,
        actorEmail: ctx.user.email,
        at: nowIso(),
      });
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 400;
      return json(status, { error: err instanceof Error ? err.message : 'Could not allow the report.' });
    }
    if (!report.importedAt) {
      store.upsertBlockReport(decided);
      const uploaded = await handleTmsRequest(
        store,
        {
          method: 'POST',
          path: '/week/upload-sessions',
          headers: req.headers,
          query: {},
          body: {
            providerId: decided.providerId,
            pdfText: decided.pendingText,
            fileName: decided.fileName,
            schoolId: decided.schoolId,
            programType: decided.programType,
            blockReportId: decided.id,
          },
        },
        deps,
      );
      const uploadedBody = (uploaded.body || {}) as { ok?: boolean; errors?: string[]; error?: string };
      if (uploaded.status >= 400 || uploadedBody.ok !== true) {
        store.upsertBlockReport(report);
        return json(409, {
          error: uploadedBody.error || 'The upload is still blocked.',
          errors: uploadedBody.errors || [],
          report: blockReportPublic(report),
        });
      }
      decided = { ...decided, importedAt: nowIso() };
      store.upsertBlockReport(decided);
    }
    if (decided.overrideNotifiedAt) {
      return json(200, { ok: true, report: blockReportPublic(decided), duplicate: true });
    }
    let emailedOwner = false;
    if (deps.mail) {
      try {
        const letter = buildMosheOverrideEmail(decided);
        await deps.mail.send({ to: letter.to, subject: letter.subject, text: letter.text });
        emailedOwner = true;
        decided = markOverrideNotified(decided, nowIso());
        store.upsertBlockReport(decided);
      } catch {
        emailedOwner = false;
        store.upsertBlockReport(decided);
      }
    } else {
      store.upsertBlockReport(decided);
    }
    store.audit(ctx.user.id, 'block_report_allow', `blockReport:${decided.id}`, auditBlockReport(report), {
      billuNote: decided.billuNote,
      errors: decided.errors,
      therapistMessage: decided.therapistMessage,
      importedAt: decided.importedAt,
      pdfKey: decided.pdfKey || '',
    });
    return json(200, { ok: true, report: blockReportPublic(decided), emailedOwner });
  }

  return null;
}

export async function handleTmsRequest(
  store: MemoryStore,
  req: HttpRequest,
  deps: TmsRequestDeps = {},
): Promise<HttpResponse> {
  if (req.method === 'OPTIONS') return { status: 204, body: '' };
  const path = req.path.replace(/\/+$/, '') || '/';

  if (req.method === 'POST' && path === '/webhooks/esign') {
    // SignNow Webhooks 2.0 with docid_queryparam=true puts document_id on the query string.
    const queryDoc = String(
      req.query.document_id || req.query.documentId || req.query.docid || '',
    ).trim();
    const body = obj(req);
    const parsed = envelopeCompleted({
      ...body,
      document_id: body.document_id || body.documentId || queryDoc,
      documentId: body.documentId || body.document_id || queryDoc,
    });
    const envelopeId = parsed.envelopeId || queryDoc;
    if (!parsed.completed || !envelopeId) {
      console.info('[tms-esign] webhook ignored', {
        envelopeId: envelopeId || null,
        queryDoc: queryDoc || null,
        completed: parsed.completed,
      });
      return json(202, { ok: true, ignored: true });
    }
    const week = store.data.weeks.find(
      (w) => w.envelopeId === envelopeId || w.id === envelopeId.replace(/^email:/, ''),
    );
    if (!week) return json(404, { error: 'Envelope week not found.' });

    // Locker #38: refuse to lock if any session still lacks a required no-peer note.
    const lockSessions = store.sessionsForWeek(week.id);
    const lockSoloErrors: string[] = [];
    for (const s of lockSessions) {
      if (isAdditionalServiceType(s.additionalServiceType || '')) continue;
      const dayPeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        week.providerId,
        s.dateOfService,
        s.id,
      );
      const soloNoteErr = soloGroupMandateNoteError({
        notes: s.notes,
        serviceType: s.serviceType,
        cptCodes: s.cptCodes,
        studentId: s.studentId,
        attendance: s.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) {
        const who = studentNameById(store).get(s.studentId) || s.studentId;
        lockSoloErrors.push(`${s.dateOfService} ${who}: ${soloNoteErr}`);
      }
    }
    if (lockSoloErrors.length) {
      console.warn('[tms-esign] lock refused — solo-group note locker', {
        weekId: week.id,
        envelopeId,
        errors: lockSoloErrors,
      });
      return json(400, {
        error: lockSoloErrors[0],
        errors: lockSoloErrors,
        locked: false,
      });
    }

    const signedKey = `tms/signed/${week.id}.pdf`;
    const timesheetKey = week.timesheetKey || `tms/timesheets/${week.id}.pdf`;
    let signedPdfOk = false;
    try {
      const bytes = await downloadSignedDocument(envelopeId);
      if (bytes?.length) {
        const buf = Buffer.from(bytes);
        await putLockerPdf(signedKey, buf);
        // Also mirror into timesheets/ so older archive rows that still point there stay wet-ink.
        if (timesheetKey && timesheetKey !== signedKey) {
          await putLockerPdf(timesheetKey, buf);
        }
        // Index wet-ink under signedKey so Admin/Therapist archive Open always finds the signed PDF.
        const existingTs = findTimesheetArchive(store, week.id);
        await persistArchivePdf({
          store,
          kind: 'timesheet',
          sourceType: 'timesheet',
          userId: 'esign',
          providerId: week.providerId,
          weekId: week.id,
          weekStart: week.weekStart,
          filename: `timesheet-${week.weekStart}-signed.pdf`,
          s3Key: signedKey,
          status: 'locked',
          pdf: buf,
          replaceId: existingTs?.id,
        });
        signedPdfOk = true;
        console.info('[tms-esign] signed PDF stored', {
          weekId: week.id,
          envelopeId,
          bytes: buf.length,
          signedKey,
          timesheetKey,
        });
      } else {
        console.warn('[tms-esign] signed PDF download empty', { weekId: week.id, envelopeId });
      }
    } catch (err) {
      console.warn(
        '[tms-esign] signed PDF download failed',
        err instanceof Error ? err.message : err,
        { weekId: week.id, envelopeId },
      );
    }

    const locked = store.upsertWeek({
      ...week,
      status: 'locked',
      signatureRequestStatus: 'completed',
      signatureRequestAt: nowIso(),
      timesheetKey,
      signedKey: signedPdfOk ? signedKey : week.signedKey || '',
    });
    // Always ensure a timesheet archive row exists for locked weeks (submit may have been
    // before archives existed, or SignNow download may have failed this pass).
    if (!signedPdfOk) {
      const existingTs = findTimesheetArchive(store, week.id);
      if (!existingTs) {
        await persistArchivePdf({
          store,
          kind: 'timesheet',
          sourceType: 'timesheet',
          userId: 'esign',
          providerId: week.providerId,
          weekId: week.id,
          weekStart: week.weekStart,
          filename: `timesheet-${week.weekStart}.pdf`,
          s3Key: week.signedKey || signedKey || timesheetKey,
          status: 'locked',
        });
      }
    }
    markTimesheetArchivesStatus(store, week.id, 'locked');
    store.audit('esign', 'sign_and_lock', `week:${week.id}`, week, {
      ...locked,
      signedPdfOk,
    });
    const provider = store.data.providers.find((p) => p.id === week.providerId);
    const therapist = provider ? store.userById(provider.userId) : undefined;
    if (deps.mail && therapist?.email) {
      await deps.mail.send({
        to: [therapist.email],
        subject: 'Timesheet signed and finalized',
        text: 'Your submission for this week has been signed and finalized. Payment will be processed accordingly.',
      });
    }
    // HHA transfer is NOT done on sign — only Wednesday auto-transfer or admin Send to HHA.
    return json(200, {
      week: store.data.weeks.find((w) => w.id === week.id),
      therapistMessage:
        'Your submission for this week has been signed and finalized. Payment will be processed accordingly.',
      signedPdfOk,
    });
  }

  if (req.method === 'POST' && path === '/internal/due-nags') {
    // Requires a configured key — without TMS_INTERNAL_KEY this HTTP route stays off.
    // The daily EventBridge job invokes the Lambda directly and does not pass through here.
    const key = process.env.TMS_INTERNAL_KEY || '';
    const provided = req.headers['x-tms-internal'] || obj(req).key;
    if (!key || provided !== key) return json(401, { error: 'Unauthorized nag job.' });
    if (!deps.mail) return json(503, { error: 'Mailer missing.' });
    const out = await runDueNags(store, deps.mail);
    return json(200, out);
  }

  if (req.method === 'POST' && path === '/internal/hha-error-digest') {
    const key = process.env.TMS_INTERNAL_KEY || '';
    const provided = req.headers['x-tms-internal'] || obj(req).key;
    if (!key || provided !== key) return json(401, { error: 'Unauthorized HHA digest job.' });
    if (!deps.mail) return json(503, { error: 'Mailer missing.' });
    const out = await runHhaErrorDigest(store, deps.mail);
    return json(200, out);
  }

  if (req.method === 'POST' && path === '/internal/hha-auto-transfer') {
    const key = process.env.TMS_INTERNAL_KEY || '';
    const provided = req.headers['x-tms-internal'] || obj(req).key;
    if (!key || provided !== key) return json(401, { error: 'Unauthorized HHA auto-transfer job.' });
    if (!deps.hha) return json(503, { error: 'HHA client is not configured.' });
    const out = await runHhaAutoTransfer(store, deps.hha, { actorId: 'hha-auto-transfer' });
    return json(200, out);
  }

  const luna = await handleLunaRoutes(store, req, path, deps);
  if (luna) return luna;

  const emailedPdf = path.match(/^\/block-reports\/([^/]+)\/file$/);
  if (req.method === 'GET' && emailedPdf && String(req.query.t || '').trim()) {
    const report = (store.data.blockReports || []).find((row) => row.id === emailedPdf[1]);
    const token = String(req.query.t || '').trim();
    if (
      !report ||
      !String(report.pdfKey || '').trim() ||
      !blockReportPdfTokenMatches(String(report.pdfToken || ''), token)
    ) {
      return json(404, { error: 'Report PDF not found.' });
    }
    const bytes = await readBlockReportPdf(report.pdfKey, deps);
    if (!bytes?.length) return json(404, { error: 'Report PDF not found.' });
    return blockReportPdfResponse(bytes, report.fileName || 'therapist-report.pdf');
  }

  const auth = await authenticate(store, req.headers);
  if ('error' in auth) return json(auth.status, { error: auth.error });
  const ctx = auth;

  const blockReportResponse = await handleBlockReportRoutes(store, req, path, ctx, deps);
  if (blockReportResponse) return blockReportResponse;

  if (req.method === 'GET' && path === '/me') {
    const provider = providerFor(store, ctx.user);
    const schools = provider ? schoolsForProvider(store, provider.id) : [];
    const programTypes = provider ? programTypesForProvider(store, provider.id) : [];
    const programType = String(req.query.programType || '').trim();
    return json(200, {
      user: ctx.user,
      provider,
      schools,
      programTypes,
      settings: {
        sessionImportAgeLockEnabled: getAppSettings(store).sessionImportAgeLockEnabled,
        sessionImportMaxAgeDays: getAppSettings(store).sessionImportMaxAgeDays,
        yellowWarningsBlockImport: getAppSettings(store).yellowWarningsBlockImport,
        allowImportWithHardBlocks: getAppSettings(store).allowImportWithHardBlocks === true,
        allowShortSessionVsMandate: getAppSettings(store).allowShortSessionVsMandate === true,
        // Exact stored boolean (appSettingsFromStore already defaults missing → true).
        requireMfa: getAppSettings(store).requireMfa === true,
        allowSmsMfa: getAppSettings(store).allowSmsMfa === true,
      },
      // Due-date reminders are listed (filtered) in dueDates; the school-wide due_* alert
      // rows would list every school's reports on a therapist's screen.
      alerts: store
        .openAlerts()
        .filter((a) => ctx.user.role === 'admin' || !String(a.kind || '').startsWith('due_'))
        .slice(0, 20),
      dueDates: dueDatesForUser(store, ctx.user, programType || undefined),
    });
  }

  if (req.method === 'GET' && path === '/archive') {
    const provider = providerFor(store, ctx.user);
    const providerId = provider?.id || '';
    if (!providerId && ctx.user.role !== 'admin') {
      return json(400, { error: 'No provider profile on this login.' });
    }
    const kind = String(req.query.kind || '').trim();
    const aliasIds = providerId ? providerLookupIds(store, providerId) : [];
    const source = providerId
      ? archivesForProviderIds(store.data.archives, aliasIds)
      : store.data.archives;
    let rows = filterArchives(source, {
      kind: kind === 'upload' || kind === 'timesheet' ? kind : '',
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
    });
    // Therapists only see successful imports — blocked attempts no longer clutter My uploads.
    if (kind === 'upload' || !kind) {
      rows = rows.filter((r) => r.kind !== 'upload' || r.status !== 'blocked');
    }
    return json(200, { items: rows.map((r) => archiveListItem(r, store)) });
  }

  if (req.method === 'GET' && path === '/admin/archive') {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    const kind = String(req.query.kind || '').trim();
    const rows = filterArchives(store.data.archives, {
      kind: kind === 'upload' || kind === 'timesheet' ? kind : '',
      providerId: String(req.query.providerId || ''),
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
    });
    return json(200, { items: rows.map((r) => archiveListItem(r, store)) });
  }

  if (req.method === 'GET' && /^\/archive\/[^/]+\/file$/.test(path)) {
    const id = path.split('/')[2];
    const row = store.archiveById(id);
    if (!row) return json(404, { error: 'Archive item not found.' });
    const provider = providerFor(store, ctx.user);
    const providerIds = provider?.id ? providerLookupIds(store, provider.id) : [];
    if (
      !canAccessArchive(row, {
        role: ctx.user.role,
        userId: ctx.user.id,
        providerId: provider?.id,
        providerIds,
      })
    ) {
      return json(403, { error: 'You can only open your own archived files.' });
    }
    if (!row.s3Key) return json(404, { error: 'No file stored for this archive item.' });
    const pdf = await loadArchiveFile(store, row);
    if (!pdf) return json(404, { error: 'Archived file missing from storage.' });
    const safeName = String(row.filename || 'archive.pdf').replace(/[^\w.\-]+/g, '_');
    const ctype = contentTypeForStoredFile(row.s3Key, row.filename);
    return {
      status: 200,
      headers: {
        'content-type': ctype,
        'content-disposition': `${ctype === 'application/pdf' ? 'inline' : 'attachment'}; filename="${safeName}"`,
      },
      body: pdf,
    };
  }

  if (req.method === 'POST' && path === '/archive/bundle') {
    const raw = obj(req).ids;
    const ids = [
      ...new Set(
        (Array.isArray(raw) ? raw : []).map((id) => String(id || '').trim()).filter(Boolean),
      ),
    ];
    const mode = String(obj(req).mode || '').trim();
    if (mode !== 'zip' && mode !== 'pdf') {
      return json(400, { error: 'Choose download or merge.' });
    }
    if (!ids.length) return json(400, { error: 'Select at least one file.' });
    if (ids.length > 40) return json(400, { error: 'Select up to 40 files at a time.' });
    const provider = providerFor(store, ctx.user);
    const providerIds = provider?.id ? providerLookupIds(store, provider.id) : [];
    const access = {
      role: ctx.user.role,
      userId: ctx.user.id,
      providerId: provider?.id,
      providerIds,
    };
    const picked: ArchiveRecord[] = [];
    for (const id of ids) {
      const row = store.archiveById(id);
      if (!row) return json(404, { error: 'Archive item not found.' });
      if (!canAccessArchive(row, access)) {
        return json(403, { error: 'You can only download your own archived files.' });
      }
      picked.push(row);
    }
    const ordered = sortArchivesByDate(picked);
    const loaded: Array<ArchiveRecord & { bytes: Buffer; providerName: string }> = [];
    const missing: string[] = [];
    for (const row of ordered) {
      const bytes = row.s3Key ? await loadArchiveFile(store, row) : null;
      if (!bytes?.length) {
        missing.push(row.filename || row.id);
        continue;
      }
      const who = store.data.providers.find((p) => p.id === row.providerId);
      loaded.push({
        ...row,
        bytes,
        providerName: who ? `${who.firstName} ${who.lastName}`.trim() : '',
      });
    }
    if (!loaded.length || missing.length) {
      return json(404, {
        error: `Archived file missing from storage: ${missing.join(', ')}. Leave those rows unchecked and try again.`,
      });
    }
    if (mode === 'pdf') {
      const notPdf = loaded.filter((row) => !isPdfBytes(row.bytes));
      if (notPdf.length) {
        const names = notPdf.map((row) => row.filename || row.id).join(', ');
        return json(400, {
          error: `Merge needs PDF files. Download the selected files to keep ${names}, or leave those rows unchecked.`,
        });
      }
      let merged: Buffer;
      try {
        merged = await mergePdfBuffers(loaded.map((row) => row.bytes));
      } catch (err) {
        console.warn('[tms-archive] merge failed', err instanceof Error ? err.message : err);
        return json(400, { error: 'One of the selected PDFs could not be combined. Download the files separately.' });
      }
      const filename = mergedArchiveFilename(loaded);
      return {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}"`,
        },
        body: merged,
      };
    }
    const used = new Set<string>();
    const files = loaded.map((row, index) => ({
      name: archiveDownloadName(row, index, used),
      data: row.bytes,
    }));
    const starts = sortArchivesByDate(loaded)
      .map((row) => String(row.weekStart || row.createdAt || '').slice(0, 10))
      .filter(Boolean);
    const span =
      starts.length === 0
        ? 'selected'
        : starts[0] === starts[starts.length - 1]
          ? starts[0]
          : `${starts[0]}-to-${starts[starts.length - 1]}`;
    return {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="archive-${span}.zip"`,
      },
      body: zipStoredFiles(files),
    };
  }

  if (req.method === 'DELETE' && /^\/archive\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const row = store.archiveById(id);
    if (!row) return json(404, { error: 'Archive item not found.' });
    const provider = providerFor(store, ctx.user);
    const providerIds = provider?.id ? providerLookupIds(store, provider.id) : [];
    if (
      !canAccessArchive(row, {
        role: ctx.user.role,
        userId: ctx.user.id,
        providerId: provider?.id,
        providerIds,
      })
    ) {
      return json(403, { error: 'You can only delete your own archived files.' });
    }
    if (row.s3Key) await deletePdfFromS3(row.s3Key);
    store.removeArchive(id);
    store.audit(ctx.user.id, 'delete_archive', `archive:${id}`, null, {
      kind: row.kind,
      providerId: row.providerId,
      filename: row.filename,
      weekStart: row.weekStart,
    });
    return json(200, { ok: true, id });
  }

  if (req.method === 'GET' && path === '/dashboard') {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    return json(200, dashboard(store));
  }

  const adminUser = async (
    fn: (c: AuthContext) => Promise<HttpResponse> | HttpResponse,
  ): Promise<HttpResponse> => {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    return fn(ctx);
  };

  if (req.method === 'GET' && path === '/admin/settings') {
    return adminUser(async () => {
      // Prefer strongly consistent live row when available (Scan hydrate can lag).
      if (deps.readLiveSettings) {
        try {
          const live = await deps.readLiveSettings();
          if (live) {
            upsertAppSettings(store, live);
            return json(200, { settings: live });
          }
        } catch (err) {
          console.error('[tms-api] readLiveSettings on GET /admin/settings failed', err);
        }
      }
      return json(200, { settings: getAppSettings(store) });
    });
  }

  if (req.method === 'POST' && path === '/admin/settings') {
    return adminUser(async () => {
      const b = obj(req);
      // Re-read live settings immediately before merge. Concurrent writers (age-lock /
      // yellow / MFA) load a snapshot at request start; a stale requireMfa:true in that
      // snapshot was overwriting a just-saved requireMfa:false on the next settings PUT.
      const memPrev = getAppSettings(store);
      let livePrev = memPrev;
      if (deps.readLiveSettings) {
        try {
          const live = await deps.readLiveSettings();
          if (live) livePrev = live;
        } catch (err) {
          console.error('[tms-api] readLiveSettings failed; using in-memory settings', err);
        }
      }
      const prev = livePrev;
      const bodyRequireMfa = coerceOptionalBool(b.requireMfa);
      const bodyAgeLock = coerceOptionalBool(b.sessionImportAgeLockEnabled);
      const bodyYellow = coerceOptionalBool(b.yellowWarningsBlockImport);
      const bodyHardLocker = coerceOptionalBool(b.allowImportWithHardBlocks);
      const bodyShortLocker = coerceOptionalBool(b.allowShortSessionVsMandate);
      const next = upsertAppSettings(store, {
        ...prev,
        sessionImportAgeLockEnabled:
          bodyAgeLock !== undefined ? bodyAgeLock : prev.sessionImportAgeLockEnabled,
        sessionImportMaxAgeDays:
          Number(b.sessionImportMaxAgeDays) > 0
            ? Math.floor(Number(b.sessionImportMaxAgeDays))
            : prev.sessionImportMaxAgeDays,
        yellowWarningsBlockImport:
          bodyYellow !== undefined ? bodyYellow : prev.yellowWarningsBlockImport,
        // Lockers default OFF; only an explicit bool from the admin turns them on.
        allowImportWithHardBlocks:
          bodyHardLocker !== undefined ? bodyHardLocker : prev.allowImportWithHardBlocks === true,
        allowShortSessionVsMandate:
          bodyShortLocker !== undefined ? bodyShortLocker : prev.allowShortSessionVsMandate === true,
        // Only apply requireMfa when the client explicitly sends a bool-ish value — never invent true.
        // String "false" must not fall through to prev (was sticky ON behind some proxies).
        requireMfa: bodyRequireMfa !== undefined ? bodyRequireMfa : prev.requireMfa,
        // Moshe decision: SMS MFA stays off — ignore client attempts to enable.
        allowSmsMfa: false,
        unlockedWeekIds: Array.isArray(b.unlockedWeekIds)
          ? b.unlockedWeekIds.map(String)
          : prev.unlockedWeekIds,
        unlockedProviderIds: Array.isArray(b.unlockedProviderIds)
          ? b.unlockedProviderIds.map(String)
          : prev.unlockedProviderIds,
      });
      store.audit(ctx.user.id, 'update_settings', 'settings:global', memPrev, next);
      // Persist requireMfa OFF *before* any Cognito work so Advanced/login never see sticky ON.
      if (deps.persistNow) {
        try {
          await deps.persistNow();
        } catch (err) {
          console.error('[tms-api] persist settings before MFA clear failed', err);
          return json(500, {
            error: 'Could not save MFA policy. Try again.',
            settings: next,
          });
        }
      }
      // Cognito OPTIONAL MFA still challenges users with PreferredMfaSetting.
      // Fire-and-forget clear so Netlify's proxy always gets requireMfa:false quickly.
      let mfaClear:
        | { cleared: number; errors: number; skipped: boolean; pending?: boolean; error?: string }
        | undefined;
      if (next.requireMfa === false) {
        mfaClear = { cleared: 0, errors: 0, skipped: false, pending: true };
        void clearAllCognitoMfaPreferences()
          .then((result) => {
            store.audit(ctx.user.id, 'clear_cognito_mfa', 'cognito:pool', prev.requireMfa, result);
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[tms-api] clear Cognito MFA after requireMfa=false failed', err);
            store.audit(ctx.user.id, 'clear_cognito_mfa_failed', 'cognito:pool', prev.requireMfa, {
              cleared: 0,
              errors: 1,
              skipped: false,
              error: message,
            });
          });
      }
      return json(200, { settings: next, mfaClear });
    });
  }

  if (req.method === 'POST' && path === '/admin/therapists') {
    return adminUser(async () => {
      const b = obj(req);
      // Always therapist — ignore any role from the client body.
      try {
        const out = await upsertTherapistAsProvider(store, { ...b, role: 'therapist' });
        store.audit(ctx.user.id, 'upsert_therapist', `user:${out.user.id}`, null, {
          user: out.user,
          provider: out.provider,
        });
        return json(out.createdUser ? 201 : 200, {
          user: out.user,
          provider: out.provider,
          message: out.createdUser
            ? 'Therapist created and linked as provider. They will get a Cognito invite when the user pool is configured.'
            : 'Existing login linked to therapist (provider) profile.',
        });
      } catch (err) {
        return json(400, { error: err instanceof Error ? err.message : 'Could not create therapist.' });
      }
    });
  }

  if (req.method === 'POST' && path === '/admin/users') {
    return adminUser(async () => {
      const b = obj(req);
      const email = String(b.email || '').trim().toLowerCase();
      const role = b.role === 'admin' ? 'admin' : 'therapist';
      if (!email) return json(400, { error: 'Email is required.' });

      // Therapist with profile fields → one-shot user + provider + link (same as /admin/therapists).
      // Admin invites never take this path (no provider chrome).
      const wantsProvider =
        role === 'therapist' &&
        (b.discipline != null ||
          b.firstName != null ||
          b.lastName != null ||
          b.payRate != null ||
          b.payRatePerHour != null ||
          b.payRate30Min != null ||
          b.payRateAdditionalHourly != null ||
          b.hhaCaregiverCode != null ||
          b.createProvider === true);
      if (wantsProvider) {
        try {
          const out = await upsertTherapistAsProvider(store, { ...b, email });
          store.audit(ctx.user.id, 'invite_user', `user:${out.user.id}`, null, {
            user: out.user,
            provider: out.provider,
          });
          return json(out.createdUser ? 201 : 200, {
            user: out.user,
            provider: out.provider,
            message: out.createdUser
              ? 'Therapist login created and linked as provider.'
              : 'Existing login linked to therapist (provider) profile.',
          });
        } catch (err) {
          return json(400, { error: err instanceof Error ? err.message : 'Could not create therapist.' });
        }
      }

      if (store.userByEmail(email)) return json(400, { error: 'User already exists.' });
      const displayName = String(b.displayName || email);
      // Admins must never get a providerId from the client body.
      const providerId = role === 'admin' ? '' : String(b.providerId || '');
      let cognitoSub = String(b.cognitoSub || `invite-${email}`);
      let cognitoOk = !process.env.TMS_USER_POOL_ID?.trim();
      try {
        cognitoSub = await inviteTherapist(email, displayName, role);
        cognitoOk = true;
      } catch (err) {
        // Pool configured but Cognito failed: still create Dynamo so ops can repair groups,
        // but surface the failure in the message. inviteTherapist now syncs groups on UsernameExists.
        cognitoSub = `invite-${email}`;
        void err;
      }
      const user: AppUser = {
        id: newId(),
        cognitoSub,
        email,
        role,
        displayName,
        providerId,
        active: true,
        createdAt: nowIso(),
      };
      store.upsertUser(user);
      if (role === 'therapist' && user.providerId) linkUserToProvider(store, user.id, user.providerId);
      store.audit(ctx.user.id, 'invite_user', `user:${user.id}`, null, user);
      const who = role === 'admin' ? 'Admin' : 'Therapist';
      const cognitoNote = cognitoOk
        ? 'They will get a Cognito email when the user pool is configured.'
        : 'App role saved; Cognito invite/group sync failed — repair Cognito groups before they sign in.';
      return json(201, {
        user: store.userById(user.id),
        message: `${who} invite created. ${cognitoNote}`,
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/users') {
    return adminUser(() => json(200, { users: store.data.users }));
  }

  if (req.method === 'DELETE' && /^\/admin\/users\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const target = store.userById(id);
      if (!target) return json(404, { error: 'User not found.' });
      if (target.id === ctx.user.id) {
        return json(400, { error: 'You cannot delete your own admin account.' });
      }
      if (target.role === 'admin') {
        const otherActiveAdmins = store.data.users.filter(
          (u) => u.role === 'admin' && u.active !== false && u.id !== target.id,
        );
        if (otherActiveAdmins.length === 0) {
          return json(400, { error: 'Cannot delete the last active admin.' });
        }
      }
      const linkedProvider =
        (target.providerId
          ? store.data.providers.find((p) => p.id === target.providerId)
          : undefined) || store.data.providers.find((p) => p.userId === target.id);
      const before = { user: { ...target }, provider: linkedProvider ? { ...linkedProvider } : null };
      if (linkedProvider && target.role === 'therapist') {
        store.removeProvider(linkedProvider.id);
      }
      try {
        await deleteCognitoLogin(target.cognitoSub, target.email);
      } catch (err) {
        // App user is still removed so the admin list stays clean.
        void err;
      }
      store.deleteUser(target.id);
      store.audit(ctx.user.id, 'delete_user', `user:${target.id}`, before, null);
      return json(200, {
        deleted: true,
        id: target.id,
        message: target.role === 'admin' ? 'Admin removed.' : 'Therapist removed.',
      });
    });
  }

  if (req.method === 'POST' && /^\/admin\/users\/[^/]+\/deactivate$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const target = store.userById(id);
      if (!target) return json(404, { error: 'User not found.' });
      if (target.id === ctx.user.id) {
        return json(400, { error: 'You cannot deactivate your own admin account.' });
      }
      if (target.role === 'admin') {
        return json(400, { error: 'Admins must be deleted, not deactivated.' });
      }
      if (target.active === false) {
        return json(200, { user: target, message: 'Already deactivated.' });
      }
      const before = { ...target };
      const updated = store.upsertUser({ ...target, active: false });
      try {
        await deactivateCognitoLogin(target.email, target.role);
      } catch (err) {
        // App state still deactivates; Cognito may lag if username differs.
        void err;
      }
      store.audit(ctx.user.id, 'deactivate_user', `user:${updated.id}`, before, updated);
      return json(200, {
        user: updated,
        message: 'User deactivated.',
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/schools') {
    return adminUser(() => {
      const b = obj(req);
      const id = String(b.id || newId());
      const existing = store.data.schools.find((s) => s.id === id);
      const school = store.upsertSchool({
        id,
        name: String(b.name || existing?.name || '').trim(),
        district: String(b.district ?? existing?.district ?? ''),
        signerName: String(b.signerName ?? existing?.signerName ?? ''),
        signerEmail: String(b.signerEmail ?? existing?.signerEmail ?? ''),
        address1: String(b.address1 ?? existing?.address1 ?? '').trim() || undefined,
        city: String(b.city ?? existing?.city ?? '').trim() || undefined,
        state: String(b.state ?? existing?.state ?? '').trim() || undefined,
        zipCode: String(b.zipCode ?? existing?.zipCode ?? '').trim() || undefined,
        createdAt: existing?.createdAt || nowIso(),
      });
      return json(existing ? 200 : 201, { school });
    });
  }

  if (req.method === 'GET' && path === '/admin/districts') {
    return adminUser(() => {
      // Detail lookup via query so derived ids (`derived:carle place`) are not
      // stuck in a percent-encoded path segment (API Gateway rawPath).
      const lookup = String(req.query.id || req.query.districtId || '').trim();
      const byName = String(req.query.name || '').trim();
      if (lookup || byName) {
        // Name is a second key so a derived id (`derived:hicksville`) that a
        // proxy truncates on ":" still resolves the district shown in the list.
        const row =
          (lookup && findDistrictDirectoryRow(store, lookup)) ||
          (byName && findDistrictDirectoryRow(store, byName)) ||
          undefined;
        if (!row) return json(404, { error: 'District not found.' });
        return json(200, { district: row });
      }
      const districts = listDistrictDirectory(store);
      return json(200, { districts });
    });
  }

  if (req.method === 'POST' && path === '/admin/districts') {
    return adminUser(() => {
      const b = obj(req);
      const name = String(b.name || '').trim();
      if (!name) return json(400, { error: 'District name is required.' });
      const idRaw = String(b.id || '').trim();
      const existing =
        (idRaw && !idRaw.startsWith('derived:')
          ? store.data.districts.find((d) => d.id === idRaw)
          : undefined) ||
        findDistrictByName(store, name);
      const id = existing?.id || (idRaw && !idRaw.startsWith('derived:') ? idRaw : newId());
      const district = store.upsertDistrict({
        id,
        name: name || existing?.name || '',
        signerName: String(b.signerName ?? existing?.signerName ?? '').trim(),
        signerEmail: String(b.signerEmail ?? existing?.signerEmail ?? '').trim(),
        createdAt: existing?.createdAt || nowIso(),
      });
      // Keep school.district wired when saving a district name for buildings that match.
      const wantKey = String(district.name || '').trim().toLowerCase();
      for (const s of store.data.schools) {
        const d = String(s.district || '').trim();
        if (!d) continue;
        if (d.toLowerCase() === wantKey || findDistrictByName(store, d)?.id === district.id) {
          if (d !== district.name) {
            store.upsertSchool({ ...s, district: district.name });
          }
        }
      }
      store.audit(
        ctx.user.id,
        existing ? 'update_district' : 'create_district',
        `district:${district.id}`,
        existing || null,
        district,
      );
      const directory = listDistrictDirectory(store);
      const row =
        directory.find((d) => d.id === district.id) ||
        findDistrictDirectoryRow(store, district.name);
      return json(existing ? 200 : 201, {
        // Directory row (schools, persisted, signer) so the client can redraw
        // without a follow-up GET that 404s before the new id is readable.
        district: row || district,
        directory,
        message: 'District saved.',
      });
    });
  }

  if (req.method === 'GET' && /^\/admin\/districts\/[^/]+$/.test(path)) {
    return adminUser(() => {
      // rawPath keeps encoding (`derived%3Acarle%20place`); match real ids,
      // derived keys, and district names.
      const row = findDistrictDirectoryRow(store, path.split('/')[3]);
      if (!row) return json(404, { error: 'District not found.' });
      return json(200, { district: row });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/districts\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = decodeDistrictPathId(path.split('/')[3]);
      if (!id || id.startsWith('derived:')) {
        return json(400, { error: 'Derived districts cannot be deleted; remove school.district / program type labels instead.' });
      }
      const existing = store.data.districts.find((d) => d.id === id);
      if (!existing) return json(404, { error: 'District not found.' });
      store.removeDistrict(id);
      store.audit(ctx.user.id, 'delete_district', `district:${id}`, existing, null);
      return json(200, {
        deleted: true,
        id,
        message: 'District removed. School district labels were left unchanged.',
        directory: listDistrictDirectory(store),
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/schools') {
    return adminUser(() => {
      const calendarsBySchoolId: Record<string, SchoolCalendar> = {};
      const setupBySchoolId: Record<
        string,
        {
          incomplete: boolean;
          missingCalendar: boolean;
          missingAddress: boolean;
          message: string;
        }
      > = {};
      for (const s of store.data.schools) {
        const cal = store.schoolCalendarForSchool(s.id) ?? emptySchoolCalendar(s.id);
        calendarsBySchoolId[s.id] = cal;
        const setup = schoolSetupIncomplete(s, cal);
        setupBySchoolId[s.id] = {
          incomplete: setup.incomplete,
          missingCalendar: setup.missingCalendar,
          missingAddress: setup.missingAddress,
          message: setup.message,
        };
      }
      return json(200, {
        schools: store.data.schools,
        calendarsBySchoolId,
        setupBySchoolId,
      });
    });
  }

  if (req.method === 'GET' && /^\/admin\/schools\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      if (id === 'calendar') return json(404, { error: 'Not found.' });
      const detail = adminSchoolDetail(store, id);
      if (!detail) return json(404, { error: 'School not found.' });
      return json(200, detail);
    });
  }

  if (req.method === 'GET' && /^\/admin\/schools\/[^/]+\/calendar$/.test(path)) {
    return adminUser(() => {
      const schoolId = path.split('/')[3];
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const calendar =
        store.schoolCalendarForSchool(schoolId) ?? emptySchoolCalendar(schoolId);
      return json(200, { calendar });
    });
  }

  if (req.method === 'POST' && /^\/admin\/schools\/[^/]+\/calendar\/parse$/.test(path)) {
    return adminUser(() => {
      const schoolId = path.split('/')[3];
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const b = obj(req);
      const text = pdfTextFromBody(b);
      if (!text.trim()) {
        return json(400, {
          error: bodyHasPdfBytes(b)
            ? SCHOOL_CALENDAR_PDF_NO_TEXT_ERROR
            : 'Upload a school calendar PDF (text-based) or paste calendar text.',
          hint: SCHOOL_CALENDAR_PDF_HINT,
        });
      }
      const parsed = parseSchoolCalendarPdfText(text);
      const existing = store.schoolCalendarForSchool(schoolId) ?? emptySchoolCalendar(schoolId);
      const proposed = mergeSchoolCalendarParse(existing, parsed);
      const apply = b.apply === true || b.apply === 'true' || b.save === true;
      if (apply) {
        if (proposed.yearStart && !isIsoDate(proposed.yearStart)) {
          return json(400, { error: 'yearStart must be YYYY-MM-DD.' });
        }
        if (proposed.yearEnd && !isIsoDate(proposed.yearEnd)) {
          return json(400, { error: 'yearEnd must be YYYY-MM-DD.' });
        }
        if (proposed.yearStart && proposed.yearEnd && proposed.yearStart > proposed.yearEnd) {
          return json(400, { error: 'yearStart must be on or before yearEnd.' });
        }
        const before = store.schoolCalendarForSchool(schoolId) ?? null;
        const calendar = store.upsertSchoolCalendar({
          schoolId,
          yearStart: proposed.yearStart,
          yearEnd: proposed.yearEnd,
          offDays: proposed.offDays,
          ...(before?.cycleDays != null ? { cycleDays: before.cycleDays } : {}),
        });
        store.audit(ctx.user.id, 'parse_school_calendar_pdf', `school:${schoolId}`, before, {
          parsed,
          calendar,
        });
        return json(200, {
          calendar,
          parsed,
          proposed,
          applied: true,
          message: `Saved calendar from PDF: ${parsed.offDays.length} off day(s) extracted, ${proposed.offDays.length} total after merge.`,
          hint: SCHOOL_CALENDAR_PDF_HINT,
        });
      }
      return json(200, {
        parsed,
        proposed,
        applied: false,
        message: `Parsed ${parsed.offDays.length} off day(s) from PDF. Review and save to apply.`,
        hint: SCHOOL_CALENDAR_PDF_HINT,
        warnings: parsed.warnings,
      });
    });
  }

  if (req.method === 'POST' && /^\/admin\/schools\/[^/]+\/calendar$/.test(path)) {
    return adminUser(() => {
      const schoolId = path.split('/')[3];
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const b = obj(req);
      const yearStart = String(b.yearStart ?? '').trim();
      const yearEnd = String(b.yearEnd ?? '').trim();
      if (yearStart && !isIsoDate(yearStart)) {
        return json(400, { error: 'yearStart must be YYYY-MM-DD.' });
      }
      if (yearEnd && !isIsoDate(yearEnd)) {
        return json(400, { error: 'yearEnd must be YYYY-MM-DD.' });
      }
      if (yearStart && yearEnd && yearStart > yearEnd) {
        return json(400, { error: 'yearStart must be on or before yearEnd.' });
      }
      let offDays: string[] = [];
      if (Array.isArray(b.offDays)) {
        offDays = normalizeOffDays(b.offDays.map(String));
      }
      const csv = String(b.offDaysCsv ?? b.offDaysText ?? '').trim();
      if (csv) offDays = normalizeOffDays([...offDays, ...parseOffDaysCsv(csv)]);
      const before = store.schoolCalendarForSchool(schoolId) ?? null;
      let cycleDays = before?.cycleDays;
      if (Object.prototype.hasOwnProperty.call(b, 'cycleDays')) {
        const parsedCycle = parseSchoolCycleDays(b.cycleDays);
        if (!parsedCycle.ok) return json(400, { error: parsedCycle.error });
        cycleDays = parsedCycle.cycleDays;
      }
      const calendar = store.upsertSchoolCalendar({
        schoolId,
        yearStart,
        yearEnd,
        offDays,
        ...(cycleDays != null ? { cycleDays } : {}),
      });
      store.audit(ctx.user.id, 'upsert_school_calendar', `school:${schoolId}`, before, calendar);
      return json(200, { calendar, message: 'School calendar saved.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/schools\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.schools.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'School not found.' });
      const childCount = store.data.students.filter((s) => s.schoolId === id).length;
      store.removeSchool(id);
      store.audit(ctx.user.id, 'delete_school', `school:${id}`, { ...existing, childCount }, null);
      return json(200, {
        deleted: true,
        id,
        message:
          childCount > 0
            ? `School removed. ${childCount} child(ren) no longer linked to a school.`
            : 'School removed.',
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/providers/purge-orphans') {
    return adminUser(() => {
      const result = purgeOrphanProviders(store);
      store.audit(ctx.user.id, 'purge_orphan_providers', 'providers', null, result);
      return json(200, {
        ...result,
        message:
          result.retained.length > 0
            ? `Deleted ${result.deleted.length} orphan(s); ${result.retained.length} kept (caseload with no linked match).`
            : `Deleted ${result.deleted.length} orphan provider(s).`,
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/providers') {
    return adminUser(async () => {
      const b = obj(req);
      const email = String(b.email || '').trim().toLowerCase();
      // Email means therapist-as-provider: create/link login + provider in one step.
      if (email) {
        try {
          const out = await upsertTherapistAsProvider(store, b);
          store.audit(ctx.user.id, 'upsert_provider', `provider:${out.provider.id}`, null, out);
          return json(out.createdUser ? 201 : 200, {
            provider: out.provider,
            user: out.user,
          });
        } catch (err) {
          return json(400, { error: err instanceof Error ? err.message : 'Could not save provider.' });
        }
      }
      const firstName = String(b.firstName || '');
      const lastName = String(b.lastName || '');
      const userId = String(b.userId || '');
      // Avoid creating a new orphan twin when a linked profile already matches the name.
      if (!userId) {
        const existing = findProviderByName(store.data.providers, `${firstName} ${lastName}`.trim());
        if (existing && !isOrphanProvider(store, existing)) {
          return json(400, {
            error:
              'A linked provider with this name already exists. Open that profile instead of creating a duplicate without a login.',
            existingProviderId: existing.id,
          });
        }
      }
      const discipline = parseDiscipline(b.discipline);
      const provider = store.upsertProvider({
        id: String(b.id || newId()),
        userId,
        firstName,
        lastName,
        discipline,
        ...providerPayFields(b),
        hhaCaregiverCode: String(b.hhaCaregiverCode || ''),
        active: b.active === false ? false : true,
        createdAt: nowIso(),
      });
      if (provider.userId) linkUserToProvider(store, provider.userId, provider.id);
      purgeOrphanProviders(store);
      return json(201, {
        provider: store.data.providers.find((p) => p.id === provider.id),
        user: provider.userId ? store.userById(provider.userId) : undefined,
      });
    });
  }

  if (req.method === 'GET' && path === '/admin/providers') {
    return adminUser(() => {
      // Durable heal: merge alias caseloads and drop empty orphan twins on list.
      const orphanPurge = purgeOrphanProviders(store);
      return json(200, { providers: store.data.providers, orphanPurge });
    });
  }

  if (req.method === 'GET' && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      // Heal on list; detail stays read-only. Import / purge-orphans also write.
      const detail = adminProviderDetail(store, id);
      if (!detail) return json(404, { error: 'Provider not found.' });
      return json(200, detail);
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const existing = store.data.providers.find((p) => p.id === id);
      if (!existing) return json(404, { error: 'Provider not found.' });
      const b = obj(req);
      const provider = store.upsertProvider({
        ...existing,
        firstName: pickStr(b.firstName, existing.firstName),
        lastName: pickStr(b.lastName, existing.lastName),
        discipline: parseDiscipline(b.discipline, existing.discipline),
        ...providerPayFields(b, existing),
        hhaCaregiverCode: pickStr(b.hhaCaregiverCode, existing.hhaCaregiverCode),
        active: b.active === false ? false : b.active === true ? true : existing.active,
      });
      let user = provider.userId ? store.userById(provider.userId) : store.data.users.find((u) => u.providerId === provider.id);
      if (user && (b.email != null || b.displayName != null)) {
        const email = b.email != null ? String(b.email).trim().toLowerCase() : user.email;
        const displayName =
          b.displayName != null
            ? String(b.displayName).trim()
            : `${provider.firstName} ${provider.lastName}`.trim() || user.displayName;
        user = store.upsertUser({ ...user, email: email || user.email, displayName: displayName || user.displayName });
      }
      store.audit(ctx.user.id, 'update_provider', `provider:${id}`, existing, provider);
      return json(200, { provider, user: user || null });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/providers\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const existing = store.data.providers.find((p) => p.id === id);
      if (!existing) return json(404, { error: 'Provider not found.' });
      const linked =
        (existing.userId ? store.userById(existing.userId) : undefined) ||
        store.data.users.find((u) => u.providerId === existing.id);
      const before = { provider: existing, user: linked || null };
      store.removeProvider(id);
      if (linked && linked.role === 'therapist') {
        store.upsertUser({ ...linked, providerId: '', active: false });
        try {
          await deactivateCognitoLogin(linked.email, linked.role);
        } catch {
          /* app unlink still wins */
        }
      }
      store.audit(ctx.user.id, 'delete_provider', `provider:${id}`, before, null);
      return json(200, { deleted: true, id, message: 'Provider removed.' });
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/providers\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find((n) => n.id === noteId && n.providerId === providerId);
      if (!existing) return json(404, { error: 'Note not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const tags = parseNoteTags(obj(req), existing.tags);
      const note = store.upsertAdminNote({ ...existing, body: text, tags });
      store.audit(ctx.user.id, 'update_admin_note', `note:${noteId}`, existing, note);
      return json(200, { note, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/providers\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find((n) => n.id === noteId && n.providerId === providerId);
      if (!existing) return json(404, { error: 'Note not found.' });
      store.removeAdminNote(noteId);
      store.audit(ctx.user.id, 'delete_admin_note', `note:${noteId}`, existing, null);
      return json(200, { deleted: true, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'GET' && path === '/admin/students') {
    return adminUser(() => json(200, { students: adminStudentsList(store) }));
  }

  if (req.method === 'GET' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const detail = adminStudentDetail(store, id);
      if (!detail) return json(404, { error: 'Child not found.' });
      return json(200, detail);
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.students.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'Child not found.' });
      store.removeStudent(id);
      store.audit(ctx.user.id, 'delete_student', `student:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Child removed.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/mandates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.mandates.find((m) => m.id === id);
      if (!existing) return json(404, { error: 'Mandate not found.' });
      store.removeMandate(id);
      store.audit(ctx.user.id, 'delete_mandate', `mandate:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Mandate removed.' });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/files\/[^/]+$/.test(path)) {
    return adminUser(async () => {
      const id = path.split('/')[3];
      const existing = store.data.files.find((f) => f.id === id);
      if (!existing) return json(404, { error: 'File not found.' });
      if (existing.s3Key && String(existing.s3Key).startsWith('tms/')) {
        await deletePdfFromS3(existing.s3Key);
      }
      store.removeFile(id);
      store.audit(ctx.user.id, 'delete_file', `file:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'File removed.' });
    });
  }

  if (req.method === 'GET' && path === '/admin/weeks') {
    return adminUser(() => {
      const weekStart = String(req.query.weekStart || '').trim();
      const name = String(req.query.name || req.query.q || '').trim();
      // Heal same-district draft fragments (short "UFSD" vs "UFSD Therapy", blank stamps)
      // before listing. Locked sheets are left alone.
      const healPool = weekStart
        ? store.data.weeks.filter((w) => w.weekStart === weekStart)
        : store.data.weeks;
      foldEditableSameBinWeeks(store, healPool);
      return json(200, {
        weeks: adminWeeksList(store, {
          ...(weekStart ? { weekStart } : {}),
          ...(name ? { name } : {}),
        }),
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/weeks/timesheets/merge') {
    return adminUser(() => {
      const raw = obj(req).weekIds;
      const ids = [
        ...new Set(
          (Array.isArray(raw) ? raw : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        ),
      ];
      if (!ids.length) return json(400, { error: 'Select at least one week to merge.' });
      if (ids.length > 40) return json(400, { error: 'Merge up to 40 weeks at a time.' });
      const found: WeeklyPeriod[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const week = store.data.weeks.find((w) => w.id === id);
        if (!week) missing.push(id);
        else found.push(week);
      }
      if (missing.length) return json(404, { error: 'One or more selected weeks were not found.' });
      const byDate = found
        .slice()
        .sort((a, b) => String(a.weekStart || '').localeCompare(String(b.weekStart || '')));
      const rows = found.flatMap((week) => timesheetSourceRowsForWeek(store, week));
      const providerNames = uniqueTrimmed(
        found.map((week) => {
          const provider = store.data.providers.find((p) => p.id === week.providerId);
          return provider ? `${provider.firstName} ${provider.lastName}`.trim() : '';
        }),
      );
      const providerLabel =
        providerNames.length === 1
          ? providerNames[0]!
          : providerNames.length > 1 && providerNames.length <= 3
            ? providerNames.join(', ')
            : providerNames.length > 3
              ? `${providerNames.length} providers`
              : 'Multiple providers';
      const starts = byDate.map((week) => String(week.weekStart || '').trim()).filter(Boolean);
      const weekOf =
        starts.length === 0
          ? ''
          : starts[0] === starts[starts.length - 1]
            ? starts[0]!
            : `${starts[0]} to ${starts[starts.length - 1]}`;
      const signerNames = uniqueTrimmed(found.map((week) => week.signerName));
      const signerEmails = uniqueTrimmed(found.map((week) => week.signerEmail));
      const districts = uniqueTrimmed(found.map((week) => schoolDistrictForWeek(store, week.id)));
      const base = byDate[0] || found[0]!;
      // buildTimesheetPdf sorts rows by date of service, then begin time, then child.
      const pdf = buildTimesheetPdf({
        week: {
          ...base,
          weekStart: weekOf,
          status: 'combined' as WeeklyPeriod['status'],
        },
        providerLabel,
        signerName: signerNames.length === 1 ? signerNames[0]! : signerNames.length ? 'Multiple signers' : '',
        signerEmail: signerEmails.length === 1 ? signerEmails[0]! : '',
        schoolDistrict: districts.length === 1 ? districts[0] : '',
        rows,
      });
      const filename = `timesheet-merged-${String(starts[0] || 'weeks').replace(/[^\d-]/g, '')}.pdf`;
      return {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}"`,
        },
        body: Buffer.from(pdf),
      };
    });
  }

  if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      const provider = store.data.providers.find((p) => p.id === providerId);
      if (!provider) return json(404, { error: 'Provider not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const note = store.addAdminNote({
        id: newId(),
        providerId,
        studentId: '',
        authorId: ctx.user.id,
        body: text,
        tags: parseNoteTags(obj(req), []),
        createdAt: nowIso(),
      });
      return json(201, { note, notes: store.notesForProvider(providerId) });
    });
  }

  if (req.method === 'GET' && /^\/admin\/providers\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const providerId = path.split('/')[3];
      return json(200, {
        notes: store.notesForProvider(providerId),
        tagOptions: [...DEFAULT_ADMIN_NOTE_TAGS],
      });
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/students\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const studentId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find(
        (n) => n.id === noteId && String(n.studentId || '').trim() === studentId,
      );
      if (!existing) return json(404, { error: 'Note not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const tags = parseNoteTags(obj(req), existing.tags);
      const note = store.upsertAdminNote({ ...existing, body: text, tags, studentId });
      store.audit(ctx.user.id, 'update_admin_note', `note:${noteId}`, existing, note);
      return json(200, { note, notes: store.notesForStudent(studentId) });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/students\/[^/]+\/notes\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const studentId = path.split('/')[3];
      const noteId = path.split('/')[5];
      const existing = store.data.adminNotes.find(
        (n) => n.id === noteId && String(n.studentId || '').trim() === studentId,
      );
      if (!existing) return json(404, { error: 'Note not found.' });
      store.removeAdminNote(noteId);
      store.audit(ctx.user.id, 'delete_admin_note', `note:${noteId}`, existing, null);
      return json(200, { deleted: true, notes: store.notesForStudent(studentId) });
    });
  }

  if (req.method === 'POST' && /^\/admin\/students\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const studentId = path.split('/')[3];
      const student = store.data.students.find((s) => s.id === studentId);
      if (!student) return json(404, { error: 'Child not found.' });
      const text = String(obj(req).body || obj(req).note || obj(req).text || '').trim();
      if (!text) return json(400, { error: 'Note text is required.' });
      const note = store.addAdminNote({
        id: newId(),
        providerId: '',
        studentId,
        authorId: ctx.user.id,
        body: text,
        tags: parseNoteTags(obj(req), []),
        createdAt: nowIso(),
      });
      return json(201, { note, notes: store.notesForStudent(studentId) });
    });
  }

  if (req.method === 'GET' && /^\/admin\/students\/[^/]+\/notes$/.test(path)) {
    return adminUser(() => {
      const studentId = path.split('/')[3];
      return json(200, {
        notes: store.notesForStudent(studentId),
        tagOptions: [...DEFAULT_ADMIN_NOTE_TAGS],
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/mandates/parse') {
    return adminUser(() => {
      const b = obj(req);
      const text = pdfTextFromBody(b) || textBody(req);
      if (!text.trim()) {
        return json(400, {
          error: bodyHasPdfBytes(b)
            ? PDF_NO_TEXT_ERROR
            : 'Upload a mandate PDF or paste the mandate text.',
        });
      }
      const parsed = parseMandatePdfText(text);
      let student = store.findStudentByName(parsed.firstName, parsed.lastName);
      if (!student && parsed.firstName) {
        student = store.upsertStudent({
          id: newId(),
          schoolId: String(obj(req).schoolId || store.data.schools[0]?.id || ''),
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          dob: parsed.dob,
          programId: parsed.programId,
          programType: parsed.programType,
          hhaPatientId: '',
          createdAt: nowIso(),
        });
      }
      let mandate = student ? store.mandateForStudent(student.id) : undefined;
      if (student && parsed.frequencyPerWeek != null) {
        mandate = store.upsertMandate({
          id: mandate?.id || newId(),
          studentId: student.id,
          providerId: String(obj(req).providerId || ''),
          serviceType: parsed.serviceType,
          discipline: parsed.discipline,
          frequencyPerWeek: parsed.frequencyPerWeek,
          frequencyKind: 'weekly',
          sessionsPerPeriod: parsed.frequencyPerWeek,
          ratioGroup: parsed.ratioGroup,
          sourcePdfKey: String(b.sourcePdfKey || 'upload'),
          parsedAt: nowIso(),
          startOn: '',
          endOn: '',
          createdAt: mandate?.createdAt || nowIso(),
        });
      }
      store.audit(ctx.user.id, 'parse_mandate_pdf', student ? `student:${student.id}` : 'student:new', null, parsed);
      return json(200, { parsed, student, mandate });
    });
  }

  if (req.method === 'POST' && path === '/admin/caseloads/import') {
    return adminUser(() => {
      const b = obj(req);
      const csvText = String(b.csvText || b.csv || textBody(req) || '');
      const fileBase64 = String(b.fileBase64 || b.excelBase64 || b.contentBase64 || '');
      if (!csvText.trim() && !fileBase64.trim()) {
        return json(400, { error: 'csvText or fileBase64 is required.' });
      }
      const parsed = parseCaseloadUpload({
        fileName: String(b.fileName || ''),
        mime: String(b.mime || b.contentType || ''),
        csvText,
        fileBase64,
      });
      const dryRun = b.dryRun === true && b.confirm !== true;
      // Persist only when confirming. Valid rows still commit even if some rows had parse errors.
      // RS Provider must match an existing TMS therapist — no default-provider fallback.
      const result = applyCaseloadImport(store, parsed, { dryRun });
      if (!dryRun) {
        store.audit(
          ctx.user.id,
          'caseload_csv_import',
          'caseload',
          null,
          {
            createdStudents: result.createdStudents,
            createdMandates: result.createdMandates,
            updatedMandates: result.updatedMandates,
            createdSchools: result.createdSchools,
            rowCount: result.rows.length,
            errorCount: result.errors.length,
          },
        );
      }
      return json(200, {
        ...result,
        dryRun,
        parsedRowCount: parsed.rows.length,
      });
    });
  }

  if (req.method === 'POST' && path === '/admin/mandates') {
    return adminUser(() => {
      const b = obj(req);
      const studentId = String(b.studentId || '').trim();
      if (!studentId) return json(400, { error: 'studentId is required.' });
      const student = store.data.students.find((s) => s.id === studentId);
      if (!student) return json(404, { error: 'Child not found.' });
      const frequencyKind = (String(b.frequencyKind || 'weekly') === 'school_day_cycle'
        ? 'school_day_cycle'
        : String(b.frequencyKind || '') === 'monthly'
          ? 'monthly'
          : 'weekly') as FrequencyKind;
      const mandateKind = parseMandateKind(b.mandateKind);
      const freq = Number(b.frequencyPerWeek ?? b.sessionsPerPeriod ?? 0);
      const sessionsPerPeriod = Number(b.sessionsPerPeriod ?? b.frequencyPerWeek ?? freq);
      const disciplineRaw = String(b.discipline || '');
      const discipline = (['OT', 'PT', 'SLP'].includes(disciplineRaw) ? disciplineRaw : '') as Discipline | '';
      const durationMinutes = parseNullableNumber(b.durationMinutes);
      const groupSize = parseNullableNumber(b.groupSize);
      const billingServiceName = schoolBillingServiceNameForMandate({
        discipline,
        durationMinutes,
        mandateKind,
        ratioGroup: Boolean(b.ratioGroup),
        groupSize: groupSize ?? (Boolean(b.ratioGroup) ? 2 : 1),
      });
      const mandate = store.upsertMandate({
        id: newId(),
        studentId,
        providerId: String(b.providerId || ''),
        serviceType: String(
          b.serviceType ||
            (mandateKind === 'makeup_auth' || mandateKind === 'makeup_weekly'
              ? 'Makeup authorization'
              : ''),
        ),
        discipline,
        mandateKind,
        frequencyPerWeek:
          frequencyKind === 'school_day_cycle' || mandateKind === 'makeup_auth'
            ? 0
            : Number.isFinite(freq)
              ? freq
              : 0,
        frequencyKind:
          mandateKind === 'makeup_auth' || mandateKind === 'makeup_weekly'
            ? 'weekly'
            : frequencyKind,
        sessionsPerPeriod: Number.isFinite(sessionsPerPeriod) ? sessionsPerPeriod : 0,
        periodSchoolDays:
          frequencyKind === 'school_day_cycle' ? Number(b.periodSchoolDays || 6) : undefined,
        ratioGroup: Boolean(b.ratioGroup),
        durationMinutes,
        billingServiceName,
        groupSize: groupSize ?? (Boolean(b.ratioGroup) ? 2 : 1),
        location: String(b.location || ''),
        sourcePdfKey: 'manual',
        parsedAt: nowIso(),
        startOn: String(b.startOn || ''),
        endOn: String(b.endOn || ''),
        createdAt: nowIso(),
      });
      store.audit(ctx.user.id, 'create_mandate', `mandate:${mandate.id}`, null, mandate);
      return json(201, { mandate, message: 'Mandate saved.' });
    });
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && /^\/admin\/mandates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.mandates.find((m) => m.id === id);
      if (!existing) return json(404, { error: 'Mandate not found.' });
      const b = obj(req);
      const disciplineRaw = b.discipline != null ? String(b.discipline) : existing.discipline;
      const discipline = (['OT', 'PT', 'SLP'].includes(disciplineRaw) ? disciplineRaw : existing.discipline) as Discipline | '';
      const freq = b.frequencyPerWeek == null || b.frequencyPerWeek === ''
        ? existing.frequencyPerWeek
        : Number(b.frequencyPerWeek);
      const kindRaw = b.frequencyKind != null ? String(b.frequencyKind) : existing.frequencyKind || 'weekly';
      const frequencyKind = (kindRaw === 'school_day_cycle'
        ? 'school_day_cycle'
        : kindRaw === 'monthly'
          ? 'monthly'
          : 'weekly') as FrequencyKind;
      const sessionsPerPeriod =
        b.sessionsPerPeriod == null || b.sessionsPerPeriod === ''
          ? existing.sessionsPerPeriod ?? (frequencyKind === 'weekly' || frequencyKind === 'monthly' ? (Number.isFinite(freq) ? freq : existing.frequencyPerWeek) : existing.sessionsPerPeriod)
          : Number(b.sessionsPerPeriod);
      const periodSchoolDays =
        b.periodSchoolDays == null || b.periodSchoolDays === ''
          ? existing.periodSchoolDays
          : Number(b.periodSchoolDays);
      const mandateKind = parseMandateKind(b.mandateKind, existing.mandateKind || 'regular');
      const ratioGroup = b.ratioGroup == null ? existing.ratioGroup : Boolean(b.ratioGroup);
      const durationMinutes =
        b.durationMinutes === undefined ? existing.durationMinutes ?? null : parseNullableNumber(b.durationMinutes);
      const groupSizeRaw =
        b.groupSize === undefined ? existing.groupSize ?? null : parseNullableNumber(b.groupSize);
      const groupSize =
        groupSizeRaw != null && Number.isFinite(groupSizeRaw) && groupSizeRaw > 0
          ? groupSizeRaw
          : ratioGroup
            ? 2
            : 1;
      const billingServiceName = schoolBillingServiceNameForMandate({
        discipline,
        durationMinutes,
        mandateKind,
        ratioGroup,
        groupSize,
      });
      const mandate = store.upsertMandate({
        ...existing,
        mandateKind,
        studentId: pickStr(b.studentId, existing.studentId),
        frequencyPerWeek: mandateKind === 'makeup_auth'
          ? 0
          : frequencyKind === 'school_day_cycle'
          ? 0
          : Number.isFinite(freq) ? freq : existing.frequencyPerWeek,
        frequencyKind:
          mandateKind === 'makeup_auth' || mandateKind === 'makeup_weekly'
            ? 'weekly'
            : frequencyKind,
        sessionsPerPeriod: Number.isFinite(Number(sessionsPerPeriod)) ? Number(sessionsPerPeriod) : existing.sessionsPerPeriod,
        periodSchoolDays: frequencyKind === 'school_day_cycle'
          ? (Number.isFinite(Number(periodSchoolDays)) ? Number(periodSchoolDays) : existing.periodSchoolDays || 6)
          : undefined,
        serviceType: pickStr(b.serviceType, existing.serviceType),
        discipline,
        providerId: pickStr(b.providerId, existing.providerId),
        startOn: pickStr(b.startOn, existing.startOn),
        endOn: pickStr(b.endOn, existing.endOn),
        location: b.location != null ? String(b.location) : existing.location,
        ratioGroup,
        durationMinutes,
        billingServiceName,
        groupSize,
      });
      store.audit(ctx.user.id, 'update_mandate', `mandate:${id}`, existing, mandate);
      return json(200, { mandate, message: 'Mandate updated.' });
    });
  }

  if (req.method === 'POST' && /^\/admin\/students\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.students.find((s) => s.id === id);
      if (!existing) return json(404, { error: 'Student not found.' });
      const b = obj(req);
      const student = store.upsertStudent({
        ...existing,
        firstName: pickStr(b.firstName, existing.firstName),
        middleName: b.middleName != null ? String(b.middleName).trim() : existing.middleName || '',
        lastName: pickStr(b.lastName, existing.lastName),
        dob: pickStr(b.dob, existing.dob),
        schoolId: pickStr(b.schoolId, existing.schoolId),
        hhaPatientId: pickStr(b.hhaPatientId, existing.hhaPatientId),
        programId: pickStr(b.programId, existing.programId),
        programType: pickStr(b.programType, existing.programType),
        grade: b.grade != null ? String(b.grade) : existing.grade,
      });
      store.audit(ctx.user.id, 'update_student', `student:${id}`, existing, student);
      return json(200, { student });
    });
  }

  if (req.method === 'POST' && path === '/admin/due-dates') {
    return adminUser(() => {
      const b = obj(req);
      const idIn = String(b.id || '').trim();
      const existing = idIn ? store.data.dueDates.find((d) => d.id === idIn) : undefined;
      const schoolId = String(b.schoolId || existing?.schoolId || '').trim();
      if (!schoolId) return json(400, { error: 'schoolId is required.' });
      const school = store.data.schools.find((s) => s.id === schoolId);
      if (!school) return json(404, { error: 'School not found.' });
      const typeRaw = String(b.reportType || b.kind || existing?.kind || 'progress').trim();
      const kind = typeRaw === 'annual' || typeRaw === 'reeval' ? typeRaw : 'progress';
      const dueOn = String(b.dueDate || b.dueOn || '').trim();
      if (!dueOn) return json(400, { error: 'dueOn is required.' });
      const notes =
        b.notes !== undefined ? String(b.notes || '').trim() : String(existing?.notes || '').trim();
      // Child targets: studentIds[] (new rows) or a single studentId.
      const rawIds: unknown[] = Array.isArray(b.studentIds)
        ? (b.studentIds as unknown[])
        : [];
      const singleId = String(b.studentId || '').trim();
      const studentIds = [
        ...new Set(
          [...rawIds, ...(rawIds.length ? [] : [singleId])]
            .map((x) => String(x || '').trim())
            .filter(Boolean),
        ),
      ];
      for (const sid of studentIds) {
        const st = store.data.students.find((s) => s.id === sid);
        if (!st) return json(404, { error: `Child not found: ${sid}` });
        if (st.schoolId !== schoolId) {
          return json(400, { error: 'Selected child is not at this school.' });
        }
      }
      const saveDue = (id: string, studentId: string, prior?: typeof existing) => {
        const row = store.upsertDueDate({
          id,
          schoolId,
          ...(studentId ? { studentId } : {}),
          kind,
          dueOn,
          notes,
          completedAt: String(b.completedAt ?? prior?.completedAt ?? ''),
          lastNagOn: prior && prior.dueOn === dueOn ? prior.lastNagOn || '' : '',
        });
        const label = school.name || schoolId;
        const child = studentId
          ? store.data.students.find((s) => s.id === studentId)
          : undefined;
        const childBit = child
          ? ` (${[child.firstName, child.lastName].map((p) => String(p || '').trim()).filter(Boolean).join(' ')})`
          : '';
        const noteBit = row.notes ? ` — ${row.notes}` : '';
        for (const a of store.data.alerts) {
          if (a.entityRef === `due:${row.id}` && !a.resolved) a.resolved = true;
        }
        store.addAlert({
          id: newId(),
          userId: '',
          kind: `due_${row.kind}`,
          severity: 'warning',
          body: `${label}${childBit}: ${row.kind} due ${row.dueOn}${noteBit}`,
          entityRef: `due:${row.id}`,
          resolved: Boolean(row.completedAt),
          createdAt: nowIso(),
        });
        return row;
      };
      // Create a new assignment unless editing by id — same type + different notes allowed.
      if (!existing && studentIds.length > 0) {
        const dueDates = studentIds.map((sid) => saveDue(newId(), sid));
        return json(201, { dueDates, dueDate: dueDates[0], count: dueDates.length });
      }
      // Editing keeps the existing child unless a studentId is supplied.
      const row = saveDue(
        existing?.id || newId(),
        studentIds[0] ?? String(existing?.studentId || '').trim(),
        existing,
      );
      return json(existing ? 200 : 201, { dueDate: row });
    });
  }

  if (req.method === 'POST' && /^\/admin\/due-dates\/[^/]+\/complete$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const row = store.data.dueDates.find((d) => d.id === id);
      if (!row) return json(404, { error: 'Due date not found.' });
      const updated = store.upsertDueDate({ ...row, completedAt: nowIso() });
      for (const a of store.data.alerts) {
        if (a.entityRef === `due:${id}`) a.resolved = true;
      }
      return json(200, { dueDate: updated });
    });
  }

  if (req.method === 'DELETE' && /^\/admin\/due-dates\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const id = path.split('/')[3];
      const existing = store.data.dueDates.find((d) => d.id === id);
      if (!existing) return json(404, { error: 'Due date not found.' });
      store.removeDueDate(id);
      store.audit(ctx.user.id, 'delete_due_date', `due:${id}`, existing, null);
      return json(200, { deleted: true, id, message: 'Due date removed.' });
    });
  }

  if (req.method === 'GET' && path === '/admin/reports/missing-notes') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      return json(200, {
        rows: missingNotes(store, undefined, { from, to, includeMissed: true }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/last-service') {
    return adminUser(() => {
      const providerId = String(req.query.providerId || '').trim();
      return json(200, {
        rows: lastServiceByStudent(store, {
          providerId: providerId || undefined,
        }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/due-dates') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      // raw=1 is the school editor's full list (completed + school-wide rows as stored).
      const raw = String(req.query.raw || '') === '1';
      return json(200, {
        rows: dueDateReport(store, new Date(), {
          from,
          to,
          excludeCompleted: !raw,
          expandSchoolWide: !raw,
        }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/week-progress') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      return json(200, {
        from: from || null,
        to: to || null,
        rows: weekProgressReport(store, { from, to }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/week-progress.xlsx') {
    return adminUser(() => reportXlsxWeekProgress(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/missing-notes.xlsx') {
    return adminUser(() => reportXlsxMissing(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/last-service.xlsx') {
    return adminUser(() => reportXlsxLastService(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/due-dates.xlsx') {
    return adminUser(() => reportXlsxDueDates(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/internal-notes') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const providerId = String(req.query.providerId || '').trim();
      return json(200, {
        rows: adminInternalNotesReport(store, {
          from,
          to,
          providerId: providerId || undefined,
        }),
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/internal-notes.xlsx') {
    return adminUser(() => reportXlsxInternalNotes(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/session-notes') {
    return adminUser(() => {
      const from = String(req.query.from || '').trim();
      const to = String(req.query.to || '').trim();
      const providerId = String(req.query.providerId || '').trim();
      const district = String(req.query.district || '').trim();
      return json(
        200,
        sessionNotesReport(store, {
          from,
          to,
          providerId: providerId || undefined,
          district: district || undefined,
        }),
      );
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/session-notes.xlsx') {
    return adminUser(() => reportXlsxSessionNotes(store, req.query));
  }
  if (req.method === 'GET' && path === '/admin/reports/hha-transfers') {
    return adminUser(() => {
      const report = hhaTransfersReport(store, {
        from: String(req.query.from || '').trim(),
        to: String(req.query.to || '').trim(),
      });
      if (!report.ok) return json(400, { error: report.error });
      return json(200, {
        from: report.from,
        to: report.to,
        timezone: report.timezone,
        rows: report.rows,
      });
    });
  }
  if (req.method === 'GET' && path === '/admin/reports/hha-transfers.xlsx') {
    return adminUser(() => reportXlsxHhaTransfers(store, req.query));
  }

  if (req.method === 'GET' && path === '/students') {
    const weekStart = String(req.query.weekStart || weekStartFromDos(nowIso().slice(0, 10)));
    const schoolId = String(req.query.schoolId || '').trim();
    const programType = String(req.query.programType || '').trim();
    const students = visibleStudents(
      store,
      ctx.user,
      weekStart,
      schoolId || undefined,
      programType || undefined,
    );
    const ids = new Set(students.map((s) => s.id));
    return json(200, {
      students,
      mandates: store.data.mandates.filter((m) => ctx.user.role === 'admin' || ids.has(m.studentId)),
      files: store.data.files.filter((f) => ctx.user.role === 'admin' || ids.has(f.studentId)),
    });
  }

  if (req.method === 'POST' && path === '/files') {
    const b = obj(req);
    const id = newId();
    const studentId = String(b.studentId || '');
    const buf = anyFileBufferFromBody(b);
    let s3Key = String(b.s3Key || '');
    if (buf) {
      const ext = String(b.fileName || b.label || 'upload').split('.').pop() || 'bin';
      s3Key = studentId
        ? `tms/locker/${studentId}/${id}.${ext}`
        : `tms/locker/providers/${String(b.providerId || 'p')}/${id}.${ext}`;
      await putLockerPdf(s3Key, buf);
    } else if (!s3Key) {
      s3Key = String(b.label || 'local');
    }
    const sessionId = String(b.sessionId || '').trim();
    const kind = String(
      b.kind || (sessionId ? 'session_note' : studentId ? 'locker' : 'provider_report'),
    );
    const file = store.addFile({
      id,
      studentId,
      providerId: String(b.providerId || providerFor(store, ctx.user)?.id || ''),
      weekId: String(b.weekId || ''),
      ...(sessionId ? { sessionId } : {}),
      kind,
      s3Key,
      label: String(b.label || 'upload'),
      createdAt: nowIso(),
    });
    return json(201, { file });
  }

  /** Download / view provider reports and student locker files from S3 (same pattern as /archive/{id}/file). */
  if (req.method === 'GET' && /^\/files\/[^/]+\/file$/.test(path)) {
    const id = path.split('/')[2];
    const row = store.data.files.find((f) => f.id === id);
    if (!row) return json(404, { error: 'File not found.' });
    const provider = providerFor(store, ctx.user);
    if (ctx.user.role !== 'admin') {
      const myIds = provider?.id ? new Set(providerLookupIds(store, provider.id)) : new Set<string>();
      const ownsProvider = Boolean(row.providerId && myIds.has(row.providerId));
      const ownsStudent = Boolean(
        row.studentId &&
          store.data.mandates.some(
            (m) => m.studentId === row.studentId && myIds.has(String(m.providerId || '')),
          ),
      );
      if (!ownsProvider && !ownsStudent) {
        return json(403, { error: 'You can only open your own files.' });
      }
    }
    const s3Key = String(row.s3Key || '').trim();
    if (!s3Key || !s3Key.startsWith('tms/')) {
      return json(404, { error: 'No file stored for this item.' });
    }
    const bytes = await getPdfFromS3(s3Key);
    if (!bytes?.length) return json(404, { error: 'File missing from storage.' });
    const keyName = s3Key.split('/').pop() || 'file';
    const labelName = String(row.label || '').trim();
    const hasExt = /\.[a-z0-9]{1,8}$/i.test(labelName);
    const rawName = hasExt ? labelName : keyName;
    const safeName = rawName.replace(/[^\w.\-]+/g, '_') || 'file';
    return {
      status: 200,
      headers: {
        'content-type': contentTypeForStoredFile(s3Key, row.label),
        'content-disposition': `inline; filename="${safeName}"`,
      },
      body: bytes,
    };
  }

  if (req.method === 'GET' && path === '/weeks') {
    const provider = providerFor(store, ctx.user);
    if (!provider && ctx.user.role !== 'admin') {
      return json(400, { error: 'No provider profile on this login.' });
    }
    const providerId = String(req.query.providerId || provider?.id || '');
    if (!providerId) return json(400, { error: 'providerId is required.' });
    if (ctx.user.role !== 'admin' && provider?.id !== providerId) {
      return json(403, { error: 'You can only list your own weeks.' });
    }
    const programType = String(req.query.programType || '').trim();
    const currentStart = weekStartFromDos(nowIso().slice(0, 10));
    const payProvider =
      store.data.providers.find((p) => p.id === providerId) ||
      (provider?.id === providerId ? provider : undefined);
    const confirmedSessionIds = new Set(
      (store.data.hhaTransfers || [])
        .filter((t) => t.status === 'confirmed' || t.status === 'manual')
        .map((t) => t.sessionId),
    );
    const wantPt = programTypeKey(programType);
    const providerWeeks = store.data.weeks.filter((w) =>
      providerLookupIds(store, providerId).includes(w.providerId),
    );
    // Repair fragmented unsigned multi-building bins before counting (Carle Place etc.).
    foldEditableSameBinWeeks(store, providerWeeks, {
      preferProgramType: programType || undefined,
    });
    const weeks = store.data.weeks
      .filter((w) => providerLookupIds(store, providerId).includes(w.providerId))
      .map((w) => {
        const allSessions = store.sessionsForWeek(w.id);
        const scoped = filterSessionsByProgramType(store, allSessions, programType || undefined);
        // Prefer label from scoped sessions so a mis-stamped week doesn't show the wrong district.
        const resolvedPt =
          (scoped.length
            ? (() => {
                const counts = new Map<string, number>();
                for (const s of scoped) {
                  const st = store.data.students.find((x) => x.id === s.studentId);
                  const pt = String(st?.programType || '').trim();
                  if (!pt) continue;
                  counts.set(pt, (counts.get(pt) || 0) + 1);
                }
                let best = '';
                let n = 0;
                for (const [pt, c] of counts) {
                  if (c > n) {
                    best = pt;
                    n = c;
                  }
                }
                return best;
              })()
            : '') ||
          resolveWeekProgramType(store, w) ||
          String(w.programType || '').trim();
        const rollup = weekHhaRollup(store, w.id);
        // Paid rollup for Processed uses confirmed transfers; when program-scoped, only count scoped.
        const scopedConfirmed = scoped.filter((s) => confirmedSessionIds.has(s.id)).length;
        const scopedEligible = scoped.filter((s) => isHhaTransferSession(s)).length;
        const fullyPaid =
          wantPt
            ? scopedEligible > 0 && scopedConfirmed === scopedEligible
            : rollup.eligible > 0 && rollup.confirmed === rollup.eligible && rollup.failed === 0;
        const draft = w.status === 'draft' || w.status === 'reopened';
        const isCurrent = w.weekStart === currentStart;
        const stampedKey = canonicalTimesheetProgramKey(w.programType || resolvedPt);
        const wantKey = canonicalTimesheetProgramKey(programType);
        // Hard exclude bins stamped for a different program than the provider picker.
        // "Elmont UFSD" and "Elmont UFSD Therapy" are the same district.
        const wrongProgram = Boolean(wantKey && stampedKey && stampedKey !== wantKey);
        const pending =
          !wrongProgram &&
          (isCurrent || w.status === 'submitted' || !draft) &&
          !fullyPaid &&
          (scoped.length > 0 || isCurrent || w.status === 'submitted');
        return {
          id: w.id,
          weekStart: w.weekStart,
          status: w.status,
          sessionCount: scoped.length,
          isCurrent,
          processed: fullyPaid,
          draft,
          pending,
          wrongProgram,
          providerSigned: Boolean(String(w.providerSignedKey || '').trim()),
          providerSignedKey: String(w.providerSignedKey || '').trim(),
          programType: resolvedPt,
          schoolId: String(w.schoolId || '').trim(),
          signerName: String(w.signerName || '').trim(),
          signerEmail: String(w.signerEmail || '').trim(),
          hhaStatus: rollup.status,
          hhaConfirmed: wantPt ? scopedConfirmed : rollup.confirmed,
          hhaEligible: wantPt ? scopedEligible : rollup.eligible,
        };
      })
      .filter((w) => {
        if (!wantPt) return true;
        if (w.wrongProgram) return false;
        // Keep only bins with sessions in this program (or empty current week for workspace).
        return w.sessionCount > 0 || (w.isCurrent && !programTypeKey(w.programType));
      })
      .sort((a, b) => {
        const byWeek = String(b.weekStart).localeCompare(String(a.weekStart));
        if (byWeek) return byWeek;
        return String(a.programType || '').localeCompare(String(b.programType || ''), undefined, {
          sensitivity: 'base',
        });
      });
    // Collapse duplicate list rows for the same Monday+program (legacy school/signer splits).
    // Fold should already have merged sessions; if fragments remain, prefer the richer row
    // and sum session counts so Draft never under-counts (e.g. 9+12 → 21).
    const dedupeKey = (w: (typeof weeks)[number]) =>
      `${w.weekStart}::${programTypeKey(w.programType) || '_'}`;
    const dedupedWeeks: typeof weeks = [];
    const seen = new Map<string, number>();
    for (const w of weeks) {
      const key = dedupeKey(w);
      const idx = seen.get(key);
      if (idx == null) {
        seen.set(key, dedupedWeeks.length);
        dedupedWeeks.push(w);
        continue;
      }
      const prev = dedupedWeeks[idx]!;
      const prevRank =
        (prev.providerSigned ? 1000 : 0) +
        (String(prev.signerEmail || '').trim() ? 50 : 0) +
        prev.sessionCount;
      const nextRank =
        (w.providerSigned ? 1000 : 0) +
        (String(w.signerEmail || '').trim() ? 50 : 0) +
        w.sessionCount;
      const keep = nextRank > prevRank ? w : prev;
      const drop = keep.id === w.id ? prev : w;
      dedupedWeeks[idx] = {
        ...keep,
        sessionCount: prev.sessionCount + w.sessionCount,
        providerSigned: Boolean(keep.providerSigned || drop.providerSigned),
        signerName: keep.signerName || drop.signerName,
        signerEmail: keep.signerEmail || drop.signerEmail,
      };
    }
    const weeksOut = dedupedWeeks;
    const mapSessions = (
      sessions: Array<{
        session: (typeof store.data.sessions)[number];
        week: (typeof weeksOut)[number];
      }>,
    ) =>
      sessions
        .map(({ session: s, week: w }) => {
          const dayPeers = providerDaySessions(
            store.data.sessions,
            store.data.weeks,
            providerId,
            s.dateOfService,
            s.id,
          );
          const payOpts = {
            presentGroupPeerCount: presentGroupPeerCount({
              candidate: s,
              peers: dayPeers,
              mandates: store.data.mandates,
            }),
            mandateDurationMinutes: mandateDurationMinutesForSession(s, store.data.mandates),
          };
          const student = store.data.students.find((st) => st.id === s.studentId);
          const transfer = store.transferForSession(s.id);
          return {
            id: s.id,
            weekId: w.id,
            weekStart: w.weekStart,
            weekStatus: w.status,
            dateOfService: s.dateOfService,
            attendance: s.attendance,
            beginTime: s.beginTime || '',
            endTime: s.endTime || '',
            payAmount: payProvider ? sessionPayAmount(payProvider, s, payOpts) : null,
            studentId: s.studentId,
            studentName: sessionListedChildName(
              s,
              student ? `${student.firstName} ${student.lastName}`.trim() : '',
            ),
            programType: String(s.programType || student?.programType || w.programType || '').trim(),
            schoolId: String(student?.schoolId || '').trim(),
            hhaStatus: transfer?.status || 'none',
          };
        })
        .sort((a, b) => {
          const da = String(b.dateOfService || '').localeCompare(String(a.dateOfService || ''));
          if (da) return da;
          const byPt = String(a.programType || '').localeCompare(String(b.programType || ''), undefined, {
            sensitivity: 'base',
          });
          if (byPt) return byPt;
          return String(b.beginTime || '').localeCompare(String(a.beginTime || ''));
        });
    const mapWeekSessions = (weekIds: Set<string>) =>
      mapSessions(
        weeksOut
          .filter((w) => weekIds.has(w.id))
          .flatMap((w) => {
            const scoped = filterSessionsByProgramType(
              store,
              store.sessionsForWeek(w.id),
              programType || undefined,
            );
            return scoped.map((session) => ({ session, week: w }));
          }),
      );
    // Processed = successfully synced to HHA (paid path), not merely signed/locked.
    const processedSessions = mapSessions(
      weeksOut.flatMap((w) => {
        const scoped = filterSessionsByProgramType(
          store,
          store.sessionsForWeek(w.id),
          programType || undefined,
        );
        return scoped
          .filter((s) => confirmedSessionIds.has(s.id))
          .map((session) => ({ session, week: w }));
      }),
    );
    // Draft / reopened weeks with sessions — including prior Mondays (last week / two weeks ago).
    // Import still respects the 14-day locker; viewing and sending these drafts stays allowed.
    // Already program-scoped via weeksOut filter (wrong-program bins dropped).
    const draftWeeks = weeksOut.filter((w) => w.draft && w.sessionCount > 0);
    const draftSessions = mapWeekSessions(new Set(draftWeeks.map((w) => w.id)));
    // Pending weeks (current + submitted + unpaid signed). Prior drafts stay on Draft tab rows,
    // but their Mondays still appear in the Pending week selector so providers can navigate.
    const pendingWeeks = weeksOut.filter((w) => w.pending);
    // Always offer a rolling window of recent Mondays (not only current), plus any draft/pending
    // weekStarts that fall outside that window.
    const RECENT_PENDING_WEEK_COUNT = 8;
    const recentWeekStarts: string[] = [];
    {
      let ws = currentStart;
      for (let i = 0; i < RECENT_PENDING_WEEK_COUNT; i++) {
        if (!ws) break;
        recentWeekStarts.push(ws);
        const dt = parseDos(ws);
        if (!dt) break;
        dt.setUTCDate(dt.getUTCDate() - 7);
        ws = dt.toISOString().slice(0, 10);
      }
    }
    const pendingWeekStarts = [
      ...new Set([
        ...pendingWeeks.map((w) => w.weekStart).filter(Boolean),
        ...draftWeeks.map((w) => w.weekStart).filter(Boolean),
        ...recentWeekStarts,
      ]),
    ].sort((a, b) => String(b).localeCompare(String(a)));
    return json(200, {
      weeks: weeksOut,
      currentWeekStart: currentStart,
      processedSessions,
      draftWeeks,
      draftSessions,
      pendingWeeks,
      pendingWeekStarts,
      pendingWeekWindow: RECENT_PENDING_WEEK_COUNT,
      programType: programType || '',
    });
  }

  if (req.method === 'GET' && path === '/week') {
    const provider = providerFor(store, ctx.user);
    if (!provider && ctx.user.role !== 'admin') return json(400, { error: 'No provider profile on this login.' });
    const weekStart = String(req.query.weekStart || obj(req).weekStart || '');
    const providerId = String(req.query.providerId || provider?.id || '');
    const schoolId = String(req.query.schoolId || '').trim();
    const programType = String(req.query.programType || '').trim();
    const matchedWeeks = weeksForProviderStart(store, providerId, weekStart);
    // Prefer the program-type bin (district/payer). School id is a secondary signer hint.
    let scopeSchoolId = schoolId;
    if (!scopeSchoolId && programType && matchedWeeks.length > 1) {
      const ptKey = programTypeKey(programType);
      const withProgramSessions = matchedWeeks.find((w) =>
        store.sessionsForWeek(w.id).some((s) => {
          const st = store.data.students.find((x) => x.id === s.studentId);
          return st && programTypeKey(st.programType) === ptKey;
        }),
      );
      if (withProgramSessions) {
        scopeSchoolId = resolveWeekSchoolId(store, withProgramSessions);
      } else {
        const stamped = matchedWeeks.find(
          (w) => programTypeKey(resolveWeekProgramType(store, w)) === ptKey,
        );
        if (stamped) scopeSchoolId = resolveWeekSchoolId(store, stamped);
      }
    }
    let week = pickWeekForScope(store, matchedWeeks, {
      providerId,
      schoolId: scopeSchoolId || undefined,
      programType: programType || undefined,
    });
    // Therapist school picker is metadata — if that bin is empty/missing, surface the sibling
    // week that actually has sessions so admin-imported rows remain visible.
    // When programType is set, only fall back to a week that has sessions in that program.
    if (ctx.user.role !== 'admin') {
      const emptyOrMissing = !week || store.sessionsForWeek(week.id).length === 0;
      if (emptyOrMissing && matchedWeeks.length) {
        const withSessions = matchedWeeks.find((w) => {
          const sess = store.sessionsForWeek(w.id);
          if (!sess.length) return false;
          if (!programType) return true;
          return sess.some((s) => sessionMatchesProgramType(store, s, programType));
        });
        if (withSessions) week = withSessions;
      }
    }
    // Scope sessions to the selected program type (district/payer) when provided.
    // Caseload already filters by programType; pending/processed lists must match.
    const sessions = filterSessionsByProgramType(
      store,
      week ? store.sessionsForWeek(week.id) : [],
      programType || undefined,
    );
    const nameMap = studentNameById(store);
    const students = visibleStudents(
      store,
      ctx.user,
      weekStart || week?.weekStart || '',
      schoolId || undefined,
      programType || undefined,
    );
    const check = week
      ? checkMandatesForWeek(
          store.data.mandates,
          sessions,
          store.data.sessions,
          nameMap,
          {
            ...providerWeekMandateOpts(store, providerId, weekStart || week.weekStart || ''),
            // Caseload kids with 0 sessions still feed weekly 0-of-N, monthly, and cycle checks.
            // Discharged mandates and other providers' children are not yellow under-mandate warnings.
            includeStudentIds: students.map((s) => s.id),
          },
        )
      : { errors: [] as string[], warnings: [] as string[] };
    const ai = week ? collectHeuristicAiIssues(sessions) : { errors: [] as string[], warnings: [] as string[] };
    const payProvider =
      store.data.providers.find((p) => p.id === (week?.providerId || providerId)) || provider;
    const payProviderId = week?.providerId || providerId;
    const soloNoteErrors: string[] = [];
    const sessionsOut = sessions.map((s) => {
      const local = screenServiceNote(s);
      const flags = [...new Set([...(s.aiFlags || []), ...local.flags])];
      const dayPeers = payProviderId
        ? providerDaySessions(store.data.sessions, store.data.weeks, payProviderId, s.dateOfService, s.id)
        : [];
      const payOpts = {
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
        mandateDurationMinutes: mandateDurationMinutesForSession(s, store.data.mandates),
      };
      // Additional services (eval, report, consult, meeting, documentation) are never
      // group or individual visits: skip the solo-group note check for them.
      const soloNote = isAdditionalServiceType(s.additionalServiceType || '')
        ? null
        : soloGroupMandateNoteError({
            notes: s.notes,
            serviceType: s.serviceType,
            cptCodes: s.cptCodes,
            studentId: s.studentId,
            attendance: s.attendance,
            mandates: store.data.mandates,
            presentGroupPeerCount: payOpts.presentGroupPeerCount,
            additionalServiceType: s.additionalServiceType,
          });
      if (soloNote) {
        const who = nameMap.get(s.studentId) || s.studentId;
        soloNoteErrors.push(`${s.dateOfService} ${who}: ${soloNote}`);
      }
      return {
        ...s,
        studentName: sessionListedChildName(s, nameMap.get(s.studentId) || ''),
        aiFlags: flags,
        aiBlock:
          errorsAfterAllowedOverrides(store.data.blockReports || [], payProviderId, [
            ...(local.block ? local.blockFlags : []),
            ...(s.aiBlock ? s.aiFlags || [] : []),
          ]).length > 0,
        payAmount: payProvider ? sessionPayAmount(payProvider, s, payOpts) : null,
      };
    });
    const schoolDistrict = week
      ? schoolDistrictForWeek(store, week.id, schoolId || week.schoolId || undefined)
      : '';
    if (week && therapistCanEdit(week.status)) {
      const signerSchool = resolveWeekSchool(store, providerId, {
        weekId: week.id,
        preferredSchoolId: schoolId || week.schoolId || undefined,
      });
      week = stampWeekSignerFromSchool(store, week, signerSchool);
      if (signerSchool?.id && week.schoolId !== signerSchool.id) {
        week = store.upsertWeek({ ...week, schoolId: signerSchool.id });
      }
    }
    const siblingWeeks = weekStart
      ? weeksForProviderStart(store, providerId, weekStart)
          .filter((w) => w.id !== week?.id)
          .map((w) => {
            const sid = resolveWeekSchoolId(store, w);
            const school = sid ? store.data.schools.find((s) => s.id === sid) : undefined;
            const pt = resolveWeekProgramType(store, w);
            return {
              id: w.id,
              weekStart: w.weekStart,
              status: w.status,
              schoolId: sid,
              schoolName: school?.name || '',
              district: school?.district || '',
              programType: pt,
              signerName: w.signerName,
              signerEmail: w.signerEmail,
              sessionCount: store.sessionsForWeek(w.id).length,
            };
          })
      : [];
    return json(200, {
      week,
      sessions: sessionsOut,
      students,
      schoolDistrict,
      programType: programType || '',
      siblingWeeks,
      mandates: store.data.mandates.filter((m) => students.some((s) => s.id === m.studentId) || ctx.user.role === 'admin'),
      warnings: [...new Set([...check.warnings, ...ai.warnings])],
      errors: errorsAfterAllowedOverrides(store.data.blockReports || [], providerId, [
        ...new Set([...check.errors, ...ai.errors, ...soloNoteErrors]),
      ]),
    });
  }

  if (req.method === 'POST' && path === '/week/ensure') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    const providerId = String(b.providerId || provider?.id || '');
    const weekStart = String(b.weekStart || '');
    const schoolId = String(b.schoolId || '').trim();
    const programType = String(b.programType || '').trim();
    if (!providerId || !weekStart) return json(400, { error: 'providerId and weekStart are required.' });
    const aliasWeeks = weeksForProviderStart(store, providerId, weekStart);
    foldEditableSameBinWeeks(store, aliasWeeks, {
      preferProgramType: programType || undefined,
    });
    const healedWeeks = weeksForProviderStart(store, providerId, weekStart);
    let week = pickWeekForScope(store, healedWeeks, {
      providerId,
      schoolId: schoolId || undefined,
      programType: programType || undefined,
    });
    // Signer from session children's school when present; picker/caseload only if empty week.
    const preferredSchool = resolveWeekSchool(store, providerId, {
      weekId: week?.id,
      preferredSchoolId: schoolId || undefined,
    });
    if (!week) {
      const signer = resolveSchoolOrDistrictSigner(
        store,
        preferredSchool,
        programType || '',
      );
      week = store.upsertWeek({
        id: newId(),
        providerId,
        weekStart,
        schoolId: preferredSchool?.id || schoolId || '',
        programType: programType || '',
        status: 'draft',
        signerName: signer.signerName || '',
        signerEmail: signer.signerEmail || '',
        timesheetKey: '',
        signedKey: '',
        envelopeId: '',
        hhaStatus: 'none',
        hhaError: '',
      });
    } else {
      week = stampWeekSignerFromSchool(store, week, preferredSchool);
      if (therapistCanEdit(week.status)) {
        const patch: Partial<WeeklyPeriod> = {};
        if (preferredSchool?.id) {
          const stampedId = String(week.schoolId || '').trim();
          if (!stampedId || stampedId === preferredSchool.id) {
            patch.schoolId = preferredSchool.id;
          }
        }
        if (programType) {
          const stamped = String(week.programType || '').trim();
          if (
            !stamped ||
            (canonicalTimesheetProgramKey(stamped) === canonicalTimesheetProgramKey(programType) &&
              programType.length > stamped.length)
          ) {
            patch.programType = programType;
          }
        }
        if (Object.keys(patch).length) {
          week = store.upsertWeek({ ...week, ...patch });
        }
      }
    }
    return json(200, { week, school: preferredSchool || null });
  }

  if (req.method === 'POST' && path === '/week/read-notes') {
    const b = obj(req);
    const text = pdfTextFromBody(b) || textBody(req) || String(b.pdfText || '');
    if (!String(text).trim()) {
      const error = bodyHasPdfBytes(b)
        ? PDF_NO_TEXT_ERROR
        : 'Choose a notes PDF (or paste the report text).';
      return json(400, { error, errors: [error], created: false });
    }
    const parsed = parseWeeklySessionText(text);
    if (!parsed.length) {
      const error =
        'Could not find any sessions in this PDF. Use a Frontline Related Service Session Notes or Therapist Activity Output report with a text layer (not a scan).';
      return json(400, { error, errors: [error], created: false });
    }
    try {
      const read = await readSessionNotesWithBedrock(parsed);
      return json(200, { ok: true, created: false, ...read });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Claude could not read this note.';
      return json(502, { error, errors: [error], created: false });
    }
  }

  if (req.method === 'POST' && path === '/week/upload-sessions') {
    const provider = providerFor(store, ctx.user);
    const b = obj(req);
    let providerId = String(b.providerId || provider?.id || '');
    if (!providerId) {
      const error =
        ctx.user.role === 'admin'
          ? 'providerId is required to import sessions for a provider.'
          : 'Your provider profile is not linked yet. Ask the office for help.';
      return json(400, { error, errors: [error] });
    }
    if (ctx.user.role !== 'admin' && provider?.id !== providerId) {
      return json(403, { error: 'You can only import sessions for your own provider profile.' });
    }
    // Prefer login-linked / requested id; fold alias twins onto that canonical id.
    const aliasIds = providerLookupIds(store, providerId);
    if (provider?.id && aliasIds.includes(provider.id)) {
      providerId = provider.id;
    }
    const accountProvider =
      (providerId ? store.data.providers.find((p) => p.id === providerId) : undefined) || provider;
    if (!accountProvider) {
      return json(404, { error: 'Provider not found.' });
    }
    const text = pdfTextFromBody(b) || textBody(req) || String(b.pdfText || '');
    if (!String(text).trim()) {
      const error = bodyHasPdfBytes(b)
        ? PDF_NO_TEXT_ERROR
        : 'Choose a weekly notes PDF (or paste the report text).';
      console.warn('upload-sessions 400', error, {
        hasPdf: bodyHasPdfBytes(b),
        pdfBase64Len: typeof b.pdfBase64 === 'string' ? b.pdfBase64.length : 0,
      });
      return json(400, { error, errors: [error] });
    }
    const parsed = parseWeeklySessionText(text);
    if (!parsed.length) {
      const error =
        'Could not find any sessions in this PDF. Use a Frontline Related Service Session Notes or Therapist Activity Output report with a text layer (not a scan).';
      console.warn('upload-sessions 400', error, { textLen: String(text).length });
      return json(400, { error, errors: [error] });
    }

    // Provider mismatch is whole-file — cannot attribute rows to this account safely.
    const pdfProviderName = parsed.map((r) => r.providerName).find((n) => String(n || '').trim()) || '';
    if (pdfProviderName) {
      if (!findProviderByName([accountProvider], pdfProviderName)) {
        const error =
          ctx.user.role === 'admin'
            ? `Provider in PDF does not match this provider profile (PDF: "${pdfProviderName}").`
            : `Provider in PDF does not match your account (PDF: "${pdfProviderName}").`;
        return json(400, { error, errors: [error], saved: [], failed: [], skipped: [] });
      }
    }

    // Attach each session to the Monday week of its date of service (no calendar picker required),
    // scoped by the child's program type so multi-district imports become separate timesheets.
    const weekCache = new Map<string, (typeof store.data.weeks)[number]>();
    /** Weeks created by this upload attempt — discarded on failure when still session-empty. */
    const createdWeekIds = new Set<string>();
    const uploadSchoolId = String(b.schoolId || '').trim();
    const uploadProgramType = String(b.programType || '').trim();
    const ensureWeek = (weekStart: string, sessionSchoolId?: string, sessionProgramType?: string) => {
      const scopeSchoolId = String(sessionSchoolId || uploadSchoolId || '').trim();
      const scopeProgramType = String(sessionProgramType || uploadProgramType || '').trim();
      // One cache entry per Monday + program type (buildings share the same timesheet).
      const cacheKey = `${weekStart}::${canonicalTimesheetProgramKey(scopeProgramType) || '_'}`;
      let w = weekCache.get(cacheKey);
      if (w && therapistCanImportOrAddServices(w.status)) return w;
      const matched = weeksForProviderStart(store, providerId, weekStart);
      foldEditableSameBinWeeks(store, matched, {
        preferProgramType: scopeProgramType || undefined,
      });
      const healed = weeksForProviderStart(store, providerId, weekStart);
      w = pickWeekForScope(store, healed, {
        providerId,
        // Prefer program-type scope so Middle/High buildings fold onto one sheet.
        schoolId: scopeProgramType ? undefined : scopeSchoolId || undefined,
        programType: scopeProgramType || undefined,
      });
      // Signed/locked sheet stays put. A scoped upload opens (or reuses) one draft.
      // An unscoped probe must not create a blank draft next to that locked sheet.
      if (w && weekIsProcessed(w.status) && (scopeProgramType || scopeSchoolId)) {
        const idsBefore = new Set(
          weeksForProviderStart(store, providerId, weekStart).map((row) => row.id),
        );
        w = openDraftBesideProcessed(store, w, {
          providerId,
          programType: scopeProgramType,
          schoolId: scopeSchoolId,
        });
        if (!idsBefore.has(w.id)) createdWeekIds.add(w.id);
      }
      if (!w) {
        const school = resolveWeekSchool(store, providerId, {
          preferredSchoolId: scopeSchoolId || undefined,
        });
        const signer = resolveSchoolOrDistrictSigner(
          store,
          school,
          scopeProgramType || '',
        );
        w = store.upsertWeek({
          id: newId(),
          providerId,
          weekStart,
          schoolId: school?.id || scopeSchoolId || '',
          programType: scopeProgramType || '',
          status: 'draft',
          signerName: String(b.signerName || signer.signerName || ''),
          signerEmail: String(b.signerEmail || signer.signerEmail || ''),
          timesheetKey: '',
          signedKey: '',
          envelopeId: '',
          hhaStatus: 'none',
          hhaError: '',
        });
        createdWeekIds.add(w.id);
      } else if (therapistCanEdit(w.status)) {
        const patch: Partial<WeeklyPeriod> = {};
        if (scopeSchoolId && !String(w.schoolId || '').trim()) {
          const school = store.data.schools.find((s) => s.id === scopeSchoolId);
          const signer = resolveSchoolOrDistrictSigner(
            store,
            school,
            scopeProgramType || w.programType,
          );
          patch.schoolId = scopeSchoolId;
          patch.signerName = signer.signerName || w.signerName;
          patch.signerEmail = signer.signerEmail || w.signerEmail;
        }
        if (scopeProgramType) {
          const stamped = String(w.programType || '').trim();
          if (
            !stamped ||
            (canonicalTimesheetProgramKey(stamped) ===
              canonicalTimesheetProgramKey(scopeProgramType) &&
              scopeProgramType.length > stamped.length)
          ) {
            patch.programType = scopeProgramType;
          }
        }
        // Backfill signer from building or district onto an unsigned program week.
        if (!String(w.signerEmail || '').trim()) {
          const school = scopeSchoolId
            ? store.data.schools.find((s) => s.id === scopeSchoolId)
            : resolveWeekSchool(store, providerId, { weekId: w.id });
          const signer = resolveSchoolOrDistrictSigner(
            store,
            school,
            scopeProgramType || w.programType,
          );
          if (signer.signerEmail) {
            patch.signerName = signer.signerName || w.signerName;
            patch.signerEmail = signer.signerEmail;
          }
        }
        if (Object.keys(patch).length) {
          w = store.upsertWeek({ ...w, ...patch });
        }
      }
      weekCache.set(cacheKey, w);
      return w;
    };
    const fallbackWeekStart = String(
      b.weekStart || (parsed[0] ? weekStartFromDos(parsed[0].dateOfService) : ''),
    );
    // Do not create a draft week until a row is far enough along to need one.
    // Failed validation must not leave empty Provider status Drafts rows.
    let week: (typeof store.data.weeks)[number] | undefined;
    if (!fallbackWeekStart) {
      return json(400, {
        error: 'Could not determine a week for this upload (missing dates of service).',
        errors: ['Could not determine a week for this upload (missing dates of service).'],
      });
    }
    const discardEmptyCreatedWeeks = () => {
      for (const id of createdWeekIds) {
        if (store.sessionsForWeek(id).length > 0) continue;
        store.removeWeek(id);
        for (const [key, cached] of weekCache) {
          if (cached.id === id) weekCache.delete(key);
        }
        if (week?.id === id) week = undefined;
      }
    };

    type UploadFail = {
      studentName: string;
      dateOfService: string;
      beginTime: string;
      endTime: string;
      error: string;
      severity?: 'error' | 'warn';
    };
    type UploadSaved = {
      id: string;
      studentId: string;
      studentName: string;
      dateOfService: string;
      beginTime: string;
      endTime: string;
      notes: string;
    };
    const failed: UploadFail[] = [];
    const blockReportId = String(b.blockReportId || '').trim();
    const heldOverride = blockReportId
      ? (store.data.blockReports || []).find((row) => row.id === blockReportId)
      : undefined;
    const overrideErrorTexts =
      heldOverride &&
      heldOverride.status === 'allowed' &&
      heldOverride.providerId === providerId &&
      (ctx.user.role === 'admin' || heldOverride.therapistUserId === ctx.user.id)
        ? heldOverride.errors
        : [];
    const importProvider = store.data.providers.find((p) => p.id === providerId);
    // Admin "partial import" locker (default OFF). OFF: one error rejects the whole PDF.
    // ON: only rows with no error are saved; every error row is skipped and listed.
    // A row with an error is never saved in either mode (unknown child, unreadable name,
    // signed/locked week, 14-day age lock, discipline mismatch, overlap, mandate ...).
    const partialImportLocker = getAppSettings(store).allowImportWithHardBlocks === true;
    const rejectUploadRow = (row: UploadFail): boolean => {
      if (
        overrideErrorTexts.length &&
        canWaiveUploadError(row.error) &&
        uploadErrorOverridden(overrideErrorTexts, row.error)
      ) {
        return false;
      }
      failed.push(row);
      return true;
    };
    const pending: Array<{ session: SessionRow; studentName: string }> = [];
    const skipped: UploadSaved[] = [];
    const softWarns: string[] = [];
    const names = studentNameById(store);
    const settings = getAppSettings(store);
    const yellowBlocks = settings.yellowWarningsBlockImport !== false;
    const existingKeys = new Map<string, SessionRow>();
    for (const s of store.data.sessions) {
      const sw = store.data.weeks.find((w) => w.id === s.weekId);
      if (sw && providerLookupIds(store, providerId).includes(sw.providerId)) {
        existingKeys.set(uploadSessionKey(s), s);
      }
    }

    const resolveStudent = (studentName: string) =>
      findStudentForActivityName(store.data.students, studentName);

    // Sort so earlier sessions claim mandate slots first when some exceed.
    const ordered = [...parsed].sort((a, b) => {
      const da = parseDos(a.dateOfService)?.getTime() ?? 0;
      const db = parseDos(b.dateOfService)?.getTime() ?? 0;
      if (da !== db) return da - db;
      return String(a.beginTime || '').localeCompare(String(b.beginTime || ''));
    });

    // Validate all rows in memory first — all-or-nothing (no partial save).
    for (const row of ordered) {
      const label = formatUploadRowLabel(row);
      const display = String(row.studentName || '').trim() || 'Unknown';
      if (!String(row.studentName || '').trim()) {
        console.warn('upload-sessions empty-name slice', {
          providerId,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          sliceHead: String(row.sourceSlice || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 320),
        });
        if (rejectUploadRow({
          studentName: display,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: Could not read the student name from this PDF row. Re-export/re-scan the note so the child name and program id appear next to the date/time, then try again.`,
        })) continue;
      }
      const student = resolveStudent(row.studentName);
      if (!student) {
        if (rejectUploadRow({
          studentName: display,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: Not found. Please reach out to your administrator to import the caseload first.`,
        })) continue;
      }
      const studentName =
        `${student.firstName} ${student.lastName}`.trim() || display;

      const rowWeekStart = weekStartFromDos(row.dateOfService) || fallbackWeekStart;
      const targetWeek = ensureWeek(rowWeekStart, student.schoolId, student.programType);
      week = targetWeek;
      if (!therapistCanImportOrAddServices(targetWeek.status) && ctx.user.role !== 'admin') {
        const lockMsg =
          targetWeek.status === 'submitted'
            ? 'Week is awaiting signature — cancel approval before importing.'
            : weekIsProcessed(targetWeek.status)
              ? 'Week is signed/locked — revoke the signature before importing.'
              : 'This week cannot accept imports.';
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${lockMsg}`,
        })) continue;
      }

      const ageErr = sessionImportAgeError(row.dateOfService, {
        settings,
        providerId,
        weekId: targetWeek.id,
        isAdmin: ctx.user.role === 'admin',
      });
      if (ageErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${ageErr}`,
        })) continue;
      }

      const rawSchool = String(row.schoolName || row.location || '').trim();
      const pdfSchool =
        rawSchool && !isGenericSettingLabel(rawSchool) && !isNonSchoolLikeSetting(rawSchool)
          ? rawSchool
          : '';
      if (pdfSchool) {
        const knownSchool = store.data.schools.find((s) => s.id === student.schoolId);
        if (
          knownSchool &&
          pdfSchoolConflictsWithChild(pdfSchool, knownSchool, student.programType, {
            sameDistrictSchoolNames: sameDistrictSchoolNames(
              store,
              knownSchool,
              student.programType,
            ),
          })
        ) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: School '${pdfSchool}' does not match child's school '${knownSchool.name}'.`,
          })) continue;
        }
        if (!knownSchool) {
          const exists = store.data.schools.some(
            (s) =>
              Boolean(String(s.name || '').trim()) &&
              !pdfSchoolConflictsWithChild(pdfSchool, s, undefined, {
                sameDistrictSchoolNames: sameDistrictSchoolNames(store, s, undefined),
              }),
          );
          if (!exists) {
            if (rejectUploadRow({
              studentName,
              dateOfService: row.dateOfService,
              beginTime: row.beginTime,
              endTime: row.endTime,
              error: `${label}: School '${pdfSchool}' not found`,
            })) continue;
          }
        }
      }

      const key = uploadSessionKey({
        studentId: student.id,
        dateOfService: row.dateOfService,
        beginTime: row.beginTime,
        endTime: row.endTime,
        attendance: row.attendance,
      });
      const already = existingKeys.get(key);
      if (already) {
        // Exact duplicate (same child+DOS+times+attendance) of an already-saved session → skip save.
        // Missed vs attended at the same slot are different records and must not collide.
        // Locker #38 still re-validates below — duplicate skip must never bypass the note gate.
        skipped.push({
          id: already.id,
          studentId: already.studentId,
          studentName,
          dateOfService: already.dateOfService,
          beginTime: already.beginTime,
          endTime: already.endTime,
          notes: already.notes,
        });
        continue;
      }

      const cptCodes = row.cptCodes || [];
      const cptUnits = row.cptUnits || 0;
      const cptProcedures = row.cptProcedures || [];
      let session: SessionRow = {
        id: newId(),
        weekId: targetWeek.id,
        studentId: student.id,
        dateOfService: row.dateOfService,
        beginTime: row.attendance === 'missed' ? '' : row.beginTime,
        endTime: row.attendance === 'missed' ? '' : row.endTime,
        attendance: row.attendance,
        cancelReason: row.cancelReason,
        makeupOfSessionId: '',
        serviceType: row.serviceType,
        additionalServiceType: '',
        location: row.location,
        notes: row.notes,
        cptCodes,
        cptUnits,
        cptLabel: cptLabelFromParts(cptCodes, cptProcedures, cptUnits),
        aiFlags: [],
        aiBlock: false,
      };

      const serviceTypeErr = sessionServiceTypeRequiredError(session.serviceType);
      if (serviceTypeErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${serviceTypeErr}`,
        })) continue;
      }

      // Always on: the session's service-type discipline must match the provider's.
      // Additional services are exempt. Not waivable by any switch or block-report override.
      {
        const disciplineErr = sessionProviderDisciplineMismatchError(
          session,
          importProvider,
          store.data.mandates,
        );
        if (disciplineErr) {
          failed.push({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${disciplineErr}`,
          });
          continue;
        }
      }

      const projectedSessions = [
        ...store.sessionsForWeek(targetWeek.id),
        ...pending.filter((p) => p.session.weekId === targetWeek.id).map((p) => p.session),
        session,
      ];
      const allSessionsProjected = [
        ...store.data.sessions.filter((s) => s.weekId !== targetWeek.id),
        ...projectedSessions,
        ...pending.filter((p) => p.session.weekId !== targetWeek.id).map((p) => p.session),
      ];

      if (session.attendance === 'makeup') {
        const resolved = resolveMakeupOfSessionId(session, allSessionsProjected, store.data.mandates);
        if ('error' in resolved) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${resolved.error}`,
          })) continue;
        }
        if (!('error' in resolved)) {
          session = { ...session, makeupOfSessionId: resolved.makeupOfSessionId };
        }
        const makeupErr = validateMakeup(session, allSessionsProjected, store.data.mandates);
        if (makeupErr) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${makeupErr}`,
          })) continue;
        }
      }

      const missedReasonErr = missedSessionReasonError(
        session.attendance,
        session.cancelReason,
        session.notes,
      );
      if (missedReasonErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${missedReasonErr}`,
        })) continue;
      }

      const cptErr = cptDurationError(
        session.beginTime,
        session.endTime,
        { codes: cptCodes, totalUnits: cptUnits, procedures: cptProcedures },
        session.attendance,
        { serviceType: session.serviceType, ratio: row.ratio },
      );
      if (cptErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${cptErr}`,
        })) continue;
      }

      const sigErr = sessionSignatureError(row.sourceSlice || row.notes || '', session.attendance);
      if (sigErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${sigErr}`,
        })) continue;
      }

      const dayPeers = [
        ...providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          providerId,
          session.dateOfService,
          session.id,
        ),
        ...pending
          .map((p) => p.session)
          .filter((s) => s.dateOfService === session.dateOfService),
      ];
      // Solo-group note locker (regular sessions only; imports are never additional services).
      // Checked per row, before overlap / mandate, so a row that fails it never holds a slot
      // and the partial-import mode re-validates the remaining rows without it.
      if (!isAdditionalServiceType(session.additionalServiceType || '')) {
        const soloNoteErr = soloGroupMandateNoteError({
          notes: session.notes,
          serviceType: session.serviceType,
          cptCodes: session.cptCodes,
          studentId: session.studentId,
          attendance: session.attendance,
          mandates: store.data.mandates,
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
        });
        if (soloNoteErr) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${soloNoteErr}`,
          })) continue;
        }
      }
      const overlapErr = sessionOverlapError({
        candidate: session,
        peers: dayPeers,
        studentNameById: names,
        mandates: store.data.mandates,
      });
      if (overlapErr) {
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${overlapErr}`,
        })) continue;
      }

      const notePeers: Array<{
        studentId: string;
        studentName: string;
        notes: string;
        dateOfService: string;
        attendance: string;
      }> = [
        ...pending.map((p) => ({
          studentId: p.session.studentId,
          studentName: p.studentName,
          notes: p.session.notes,
          dateOfService: p.session.dateOfService,
          attendance: p.session.attendance,
        })),
        ...store
          .sessionsForWeek(targetWeek.id)
          .filter((s) => s.studentId !== student.id)
          .map((s) => ({
            studentId: s.studentId,
            studentName: names.get(s.studentId) || s.studentId,
            notes: s.notes,
            dateOfService: s.dateOfService,
            attendance: s.attendance,
          })),
      ];
      // Copy-paste checks apply to attended & makeup only — never treat missed notes as sources.
      if (session.attendance === 'attended' || session.attendance === 'makeup') {
        const peer = notePeers.find(
          (p) =>
            p.studentId !== student.id &&
            noteIsCopyPasteSource(p.attendance, p.notes) &&
            notesLookCopyPasted(session.notes, p.notes),
        );
        if (peer) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: `${label}: ${noteCopyPasteError(studentName, peer.studentName, peer.dateOfService)}`,
          })) continue;
        }
      }

      const screened = screenServiceNote(session);
      session = {
        ...session,
        aiFlags: screened.flags,
        aiBlock: screened.block,
      };
      // Red/hard always rejects. Yellow rejects only when admin setting is on (default).
      if (screened.block) {
        const screenError = `${label}: ${screened.blockFlags.join('; ') || 'Note screening failed'}`;
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: screenError,
        })) continue;
        session = { ...session, aiBlock: false };
      }
      if (screened.warnFlags.length) {
        const warnMsg = `${label}: ${screened.warnFlags.join('; ')}`;
        softWarns.push(warnMsg);
        if (yellowBlocks) {
          if (rejectUploadRow({
            studentName,
            dateOfService: row.dateOfService,
            beginTime: row.beginTime,
            endTime: row.endTime,
            error: warnMsg,
            severity: 'warn',
          })) continue;
        }
      }

      const check = checkMandatesForWeek(
        store.data.mandates,
        projectedSessions,
        allSessionsProjected,
        names,
        mandateWeekOpts(store),
      );
      if (check.errors.length) {
        const detail =
          check.errors.find((e) => e.includes(studentName) || e.includes(session.dateOfService)) ||
          check.errors[0] ||
          'This exceeds the mandate.';
        if (rejectUploadRow({
          studentName,
          dateOfService: row.dateOfService,
          beginTime: row.beginTime,
          endTime: row.endTime,
          error: `${label}: ${detail}`,
        })) continue;
      }

      existingKeys.set(key, session);
      pending.push({ session, studentName });
    }

    // Re-check exact-duplicate skips against the existing saved row — re-import must
    // never silently accept a non-compliant solo-group session that slipped in earlier.
    // New rows were already checked in the row loop above; only the saved duplicates remain.
    {
      const pendingByDos = pending.map((p) => p.session);
      const toCheck: Array<{ session: SessionRow; studentName: string }> = [
        ...skipped
          .map((sk) => {
            const session = store.data.sessions.find((s) => s.id === sk.id);
            return session ? { session, studentName: sk.studentName } : null;
          })
          .filter((x): x is { session: SessionRow; studentName: string } => Boolean(x)),
      ];
      for (const item of toCheck) {
        if (isAdditionalServiceType(item.session.additionalServiceType || '')) continue;
        const dayPeers = [
          ...providerDaySessions(
            store.data.sessions,
            store.data.weeks,
            providerId,
            item.session.dateOfService,
            item.session.id,
          ),
          ...pendingByDos.filter(
            (s) => s.id !== item.session.id && s.dateOfService === item.session.dateOfService,
          ),
        ];
        const soloNoteErr = soloGroupMandateNoteError({
          notes: item.session.notes,
          serviceType: item.session.serviceType,
          cptCodes: item.session.cptCodes,
          studentId: item.session.studentId,
          attendance: item.session.attendance,
          mandates: store.data.mandates,
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: item.session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
        });
        if (soloNoteErr) {
          rejectUploadRow({
            studentName: item.studentName,
            dateOfService: item.session.dateOfService,
            beginTime: item.session.beginTime,
            endTime: item.session.endTime,
            error: `${formatUploadRowLabel({
              studentName: item.studentName,
              dateOfService: item.session.dateOfService,
              beginTime: item.session.beginTime,
              endTime: item.session.endTime,
            })}: ${soloNoteErr}`,
          });
        }
      }
    }

    const rawUploadName = String(b.fileName || b.filename || b.label || '').trim();
    const uploadSourceType = detectUploadSourceType(text);
    const uploadWeekStartLabel = week?.weekStart || fallbackWeekStart || 'upload';
    const defaultUploadFilename =
      rawUploadName ||
      (uploadSourceType === 'therapist_activity'
        ? `therapist-activity-${uploadWeekStartLabel}.pdf`
        : `frontline-${uploadWeekStartLabel}.pdf`);

    /** Persist PDF only after a successful import — blocked attempts must not clutter archive. */
    const archiveUploadPdf = async (
      status: 'imported',
      schoolIdHint?: string,
    ): Promise<string | null> => {
      if (!week) return null;
      const uploadPdf = pdfBufferFromBody(b);
      if (!uploadPdf?.length) return null;
      const archiveId = newId();
      const schoolId =
        String(b.schoolId || '').trim() ||
        String(schoolIdHint || '').trim() ||
        (() => {
          const firstStudent = pending[0]?.session.studentId;
          return firstStudent
            ? String(store.data.students.find((s) => s.id === firstStudent)?.schoolId || '')
            : '';
        })();
      const row = await persistArchivePdf({
        store,
        kind: 'upload',
        sourceType: uploadSourceType,
        userId: ctx.user.id,
        providerId,
        schoolId,
        weekId: week.id,
        weekStart: week.weekStart,
        filename: defaultUploadFilename,
        s3Key: `tms/archive/uploads/${providerId}/${archiveId}.pdf`,
        status,
        pdf: uploadPdf,
        replaceId: archiveId,
      });
      return row?.id || null;
    };

    // Partial-import locker ON and at least one clean row: save the clean rows below and
    // report every error row. Otherwise any issue → save nothing.
    const partialImport = partialImportLocker && failed.length > 0 && pending.length > 0;

    // Any issue → save nothing (audit log only — do not archive blocked PDFs).
    if (failed.length && !partialImport) {
      const errors = failed.map((f) => f.error);
      const attendanceCounts = parsed.reduce(
        (acc, r) => {
          acc[r.attendance] = (acc[r.attendance] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      console.warn('upload-sessions blocked', {
        providerId,
        filename: defaultUploadFilename,
        parsed: parsed.length,
        failed: failed.length,
        skipped: skipped.length,
        attendanceCounts,
        sampleErrors: errors.slice(0, 5),
      });
      const blockedWeekId = week?.id || '';
      const blockedWeekStart = week?.weekStart || fallbackWeekStart;
      // Drop empty drafts created only for this failed attempt (Provider status Drafts).
      discardEmptyCreatedWeeks();
      store.audit(ctx.user.id, 'upload_sessions', `provider:${providerId}`, null, {
        ok: false,
        filename: defaultUploadFilename,
        weekId: blockedWeekId,
        weekStart: blockedWeekStart,
        parsed: parsed.length,
        imported: 0,
        failed: failed.length,
        skipped: skipped.length,
        attendanceCounts,
        errors: errors.slice(0, 20),
      });
      const yellowMsgs = [
        ...new Set([
          ...softWarns,
          ...failed.filter((f) => f.severity === 'warn').map((f) => f.error),
        ]),
      ];
      const hardMsgs = failed.filter((f) => f.severity !== 'warn').map((f) => f.error);
      // Still blocked. Pending review starts only after Report incorrect error.
      return json(200, {
        ok: false,
        partial: false,
        week: week || null,
        sessions: week ? store.sessionsForWeek(week.id) : [],
        saved: [],
        failed,
        skipped,
        warnings: yellowMsgs,
        errors,
        error:
          hardMsgs[0] ||
          yellowMsgs[0] ||
          `Import blocked — ${failed.length} issue(s). Nothing was saved. Fix all errors and import again.`,
        parsed: parsed.length,
        imported: 0,
        notImported: failed.length,
        skippedCount: skipped.length,
      });
    }

    const saved: UploadSaved[] = [];
    for (const item of pending) {
      store.upsertSession(item.session);
      saved.push({
        id: item.session.id,
        studentId: item.session.studentId,
        studentName: item.studentName,
        dateOfService: item.session.dateOfService,
        beginTime: item.session.beginTime,
        endTime: item.session.endTime,
        notes: item.session.notes,
      });
    }

    if (partialImport) {
      // Drafts opened only for rows that were skipped stay out of the list.
      discardEmptyCreatedWeeks();
      const firstSavedWeekId = pending[0]!.session.weekId;
      if (week?.id !== firstSavedWeekId) {
        week = store.data.weeks.find((w) => w.id === firstSavedWeekId);
      }
    }

    // After sessions land, stamp signer from children's schools (not org schools[0] / picker).
    const touchedWeekIds = new Set(pending.map((p) => p.session.weekId).filter(Boolean));
    for (const wid of touchedWeekIds) {
      const w = store.data.weeks.find((x) => x.id === wid);
      if (!w) continue;
      const school = resolveWeekSchool(store, providerId, { weekId: w.id });
      const stamped = stampWeekSignerFromSchool(store, w, school);
      weekCache.set(stamped.weekStart, stamped);
      if (week?.id === stamped.id) week = stamped;
    }
    if (!week && pending[0]) {
      week = store.data.weeks.find((w) => w.id === pending[0]!.session.weekId);
    }
    if (!week) {
      // Duplicate-only reimport that never needed a new draft — nothing new to list.
      return json(200, {
        ok: true,
        partial: false,
        week: null,
        sessions: [],
        saved,
        failed: [],
        skipped,
        warnings: [...new Set(softWarns)],
        errors: [],
        parsed: parsed.length,
        imported: saved.length,
        skippedCount: skipped.length,
      });
    }

    const weekCheck = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(week.id),
      store.data.sessions,
      names,
      providerWeekMandateOpts(store, providerId, week.weekStart),
    );

    const archiveId = await archiveUploadPdf(
      'imported',
      saved[0]?.studentId
        ? String(store.data.students.find((s) => s.id === saved[0]!.studentId)?.schoolId || '')
        : '',
    );
    const attendanceCounts = parsed.reduce(
      (acc, r) => {
        acc[r.attendance] = (acc[r.attendance] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    console.info('upload-sessions imported', {
      providerId,
      filename: defaultUploadFilename,
      parsed: parsed.length,
      imported: saved.length,
      skipped: skipped.length,
      attendanceCounts,
      archiveId,
      weekId: week.id,
      weekStart: week.weekStart,
    });
    store.audit(ctx.user.id, 'upload_sessions', `provider:${providerId}`, null, {
      ok: true,
      filename: defaultUploadFilename,
      weekId: week.id,
      weekStart: week.weekStart,
      parsed: parsed.length,
      imported: saved.length,
      failed: failed.length,
      skipped: skipped.length,
      attendanceCounts,
      archiveId,
      ...(partialImport
        ? { partial: true, notImported: failed.length, errors: failed.map((f) => f.error).slice(0, 40) }
        : {}),
    });

    // Partial import (admin locker ON): the clean rows are saved, every error row is listed.
    const partialErrors = partialImport ? failed.map((f) => f.error) : [];
    return json(200, {
      ok: true,
      partial: partialImport,
      week,
      sessions: store.sessionsForWeek(week.id),
      saved,
      failed: partialImport ? failed : [],
      skipped,
      warnings: [
        ...new Set([
          ...softWarns,
          ...weekCheck.warnings,
        ]),
      ],
      errors: partialErrors,
      ...(partialImport
        ? {
            message:
              `Partial import: ${saved.length} clean session(s) saved. ` +
              `${failed.length} row(s) with errors were NOT imported and are listed below. ` +
              `Fix them and import the PDF again.`,
            notImported: failed.length,
          }
        : {}),
      parsed: parsed.length,
      imported: saved.length,
      skippedCount: skipped.length,
    });
  }

  if (req.method === 'POST' && path === '/week/sessions') {
    const b = obj(req);
    const week = store.data.weeks.find((w) => w.id === String(b.weekId || ''));
    if (!week) return json(404, { error: 'Week not found.' });
    // The yellow-warning locker applies to manual sessions / notes. The partial-import
    // locker is PDF-import only: a manual session with an error is never saved.
    const manualSettings = getAppSettings(store);
    const existing = store.data.sessions.find((s) => s.id === String(b.id || ''));
    if (existing) {
      if (!therapistCanMutateExistingSession(week.status, { isAdmin: ctx.user.role === 'admin' })) {
        return json(409, {
          error:
            week.status === 'submitted'
              ? 'Approval is pending. Cancel the signature request before editing sessions.'
              : 'This session was already processed and cannot be edited. Revoke the signature on this week before changing it.',
        });
      }
    } else if (
      !therapistCanImportOrAddServices(week.status) &&
      !weekIsProcessed(week.status) &&
      ctx.user.role !== 'admin'
    ) {
      return json(409, {
        error:
          week.status === 'submitted'
            ? 'This week is awaiting signature. Cancel the approval request before adding or editing sessions.'
            : 'This week cannot accept new sessions. Ask an admin to reopen it.',
      });
    }
    let attendance =
      b.attendance === 'missed' ||
      b.attendance === 'makeup' ||
      b.attendance === 'attended' ||
      b.attendance === 'paid_absence'
        ? b.attendance
        : existing?.attendance || 'attended';
    const rawAdditional = b.additionalServiceType;
    let additionalServiceType: SessionRow['additionalServiceType'] =
      String(existing?.additionalServiceType || '') === 'paid_absence'
        ? ''
        : existing?.additionalServiceType || '';
    if (rawAdditional === 'paid_absence' || attendance === 'paid_absence') {
      attendance = 'paid_absence';
      additionalServiceType = '';
    } else if (rawAdditional === '' || rawAdditional == null) {
      if (Object.prototype.hasOwnProperty.call(b, 'additionalServiceType')) {
        additionalServiceType = '';
      }
    } else if (isAdditionalServiceType(rawAdditional)) {
      additionalServiceType = rawAdditional;
    } else {
      return json(400, {
        error: 'Pick a valid additional service: Eval, Progress report, Consultation, Meetings, or Documentation.',
      });
    }
    const serviceTypeFromAdditional = additionalServiceType
      ? additionalServiceLabel(additionalServiceType)
      : '';
    const cptRaw = String(b.cptLabel || b.cptCode || '').trim();
    const cptCodes = Array.isArray(b.cptCodes)
      ? (b.cptCodes as unknown[]).map(String).filter(Boolean)
      : cptRaw
        ? cptRaw.split(/[,;\s]+/).map((c) => c.replace(/x\d+$/i, '')).filter(Boolean)
        : existing?.cptCodes || [];
    const cptLabel = cptRaw || existing?.cptLabel || cptCodes.join(', ');
    const cptUnits =
      typeof b.cptUnits === 'number' && Number.isFinite(b.cptUnits)
        ? Number(b.cptUnits)
        : existing?.cptUnits || 0;
    const dateOfService = pickStr(b.dateOfService, existing?.dateOfService || '');
    const ageErr = sessionImportAgeError(dateOfService, {
      settings: getAppSettings(store),
      providerId: week.providerId,
      weekId: week.id,
      isAdmin: ctx.user.role === 'admin',
    });
    if (ageErr) return json(400, { error: ageErr, errors: [ageErr] });
    // Route new sessions onto the child's program-type timesheet bin.
    let targetWeek = week;
    const requestedStudentId = pickStr(b.studentId, existing?.studentId || '');
    const bodyProgramType = canonicalContractProgramName(String(b.programType || ''));
    const childStudent = store.data.students.find((st) => st.id === requestedStudentId);
    const childSchoolId = String(childStudent?.schoolId || '').trim();
    const childProgramType = String(childStudent?.programType || '').trim();
    if (
      !existing &&
      (childSchoolId || childProgramType) &&
      !weekMatchesSchoolBin(
        store,
        week,
        childProgramType ? '' : childSchoolId,
        childProgramType || undefined,
      )
    ) {
      const matched = weeksForProviderStart(store, week.providerId, week.weekStart);
      let scoped = pickWeekForScope(store, matched, {
        providerId: week.providerId,
        schoolId: childProgramType ? undefined : childSchoolId || undefined,
        programType: childProgramType || undefined,
      });
      if (
        !scoped ||
        !weekMatchesSchoolBin(
          store,
          scoped,
          childProgramType ? '' : childSchoolId,
          childProgramType || undefined,
        )
      ) {
        const school = childSchoolId
          ? store.data.schools.find((s) => s.id === childSchoolId)
          : undefined;
        const signer = resolveSchoolOrDistrictSigner(
          store,
          school,
          childProgramType,
        );
        scoped = store.upsertWeek({
          id: newId(),
          providerId: week.providerId,
          weekStart: week.weekStart,
          schoolId: childSchoolId,
          programType: childProgramType,
          status: 'draft',
          signerName: signer.signerName || '',
          signerEmail: signer.signerEmail || '',
          timesheetKey: '',
          signedKey: '',
          envelopeId: '',
          hhaStatus: 'none',
          hhaError: '',
        });
      }
      targetWeek = scoped;
      if (targetWeek.status === 'submitted' && ctx.user.role !== 'admin') {
        return json(409, {
          error:
            'This program week is awaiting signature. Cancel the approval request before adding sessions.',
        });
      }
    } else if (
      !existing &&
      additionalServiceType &&
      !requestedStudentId
    ) {
      // No-child additional: attach to the same therapist+week draft as regular sessions.
      const matched = weeksForProviderStart(store, week.providerId, week.weekStart);
      foldEditableSameBinWeeks(store, matched, {
        preferProgramType: bodyProgramType || week.programType || undefined,
      });
      const siblings = weeksForProviderStart(store, week.providerId, week.weekStart);
      const preferPt = canonicalTimesheetProgramKey(bodyProgramType || week.programType || '');
      const host =
        (preferPt
          ? siblings.find(
              (w) =>
                therapistCanEdit(w.status) &&
                canonicalTimesheetProgramKey(resolveWeekProgramType(store, w)) === preferPt &&
                store.sessionsForWeek(w.id).some((s) => String(s.studentId || '').trim()),
            )
          : undefined) ||
        siblings
          .filter(
            (w) =>
              therapistCanEdit(w.status) &&
              store.sessionsForWeek(w.id).some((s) => String(s.studentId || '').trim()),
          )
          .sort(
            (a, b) =>
              store.sessionsForWeek(b.id).length - store.sessionsForWeek(a.id).length,
          )[0] ||
        (preferPt
          ? siblings.find(
              (w) =>
                therapistCanEdit(w.status) &&
                canonicalTimesheetProgramKey(resolveWeekProgramType(store, w)) === preferPt,
            )
          : undefined) ||
        (therapistCanEdit(week.status) ? week : undefined) ||
        siblings.find((w) => therapistCanEdit(w.status));
      if (host) {
        targetWeek = host;
        if (
          bodyProgramType &&
          (therapistCanEdit(targetWeek.status) || ctx.user.role === 'admin') &&
          !String(targetWeek.programType || '').trim()
        ) {
          targetWeek = store.upsertWeek({ ...targetWeek, programType: bodyProgramType });
        }
      }
      if (targetWeek.status === 'submitted' && ctx.user.role !== 'admin') {
        return json(409, {
          error:
            'This program week is awaiting signature. Cancel the approval request before adding sessions.',
        });
      }
    }
    if (!existing && weekIsProcessed(targetWeek.status)) {
      targetWeek = openDraftBesideProcessed(store, targetWeek, {
        providerId: week.providerId,
        programType:
          childProgramType || bodyProgramType || resolveWeekProgramType(store, targetWeek),
        schoolId: childSchoolId || String(targetWeek.schoolId || ''),
      });
    }
    const noChildAdditional =
      Boolean(additionalServiceType) && !String(requestedStudentId || '').trim();
    const sentProgram = Object.prototype.hasOwnProperty.call(b, 'programType');
    const sessionProgramType = noChildAdditional
      ? sentProgram
        ? bodyProgramType
        : canonicalContractProgramName(existing?.programType || '')
      : '';
    const session: SessionRow = {
      id: String(b.id || existing?.id || newId()),
      weekId: targetWeek.id,
      studentId: pickStr(b.studentId, existing?.studentId || ''),
      dateOfService,
      beginTime: pickStr(b.beginTime, existing?.beginTime || ''),
      endTime: pickStr(b.endTime, existing?.endTime || ''),
      attendance,
      cancelReason: pickStr(b.cancelReason, existing?.cancelReason || ''),
      makeupOfSessionId: pickStr(b.makeupOfSessionId, existing?.makeupOfSessionId || ''),
      serviceType: pickStr(
        b.serviceType,
        serviceTypeFromAdditional || existing?.serviceType || '',
      ),
      additionalServiceType,
      programType: sessionProgramType || undefined,
      location: pickStr(b.location, existing?.location || ''),
      notes: pickStr(b.notes, existing?.notes || ''),
      cptCodes,
      cptUnits,
      cptLabel,
      aiFlags: Array.isArray(b.aiFlags) ? (b.aiFlags as string[]) : existing?.aiFlags || [],
      aiBlock: typeof b.aiBlock === 'boolean' ? b.aiBlock : existing?.aiBlock || false,
    };
    if (additionalServiceType && !b.serviceType) {
      session.serviceType = serviceTypeFromAdditional;
    }
    if (
      session.programType &&
      (therapistCanEdit(targetWeek.status) || ctx.user.role === 'admin') &&
      !String(targetWeek.programType || '').trim()
    ) {
      targetWeek = store.upsertWeek({ ...targetWeek, programType: session.programType });
      session.weekId = targetWeek.id;
    }
    session.studentId = String(session.studentId || '').trim();
    if (!session.studentId && !isAdditionalServiceType(session.additionalServiceType || '')) {
      const childRequired = 'Select a child.';
      return json(400, { error: childRequired, errors: [childRequired] });
    }
    const serviceTypeErr = sessionServiceTypeRequiredError(session.serviceType);
    if (serviceTypeErr) return json(400, { error: serviceTypeErr, errors: [serviceTypeErr] });
    const manualProvider = store.data.providers.find((p) => p.id === week.providerId);
    // Always on: service-type discipline must match the provider's (additional services exempt).
    {
      const disciplineErr = sessionProviderDisciplineMismatchError(
        session,
        manualProvider,
        store.data.mandates,
      );
      if (disciplineErr) return json(400, { error: disciplineErr, errors: [disciplineErr] });
    }
    // Manual entry: carry the manual flag / signature from the saved row, then require a signature.
    session.manualEntry = existing ? existing.manualEntry === true : true;
    if (existing) {
      session.providerSignatureName = existing.providerSignatureName;
      session.providerSignedAt = existing.providerSignedAt;
      session.providerSignedByUserId = existing.providerSignedByUserId;
    }
    const typedSignature = pickStr(b.signatureName, '').trim();
    if (session.manualEntry && manualSessionNeedsSignature(session)) {
      const sigErr = manualSignatureError(typedSignature, manualProvider);
      if (sigErr) return json(400, { error: sigErr, errors: [sigErr] });
    }
    if (typedSignature && session.manualEntry) {
      session.providerSignatureName = typedSignature.slice(0, 200);
      session.providerSignedAt = nowIso();
      session.providerSignedByUserId = ctx.user.id;
    }
    if (session.attendance === 'missed') {
      session.makeupOfSessionId = '';
      // Paid absence is payable on the timesheet and keeps its clock.
      // Unpaid misses stay off the sheet and still drop times / require a Frontline reason.
      if (!isPaidAbsenceSession(session)) {
        session.beginTime = '';
        session.endTime = '';
        const missedReasonErr = missedSessionReasonError(
          session.attendance,
          session.cancelReason,
          session.notes,
        );
        if (missedReasonErr) return json(400, { error: missedReasonErr, errors: [missedReasonErr] });
      }
    } else if (session.attendance !== 'makeup') {
      session.makeupOfSessionId = '';
    }
    if (session.attendance === 'makeup') {
      // Manual add/edit: require an explicit unused miss (no makeup-auth-only shortcut).
      if (!String(session.makeupOfSessionId || '').trim()) {
        return json(400, {
          error: 'Select the missed session this makeup covers.',
          errors: ['Select the missed session this makeup covers.'],
        });
      }
      const resolved = resolveMakeupOfSessionId(
        session,
        store.data.sessions.filter((s) => s.id !== session.id).concat(session),
        store.data.mandates,
      );
      if ('error' in resolved) return json(400, { error: resolved.error });
      session.makeupOfSessionId = resolved.makeupOfSessionId;
    }
    const makeupErr = validateMakeup(
      session,
      store.data.sessions.filter((s) => s.id !== session.id).concat(session),
      store.data.mandates,
    );
    if (makeupErr) return json(400, { error: makeupErr });
    if (!isAdditionalServiceType(session.additionalServiceType || '')) {
      const dayPeers = providerDaySessions(
        store.data.sessions.filter((s) => s.id !== session.id),
        store.data.weeks,
        week.providerId,
        session.dateOfService,
        session.id,
      );
      const overlapErr = sessionOverlapError({
        candidate: session,
        peers: dayPeers,
        studentNameById: studentNameById(store),
        mandates: store.data.mandates,
      });
      if (overlapErr) {
        return json(400, { error: overlapErr, errors: [overlapErr] });
      }
      const soloNoteErr = soloGroupMandateNoteError({
        notes: session.notes,
        serviceType: session.serviceType,
        cptCodes: session.cptCodes,
        studentId: session.studentId,
        attendance: session.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: session,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) {
        return json(400, { error: soloNoteErr, errors: [soloNoteErr] });
      }
    }
    const screenedLocal = screenServiceNote(session);
    session.aiFlags = screenedLocal.flags;
    session.aiBlock = screenedLocal.block;
    // Same note screening as the PDF import (regular sessions): red blocks, yellow per admin setting.
    if (!isAdditionalServiceType(session.additionalServiceType || '')) {
      if (screenedLocal.block) {
        const screenMsg = screenedLocal.blockFlags.join('; ') || 'Note screening failed';
        return json(400, { error: screenMsg, errors: [screenMsg] });
      }
      if (screenedLocal.warnFlags.length && manualSettings.yellowWarningsBlockImport !== false) {
        const warnMsg = screenedLocal.warnFlags.join('; ');
        return json(400, { error: warnMsg, errors: [warnMsg] });
      }
    }
    store.upsertSession(session);
    // Drop empty draft shells left behind when a no-child additional was re-homed.
    if (week.id !== targetWeek.id && therapistCanEdit(week.status)) {
      if (store.sessionsForWeek(week.id).length === 0) {
        store.removeWeek(week.id);
      }
    }
    foldOrphanNoChildAdditionalWeeks(
      store,
      weeksForProviderStart(store, targetWeek.providerId, targetWeek.weekStart),
      {
        preferProgramType:
          bodyProgramType || targetWeek.programType || childProgramType || undefined,
      },
    );
    if (therapistCanEdit(targetWeek.status)) {
      const signerSchool = resolveWeekSchool(store, targetWeek.providerId, {
        weekId: targetWeek.id,
        preferredSchoolId: childSchoolId || targetWeek.schoolId || undefined,
      });
      targetWeek = stampWeekSignerFromSchool(store, targetWeek, signerSchool);
      if (signerSchool?.id && targetWeek.schoolId !== signerSchool.id) {
        targetWeek = store.upsertWeek({ ...targetWeek, schoolId: signerSchool.id });
      }
    }
    const check = checkMandatesForWeek(
      store.data.mandates,
      store.sessionsForWeek(targetWeek.id),
      store.data.sessions,
      studentNameById(store),
      providerWeekMandateOpts(store, targetWeek.providerId, targetWeek.weekStart),
    );
    if (check.errors.length) {
      store.removeSession(session.id);
      return json(400, {
        error: overMandateSummary(check.errors),
        errors: check.errors,
      });
    }
    // Digital session note for a manually entered REGULAR session (not additional services).
    // Stable archive id: editing the session replaces its note instead of adding another.
    let digitalNote: Awaited<ReturnType<typeof persistArchivePdf>> = null;
    let digitalNoteWarning = '';
    const makeDigitalNote = async (): Promise<void> => {
      if (!session.manualEntry || !manualSessionNoteApplies(session)) return;
      try {
        const noteStudent = store.data.students.find((s) => s.id === session.studentId);
        const noteSchool = store.data.schools.find(
          (s) => s.id === (noteStudent?.schoolId || childSchoolId || targetWeek.schoolId),
        );
        const noteProvider = store.data.providers.find((p) => p.id === targetWeek.providerId);
        const notePdf = await buildManualSessionNotePdf({
          session,
          student: noteStudent,
          provider: noteProvider,
          school: noteSchool,
          providerName: noteProvider
            ? `${noteProvider.firstName} ${noteProvider.lastName}`.trim()
            : '',
        });
        const noteArchiveId = manualSessionNoteArchiveId(session.id);
        const noteChild = noteStudent
          ? `${noteStudent.firstName} ${noteStudent.lastName}`.trim()
          : 'Child';
        digitalNote = await persistArchivePdf({
          store,
          kind: 'upload',
          sourceType: 'manual_session_note',
          userId: ctx.user.id,
          providerId: String(targetWeek.providerId || ''),
          schoolId: childSchoolId || targetWeek.schoolId || '',
          weekId: targetWeek.id,
          weekStart: targetWeek.weekStart,
          filename: `Session note - ${noteChild} - ${session.dateOfService.replace(/\//g, '-')}.pdf`,
          s3Key: `tms/archive/uploads/${targetWeek.providerId || 'p'}/${noteArchiveId}.pdf`,
          status: 'imported',
          pdf: notePdf,
          replaceId: noteArchiveId,
        });
        if (!digitalNote) digitalNoteWarning = 'The digital session note could not be saved to Archived Documents.';
      } catch (err) {
        console.warn('manual session note failed', err instanceof Error ? err.message : err);
        digitalNoteWarning = 'The digital session note could not be generated.';
      }
    };
    // Optional custom note (Word/PDF): store bytes only — never session-parse / PDF-read.
    // Locker links the file to the session; uploads archive mirrors Frontline/Therapist Activity archive.
    let attachedFile: StoredFile | undefined;
    let archiveRow: Awaited<ReturnType<typeof persistArchivePdf>> = null;
    const attachBuf = anyFileBufferFromBody(b);
    const attachName = String(b.fileName || b.attachmentName || '').trim();
    if (attachBuf) {
      const lowerName = attachName.toLowerCase();
      if (attachName && !/\.(pdf|doc|docx)$/.test(lowerName)) {
        store.removeSession(session.id);
        return json(400, {
          error: 'Custom note must be a PDF or Word document (.doc / .docx).',
          errors: ['Custom note must be a PDF or Word document (.doc / .docx).'],
        });
      }
      const fileId = newId();
      const ext = (attachName.split('.').pop() || 'bin').replace(/[^\w]+/g, '') || 'bin';
      const label = String(b.fileLabel || attachName || 'Custom session note');
      const s3Key = `tms/locker/providers/${targetWeek.providerId || 'p'}/${fileId}.${ext}`;
      await putLockerPdf(s3Key, attachBuf);
      attachedFile = store.addFile({
        id: fileId,
        studentId: session.studentId || '',
        providerId: String(targetWeek.providerId || ''),
        weekId: targetWeek.id,
        sessionId: session.id,
        kind: 'session_note',
        s3Key,
        label,
        createdAt: nowIso(),
      });
      const archiveId = newId();
      const archiveExt = ext === 'bin' ? 'pdf' : ext;
      archiveRow = await persistArchivePdf({
        store,
        kind: 'upload',
        sourceType: 'upload_other',
        userId: ctx.user.id,
        providerId: String(targetWeek.providerId || ''),
        schoolId: childSchoolId || targetWeek.schoolId || '',
        weekId: targetWeek.id,
        weekStart: targetWeek.weekStart,
        filename: attachName || label || `custom-note.${archiveExt}`,
        s3Key: `tms/archive/uploads/${targetWeek.providerId || 'p'}/${archiveId}.${archiveExt}`,
        status: 'imported',
        pdf: attachBuf,
        replaceId: archiveId,
      });
    }
    await makeDigitalNote();
    return json(200, {
      session,
      file: attachedFile || null,
      archive: archiveRow || null,
      digitalNote: digitalNote || null,
      warnings: [
        ...check.warnings,
        ...screenedLocal.warnFlags,
        ...(digitalNoteWarning ? [digitalNoteWarning] : []),
      ],
    });
  }

  if (req.method === 'GET' && /^\/students\/[^/]+\/missed$/.test(path)) {
    const studentId = path.split('/')[2];
    const excludeMakeupSessionId = String(req.query.excludeSessionId || '').trim();
    return json(200, {
      missed: unusedMissedForStudent(store.data.sessions, studentId, {
        excludeMakeupSessionId: excludeMakeupSessionId || undefined,
      }),
    });
  }

  if (req.method === 'POST' && /^\/sessions\/[^/]+\/ai-screen$/.test(path)) {
    const id = path.split('/')[2];
    const session = store.data.sessions.find((s) => s.id === id);
    if (!session) return json(404, { error: 'Session not found.' });
    const screened = await screenNoteWithOptionalBedrock(session);
    store.upsertSession({
      ...session,
      aiFlags: screened.flags,
      aiBlock: screened.block,
    });
    return json(200, screened);
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/provider-sign$/.test(path)) {
    let week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      return json(409, { error: 'This week is locked.' });
    }
    const signBody = obj(req);
    const signProgramType = String(signBody.programType || '').trim();
    const signSchoolId = String(signBody.schoolId || '').trim();
    const splitBins = splitWeekBySchoolBins(store, week, () => newId());
    if (signProgramType || signSchoolId) {
      const match = splitBins.find((w) =>
        weekMatchesSchoolBin(store, w, signSchoolId, signProgramType || undefined),
      );
      if (match) week = match;
    } else {
      week = splitBins.find((w) => w.id === week!.id) || splitBins[0] || week;
    }
    const sessions = store.sessionsForWeek(week.id);
    if (!sessions.length) {
      return json(400, { error: 'Add at least one session before signing the timesheet.' });
    }
    const check = checkMandatesForWeek(
      store.data.mandates,
      sessions,
      store.data.sessions,
      studentNameById(store),
      providerWeekMandateOpts(store, week.providerId, week.weekStart),
    );
    const mandateErrors = errorsAfterAllowedOverrides(
      store.data.blockReports || [],
      week.providerId,
      check.errors,
    );
    if (mandateErrors.length) {
      return json(400, {
        error: overMandateSummary(mandateErrors),
        errors: mandateErrors,
      });
    }
    const soloNoteErrors: string[] = [];
    for (const s of sessions) {
      if (isAdditionalServiceType(s.additionalServiceType || '')) continue;
      const dayPeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        week.providerId,
        s.dateOfService,
        s.id,
      );
      const soloNoteErr = soloGroupMandateNoteError({
        notes: s.notes,
        serviceType: s.serviceType,
        cptCodes: s.cptCodes,
        studentId: s.studentId,
        attendance: s.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) {
        const who = studentNameById(store).get(s.studentId) || s.studentId;
        soloNoteErrors.push(`${s.dateOfService} ${who}: ${soloNoteErr}`);
      }
    }
    const openSoloErrors = errorsAfterAllowedOverrides(
      store.data.blockReports || [],
      week.providerId,
      soloNoteErrors,
    );
    if (openSoloErrors.length) {
      return json(400, {
        error: openSoloErrors[0],
        errors: openSoloErrors,
      });
    }
    const provider = store.data.providers.find((p) => p.id === week!.providerId);
    const typedName = String(signBody.signatureName || signBody.providerSignName || '').trim();
    const defaultName = provider
      ? `${provider.firstName || ''} ${provider.lastName || ''}`.trim()
      : '';
    const providerSignName = typedName || defaultName;
    if (!providerSignName) {
      return json(400, { error: 'Enter your name to sign the timesheet.' });
    }
    const rawDate = String(signBody.signDate || signBody.providerSignDate || '').trim();
    const providerSignDate = rawDate || formatTimesheetSignDate();
    const signerSchool = resolveWeekSchool(store, week.providerId, {
      weekId: week.id,
      preferredSchoolId: signSchoolId || undefined,
    });
    const signerName = signerSchool
      ? String(signerSchool.signerName || '')
      : String(signBody.signerName || week.signerName || '');
    const signerEmail = signerSchool
      ? String(signerSchool.signerEmail || '')
      : String(signBody.signerEmail || week.signerEmail || '');
    const schoolDistrict = schoolDistrictForWeek(
      store,
      week.id,
      signerSchool?.id || signSchoolId || undefined,
    );
    const stampedWeek = {
      ...week,
      schoolId: week.schoolId || signerSchool?.id || '',
      programType:
        week.programType || signProgramType || resolveWeekProgramType(store, week) || '',
      signerName: signerName || week.signerName,
      signerEmail: signerEmail || week.signerEmail,
    };
    const pdf = buildTimesheetPdf({
      week: stampedWeek,
      providerLabel: provider
        ? `${provider.firstName} ${provider.lastName}`
        : stampedWeek.providerId,
      signerName: stampedWeek.signerName,
      signerEmail: stampedWeek.signerEmail,
      schoolDistrict,
      providerSignDate,
      providerSignName,
      rows: sessions.map((session) => {
        const dayPeers = providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          stampedWeek.providerId,
          session.dateOfService,
          session.id,
        );
        const payOpts = {
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
          mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
        };
        return {
          session,
          student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
          payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
        };
      }),
    });
    const providerSignedKey = `tms/provider-signed/${stampedWeek.id}.pdf`;
    const timesheetKey = stampedWeek.timesheetKey || `tms/timesheets/${stampedWeek.id}.pdf`;
    await putLockerPdf(providerSignedKey, Buffer.from(pdf));
    await putLockerPdf(timesheetKey, Buffer.from(pdf));
    const next = store.upsertWeek({
      ...stampedWeek,
      timesheetKey,
      providerSignedKey,
      providerSignedAt: nowIso(),
    });
    const existingTs = findTimesheetArchive(store, next.id);
    await persistArchivePdf({
      store,
      kind: 'timesheet',
      sourceType: 'timesheet',
      userId: ctx.user.id,
      providerId: next.providerId,
      schoolId: signerSchool?.id || signSchoolId,
      weekId: next.id,
      weekStart: next.weekStart,
      filename: `timesheet-${next.weekStart}-provider-signed.pdf`,
      s3Key: providerSignedKey,
      status: 'provider_signed',
      pdf: Buffer.from(pdf),
      replaceId: existingTs?.id,
    });
    store.audit(ctx.user.id, 'provider_sign_timesheet', `week:${week.id}`, week, next);
    return json(200, {
      week: next,
      providerSignedKey,
      message: 'Timesheet signed and saved. You can now send it to the school signer.',
      warnings: check.warnings,
    });
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/submit$/.test(path)) {
    let week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!therapistCanEdit(week.status) && ctx.user.role !== 'admin') {
      return json(409, { error: 'This week is locked.' });
    }
    const submitBody = obj(req);
    const submitProgramType = String(submitBody.programType || '').trim();
    const submitSchoolId = String(submitBody.schoolId || '').trim();
    // Repair mixed program/signer weeks before building the PDF / SignNow envelope.
    const splitBins = splitWeekBySchoolBins(store, week, () => newId());
    if (submitProgramType || submitSchoolId) {
      const match = splitBins.find((w) =>
        weekMatchesSchoolBin(store, w, submitSchoolId, submitProgramType || undefined),
      );
      if (match) week = match;
    } else {
      week = splitBins.find((w) => w.id === week!.id) || splitBins[0] || week;
    }
    const sessions = store.sessionsForWeek(week.id);
    const check = checkMandatesForWeek(
      store.data.mandates,
      sessions,
      store.data.sessions,
      studentNameById(store),
      providerWeekMandateOpts(store, week.providerId, week.weekStart),
    );
    const mandateErrors = errorsAfterAllowedOverrides(
      store.data.blockReports || [],
      week.providerId,
      check.errors,
    );
    if (mandateErrors.length) {
      return json(400, {
        error: overMandateSummary(mandateErrors),
        errors: mandateErrors,
      });
    }
    const soloNoteErrors: string[] = [];
    for (const s of sessions) {
      if (isAdditionalServiceType(s.additionalServiceType || '')) continue;
      const dayPeers = providerDaySessions(
        store.data.sessions,
        store.data.weeks,
        week.providerId,
        s.dateOfService,
        s.id,
      );
      const soloNoteErr = soloGroupMandateNoteError({
        notes: s.notes,
        serviceType: s.serviceType,
        cptCodes: s.cptCodes,
        studentId: s.studentId,
        attendance: s.attendance,
        mandates: store.data.mandates,
        presentGroupPeerCount: presentGroupPeerCount({
          candidate: s,
          peers: dayPeers,
          mandates: store.data.mandates,
        }),
      });
      if (soloNoteErr) {
        const who = studentNameById(store).get(s.studentId) || s.studentId;
        soloNoteErrors.push(`${s.dateOfService} ${who}: ${soloNoteErr}`);
      }
    }
    const openSoloErrors = errorsAfterAllowedOverrides(
      store.data.blockReports || [],
      week.providerId,
      soloNoteErrors,
    );
    if (openSoloErrors.length) {
      return json(400, {
        error: openSoloErrors[0],
        errors: openSoloErrors,
      });
    }
    const aiErrors: string[] = [];
    for (const s of sessions) {
      const makeupErr = validateMakeup(s, store.data.sessions, store.data.mandates);
      if (
        makeupErr &&
        errorsAfterAllowedOverrides(store.data.blockReports || [], week.providerId, [makeupErr]).length
      ) {
        return json(400, { error: makeupErr });
      }
      if (s.attendance !== 'missed') {
        const screened = await screenNoteWithOptionalBedrock(s);
        const stillBlocking = errorsAfterAllowedOverrides(
          store.data.blockReports || [],
          week.providerId,
          screened.blockFlags,
        );
        store.upsertSession({
          ...s,
          aiFlags: screened.flags,
          aiBlock: stillBlocking.length > 0,
        });
        for (const f of stillBlocking) {
          aiErrors.push(`${s.dateOfService}: ${f}`);
        }
      }
    }
    if (aiErrors.length) {
      return json(400, {
        error: 'AI note screening blocked submit',
        errors: aiErrors,
        warnings: check.warnings,
      });
    }
    const b = submitBody;
    const signerSchool = resolveWeekSchool(store, week.providerId, {
      weekId: week.id,
      preferredSchoolId: String(b.schoolId || '').trim() || undefined,
    });
    // Prefer the child's school signer fields even when empty — do not fall back to a
    // sibling school's stale week.signer* or the selected-school filter body.
    const signerName = signerSchool
      ? String(signerSchool.signerName || '')
      : String(b.signerName || week.signerName || '');
    const signerEmail = signerSchool
      ? String(signerSchool.signerEmail || '')
      : String(b.signerEmail || week.signerEmail || '');
    if (!String(signerEmail || '').trim()) {
      return json(400, {
        error: 'No school signer is on file. Contact the office to assign a signer.',
      });
    }
    const providerSignedKey = String(week.providerSignedKey || '').trim();
    let providerSignedPdf = providerSignedKey ? await getPdfFromS3(providerSignedKey) : null;
    // Vitest / email-fallback / admin: auto-stamp provider signature when missing.
    if (
      !providerSignedPdf?.length &&
      (process.env.VITEST === 'true' ||
        process.env.TMS_SIGNNOW_ALLOW_EMAIL_FALLBACK === '1' ||
        ctx.user.role === 'admin')
    ) {
      const provider = store.data.providers.find((p) => p.id === week.providerId);
      const schoolDistrict = schoolDistrictForWeek(
        store,
        week.id,
        signerSchool?.id || String(b.schoolId || '').trim() || undefined,
      );
      const autoName = provider
        ? `${provider.firstName || ''} ${provider.lastName || ''}`.trim() || 'Therapist'
        : 'Therapist';
      const autoPdf = buildTimesheetPdf({
        week: { ...week, signerName, signerEmail },
        providerLabel: autoName,
        signerName,
        signerEmail,
        schoolDistrict,
        providerSignDate: formatTimesheetSignDate(),
        providerSignName: autoName,
        rows: sessions.map((session) => {
          const dayPeers = providerDaySessions(
            store.data.sessions,
            store.data.weeks,
            week.providerId,
            session.dateOfService,
            session.id,
          );
          const payOpts = {
            presentGroupPeerCount: presentGroupPeerCount({
              candidate: session,
              peers: dayPeers,
              mandates: store.data.mandates,
            }),
            mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
          };
          return {
            session,
            student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
            payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
          };
        }),
      });
      const autoKey = `tms/provider-signed/${week.id}.pdf`;
      await putLockerPdf(autoKey, Buffer.from(autoPdf));
      week = store.upsertWeek({
        ...week,
        providerSignedKey: autoKey,
        providerSignedAt: nowIso(),
      });
      providerSignedPdf = Buffer.from(autoPdf);
    }
    const resolvedProviderSignedKey = String(week.providerSignedKey || providerSignedKey || '').trim();
    if (!resolvedProviderSignedKey || !providerSignedPdf?.length) {
      return json(400, {
        error: 'Sign the timesheet first (Sign timesheet), then send it to the school signer.',
      });
    }
    const next = store.upsertWeek({
      ...week,
      status: 'submitted',
      schoolId: week.schoolId || signerSchool?.id || '',
      programType:
        week.programType ||
        submitProgramType ||
        resolveWeekProgramType(store, week) ||
        '',
      signerName,
      signerEmail,
      providerSignedKey: resolvedProviderSignedKey,
    });
    const provider = store.data.providers.find((p) => p.id === next.providerId);
    const pdf = Uint8Array.from(providerSignedPdf);
    let envelope;
    try {
      envelope = await createSignEnvelope({
        signerEmail: next.signerEmail,
        signerName: next.signerName,
        weekId: next.id,
        pdf,
      });
    } catch (err) {
      store.upsertWeek({ ...week });
      const msg =
        err instanceof SignNowNotConfiguredError || err instanceof SignNowApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not send timesheet via SignNow.';
      const status =
        err instanceof SignNowNotConfiguredError
          ? 503
          : err instanceof SignNowApiError && err.status && err.status >= 400 && err.status < 500
            ? 502
            : 503;
      return json(status, { error: msg });
    }
    const timesheetKey = `tms/timesheets/${next.id}.pdf`;
    store.upsertWeek({
      ...next,
      envelopeId: envelope.envelopeId,
      timesheetKey,
      signatureRequestStatus: 'pending',
      signatureRequestAt: nowIso(),
    });
    const existingTs = findTimesheetArchive(store, next.id);
    await persistArchivePdf({
      store,
      kind: 'timesheet',
      sourceType: 'timesheet',
      userId: ctx.user.id,
      providerId: next.providerId,
      schoolId: signerSchool?.id || String(b.schoolId || '').trim(),
      weekId: next.id,
      weekStart: next.weekStart,
      filename: `timesheet-${next.weekStart}.pdf`,
      s3Key: timesheetKey,
      status: 'submitted',
      pdf: Buffer.from(pdf),
      replaceId: existingTs?.id,
    });
    // SES email fallback only when SignNow is off (tests / TMS_SIGNNOW_ALLOW_EMAIL_FALLBACK=1).
    if (deps.mail && next.signerEmail && envelope.vendor === 'email') {
      try {
        await deps.mail.send({
          to: [next.signerEmail],
          subject: `Please sign related-service timesheet (week of ${next.weekStart})`,
          text: `Please review and sign the attached timesheet for ${provider ? `${provider.firstName} ${provider.lastName}` : 'the therapist'}. Reply with the signed copy or complete signing in SignNow when a link is provided.\n\nPowered by advancedautomations.net`,
          attachmentName: `timesheet-${next.weekStart}.pdf`,
          attachment: pdf,
        });
      } catch (err) {
        // Roll back so a SES sandbox / identity failure does not leave the week stuck submitted.
        store.upsertWeek({ ...week });
        return json(503, {
          error: err instanceof Error ? err.message : 'Could not email the timesheet to the signer.',
        });
      }
    }
    store.audit(ctx.user.id, 'submit_week', `week:${week.id}`, week, next);
    return json(200, {
      week: store.data.weeks.find((w) => w.id === next.id),
      warnings: check.warnings,
      envelope,
      message: `Timesheet sent to ${next.signerEmail || 'the entered signer'}${envelope.vendor === 'email' ? ' by email' : ' via SignNow'}.`,
    });
  }

  if (req.method === 'GET' && /^\/weeks\/[^/]+\/timesheet$/.test(path)) {
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });

    const servePdf = (buf: Buffer, filename: string) => ({
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filename}"`,
      },
      body: buf,
    });

    // Prefer wet-ink SignNow PDF after lock (signature + date). Do not regenerate over it.
    if (week.status === 'locked' || week.status === 'signed' || week.signedKey) {
      const archiveKey = findTimesheetArchive(store, week.id)?.s3Key || '';
      const candidateKeys = [
        week.signedKey,
        `tms/signed/${week.id}.pdf`,
        week.timesheetKey,
        `tms/timesheets/${week.id}.pdf`,
        archiveKey,
      ].filter((k, i, arr): k is string => Boolean(k) && arr.indexOf(k) === i);
      for (const key of candidateKeys) {
        const existing = await getPdfFromS3(key);
        if (existing?.length) {
          if (!week.signedKey || week.signedKey !== key) {
            store.upsertWeek({
              ...week,
              signedKey: week.signedKey || (key.includes('/signed/') ? key : `tms/signed/${week.id}.pdf`),
              timesheetKey: week.timesheetKey || key,
            });
          }
          return servePdf(existing, `timesheet-${week.weekStart}-signed.pdf`);
        }
      }
      // Lazy backfill when webhook locked without storing PDF bytes.
      const envelopeId = String(week.envelopeId || '').trim();
      if (envelopeId && !envelopeId.startsWith('email:')) {
        try {
          const bytes = await downloadSignedDocument(envelopeId);
          if (bytes?.length) {
            const buf = Buffer.from(bytes);
            const signedKey = `tms/signed/${week.id}.pdf`;
            const timesheetKey = week.timesheetKey || `tms/timesheets/${week.id}.pdf`;
            await putLockerPdf(signedKey, buf);
            if (timesheetKey && timesheetKey !== signedKey) {
              await putLockerPdf(timesheetKey, buf);
            }
            const existingTs = findTimesheetArchive(store, week.id);
            await persistArchivePdf({
              store,
              kind: 'timesheet',
              sourceType: 'timesheet',
              userId: ctx.user.id,
              providerId: week.providerId,
              weekId: week.id,
              weekStart: week.weekStart,
              filename: `timesheet-${week.weekStart}-signed.pdf`,
              s3Key: signedKey,
              status: 'locked',
              pdf: buf,
              replaceId: existingTs?.id,
            });
            store.upsertWeek({ ...week, signedKey, timesheetKey });
            console.info('[tms-esign] lazy signed PDF backfill', {
              weekId: week.id,
              bytes: buf.length,
            });
            return servePdf(buf, `timesheet-${week.weekStart}-signed.pdf`);
          }
        } catch (err) {
          console.warn(
            '[tms-esign] lazy signed PDF backfill failed',
            err instanceof Error ? err.message : err,
            { weekId: week.id },
          );
        }
      }
      // Never fall through to an unsigned regeneration for locked/signed weeks.
      return json(404, {
        error:
          'Signed timesheet PDF is not available yet. Wait for SignNow completion or use Admin → refresh signed PDF.',
      });
    }

    const provider = store.data.providers.find((p) => p.id === week.providerId);
    const schoolId = String(req.query.schoolId || '').trim();
    const schoolDistrict = schoolDistrictForWeek(store, week.id, schoolId || undefined);
    const pdf = buildTimesheetPdf({
      week,
      providerLabel: provider ? `${provider.firstName} ${provider.lastName}` : week.providerId,
      signerName: week.signerName,
      signerEmail: week.signerEmail,
      schoolDistrict,
      providerSignDate:
        week.status === 'submitted' || week.status === 'signed' || week.status === 'locked'
          ? formatTimesheetSignDate()
          : undefined,
      rows: store.sessionsForWeek(week.id).map((session) => {
        const dayPeers = providerDaySessions(
          store.data.sessions,
          store.data.weeks,
          week.providerId,
          session.dateOfService,
          session.id,
        );
        const payOpts = {
          presentGroupPeerCount: presentGroupPeerCount({
            candidate: session,
            peers: dayPeers,
            mandates: store.data.mandates,
          }),
          mandateDurationMinutes: mandateDurationMinutesForSession(session, store.data.mandates),
        };
        return {
          session,
          student: store.data.students.find((s) => s.id === session.studentId) as Student | undefined,
          payAmount: provider ? sessionPayAmount(provider, session, payOpts) : null,
        };
      }),
    });
    // Never overwrite a locked week's archive with an unsigned regeneration.
    if (week.status !== 'locked' && week.status !== 'signed') {
      store.upsertWeek({ ...week, timesheetKey: `tms/timesheets/${week.id}.pdf` });
      const existingTs = findTimesheetArchive(store, week.id);
      await persistArchivePdf({
        store,
        kind: 'timesheet',
        sourceType: 'timesheet',
        userId: ctx.user.id,
        providerId: week.providerId,
        schoolId,
        weekId: week.id,
        weekStart: week.weekStart,
        filename: `timesheet-${week.weekStart}.pdf`,
        s3Key: `tms/timesheets/${week.id}.pdf`,
        status: week.status || 'draft',
        pdf: Buffer.from(pdf),
        replaceId: existingTs?.id,
      });
    }
    return servePdf(Buffer.from(pdf), `timesheet-${week.weekStart}.pdf`);
  }

  if (
    req.method === 'POST' &&
    /^\/weeks\/[^/]+\/(?:cancel-approval|cancel-signature)$/.test(path)
  ) {
    return endWeekSignatureRequest(store, ctx, path.split('/')[2] || '', 'cancel');
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/retrieve-signature$/.test(path)) {
    return endWeekSignatureRequest(store, ctx, path.split('/')[2] || '', 'retrieve');
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/resend-invite$/.test(path)) {
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (week.status !== 'submitted') {
      return json(409, {
        error: 'Only a pending (submitted) timesheet can resend the SignNow invite.',
      });
    }
    if (ctx.user.role !== 'admin') {
      const provider = providerFor(store, ctx.user);
      if (!provider || week.providerId !== provider.id) {
        return json(403, { error: 'You can only resend your own pending timesheet invite.' });
      }
    }
    const envelopeId = String(week.envelopeId || '').trim();
    if (!envelopeId) {
      return json(409, {
        error: 'This week has no SignNow document. Cancel approval and send the timesheet again.',
      });
    }
    const to = String(week.signerEmail || '').trim();
    const result = await resendSignEnvelopeInvite(envelopeId, { toEmail: to || undefined });
    if (!result.ok) {
      return json(502, {
        error: result.detail || 'Could not resend SignNow invite.',
        resent: result.resent,
      });
    }
    store.audit(ctx.user.id, 'resend_esign_invite', `week:${week.id}`, week, {
      envelopeId,
      resent: result.resent,
      to,
    });
    return json(200, {
      week,
      resent: result.resent,
      message: `SignNow invite resent to ${to || 'the signer'}.`,
    });
  }

  if (req.method === 'DELETE' && /^\/sessions\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const session = store.data.sessions.find((s) => s.id === id);
    if (!session) return json(404, { error: 'Session not found.' });
    const week = store.data.weeks.find((w) => w.id === session.weekId);
    if (!week) return json(404, { error: 'Week not found.' });
    if (
      !therapistCanMutateExistingSession(week.status, { isAdmin: ctx.user.role === 'admin' })
    ) {
      return json(409, {
        error:
          week.status === 'submitted'
            ? 'Approval is pending. Cancel the signature request before removing sessions.'
            : weekIsProcessed(week.status)
              ? 'This session was already processed and cannot be removed. Revoke the signature on this week before removing it.'
              : 'This week is locked. Ask an admin to reopen it.',
      });
    }
    if (ctx.user.role !== 'admin') {
      const provider = providerFor(store, ctx.user);
      if (!provider || week.providerId !== provider.id) {
        return json(403, { error: 'You can only remove sessions from your own week.' });
      }
    }
    store.removeSession(id);
    store.audit(ctx.user.id, 'remove_session', `session:${id}`, session, null);
    return json(200, { ok: true, sessions: store.sessionsForWeek(week.id) });
  }

  if (req.method === 'DELETE' && /^\/admin\/weeks\/[^/]+$/.test(path)) {
    return adminUser(() => {
      const week = store.data.weeks.find((w) => w.id === path.split('/')[3]);
      if (!week) return json(404, { error: 'Week not found.' });
      store.removeWeek(week.id);
      store.audit(ctx.user.id, 'remove_week', `week:${week.id}`, week, null);
      return json(200, { ok: true });
    });
  }

  if (req.method === 'POST' && /^\/admin\/weeks\/[^/]+\/sign$/.test(path)) {
    return adminUser(() =>
      json(410, {
        error:
          'Manual Sign is disabled. After the therapist sends the timesheet, the school principal signs via SignNow; completion auto-locks the week. HHA transfer runs Wednesday morning or via Send to HHA.',
      }),
    );
  }

  if (req.method === 'POST' && /^\/admin\/weeks\/[^/]+\/reopen$/.test(path)) {
    return revokeWeekSignature(store, ctx, path.split('/')[3] || '');
  }

  /** Re-download completed SignNow PDF into locker (fixes missing scribble after lock). */
  if (req.method === 'POST' && /^\/admin\/weeks\/[^/]+\/refresh-signed-pdf$/.test(path)) {
    return adminUser(async () => {
      const week = store.data.weeks.find((w) => w.id === path.split('/')[3]);
      if (!week) return json(404, { error: 'Week not found.' });
      const envelopeId = String(week.envelopeId || '').trim();
      if (!envelopeId || envelopeId.startsWith('email:')) {
        return json(409, { error: 'Week has no SignNow document id to download.' });
      }
      const bytes = await downloadSignedDocument(envelopeId);
      if (!bytes?.length) {
        return json(502, {
          error:
            'Could not download signed PDF from SignNow. Confirm the invite is fulfilled, then retry.',
        });
      }
      const buf = Buffer.from(bytes);
      const signedKey = `tms/signed/${week.id}.pdf`;
      const timesheetKey = week.timesheetKey || `tms/timesheets/${week.id}.pdf`;
      await putLockerPdf(signedKey, buf);
      if (timesheetKey && timesheetKey !== signedKey) {
        await putLockerPdf(timesheetKey, buf);
      }
      const existingTs = findTimesheetArchive(store, week.id);
      await persistArchivePdf({
        store,
        kind: 'timesheet',
        sourceType: 'timesheet',
        userId: ctx.user.id,
        providerId: week.providerId,
        weekId: week.id,
        weekStart: week.weekStart,
        filename: `timesheet-${week.weekStart}-signed.pdf`,
        s3Key: signedKey,
        status: week.status === 'locked' || week.status === 'signed' ? 'locked' : week.status,
        pdf: buf,
        replaceId: existingTs?.id,
      });
      const next = store.upsertWeek({ ...week, signedKey, timesheetKey });
      store.audit(ctx.user.id, 'refresh_signed_pdf', `week:${week.id}`, week, {
        signedKey,
        timesheetKey,
        bytes: buf.length,
      });
      return json(200, { week: next, bytes: buf.length, signedKey, timesheetKey });
    });
  }

  if (req.method === 'GET' && /^\/weeks\/[^/]+\/hha-failures$/.test(path)) {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    const weekId = path.split('/')[2] || '';
    const week = store.data.weeks.find((w) => w.id === weekId);
    if (!week) return json(404, { error: 'Week not found.' });
    return json(200, { failures: weekHhaFailures(store, weekId) });
  }

  if (req.method === 'POST' && /^\/sessions\/[^/]+\/hha-already$/.test(path)) {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    const sessionId = path.split('/')[2] || '';
    const result = markSessionAlreadyInHha({
      store,
      sessionId,
      actorId: ctx.user.id,
    });
    if (!result.ok) return json(result.status, { error: result.error });
    return json(200, result);
  }

  if (req.method === 'POST' && /^\/weeks\/[^/]+\/hha$/.test(path)) {
    const denied = requireAdmin(ctx);
    if (denied) return json(403, { error: denied });
    const week = store.data.weeks.find((w) => w.id === path.split('/')[2]);
    if (!week) return json(404, { error: 'Week not found.' });
    if (!deps.hha) return json(503, { error: 'HHA client is not configured.' });
    const rawIds = obj(req).sessionIds;
    const sessionIds = Array.isArray(rawIds)
      ? rawIds.map((id) => String(id || '').trim()).filter(Boolean)
      : undefined;
    const result = await transferLockedWeek({
      store,
      week: store.data.weeks.find((w) => w.id === week.id)!,
      hha: deps.hha,
      actorId: ctx.user.id,
      afterSession: deps.persistNow,
      // Targeted retry: only these sessions; already-confirmed / VisitID skips still apply.
      ...(sessionIds?.length ? { sessionIds } : {}),
    });
    return json(result.ok ? 200 : 207, result);
  }

  if (req.method === 'GET' && path === '/alerts') {
    const rows = store.openAlerts();
    return json(200, { alerts: rows, dueDates: dueDatesForUser(store, ctx.user) });
  }

  return json(404, { error: `No route ${req.method} ${path}` });
}
