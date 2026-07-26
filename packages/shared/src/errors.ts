import type { ExceptionCode, PipelineException, ProcessorResult } from './types/pipeline.js';
import {
  explainPipelineError,
  formatAlertSubject,
  formatExplainedException,
  isPreviewException,
  looksLikeStubFixtureData,
  summarizeProcessorResult,
} from './exception-guidance.js';

export {
  explainException,
  explainPipelineError,
  formatAlertSubject,
  formatExplainedException,
  isPreviewException,
  looksLikeStubFixtureData,
  codeLabel,
  reportLabel,
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
  closed?: ProcessorResult;
  sessions?: ProcessorResult;
  pipelineStep?: string;
  pipelineError?: string;
  dryRun?: boolean;
}): string {
  const lines: string[] = [];
  const previewExceptions = options.exceptions.filter(isPreviewException);
  const allPreview =
    options.exceptions.length > 0 && previewExceptions.length === options.exceptions.length;
  const stubFixtures = looksLikeStubFixtureData(options.exceptions);
  const dryRun = options.dryRun ?? allPreview;

  lines.push(`Run ID: ${options.runId}`);
  lines.push('');

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

  if (dryRun) {
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

  if (options.ok && options.exceptions.length === 0) {
    lines.push('Result: SUCCESS — all rows passed checks.');
    return lines.join('\n').trimEnd();
  }

  if (dryRun && allPreview) {
    lines.push(
      `Result: ${options.exceptions.length} mapping issue(s) found during preview (${options.hardFailures} row(s) would be blocked on live run).`,
    );
  } else if (!options.ok) {
    lines.push(`Result: FAILED — ${options.hardFailures} row(s) blocked from HHA sync.`);
  } else {
    lines.push(`Result: Completed with ${options.exceptions.length} note(s).`);
  }
  lines.push('');

  lines.push('--- Summary by report ---');
  lines.push(summarizeProcessorResult('Gluck open (new cases)', options.opened));
  lines.push(summarizeProcessorResult('Gluck closure', options.closed));
  lines.push(summarizeProcessorResult('API Report (sessions)', options.sessions));
  lines.push('');

  if (options.exceptions.length === 0) {
    lines.push('No row-level issues recorded.');
    return lines.join('\n').trimEnd();
  }

  lines.push(`--- Issues (${options.exceptions.length}) — read each block below ---`);
  lines.push('');

  options.exceptions.slice(0, 25).forEach((ex, i) => {
    lines.push(formatExplainedException(ex, i + 1));
    lines.push('');
  });

  if (options.exceptions.length > 25) {
    lines.push(`… and ${options.exceptions.length - 25} more issue(s). See S3 exceptions.json for full list.`);
    lines.push('');
  }

  lines.push('--- Quick reference ---');
  lines.push('• Program Type → HHA ContractID: must match GetContracts name exactly');
  lines.push('• Service Type → HHA billing code: must exist in GetBillingServiceCodes');
  lines.push('• Gluck open: needs DOB, address, city, state, zip, auth number for new patients');
  lines.push('• API Report: needs Provider Name + Pay Rate for caregiver/pay code lookup');
  lines.push('• Early Intervention rows are always skipped (by design)');

  return lines.join('\n').trimEnd();
}

export function buildAlertSubject(options: {
  runId: string;
  ok: boolean;
  hardFailures: number;
  exceptions: PipelineException[];
  pipelineStep?: string;
  dryRun?: boolean;
}): string {
  const allPreview =
    options.exceptions.length > 0 &&
    options.exceptions.every(isPreviewException);
  return formatAlertSubject({
    runId: options.runId,
    ok: options.ok,
    dryRun: options.dryRun ?? allPreview,
    hardFailures: options.hardFailures,
    exceptionCount: options.exceptions.length,
    pipelineStep: options.pipelineStep,
    allPreview,
    stubFixtures: looksLikeStubFixtureData(options.exceptions),
  });
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
    details: options.details,
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
    details: { step: options.step, ...options.extraDetails },
  };
}
