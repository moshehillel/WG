import { describe, expect, it } from 'vitest';
import {
  buildAlertSubject,
  explainPipelineError,
  formatExplainedException,
  formatPipelineAlertBody,
  looksLikeStubFixtureData,
  parseStepFunctionsCause,
} from './errors.js';
import type { PipelineException } from './types/pipeline.js';

const stubPreviewExceptions: PipelineException[] = [
  {
    code: 'other',
    message:
      '[preview/opened_cases] case/session HH-1: Program Type "Home Health" is not mapped to an HHA contract ID',
    reportKind: 'opened_cases',
    rowId: 'HH-1',
    details: { programType: 'Home Health', preview: true },
  },
  {
    code: 'unknown_service_code',
    message:
      '[preview/opened_cases] case/session HH-1: Service Type "PCA001" has no matching HHA billing code',
    reportKind: 'opened_cases',
    rowId: 'HH-1',
    details: { serviceCode: 'PCA001', preview: true },
  },
];

describe('errors', () => {
  it('detects stub fixture preview data', () => {
    expect(looksLikeStubFixtureData(stubPreviewExceptions)).toBe(true);
  });

  it('formats explained exceptions with problem, impact, and action', () => {
    const text = formatExplainedException(stubPreviewExceptions[0]!, 1);
    expect(text).toContain('Gluck open');
    expect(text).toContain('Problem:');
    expect(text).toContain('What to do:');
    expect(text).toContain('Dry-run preview only');
  });

  it('builds dry-run subject that does not say LIVE FAILED', () => {
    const subject = buildAlertSubject({
      runId: 'manual-test',
      ok: false,
      hardFailures: 4,
      exceptions: stubPreviewExceptions,
      dryRun: true,
    });
    expect(subject).toContain('DRY-RUN');
    expect(subject).not.toContain('LIVE FAILED');
  });

  it('builds alert body with stub warning and dry-run header', () => {
    const body = formatPipelineAlertBody({
      runId: 'manual-2026-07-26-live',
      ok: false,
      hardFailures: 4,
      exceptions: stubPreviewExceptions,
      dryRun: true,
      opened: {
        runId: 'x',
        reportKind: 'opened_cases',
        processed: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        exceptions: [],
      },
    });
    expect(body).toContain('DRY-RUN MODE');
    expect(body).toContain('TEST DATA WARNING');
    expect(body).toContain('HH-1');
    expect(body).toContain('No changes were made to HHA');
    expect(body).not.toContain('hard failure(s)');
  });

  it('explains common pipeline download errors', () => {
    const explained = explainPipelineError(
      "ENOENT: no such file or directory, open '/tmp/wg-ps-x/closed-cases.csv'",
    );
    expect(explained.action).toContain('Re-run');
  });

  it('parses Step Functions cause JSON', () => {
    const parsed = parseStepFunctionsCause(
      JSON.stringify({ errorType: 'Error', errorMessage: 'REPORTS_BUCKET is required' }),
    );
    expect(parsed.errorMessage).toBe('REPORTS_BUCKET is required');
  });
});
