import { describe, expect, it } from 'vitest';
import {
  explainException,
  formatReportsSummary,
  reportLabel,
} from './exception-guidance.js';
import { exceptionToResultCsvRow } from './alert-results-csv.js';
import type { PipelineException } from './types/pipeline.js';

describe('formatReportsSummary', () => {
  it('shows 0 downloaded when report was in scope but empty', () => {
    const lines = formatReportsSummary({
      parse: {
        gluck_opened_cases: 0,
        new_services: 0,
        closed_cases: 0,
        discharge_service: 0,
        verified_sessions: 0,
      },
    });
    expect(lines.find((l) => l.includes('Gluck open'))).toMatch(/0 downloaded/);
    expect(lines.find((l) => l.includes('new service') || l.includes('New service'))).toMatch(
      /0 downloaded/,
    );
    expect(lines.find((l) => l.includes('Gluck closure'))).toMatch(/0 downloaded/);
    expect(lines.find((l) => l.includes('Discharge service'))).toMatch(/0 rows/);
    expect(lines.every((l) => !l.includes('not required to download'))).toBe(true);
  });

  it('shows not required when counts are omitted (not in reportKinds)', () => {
    const lines = formatReportsSummary({
      parse: { verified_sessions: 3 },
      closed: {
        runId: 'r1',
        reportKind: 'closed_cases',
        processed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        exceptions: [],
      },
      sessions: {
        runId: 'r1',
        reportKind: 'verified_sessions',
        processed: 3,
        succeeded: 3,
        skipped: 0,
        failed: 0,
        exceptions: [],
      },
    });
    expect(lines.filter((l) => l.includes('not required to download')).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(lines.find((l) => l.includes('API Report') || l.includes('verified'))).toMatch(
      /3 downloaded/,
    );
  });

  it('shows separate Gluck closure vs Discharge service outcomes when both processed', () => {
    const lines = formatReportsSummary({
      parse: {
        closed_cases: 2,
        discharge_service: 1,
      },
      closed: {
        runId: 'r1',
        reportKind: 'closed_cases',
        processed: 2,
        succeeded: 2,
        skipped: 0,
        failed: 0,
        exceptions: [],
      },
      discharge: {
        runId: 'r1',
        reportKind: 'discharge_service',
        processed: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        exceptions: [],
      },
    });
    expect(lines.find((l) => l.includes('Gluck closure'))).toMatch(
      /2 downloaded — 2 ok, 2 total/,
    );
    expect(lines.find((l) => l.includes('Discharge service'))).toMatch(
      /1 downloaded — 1 blocked, 0 ok, 1 total/,
    );
  });
});

describe('discharge vs closure report labels', () => {
  it('maps reportKind to distinct ops labels', () => {
    expect(reportLabel('closed_cases')).toBe('Gluck closure');
    expect(reportLabel('discharge_service')).toBe('Discharge service');
  });

  it('CSV row for Fernando discharge fail uses Discharge service (not Gluck closure)', () => {
    const ex: PipelineException = {
      code: 'hha_api_error',
      message:
        '[discharge_service] row=FERNANDO-1 step=dischargeService: Ambiguous HHA discharge: patient has 2 active placement(s)',
      reportKind: 'discharge_service',
      rowId: 'FERNANDO-1',
      details: {
        patientName: 'Fernando Test',
        firstName: 'Fernando',
        lastName: 'Test',
      },
    };
    const explained = explainException(ex);
    expect(explained.reportLabel).toBe('Discharge service');

    const csv = exceptionToResultCsvRow(ex);
    expect(csv.reportKind).toBe('discharge_service');
    expect(csv.reportLabel).toBe('Discharge service');
    expect(csv.reportLabel).not.toBe('Gluck closure');
  });

  it('legacy closed_cases + discharge_service message still labels as Discharge service', () => {
    const ex: PipelineException = {
      code: 'missing_field',
      message:
        '[discharge_service] row=FERNANDO-1 FAILED — missing required field(s): Service Type, Service Begin Date',
      reportKind: 'closed_cases',
      rowId: 'FERNANDO-1',
      details: { missing: ['Service Type', 'Service Begin Date'] },
    };
    expect(explainException(ex).reportLabel).toBe('Discharge service');
  });
});
