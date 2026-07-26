import type { OpenedCaseRow, PipelineException, VerifiedSessionRow } from '@white-glove/shared';
import {
  buildPayCodeName,
  isUnknownServiceType,
  lookupContractId,
  lookupServiceCode,
} from '@white-glove/shared';

function previewMessage(parts: {
  report: string;
  rowId: string;
  summary: string;
}): string {
  return `[preview/${parts.report}] case/session ${parts.rowId}: ${parts.summary}`;
}

/** Dry-run mapping checks for Monday preview (no HHA writes). */
export function previewOpenedCase(row: OpenedCaseRow): PipelineException[] {
  const issues: PipelineException[] = [];
  const rowId = row.caseId;
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || rowId;

  if (!row.programType || !lookupContractId(row.programType)) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'opened_cases',
        rowId,
        summary: `Program Type "${row.programType ?? '(blank)'}" (${name}) is not mapped to an HHA contract ID`,
      }),
      reportKind: 'opened_cases',
      rowId,
      details: { programType: row.programType, preview: true, patientName: name },
    });
  }

  if (!row.serviceCode || isUnknownServiceType(row.serviceCode)) {
    issues.push({
      code: row.serviceCode ? 'unknown_service_code' : 'missing_service_code',
      message: previewMessage({
        report: 'opened_cases',
        rowId,
        summary: row.serviceCode
          ? `Service Type "${row.serviceCode}" has no matching HHA billing code`
          : 'Service Type column is blank in the Gluck open export',
      }),
      reportKind: 'opened_cases',
      rowId,
      details: { serviceCode: row.serviceCode, preview: true, patientName: name },
    });
  }

  const fieldLabels: Record<string, string> = {
    dateOfBirth: 'Date of Birth',
    address1: 'Address',
    city: 'City',
    state: 'State',
    zipCode: 'Zip Code',
  };

  for (const field of ['dateOfBirth', 'address1', 'city', 'state', 'zipCode'] as const) {
    if (!row[field]?.trim()) {
      issues.push({
        code: 'parse_error',
        message: previewMessage({
          report: 'opened_cases',
          rowId,
          summary: `${fieldLabels[field]} is blank — required to create patient in HHA`,
        }),
        reportKind: 'opened_cases',
        rowId,
        details: { missing: field, preview: true, patientName: name },
      });
    }
  }

  if (!row.authorizationNumber?.trim()) {
    issues.push({
      code: 'missing_authorization',
      message: previewMessage({
        report: 'opened_cases',
        rowId,
        summary: 'Authorization Number is blank — required for HHA authorization',
      }),
      reportKind: 'opened_cases',
      rowId,
      details: { preview: true, patientName: name },
    });
  }

  return issues;
}

export function previewVerifiedSession(row: VerifiedSessionRow): PipelineException[] {
  const issues: PipelineException[] = [];
  const rowId = row.sessionId;

  if (!row.programType || !lookupContractId(row.programType)) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: `Program Type "${row.programType ?? '(blank)'}" is not mapped to an HHA contract ID`,
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { programType: row.programType, preview: true },
    });
  }

  if (!row.serviceCode || !lookupServiceCode(row.serviceCode)) {
    issues.push({
      code: row.serviceCode ? 'unknown_service_code' : 'missing_service_code',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: row.serviceCode
          ? `Service Type "${row.serviceCode}" has no matching HHA billing code`
          : 'Service Type is blank on the API Report row',
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { serviceCode: row.serviceCode, preview: true },
    });
  }

  const payCode = buildPayCodeName(row.serviceCode, row.payRate);
  if (row.serviceCode && row.payRate && !payCode) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: `Cannot build pay code from Service Type "${row.serviceCode}" and Pay Rate "${row.payRate}"`,
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { serviceCode: row.serviceCode, payRate: row.payRate, preview: true },
    });
  }

  if (!row.providerName?.trim()) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: 'Provider Name is blank — needed to look up caregiver in HHA',
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { preview: true },
    });
  }

  return issues;
}
