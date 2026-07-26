import type { ReportKind } from './types/reports.js';
import { REPORT_FILENAMES } from './types/reports.js';

export function runPrefix(runId: string): string {
  return `runs/${runId}`;
}

export function rawReportKey(runId: string, kind: ReportKind, ext = 'csv'): string {
  return `${runPrefix(runId)}/raw/${REPORT_FILENAMES[kind]}.${ext}`;
}

export function normalizedArtifactKey(runId: string, kind: ReportKind): string {
  return `${runPrefix(runId)}/normalized/${REPORT_FILENAMES[kind]}.json`;
}

export type ReferenceReportKind = 'caregiver_codes' | 'discharge_service' | 'new_services';

const REFERENCE_FILENAMES: Record<ReferenceReportKind, string> = {
  caregiver_codes: 'caregiver-codes',
  discharge_service: 'discharge-service',
  new_services: 'new-services',
};

export function rawReferenceKey(runId: string, kind: ReferenceReportKind, ext = 'csv'): string {
  return `${runPrefix(runId)}/raw/${REFERENCE_FILENAMES[kind]}.${ext}`;
}

export function normalizedReferenceKey(runId: string, kind: ReferenceReportKind): string {
  return `${runPrefix(runId)}/normalized/${REFERENCE_FILENAMES[kind]}.json`;
}

export function exceptionsKey(runId: string): string {
  return `${runPrefix(runId)}/exceptions.json`;
}

export function validateSummaryKey(runId: string): string {
  return `${runPrefix(runId)}/validate-summary.json`;
}
