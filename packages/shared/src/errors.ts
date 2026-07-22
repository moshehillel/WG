import type { ExceptionCode, PipelineException, ProcessorResult } from './types/pipeline.js';

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
  const tags: string[] = [`[${ex.code}]`];
  if (ex.reportKind) tags.push(`report=${ex.reportKind}`);
  if (ex.rowId) tags.push(`row=${ex.rowId}`);
  const step = ex.details?.step;
  if (typeof step === 'string') tags.push(`step=${step}`);
  return `${tags.join(' ')}: ${ex.message}`;
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

function formatProcessorSummary(name: string, result?: ProcessorResult): string {
  if (!result) return `${name}: (not run)`;
  const status =
    result.failed > 0
      ? `${result.failed} failed`
      : result.exceptions.length > 0
        ? `${result.exceptions.length} exception(s)`
        : 'OK';
  return `${name}: ${status} (${result.succeeded} ok, ${result.skipped} skipped, ${result.processed} total)`;
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
}): string {
  const lines: string[] = [];
  const headline = options.ok
    ? `White-glove run ${options.runId}: completed with exceptions`
    : `White-glove run ${options.runId}: FAILED (${options.hardFailures} hard failure(s))`;

  lines.push(headline);
  lines.push('');

  if (options.pipelineStep || options.pipelineError) {
    lines.push('Pipeline step failure');
    if (options.pipelineStep) lines.push(`  Step: ${options.pipelineStep}`);
    if (options.pipelineError) lines.push(`  Error: ${options.pipelineError}`);
    lines.push('');
  }

  lines.push('Processor summary');
  lines.push(`  ${formatProcessorSummary('Opened cases', options.opened)}`);
  lines.push(`  ${formatProcessorSummary('Closed cases', options.closed)}`);
  lines.push(`  ${formatProcessorSummary('Verified sessions', options.sessions)}`);
  lines.push('');

  if (options.exceptions.length === 0 && !options.pipelineError) {
    lines.push('No row-level exceptions recorded.');
    return lines.join('\n');
  }

  const groups = groupExceptionsByCode(options.exceptions);
  lines.push(`Exceptions (${options.exceptions.length} total, ${groups.size} type(s))`);
  lines.push('');

  for (const [code, items] of groups) {
    lines.push(`${code} (${items.length})`);
    const shown = items.slice(0, 15);
    for (const ex of shown) {
      lines.push(`  - ${formatExceptionLine(ex)}`);
    }
    if (items.length > shown.length) {
      lines.push(`  - … and ${items.length - shown.length} more ${code} item(s)`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
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
