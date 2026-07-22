import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Handler } from 'aws-lambda';
import type { DownloadResult, ReportKind } from '@white-glove/shared';
import { getEnv, PipelineRunInputSchema, errorMessage } from '@white-glove/shared';
import { loadProviderSoftCredentials } from './credentials.js';
import { downloadReports, writeStubReports } from './download-reports.js';
import { DownloadFailureError } from './errors.js';
import { ALL_BOT_KINDS, type BotReportKind } from './report-config.js';
import { uploadReportsToS3 } from './upload.js';

export interface DownloadEvent {
  runId?: string;
  dryRun?: boolean;
  reportDate?: string;
  /** When true, write stub CSVs instead of hitting ProviderSoft (useful for pipeline tests). */
  useStubs?: boolean;
}

function defaultRunId(reportDate?: string): string {
  const day = reportDate ?? new Date().toISOString().slice(0, 10);
  return `${day}T${new Date().toISOString().slice(11, 19).replace(/:/g, '')}Z`;
}

function useStubs(event: DownloadEvent): boolean {
  if (event.useStubs === true) return true;
  if (event.useStubs === false) return false;
  const v = process.env.PROVIDERSOFT_USE_STUBS;
  return v === 'true' || v === '1';
}

/** Pipeline kinds uploaded to S3; discharge stays local-only until wired into ReportKind. */
function pipelineKindsFromEnv(): BotReportKind[] {
  const raw = process.env.PROVIDERSOFT_REPORT_KINDS;
  if (!raw?.trim()) {
    return ['opened_cases', 'closed_cases', 'verified_sessions'];
  }
  const wanted = raw.split(',').map((s) => s.trim()) as BotReportKind[];
  return wanted.filter((k) => ALL_BOT_KINDS.includes(k));
}

/**
 * Live ProviderSoft download handler (Playwright in Docker Lambda, or stubs).
 * Flip PROVIDERSOFT_USE_STUBS=false after secrets + report IDs are ready.
 */
export const handler: Handler<DownloadEvent, DownloadResult> = async (event) => {
  const input = PipelineRunInputSchema.parse({
    runId: event.runId ?? defaultRunId(event.reportDate),
    dryRun: event.dryRun ?? false,
    reportDate: event.reportDate,
  });

  const env = getEnv();
  const bucket = env.REPORTS_BUCKET;
  if (!bucket) {
    throw new Error(
      `ProviderSoft download Lambda missing REPORTS_BUCKET env var (runId=${event.runId ?? 'unknown'})`,
    );
  }

  const downloadDir = await mkdtemp(path.join(tmpdir(), 'wg-ps-'));
  try {
    const stubs = useStubs(event);
    const local = stubs
      ? await writeStubReports(downloadDir)
      : await downloadReports({
          credentials: await loadProviderSoftCredentials(process.env.PROVIDERSOFT_SECRET_ARN),
          downloadDir,
          headless: env.HEADLESS ?? true,
          kinds: pipelineKindsFromEnv(),
        });

    const pipelineFiles: Partial<Record<ReportKind, string>> = {};
    for (const kind of ['opened_cases', 'closed_cases', 'verified_sessions'] as ReportKind[]) {
      if (local.files[kind]) pipelineFiles[kind] = local.files[kind];
    }

    return await uploadReportsToS3({
      runId: input.runId,
      bucket,
      files: stubs ? local.files : pipelineFiles,
    });
  } catch (err) {
    if (err instanceof DownloadFailureError) throw err;
    throw new DownloadFailureError({
      stage: 'handler',
      cause: `runId=${input.runId}: ${errorMessage(err)}`,
    });
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
};
