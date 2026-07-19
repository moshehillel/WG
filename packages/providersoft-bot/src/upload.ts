import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadResult, ReportKind } from '@white-glove/shared';
import { rawReportKey } from '@white-glove/shared';
import type { BotReportKind } from './report-config.js';

const s3 = new S3Client({});

const PIPELINE_KINDS = new Set<ReportKind>([
  'opened_cases',
  'closed_cases',
  'verified_sessions',
]);

export async function uploadReportsToS3(options: {
  runId: string;
  bucket: string;
  files: Partial<Record<BotReportKind, string>>;
}): Promise<DownloadResult> {
  const keys = {} as DownloadResult['keys'];

  for (const [kind, filePath] of Object.entries(options.files) as [
    BotReportKind,
    string | undefined,
  ][]) {
    if (!filePath) continue;
    if (!PIPELINE_KINDS.has(kind as ReportKind)) {
      // discharge_service not in pipeline ReportKind yet — skip S3 key mapping
      continue;
    }
    const reportKind = kind as ReportKind;
    const ext = path.extname(filePath).replace('.', '') || 'csv';
    const key = rawReportKey(options.runId, reportKind, ext);
    const body = await readFile(filePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        Body: body,
        ContentType: ext === 'csv' ? 'text/csv' : 'application/octet-stream',
      }),
    );
    keys[reportKind] = key;
  }

  return {
    runId: options.runId,
    bucket: options.bucket,
    keys,
    downloadedAt: new Date().toISOString(),
  };
}
