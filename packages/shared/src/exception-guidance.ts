import type { ExceptionCode, PipelineException, ProcessorResult } from './types/pipeline.js';

/** Known AWS stub fixture row IDs — not real ProviderSoft Program Ids. */
const STUB_ROW_IDS = new Set([
  'HH-1',
  'EI-1',
  'HH-0',
  'HH-2',
  'S-1',
  'S-2',
  'S-3',
  'p1',
  'p2',
]);

const REPORT_LABELS: Record<string, string> = {
  opened_cases: 'Gluck open (new cases)',
  closed_cases: 'Gluck closure',
  verified_sessions: 'API Report (verified sessions)',
  caregiver_codes: 'Caregiver codes',
  discharge_service: 'Discharge service',
};

const CODE_LABELS: Record<ExceptionCode, string> = {
  missing_service_code: 'Missing service type',
  unknown_service_code: 'Unknown service type (no HHA billing code)',
  unmatched_patient: 'Patient not found in HHA',
  missing_authorization: 'Missing authorization number',
  clocking_mismatch: 'EVV clock times do not match',
  hha_api_error: 'HHA API error',
  parse_error: 'Missing required field in ProviderSoft export',
  skipped_by_rule: 'Skipped by business rule',
  download_error: 'ProviderSoft download failed',
  pipeline_step_error: 'Pipeline infrastructure error',
  other: 'Mapping or configuration issue',
};

export function isPreviewException(ex: PipelineException): boolean {
  return ex.details?.preview === true || ex.message.includes('[preview/');
}

export function looksLikeStubFixtureData(exceptions: PipelineException[]): boolean {
  const previewRows = exceptions
    .filter(isPreviewException)
    .map((e) => e.rowId)
    .filter((id): id is string => Boolean(id));
  if (previewRows.length === 0) return false;
  return previewRows.every((id) => STUB_ROW_IDS.has(id));
}

export function reportLabel(reportKind: string | undefined): string {
  if (!reportKind) return 'Unknown report';
  return REPORT_LABELS[reportKind] ?? reportKind;
}

export function codeLabel(code: ExceptionCode): string {
  return CODE_LABELS[code] ?? code;
}

export interface ExplainedException {
  title: string;
  problem: string;
  impact: string;
  action: string;
  rowRef: string;
  reportLabel: string;
  isPreview: boolean;
}

