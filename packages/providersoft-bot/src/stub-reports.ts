import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_FILENAMES } from '@white-glove/shared';
import type { BotReportKind } from './report-config.js';
import { ALL_BOT_KINDS, BOT_REPORT_FILENAMES } from './report-config.js';

export interface LocalDownloadResult {
  /** Paths keyed by report kind; may be a subset when only some reports are requested. */
  files: Partial<Record<BotReportKind, string>>;
}

/** Keep only the kinds requested for this run (case-only nights must not upload API stubs). */
export function filterStubFilesByKinds(
  files: Partial<Record<BotReportKind, string>>,
  kinds: readonly BotReportKind[],
): Partial<Record<BotReportKind, string>> {
  const wanted = new Set(kinds);
  const out: Partial<Record<BotReportKind, string>> = {};
  for (const kind of ALL_BOT_KINDS) {
    if (wanted.has(kind) && files[kind]) out[kind] = files[kind];
  }
  return out;
}

/** Fixture CSVs when ProviderSoft UI / Playwright Docker is unavailable. */
export async function writeStubReports(
  downloadDir: string,
  kinds: readonly BotReportKind[] = ALL_BOT_KINDS,
): Promise<LocalDownloadResult> {
  await mkdir(downloadDir, { recursive: true });
  const wanted = new Set(kinds.length ? kinds : ALL_BOT_KINDS);
  const opened = [
    'Case ID,First Name,Last Name,Program Type,Service Code,Authorization Number,Contract ID',
    'HH-1,Home,Health,Home Health,PCA001,AUTH-1,CT-1',
    'EI-1,Early,Case,Early Intervention,HHA001,AUTH-E,CT-E',
  ].join('\n');
  const closed = ['case_id,status,closed_date,closed_reason', 'HH-0,Closed,2026-07-01,Discharged'].join(
    '\n',
  );
  const sessions = [
    'session_id,patient_id,case_id,service_code,visit_date,start_time,end_time,status',
    'S-1,p1,HH-1,PCA001,2026-07-14,09:00,10:00,Verified',
    'S-2,p1,HH-1,HHA001,2026-07-14,11:00,12:00,Verified',
    'S-3,p2,HH-2,ZZZ999,2026-07-14,13:00,14:00,Verified',
  ].join('\n');
  const discharge = [
    'Program Id,Program Type,Service Type,Child\'s Name',
    'HH-1,Home Health,PCA001,Home Health',
  ].join('\n');
  const caregiverCodes = [
    'Provider Name,Caregiver Code',
    'FORTUNE JOHANA,WGC-35595',
  ].join('\n');
  /** Same shape as Gluck open — ParseNormalize uses parseOpenedCases for new_services. */
  const newServices = [
    'Case ID,First Name,Last Name,Program Type,Service Code,Authorization Number,Contract ID,Service Begin Date',
    'HH-NS-1,New,Service,Home Health,PCA001,AUTH-NS,CT-1,2026-07-01',
  ].join('\n');

  const allFiles: Partial<Record<BotReportKind, string>> = {
    opened_cases: path.join(downloadDir, `${REPORT_FILENAMES.opened_cases}.csv`),
    closed_cases: path.join(downloadDir, `${REPORT_FILENAMES.closed_cases}.csv`),
    verified_sessions: path.join(downloadDir, `${REPORT_FILENAMES.verified_sessions}.csv`),
    discharge_service: path.join(downloadDir, `${BOT_REPORT_FILENAMES.discharge_service}.csv`),
    caregiver_codes: path.join(downloadDir, `${BOT_REPORT_FILENAMES.caregiver_codes}.csv`),
    new_services: path.join(downloadDir, `${BOT_REPORT_FILENAMES.new_services}.csv`),
  };
  const writers: Array<Promise<void>> = [];
  if (wanted.has('opened_cases')) writers.push(writeFile(allFiles.opened_cases!, opened, 'utf8'));
  if (wanted.has('closed_cases')) writers.push(writeFile(allFiles.closed_cases!, closed, 'utf8'));
  if (wanted.has('verified_sessions')) {
    writers.push(writeFile(allFiles.verified_sessions!, sessions, 'utf8'));
  }
  if (wanted.has('discharge_service')) {
    writers.push(writeFile(allFiles.discharge_service!, discharge, 'utf8'));
  }
  if (wanted.has('caregiver_codes')) {
    writers.push(writeFile(allFiles.caregiver_codes!, caregiverCodes, 'utf8'));
  }
  if (wanted.has('new_services')) {
    writers.push(writeFile(allFiles.new_services!, newServices, 'utf8'));
  }
  await Promise.all(writers);
  return { files: filterStubFilesByKinds(allFiles, [...wanted]) };
}

export { BOT_REPORT_FILENAMES };
