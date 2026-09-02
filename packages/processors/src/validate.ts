import type {
  ParseResult,
  PipelineException,
  ProcessorResult,
  ValidateResult,
} from '@white-glove/shared';
import {
  alertEmailSentKey,
  exceptionsKey,
  buildAlertCsvAttachments,
  buildAlertSubject,
  buildPipelineResultCsvRows,
  failuresCsvKey,
  formatPipelineAlertBody,
  formatPipelineAlertHtml,
  formatResultsHtml,
  getEnv,
  parseResultKey,
  processorBranchResultKey,
  resultsCsvKey,
  resultsHtmlKey,
  validateSummaryKey,
  ParseResultSchema,
} from '@white-glove/shared';
import { getObjectText, putJson, putText } from './s3.js';
import { sendPipelineAlert } from './send-pipeline-alert.js';
import { flagExhaustedSyncTimeouts } from './time-budget.js';

async function loadProcessorBranchResult(
  bucket: string,
  runId: string,
  branch: 'opened' | 'closed' | 'discharge' | 'sessions' | 'new_services',
  inline?: ProcessorResult,
): Promise<ProcessorResult | undefined> {
  try {
    const text = await getObjectText(bucket, processorBranchResultKey(runId, branch));
    return JSON.parse(text) as ProcessorResult;
  } catch {
    return inline;
  }
}

async function loadParseResult(
  bucket: string,
  runId: string,
  inline?: ParseResult,
): Promise<ParseResult | undefined> {
  try {
    const text = await getObjectText(bucket, parseResultKey(runId));
    return ParseResultSchema.parse(JSON.parse(text));
  } catch {
    return inline;
  }
}

async function alertEmailAlreadySent(bucket: string, runId: string): Promise<boolean> {
  try {
    await getObjectText(bucket, alertEmailSentKey(runId));
    return true;
  } catch {
    return false;
  }
}

