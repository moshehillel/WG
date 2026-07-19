import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_FILENAMES } from '@white-glove/shared';
import type { BotReportKind } from './report-config.js';
import { BOT_REPORT_FILENAMES } from './report-config.js';

export interface LocalDownloadResult {
  /** Paths keyed by report kind; may be a subset when only some reports are requested. */
  files: Partial<Record<BotReportKind, string>>;
}

/** Fixture CSVs when ProviderSoft UI / Playwright Docker is unavailable. */
export async function writeStubReports(downloadDir: string): Promise<LocalDownloadResult> {
  await mkdir(downloadDir, { recursive: true });
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

  const files = {
    opened_cases: path.join(downloadDir, `${REPORT_FILENAMES.opened_cases}.csv`),
    closed_cases: path.join(downloadDir, `${REPORT_FILENAMES.closed_cases}.csv`),
    verified_sessions: path.join(downloadDir, `${REPORT_FILENAMES.verified_sessions}.csv`),
  };
  await writeFile(files.opened_cases, opened, 'utf8');
  await writeFile(files.closed_cases, closed, 'utf8');
  await writeFile(files.verified_sessions, sessions, 'utf8');
  return { files };
}

export { BOT_REPORT_FILENAMES };
