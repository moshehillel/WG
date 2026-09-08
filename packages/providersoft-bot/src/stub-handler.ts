import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Handler } from 'aws-lambda';
import type { DownloadResult, ReportKind } from '@white-glove/shared';
import { getEnv, PipelineRunInputSchema } from '@white-glove/shared';
import { ALL_BOT_KINDS, type BotReportKind } from './report-config.js';
import { writeStubReports } from './stub-reports.js';
import { uploadReportsToS3 } from './upload.js';

/**
 * Zip-Lambda friendly entry: writes fixture CSVs and uploads to S3.
 * Use this until Docker + Playwright Chromium are available for live ProviderSoft login.
 */
export interface DownloadEvent {
  runId?: string;
  dryRun?: boolean;
  /** Live nightly / production starts with sandbox=false — refuse stubs on that path. */
  sandbox?: boolean;
  reportDate?: string;
  reportKinds?: Array<ReportKind | 'caregiver_codes' | 'discharge_service' | 'new_services'>;
}

/**
 * Zip stub DownloadFn must never silently feed a live (dryRun=false) nightly.
 * Sandbox fixtures use SandboxFixtureDownloadFn. Laptop dry-runs (dryRun=true) may still stub.
 */
export function assertStubZipNeverServesLive(event: {
  dryRun?: boolean;
  sandbox?: boolean;
}): void {
  const allow =
    process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS === 'true' ||
    process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS === '1';
  if (allow) return;
  // Live nightly / manual live: dryRun=false (default). Dry-run preview may still use stubs.
  if (event.dryRun === false || event.dryRun === undefined) {
    throw new Error(
      'Stub ProviderSoft DownloadFn refused a live path run (dryRun=false). ' +
        'Deploy the live bot image: npm run deploy:aws:live ' +
        '(-c providerSoftLiveBot=true -c providerSoftUseStubs=false). ' +
        'Sandbox fixtures use SandboxFixtureDownloadFn only.',
    );
  }
}

function defaultRunId(reportDate?: string): string {
  const day = reportDate ?? new Date().toISOString().slice(0, 10);
  return `${day}T${new Date().toISOString().slice(11, 19).replace(/:/g, '')}Z`;
}

function resolveDownloadKinds(event: DownloadEvent): BotReportKind[] {
  if (event.reportKinds?.length) {
    return event.reportKinds.filter((k) => ALL_BOT_KINDS.includes(k as BotReportKind)) as BotReportKind[];
  }
  return [...ALL_BOT_KINDS];
}

export const handler: Handler<DownloadEvent, DownloadResult> = async (event) => {
  assertStubZipNeverServesLive(event);
  const kinds = resolveDownloadKinds(event);
  const input = PipelineRunInputSchema.parse({
    runId: event.runId ?? defaultRunId(event.reportDate),
    dryRun: event.dryRun ?? false,
    reportDate: event.reportDate,
    reportKinds: event.reportKinds,
  });

  const env = getEnv();
  const bucket = env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET is required');

  const downloadDir = await mkdtemp(path.join(tmpdir(), 'wg-ps-'));
  try {
    const local = await writeStubReports(downloadDir, kinds);
    return await uploadReportsToS3({
      runId: input.runId,
      bucket,
      files: local.files,
    });
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
};
