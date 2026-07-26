import type { HhaClient } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException, VerifiedSessionRow } from '@white-glove/shared';
import { buildPayCodeName, lookupCaregiverCode } from '@white-glove/shared';

/** Shown when HHA live lookup misses — client owns exact name parity in ProviderSoft vs HHA admin. */
export const HHA_NAME_MATCH_HINT =
  'ProviderSoft names must match HHA exactly (Program Type → contract name, Service Type → billing code name).';

function previewMessage(parts: {
  report: string;
  rowId: string;
  summary: string;
}): string {
  return `[preview/${parts.report}] case/session ${parts.rowId}: ${parts.summary}`;
}

function openedFieldChecks(row: OpenedCaseRow): PipelineException[] {
  const issues: PipelineException[] = [];
  const rowId = row.caseId;
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || rowId;

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

/** Dry-run checks with live HHA read-only lookup (Monday preview). */
export async function previewOpenedCaseWithHha(
  row: OpenedCaseRow,
  hha: HhaClient,
): Promise<PipelineException[]> {
  const issues = openedFieldChecks(row);
  const rowId = row.caseId;
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || rowId;

  const contractNum = await hha.resolveContractId(row.programType);
  if (!row.programType?.trim() || !contractNum) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'opened_cases',
        rowId,
        summary: `Program Type "${row.programType ?? '(blank)'}" (${name}) not found in HHA contracts — ${HHA_NAME_MATCH_HINT}`,
      }),
      reportKind: 'opened_cases',
      rowId,
      details: { programType: row.programType, preview: true, patientName: name },
    });
  }

  if (!row.serviceCode?.trim()) {
    issues.push({
      code: 'missing_service_code',
      message: previewMessage({
        report: 'opened_cases',
        rowId,
        summary: 'Service Type column is blank in the Gluck open export',
      }),
      reportKind: 'opened_cases',
      rowId,
      details: { serviceCode: row.serviceCode, preview: true, patientName: name },
    });
  } else {
    const serviceCodeId = await hha.resolveServiceCodeId(
      row.serviceCode,
      contractNum ?? undefined,
    );
    if (!serviceCodeId) {
      issues.push({
        code: 'unknown_service_code',
        message: previewMessage({
          report: 'opened_cases',
          rowId,
          summary: `Service Type "${row.serviceCode}" not found in HHA billing codes — ${HHA_NAME_MATCH_HINT}`,
        }),
        reportKind: 'opened_cases',
        rowId,
        details: { serviceCode: row.serviceCode, preview: true, patientName: name },
      });
    }
  }

  return issues;
}

export async function previewVerifiedSessionWithHha(
  row: VerifiedSessionRow,
  hha: HhaClient,
  caregiverMap?: Map<string, string>,
): Promise<PipelineException[]> {
  const issues: PipelineException[] = [];
  const rowId = row.sessionId;

  const contractNum = await hha.resolveContractId(row.programType);
  if (!row.programType?.trim() || !contractNum) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: `Program Type "${row.programType ?? '(blank)'}" not found in HHA contracts — ${HHA_NAME_MATCH_HINT}`,
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { programType: row.programType, preview: true },
    });
  }

  if (!row.serviceCode?.trim()) {
    issues.push({
      code: 'missing_service_code',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: 'Service Type is blank on the API Report row',
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { serviceCode: row.serviceCode, preview: true },
    });
  } else {
    const serviceCodeId = await hha.resolveServiceCodeId(
      row.serviceCode,
      contractNum ?? undefined,
    );
    if (!serviceCodeId) {
      issues.push({
        code: 'unknown_service_code',
        message: previewMessage({
          report: 'verified_sessions',
          rowId,
          summary: `Service Type "${row.serviceCode}" not found in HHA billing codes — ${HHA_NAME_MATCH_HINT}`,
        }),
        reportKind: 'verified_sessions',
        rowId,
        details: { serviceCode: row.serviceCode, preview: true },
      });
    }
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
  } else if (payCode) {
    const payCodeId = await hha.resolvePayCodeId(payCode.payCodeName);
    if (!payCodeId) {
      issues.push({
        code: 'other',
        message: previewMessage({
          report: 'verified_sessions',
          rowId,
          summary: `Pay code "${payCode.payCodeName}" not found in HHA — confirm Pay Rate + Service Type match HHA admin`,
        }),
        reportKind: 'verified_sessions',
        rowId,
        details: { payCodeName: payCode.payCodeName, preview: true },
      });
    }
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
  } else if (
    caregiverMap &&
    !lookupCaregiverCode(caregiverMap, row.providerName) &&
    !(await hha.resolveCaregiverId(row.providerName))
  ) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId,
        summary: `Provider "${row.providerName}" not found in HHA — name must match caregiver codes / HHA exactly`,
      }),
      reportKind: 'verified_sessions',
      rowId,
      details: { providerName: row.providerName, preview: true },
    });
  }

  return issues;
}

/** @deprecated Use previewOpenedCaseWithHha — kept for field-only unit tests. */
export function previewOpenedCase(row: OpenedCaseRow): PipelineException[] {
  return openedFieldChecks(row);
}

/** @deprecated Use previewVerifiedSessionWithHha. */
export function previewVerifiedSession(row: VerifiedSessionRow): PipelineException[] {
  const issues: PipelineException[] = [];
  if (!row.providerName?.trim()) {
    issues.push({
      code: 'other',
      message: previewMessage({
        report: 'verified_sessions',
        rowId: row.sessionId,
        summary: 'Provider Name is blank — needed to look up caregiver in HHA',
      }),
      reportKind: 'verified_sessions',
      rowId: row.sessionId,
      details: { preview: true },
    });
  }
  return issues;
}
