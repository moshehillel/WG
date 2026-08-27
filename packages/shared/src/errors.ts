import type { ExceptionCode, PipelineException, ProcessorResult } from './types/pipeline.js';
import type { ParseReportCounts } from './exception-guidance.js';
import {
  explainPipelineError,
  formatAlertSubject,
  formatExplainedException,
  isPreviewException,
  looksLikeStubFixtureData,
  partitionExceptionsForAlert,
  formatSessionOutcomeSummary,
  formatReportsSummary,
} from './exception-guidance.js';

export {
  explainException,
  explainPipelineError,
  formatAlertSubject,
  formatExplainedException,
  formatGroupedExceptionsSection,
  formatGroupedRowList,
  formatExceptionReasonGroup,
  formatSucceededSection,
  groupExceptionsByReason,
  exceptionReasonKey,
  isPreviewException,
  looksLikeStubFixtureData,
  codeLabel,
  reportLabel,
  partyDetailsFromRow,
  patientNameFromDetails,
  caregiverNameFromDetails,
  parseHhaApiFault,
  cleanExceptionMessage,
  formatActionableReason,
} from './exception-guidance.js';

/** Extract a readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Parse Step Functions / Lambda error Cause JSON when present. */
export function parseStepFunctionsCause(cause: string | undefined): {
  errorType?: string;
  errorMessage?: string;
  trace?: string[];
} {
  if (!cause) return {};
  try {
    const parsed = JSON.parse(cause) as {
      errorType?: string;
      errorMessage?: string;
      trace?: string[];
    };
    return parsed;
  } catch {
    return { errorMessage: cause };
  }
}

export function formatExceptionLine(ex: PipelineException): string {
  const explained = formatExplainedException(ex, 0).split('\n').slice(1).join('\n');
  return explained.trim() || ex.message;
}

export function groupExceptionsByCode(
  exceptions: PipelineException[],
): Map<ExceptionCode, PipelineException[]> {
  const groups = new Map<ExceptionCode, PipelineException[]>();
  for (const ex of exceptions) {
    const list = groups.get(ex.code) ?? [];
    list.push(ex);
    groups.set(ex.code, list);
  }
  return groups;
}

/** Human-readable SNS / email body for validate + pipeline failure alerts. */
export function formatPipelineAlertBody(options: {
  runId: string;
  ok: boolean;
  hardFailures: number;
  exceptions: PipelineException[];
  opened?: ProcessorResult;
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
  parseCounts?: ParseReportCounts;
  pipelineStep?: string;
  pipelineError?: string;
  dryRun?: boolean;
  sandbox?: boolean;
  sandboxEmailFixtures?: boolean;
}): string {
  const lines: string[] = [];
  const { actionable } = partitionExceptionsForAlert(options.exceptions);
  const previewExceptions = actionable.filter(isPreviewException);
  const allPreview = actionable.length > 0 && previewExceptions.length === actionable.length;
  const stubFixtures = looksLikeStubFixtureData(actionable);
  const dryRun = options.dryRun ?? allPreview;
  const sandbox = options.sandbox ?? false;
  const fixtures = options.sandboxEmailFixtures ?? false;

  lines.push(`Run ID: ${options.runId}`);
  lines.push('');

  if (fixtures) {
    lines.push('=== SANDBOX EMAIL PREVIEW (fixture CSVs — fake rows only) ===');
    lines.push('Fake CSV files uploaded to S3 — no ProviderSoft download, no HHA writes.');
    lines.push('Read-only HHA lookups run so mapping errors look like a real sandbox run.');
    lines.push('Production schedules never use this mode.');
    lines.push('');
  }

  if (options.pipelineStep || options.pipelineError) {
    lines.push('=== PIPELINE STOPPED (infrastructure / download error) ===');
    lines.push('');
    if (options.pipelineStep) lines.push(`Failed step: ${options.pipelineStep}`);
    if (options.pipelineError) {
      const explained = explainPipelineError(options.pipelineError);
      lines.push(`What happened: ${explained.summary}`);
      lines.push(`Likely cause: ${explained.likelyCause}`);
      lines.push(`What to do: ${explained.action}`);
    }
    lines.push('');
    lines.push('No ProviderSoft row processing ran after this point.');
    return lines.join('\n').trimEnd();
  }

  if (sandbox && !fixtures) {
    lines.push('=== SANDBOX RUN (no HHA writes) ===');
    lines.push('Real ProviderSoft download + production HHA read-only lookups.');
    lines.push('This email shows what WOULD happen on a live run and any errors found.');
    lines.push('');
  } else if (dryRun) {
    lines.push('=== DRY-RUN MODE ===');
    lines.push('No changes were made to HHA. This email lists rows that WOULD fail on a live run.');
    lines.push('');
  } else {
    lines.push('=== LIVE RUN ===');
    lines.push('This run attempted real HHA sync (sandbox or production per Secrets Manager URL).');
    lines.push('');
  }

  if (stubFixtures) {
    lines.push('*** TEST DATA WARNING ***');
    lines.push(
      'Rows like HH-1, S-1, S-2, PCA001 are AWS stub fixtures — not real ProviderSoft exports.',
    );
    lines.push(
      'These alerts are expected until the live Playwright bot is deployed (Docker + providerSoftLiveBot=true).',
    );
    lines.push('Real Gluck/API Report data will produce meaningful mapping results.');
    lines.push('');
  }

  const fullSuccess = options.ok && actionable.length === 0;
  if (fullSuccess) {
    lines.push('Result: SUCCESS — all rows passed checks.');
    if (!sandbox && !dryRun) {
      return lines.join('\n').trimEnd();
    }
    lines.push('');
  } else if (dryRun && allPreview) {
    lines.push(
      `Result: ${actionable.length} mapping issue(s) found during preview (${options.hardFailures} row(s) would be blocked on live run).`,
    );
  } else if (!options.ok) {
    lines.push(`Result: FAILED — ${options.hardFailures} row(s) blocked from HHA sync.`);
  } else if (actionable.length > 0) {
    lines.push(`Result: Completed with ${actionable.length} note(s) needing review.`);
  } else {
    lines.push('Result: Completed — no actionable issues.');
  }
  lines.push('');

  lines.push('--- Summary by report ---');
  lines.push(
    ...formatReportsSummary({
      parse: options.parseCounts,
      opened: options.opened,
      newServices: options.newServices,
      closed: options.closed,
      discharge: options.discharge,
      sessions: options.sessions,
    }),
  );
  lines.push('');

  const sessionOutcome = formatSessionOutcomeSummary(options.sessions, options.exceptions);
  if (sessionOutcome.length > 0) {
    lines.push(...sessionOutcome);
    lines.push('');
  }

  if (actionable.length === 0) {
    lines.push('--- Failed ---');
    lines.push('  (none)');
    lines.push('');
    lines.push('Attachments: failures.csv / results.csv (when emailed via SES). Results table is in the HTML email body.');
    return lines.join('\n').trimEnd();
  }

  lines.push('--- Failed ---');
  lines.push(
    `  ${options.hardFailures} row(s) — see Results table in the HTML email (reasons + patients).`,
  );
  lines.push('');
  lines.push('Attachments: failures.csv and results.csv (Excel import).');

  return lines.join('\n').trimEnd();
}