export function explainException(ex: PipelineException): ExplainedException {
  const isPreview = isPreviewException(ex);
  const report = reportLabel(ex.reportKind);
  const rowRef = ex.rowId ? `row ${ex.rowId}` : 'this row';
  const programType =
    typeof ex.details?.programType === 'string' ? ex.details.programType : undefined;
  const serviceCode =
    typeof ex.details?.serviceCode === 'string' ? ex.details.serviceCode : undefined;
  const missing =
    typeof ex.details?.missing === 'string' ? ex.details.missing : undefined;
  const step = typeof ex.details?.step === 'string' ? ex.details.step : undefined;

  const modePrefix = isPreview ? 'DRY-RUN CHECK (no HHA changes were made)' : 'LIVE RUN';

  switch (ex.code) {
    case 'unknown_service_code':
      return {
        title: codeLabel(ex.code),
        problem: `Service Type "${serviceCode ?? '(missing)'}" from ProviderSoft does not match any HHA billing code.`,
        impact: isPreview
          ? 'If this were a live run, the case/session would be blocked and you would receive this alert.'
          : 'The row was not sent to HHA.',
        action:
          'Confirm the Service Type spelling in ProviderSoft matches HHA GetBillingServiceCodes. If HHA added a new code, update the mapping or ask HHA to create the billing code.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'missing_service_code':
      return {
        title: codeLabel(ex.code),
        problem: `The ProviderSoft export has no Service Type for ${rowRef}.`,
        impact: 'HHA requires a service/billing code to open a case or post a session.',
        action: 'Add Service Type to the ProviderSoft saved report columns, re-export, and re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'parse_error':
      if (missing) {
        const fieldLabels: Record<string, string> = {
          dateOfBirth: 'Date of Birth',
          address1: 'Address',
          city: 'City',
          state: 'State',
          zipCode: 'Zip Code',
        };
        const label = fieldLabels[missing] ?? missing;
        return {
          title: codeLabel(ex.code),
          problem: `${label} is blank on ${rowRef} in the Gluck open export.`,
          impact: 'HHA CreatePatient requires this field before a new patient can be created.',
          action: `Add "${label}" to the Gluck open saved report in ProviderSoft (Report Wizard column), re-download, and re-run.`,
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      return {
        title: codeLabel(ex.code),
        problem: ex.message.replace(/^\[preview\/[^\]]+\]\s*/i, ''),
        impact: 'The row cannot be processed until the export contains valid data.',
        action: 'Fix the ProviderSoft report export or parser mapping, then re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'missing_authorization':
      return {
        title: codeLabel(ex.code),
        problem: `Authorization Number is missing on ${rowRef}.`,
        impact: 'HHA CreatePatientAuthorization cannot run without an auth number.',
        action:
          'Add Authorization Number to the Gluck open report columns in ProviderSoft, re-export, and re-run.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'hha_api_error':
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'This row failed during an HHA SOAP/API call.',
        action: step
          ? `Review HHA response for step "${step}". Check sandbox vs production credentials and patient/contract IDs.`
          : 'Review CloudWatch logs for the processor Lambda and the HHA error text above.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'clocking_mismatch':
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'EVV session was not approved because clock-in/out did not match ProviderSoft times.',
        action:
          'Verify caregiver mobile clock in HHA matches the API Report Begin/End Time, then re-run Tuesday session sync.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'skipped_by_rule':
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'Row intentionally skipped (e.g. Early Intervention).',
        action: 'No action unless this skip is unexpected — then review program-type rules.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    case 'other':
      if (
        ex.message.includes('ContractID') ||
        ex.message.includes('Contract ID') ||
        programType !== undefined
      ) {
        return {
          title: 'Program Type not mapped to HHA contract',
          problem: `Program Type "${programType ?? '(missing)'}" on ${rowRef} is not linked to an HHA ContractID.`,
          impact: isPreview
            ? 'Dry-run flagged this before any HHA write.'
            : 'Case/session cannot be synced until the contract is resolved.',
          action:
            'Verify Program Type text in ProviderSoft exactly matches HHA GetContracts. Add mapping if this is a new payer/program.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (ex.message.includes('provider name') || ex.message.includes('caregiver')) {
        return {
          title: 'Caregiver not found',
          problem: `Provider Name is missing or not listed in the caregiver codes report for ${rowRef}.`,
          impact: 'HHA needs a caregiver ID to schedule or verify the session.',
          action:
            'Ensure API Report includes Provider Name and download the caregiver codes report (UserReportId 4541). Match names exactly.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      if (ex.message.includes('pay code')) {
        return {
          title: 'Pay code not found in HHA',
          problem: ex.message,
          impact: 'Session cannot be scheduled with the expected pay rate.',
          action:
            'Confirm Pay Rate + Service Type in API Report produce a valid HHA pay code (e.g. OT72). Check GetCaregiverPayCodes.',
          rowRef,
          reportLabel: report,
          isPreview,
        };
      }
      return {
        title: codeLabel(ex.code),
        problem: ex.message.replace(/^\[preview\/[^\]]+\]\s*/i, ''),
        impact: 'Row needs manual review before HHA sync.',
        action: 'See message above and fix ProviderSoft export or HHA mapping.',
        rowRef,
        reportLabel: report,
        isPreview,
      };

    default:
      return {
        title: codeLabel(ex.code),
        problem: ex.message,
        impact: 'Row was not processed successfully.',
        action: 'Review details and CloudWatch logs for this runId.',
        rowRef,
        reportLabel: report,
        isPreview,
      };
  }
}

export function formatExplainedException(ex: PipelineException, index: number): string {
  const e = explainException(ex);
  const lines = [
    `${index}. ${e.reportLabel} — ${e.rowRef}`,
    `   Issue: ${e.title}`,
    `   Problem: ${e.problem}`,
    `   Impact: ${e.impact}`,
    `   What to do: ${e.action}`,
  ];
  if (e.isPreview) {
    lines.push(`   Mode: ${e.isPreview ? 'Dry-run preview only (HHA was NOT updated)' : 'Live'}`);
  }
  return lines.join('\n');
}

export function summarizeProcessorResult(name: string, result?: ProcessorResult): string {
  if (!result) return `  ${name}: not executed in this run`;

  if (result.failed > 0) {
    return `  ${name}: ${result.failed} row(s) blocked (${result.succeeded} ok, ${result.skipped} skipped, ${result.processed} total)`;
  }
  if (result.exceptions.length > 0) {
    return `  ${name}: completed with ${result.exceptions.length} note(s) (${result.succeeded} ok, ${result.skipped} skipped)`;
  }
  return `  ${name}: OK (${result.succeeded} ok, ${result.skipped} skipped, ${result.processed} total)`;
}

export function formatAlertSubject(options: {
  runId: string;
  ok: boolean;
  dryRun?: boolean;
  hardFailures: number;
  exceptionCount: number;
  pipelineStep?: string;
  allPreview?: boolean;
  stubFixtures?: boolean;
}): string {
  if (options.pipelineStep) {
    return `White-glove ${options.runId}: PIPELINE STOPPED at ${options.pipelineStep}`;
  }
  if (options.dryRun && options.allPreview) {
    const label = options.stubFixtures ? 'DRY-RUN (test data)' : 'DRY-RUN preview';
    return `White-glove ${options.runId}: ${label} — ${options.exceptionCount} mapping issue(s) found`;
  }
  if (!options.ok) {
    return `White-glove ${options.runId}: LIVE FAILED — ${options.hardFailures} row(s) blocked`;
  }
  return `White-glove ${options.runId}: completed with ${options.exceptionCount} note(s)`;
}

export function explainPipelineError(raw: string): { summary: string; likelyCause: string; action: string } {
  if (raw.includes('ENOENT') && raw.includes('closed-cases.csv')) {
    return {
      summary: 'Download step could not find a report file before uploading to S3.',
      likelyCause:
        'Temporary CSV files were deleted before upload finished (fixed in latest deploy), or the wrong report kinds were requested.',
      action: 'Re-run the pipeline. If it persists, check Download Lambda CloudWatch logs.',
    };
  }
  if (raw.includes('REPORTS_BUCKET')) {
    return {
      summary: 'A Lambda function is missing the REPORTS_BUCKET environment variable.',
      likelyCause: 'Infrastructure misconfiguration or local run without AWS env.',
      action: 'Redeploy the CDK stack or set REPORTS_BUCKET on the failing Lambda.',
    };
  }
  if (raw.includes('reportKinds')) {
    return {
      summary: 'Step Functions input is missing the reportKinds field.',
      likelyCause: 'Manual execution JSON was incomplete.',
      action:
        'Start the pipeline with: {"runId":"manual-YYYY-MM-DD","dryRun":true,"reportKinds":["opened_cases","closed_cases","verified_sessions","caregiver_codes"]}',
    };
  }
  return {
    summary: raw,
    likelyCause: 'See CloudWatch logs for the failing Lambda step.',
    action: 'Open Step Functions execution history for this runId and inspect the failed state.',
  };
}
