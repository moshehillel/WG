import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadResult, ReportKind } from '@white-glove/shared';
import { rawReferenceKey, rawReportKey } from '@white-glove/shared';
import type { BotReportKind } from './report-config.js';

const s3 = new S3Client({});

const PIPELINE_KINDS = new Set<ReportKind>([
  'opened_cases',
  'closed_cases',
  'verified_sessions',
]);

const REFERENCE_KINDS = new Set<BotReportKind>(['caregiver_codes', 'discharge_service', 'new_services']);

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
    const ext = path.extname(filePath).replace('.', '') || 'csv';
    let key: string;
    if (PIPELINE_KINDS.has(kind as ReportKind)) {
      key = rawReportKey(options.runId, kind as ReportKind, ext);
      keys[kind as ReportKind] = key;
    } else if (REFERENCE_KINDS.has(kind)) {
      key = rawReferenceKey(options.runId, kind as 'caregiver_codes' | 'discharge_service' | 'new_services', ext);
      keys[kind as 'caregiver_codes' | 'discharge_service' | 'new_services'] = key;
    } else {
      continue;
    }
    const body = await readFile(filePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        Body: body,
        ContentType: ext === 'csv' ? 'text/csv' : 'application/octet-stream',
      }),
    );
  }

  return {
    runId: options.runId,
    bucket: options.bucket,
    keys,
    downloadedAt: new Date().toISOString(),
  };
}
