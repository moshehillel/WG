import type { PipelineException, ProcessorResult } from './types/pipeline.js';
import type { ParseReportCounts } from './exception-guidance.js';

/** Run id used by `npm run sandbox:email-preview` and HTML tests. */
export const SANDBOX_EMAIL_PREVIEW_RUN_ID = 'sandbox-email-preview-local';

/**
 * Sample validate payload that mirrors `docs/samples/sandbox-email-fixtures/`
 * (SANDBOX-FIX names) so local HTML/CSV preview matches live alert layout.
 */
export function sandboxEmailPreviewAlertOptions(): {
  runId: string;
  ok: boolean;
  hardFailures: number;
  sandbox: boolean;
  sandboxEmailFixtures: boolean;
  dryRun: boolean;
  parseCounts: ParseReportCounts;
  opened: ProcessorResult;
  newServices: ProcessorResult;
  closed: ProcessorResult;
  discharge: ProcessorResult;
  sessions: ProcessorResult;
  exceptions: PipelineException[];
} {
  const runId = SANDBOX_EMAIL_PREVIEW_RUN_ID;

  const exceptions: PipelineException[] = [
    {
      code: 'skipped_by_rule',
      message: '[opened_cases] row=9000001 skipped: Early Intervention case not sent to HHA',
      reportKind: 'opened_cases',
      rowId: '9000001',
      details: { triageReason: 'early_intervention', patientName: 'SANDBOX-FIX EI Child' },
    },
    {
      code: 'unmatched_patient',
      message:
        '[new_services] row=9000003 FAILED — patient not found in HHA. No HHA write attempted.',
      reportKind: 'new_services',
      rowId: '9000003',
      details: {
        preview: true,
        patientName: 'SANDBOX-FIX New Svc Child',
        caregiverName: 'FIX THERAPIST',
        programType: 'Extended Home Care Therapy',
      },
    },
    {
      code: 'skipped_by_rule',
      message: '[closed_cases] row=9000004 skipped: Early Intervention case not sent to HHA',
      reportKind: 'closed_cases',
      rowId: '9000004',
      details: { triageReason: 'early_intervention', patientName: 'SANDBOX-FIX EI Close' },
    },
    {
      code: 'missing_field',
      message:
        '[discharge_service] row=9000006 FAILED — missing required field(s): Service Type. No HHA write attempted.',
      reportKind: 'discharge_service',
      rowId: '9000006',
      details: {
        missing: ['serviceType'],
        preview: true,
        patientName: 'SANDBOX-FIX Discharge Bad',
        caregiverName: 'FIX THERAPIST',
        programType: 'Extended Home Care Therapy',
      },
    },
    {
      code: 'skipped_by_rule',
      message: '[verified_sessions] row=9000101 skipped: Early Intervention session not sent to HHA',
      reportKind: 'verified_sessions',
      rowId: '9000101',
      details: {
        triageReason: 'early_intervention',
        patientName: 'SANDBOX-FIX EI Session',
        caregiverName: 'FIX PROVIDER',
      },
    },
    {
      code: 'unknown_service_code',
      message: '[verified_sessions] row=9000103 FAILED — unknown Service Type.',
      reportKind: 'verified_sessions',
      rowId: '9000103',
      details: {
        preview: true,
        serviceCode: 'PT School Makeup',
        patientName: 'SANDBOX-FIX Bad Code',
        caregiverName: 'FIX PROVIDER',
        programType: 'Extended Home Care Therapy',
      },
    },
    {
      code: 'missing_field',
      message: '[verified_sessions] row=9000104 FAILED — invalid Pay Rate.',
      reportKind: 'verified_sessions',
      rowId: '9000104',
      details: {
        preview: true,
        payCodeName: 'OT75',
        patientName: 'SANDBOX-FIX Bad Pay',
        caregiverName: 'FIX PROVIDER',
        programType: 'Extended Home Care Therapy',
      },
    },
    {
      code: 'missing_field',
      message: '[verified_sessions] row=9000105 FAILED — caregiver code not found.',
      reportKind: 'verified_sessions',
      rowId: '9000105',
      details: {
        preview: true,
        providerName: 'CAGLIUSO ADAM',
        patientName: 'SANDBOX-FIX Bad Caregiver',
        caregiverName: 'CAGLIUSO ADAM',
        programType: 'Extended Home Care Therapy',
      },
    },
  ];

  return {
    runId,
    ok: false,
    hardFailures: 5,
    sandbox: true,
    sandboxEmailFixtures: true,
    dryRun: true,
    parseCounts: {
      gluck_opened_cases: 2,
      new_services: 1,
      closed_cases: 2,
      discharge_service: 2,
      verified_sessions: 6,
      opened_cases_after_ei_filter: 1,
      gluck_opened_after_ei_filter: 1,
      new_services_after_ei_filter: 1,
    },
    opened: {
      runId,
      reportKind: 'opened_cases',
      processed: 2,
      succeeded: 1,
      skipped: 1,
      failed: 0,
      exceptions: [],
      successes: [{ rowId: '9000002', patientName: 'SANDBOX-FIX Open Child', programType: 'Extended Home Care Therapy' }],
    },
    newServices: {
      runId,
      reportKind: 'new_services',
      processed: 1,
      succeeded: 0,
      skipped: 0,
      failed: 1,
      exceptions: [],
    },
    closed: {
      runId,
      reportKind: 'closed_cases',
      processed: 2,
      succeeded: 1,
      skipped: 1,
      failed: 0,
      exceptions: [],
      successes: [{ rowId: '9000005', patientName: 'SANDBOX-FIX Close OK', programType: 'Extended Home Care Therapy' }],
    },
    discharge: {
      runId,
      reportKind: 'discharge_service',
      processed: 2,
      succeeded: 1,
      skipped: 0,
      failed: 1,
      exceptions: [],
      successes: [{ rowId: '9000007', patientName: 'SANDBOX-FIX Discharge OK', programType: 'Extended Home Care Therapy' }],
    },
    sessions: {
      runId,
      reportKind: 'verified_sessions',
      processed: 6,
      succeeded: 2,
      skipped: 1,
      failed: 3,
      exceptions: [],
      successes: [
        {
          rowId: '9000102',
          patientName: 'SANDBOX-FIX OK Session',
          caregiverName: 'FORTUNE JOHANA',
          programType: 'Extended Home Care Therapy',
        },
        {
          rowId: '9000106',
          patientName: 'SANDBOX-FIX OK Session 2',
          caregiverName: 'FORTUNE JOHANA',
          programType: 'Extended Home Care Therapy',
        },
      ],
    },
    exceptions,
  };
}
