import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Handler } from 'aws-lambda';
import type { DownloadResult } from '@white-glove/shared';
import { getEnv, PipelineRunInputSchema } from '@white-glove/shared';
import { loadProviderSoftCredentials } from './credentials.js';
import { downloadReports, writeStubReports } from './download-reports.js';
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

export const handler: Handler<DownloadEvent, DownloadResult> = async (event) => {
  const input = PipelineRunInputSchema.parse({
    runId: event.runId ?? defaultRunId(event.reportDate),
    dryRun: event.dryRun ?? false,
    reportDate: event.reportDate,
  });

  const env = getEnv();
  const bucket = env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET is required');

  const downloadDir = await mkdtemp(path.join(tmpdir(), 'wg-ps-'));
  try {
    const useStubs =
      event.useStubs === true ||
      process.env.PROVIDERSOFT_USE_STUBS === 'true' ||
      process.env.PROVIDERSOFT_USE_STUBS === '1';

    const local = useStubs
      ? await writeStubReports(downloadDir)
      : await downloadReports({
          credentials: await loadProviderSoftCredentials(process.env.PROVIDERSOFT_SECRET_ARN),
          downloadDir,
          headless: env.HEADLESS ?? true,
        });

    return uploadReportsToS3({
      runId: input.runId,
      bucket,
      files: local.files,
    });
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
};
