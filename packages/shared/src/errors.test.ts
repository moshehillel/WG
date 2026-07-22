import { describe, expect, it } from 'vitest';
import {
  formatExceptionLine,
  formatPipelineAlertBody,
  parseStepFunctionsCause,
} from './errors.js';
import type { PipelineException } from './types/pipeline.js';

describe('errors', () => {
  it('formats exception lines with code, report, row, step', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message: 'HHA AddPatientContract failed: invalid ContractID (ErrorID=-12)',
      reportKind: 'opened_cases',
      rowId: 'c99',
      details: { step: 'upsertContract' },
    };
    expect(formatExceptionLine(ex)).toBe(
      '[hha_api_error] report=opened_cases row=c99 step=upsertContract: HHA AddPatientContract failed: invalid ContractID (ErrorID=-12)',
    );
  });

  it('builds alert body with grouped unique messages', () => {
    const body = formatPipelineAlertBody({
      runId: '2026-07-21T120000Z',
      ok: false,
      hardFailures: 2,
      exceptions: [
        {
          code: 'hha_api_error',
          message: '[opened_cases] row=c1 step=upsertPatient: patient not found',
          reportKind: 'opened_cases',
          rowId: 'c1',
        },
        {
          code: 'parse_error',
          message: 'Closed case row missing caseId (discharge report line 44)',
          reportKind: 'closed_cases',
        },
      ],
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
    expect(body).toContain('FAILED (2 hard failure(s))');
    expect(body).toContain('hha_api_error (1)');
    expect(body).toContain('parse_error (1)');
    expect(body).toContain('row=c1 step=upsertPatient');
  });

  it('parses Step Functions cause JSON', () => {
    const parsed = parseStepFunctionsCause(
      JSON.stringify({ errorType: 'Error', errorMessage: 'REPORTS_BUCKET is required' }),
    );
    expect(parsed.errorMessage).toBe('REPORTS_BUCKET is required');
  });
});