export function buildAlertSubject(options: {
  runId: string;
  ok: boolean;
  hardFailures: number;
  exceptions: PipelineException[];
  pipelineStep?: string;
  dryRun?: boolean;
  sandbox?: boolean;
}): string {
  const { actionable, skippedCount } = partitionExceptionsForAlert(options.exceptions);
  const allPreview = actionable.length > 0 && actionable.every(isPreviewException);
  return formatAlertSubject({
    runId: options.runId,
    ok: options.ok,
    dryRun: options.dryRun ?? allPreview,
    sandbox: options.sandbox,
    hardFailures: options.hardFailures,
    exceptionCount: actionable.length,
    skippedCount,
    pipelineStep: options.pipelineStep,
    allPreview,
    stubFixtures: looksLikeStubFixtureData(actionable),
  });
}

function normalizePartyDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = { ...details };
  if (!out.patientName) {
    const first = typeof out.firstName === 'string' ? out.firstName.trim() : '';
    const last = typeof out.lastName === 'string' ? out.lastName.trim() : '';
    const joined = [first, last].filter(Boolean).join(' ');
    if (joined) out.patientName = joined;
  }
  if (
    !out.caregiverName &&
    typeof out.providerName === 'string' &&
    out.providerName.trim()
  ) {
    out.caregiverName = out.providerName.trim();
  }
  return out;
}

export function buildRowException(options: {
  code: ExceptionCode;
  message: string;
  reportKind?: PipelineException['reportKind'];
  rowId?: string;
  details?: Record<string, unknown>;
}): PipelineException {
  return {
    code: options.code,
    message: options.message,
    reportKind: options.reportKind,
    rowId: options.rowId,
    details: normalizePartyDetails(options.details),
  };
}

export function buildHhaRowException(options: {
  reportKind: NonNullable<PipelineException['reportKind']>;
  rowId: string;
  step: string;
  err: unknown;
  extraDetails?: Record<string, unknown>;
}): PipelineException {
  const base = errorMessage(options.err);
  const message = `[${options.reportKind}] row=${options.rowId} step=${options.step}: ${base}`;
  return {
    code: 'hha_api_error',
    message,
    reportKind: options.reportKind,
    rowId: options.rowId,
    details: normalizePartyDetails({ step: options.step, ...options.extraDetails }),
  };
}