export async function validateAndNotify(options: {
  runId: string;
  bucket: string;
  opened?: ProcessorResult;
  closed?: ProcessorResult;
  sessions?: ProcessorResult;
  parse?: ParseResult;
  topicArn?: string;
  dryRun?: boolean;
  sandbox?: boolean;
  sandboxEmailFixtures?: boolean;
  skipAlertEmail?: boolean;
  forceAlertEmail?: boolean;
}): Promise<ValidateResult> {
  const parse =
    (await loadParseResult(options.bucket, options.runId, options.parse)) ?? options.parse;

  const openedRaw =
    (await loadProcessorBranchResult(options.bucket, options.runId, 'opened', options.opened)) ??
    options.opened;

  const newServices = await loadProcessorBranchResult(
    options.bucket,
    options.runId,
    'new_services',
  );

  const sessionsRaw =
    (await loadProcessorBranchResult(options.bucket, options.runId, 'sessions', options.sessions)) ??
    options.sessions;

  const closedRaw =
    (await loadProcessorBranchResult(options.bucket, options.runId, 'closed', options.closed)) ??
    options.closed;

  // Validate only runs after SyncToHha continuations stop — any remaining timedOut is terminal.
  const opened = openedRaw ? flagExhaustedSyncTimeouts(openedRaw) : openedRaw;
  const sessions = sessionsRaw ? flagExhaustedSyncTimeouts(sessionsRaw) : sessionsRaw;
  const closed = closedRaw ? flagExhaustedSyncTimeouts(closedRaw) : closedRaw;

  const discharge = await loadProcessorBranchResult(
    options.bucket,
    options.runId,
    'discharge',
  );

  // Discharge is written to its own S3 branch result; ClosedFn's merged SFN return
  // is overwritten by the closed-only S3 artifact — always fold discharge in here.
  const exceptions: PipelineException[] = [
    ...(opened?.exceptions ?? []),
    ...(newServices?.exceptions ?? []),
    ...(closed?.exceptions ?? []),
    ...(discharge?.exceptions ?? []),
    ...(sessions?.exceptions ?? []),
  ];

  if (sessions?.exceptions?.length) {
    const clockEx = sessions.exceptions.filter((e) => e.code === 'incomplete_unscheduled_clock');
    const clockSources = Object.fromEntries(
      clockEx.reduce((m, e) => {
        const s = String(e.details?.source ?? 'unknown');
        m.set(s, (m.get(s) ?? 0) + 1);
        return m;
      }, new Map<string, number>()),
    );
    let unscheduledMeta: Record<string, unknown> = {};
    let sampleUnscheduledRows: unknown[] | undefined;
    try {
      const unscheduledText = await getObjectText(
        options.bucket,
        `runs/${options.runId}/normalized/unscheduled-services.json`,
      );
      const parsed = JSON.parse(unscheduledText) as {
        total?: number;
        rows?: Array<Record<string, unknown>>;
        fromDate?: string;
        toDate?: string;
        skipped?: boolean;
        skipReason?: string;
      };
      sampleUnscheduledRows = (parsed.rows ?? []).slice(0, 5).map((row) => ({
        patientId: (row.Patient as { PatientID?: unknown })?.PatientID ?? row.PatientId,
        aideId: (row.Caregiver as { AideID?: unknown })?.AideID ?? row.AideID,
        caregiverCode: (row.Caregiver as { CaregiverCode?: string })?.CaregiverCode,
        evvIn: row.EVVInTime,
        evvOut: row.EVVOutTime,
      }));
      unscheduledMeta = {
        unscheduledTotal: parsed.total ?? parsed.rows?.length ?? null,
        fromDate: parsed.fromDate,
        toDate: parsed.toDate,
        skipped: parsed.skipped,
        skipReason: parsed.skipReason,
      };
    } catch {
      /* optional artifact */
    }
    console.log(
      '[validate-analysis]',
      JSON.stringify({
        runId: options.runId,
        ...unscheduledMeta,
        sessionsSucceeded: sessions.succeeded,
        sessionsFailed: sessions.failed,
        sessionsSkipped: sessions.skipped,
        clockExceptions: clockEx.length,
        clockSources,
        sampleClockMessages: clockEx.slice(0, 3).map((e) => e.message),
        sampleClockDetails: clockEx.slice(0, 5).map((e) => e.details),
        sampleUnscheduledRows,
      }),
    );
  }

  const hardFailures =
    (opened?.failed ?? 0) +
    (newServices?.failed ?? 0) +
    (closed?.failed ?? 0) +
    (discharge?.failed ?? 0) +
    (sessions?.failed ?? 0);

  const result: ValidateResult = {
    runId: options.runId,
    ok: hardFailures === 0,
    dryRun: options.dryRun,
    sandbox: options.sandbox,
    summary: {
      opened,
      closed,
      sessions,
      newServices: newServices ?? undefined,
      discharge: discharge ?? undefined,
    },
    exceptions,
    exceptionCount: exceptions.length,
  };

  await putJson(options.bucket, validateSummaryKey(options.runId), result);
  await putJson(options.bucket, exceptionsKey(options.runId), exceptions);

  const topicArn =
    options.topicArn ??
    process.env.EXCEPTION_TOPIC_ARN ??
    getEnv().EXCEPTION_TOPIC_ARN;
  const shouldEmail =
    !options.skipAlertEmail &&
    Boolean(topicArn) &&
    (options.sandbox || options.dryRun || !result.ok || exceptions.length > 0);
  if (!shouldEmail) {
    console.log(
      `[validate] Skipping alert email run=${options.runId} topicArn=${topicArn ? 'set' : 'missing'} sandbox=${options.sandbox} dryRun=${options.dryRun} ok=${result.ok} exceptions=${exceptions.length}`,
    );
  }
  if (shouldEmail) {
    if (!options.forceAlertEmail && (await alertEmailAlreadySent(options.bucket, options.runId))) {
      console.log(`[validate] Alert email already sent for run ${options.runId}; skipping duplicate`);
    } else {
      const alertOptions = {
        runId: options.runId,
        ok: result.ok,
        hardFailures,
        exceptions,
        opened,
        newServices,
        closed,
        discharge,
        sessions,
        parseCounts: parse?.counts,
        dryRun: options.dryRun,
        sandbox: options.sandbox,
        sandboxEmailFixtures: options.sandboxEmailFixtures,
      };
      const csvAttachments = buildAlertCsvAttachments({
        exceptions,
        opened,
        newServices,
        closed,
        discharge,
        sessions,
      });
      const resultRows = buildPipelineResultCsvRows({
        exceptions,
        opened,
        newServices,
        closed,
        discharge,
        sessions,
      });
      if (resultRows.length > 0) {
        await putText(
          options.bucket,
          resultsHtmlKey(options.runId),
          formatResultsHtml(resultRows),
          'text/html; charset=utf-8',
        );
      }
      for (const att of csvAttachments) {
        const key =
          att.filename === 'failures.csv'
            ? failuresCsvKey(options.runId)
            : resultsCsvKey(options.runId);
        await putText(options.bucket, key, att.content, att.contentType);
      }
      const alertBody = formatPipelineAlertBody(alertOptions);
      const env = getEnv();
      const htmlBody = formatPipelineAlertHtml({
        ...alertOptions,
        logoUrl: process.env.ALERT_LOGO_URL ?? env.ALERT_LOGO_URL,
        hasCsvAttachments: csvAttachments.length > 0,
      });
      const subject = buildAlertSubject({
        runId: options.runId,
        ok: result.ok,
        hardFailures,
        exceptions,
        dryRun: options.dryRun,
        sandbox: options.sandbox,
      });

      // Read alert recipients/from from process.env directly — getEnv Zod schema
      // historically omitted these keys and stripped them (silent no-send).
      const alertEmails =
        process.env.ALERT_EMAILS?.trim() || env.ALERT_EMAILS?.trim() || undefined;
      const fromEmail =
        process.env.ALERT_FROM_EMAIL?.trim() || env.ALERT_FROM_EMAIL?.trim() || undefined;
      const fromEmailFallback =
        process.env.ALERT_FROM_EMAIL_FALLBACK?.trim() ||
        env.ALERT_FROM_EMAIL_FALLBACK?.trim() ||
        undefined;
      const fromName =
        process.env.ALERT_FROM_NAME?.trim() || env.ALERT_FROM_NAME?.trim() || undefined;
      const replyTo =
        process.env.ALERT_REPLY_TO?.trim() || env.ALERT_REPLY_TO?.trim() || undefined;

      console.log(
        `[validate] Sending alert email run=${options.runId} recipients=${alertEmails ?? '(none)'} from=${fromEmail ?? '(none)'} replyTo=${replyTo ?? fromEmail ?? '(none)'}`,
      );

      const sent = await sendPipelineAlert({
        topicArn,
        fromEmail,
        fromEmailFallback,
        fromName,
        replyTo,
        alertEmails,
        subject,
        textBody: alertBody,
        htmlBody,
        attachments: csvAttachments,
      });

      console.log(
        `[validate] Alert result run=${options.runId} channel=${sent.channel} sesCount=${sent.sesCount} snsFallback=${sent.snsFallback}`,
      );

      if (sent.channel === 'none') {
        console.warn(
          `[validate] Alert email not delivered for run ${options.runId} (channel=none); not marking as sent`,
        );
      } else {
        await putJson(options.bucket, alertEmailSentKey(options.runId), {
          sentAt: new Date().toISOString(),
          subject,
          channel: sent.channel,
          sesCount: sent.sesCount,
          snsFallback: sent.snsFallback,
          attachments: csvAttachments.map((a) => a.filename),
        });
      }
    }
  }

  return result;
}
