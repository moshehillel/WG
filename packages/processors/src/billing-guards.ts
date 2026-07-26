import type { ClosedCaseRow, OpenedCaseRow } from '@white-glove/shared';

/** Shown when a row is blocked before any billable HHA write. */
export const BILLING_GUARD_PREFIX =
  'Billing safety stop — incorrect billing data can cause compliance issues; no HHA write was attempted.';

const OPEN_DEMOGRAPHICS: Array<{ key: keyof OpenedCaseRow; label: string }> = [
  { key: 'dateOfBirth', label: 'Date of Birth' },
  { key: 'address1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zipCode', label: 'Zip Code' },
];

export function validateOpenCaseBilling(row: OpenedCaseRow): string[] {
  const missing: string[] = [];
  if (!row.authorizationNumber?.trim()) missing.push('Authorization Number');
  if (!row.programType?.trim()) missing.push('Program Type');
  if (!row.serviceCode?.trim()) missing.push('Service Type');
  if (!row.startDate?.trim()) missing.push('Service Begin Date');
  for (const { key, label } of OPEN_DEMOGRAPHICS) {
    if (!row[key]?.trim()) missing.push(label);
  }
  return missing;
}

export function validateClosedCaseBilling(row: ClosedCaseRow): string[] {
  const missing: string[] = [];
  if (!row.closedDate?.trim()) missing.push('Closure Date');
  if (!row.programType?.trim()) missing.push('Program Type');
  return missing;
}

export interface DischargeServiceBillingRow {
  serviceCode?: string;
  startDate?: string;
  dischargeDate?: string;
  endDate?: string;
}

export function validateDischargeServiceBilling(row: DischargeServiceBillingRow): string[] {
  const missing: string[] = [];
  if (!row.serviceCode?.trim()) missing.push('Service Type');
  if (!row.startDate?.trim()) missing.push('Service Begin Date');
  if (!row.dischargeDate?.trim() && !row.endDate?.trim()) missing.push('Service Discharge Date');
  return missing;
}

export function billingGuardMessage(reportKind: string, rowId: string, missing: string[]): string {
  return `[${reportKind}] row=${rowId}: ${BILLING_GUARD_PREFIX} Missing: ${missing.join(', ')}.`;
}
