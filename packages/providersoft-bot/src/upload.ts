import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadResult, ReportKind } from '@white-glove/shared';
import { rawReportKey } from '@white-glove/shared';

const s3 = new S3Client({});

export async function uploadReportsToS3(options: {
  runId: string;
  bucket: string;
  files: Record<ReportKind, string>;
}): Promise<DownloadResult> {
  const keys = {} as DownloadResult['keys'];

  for (const kind of Object.keys(options.files) as ReportKind[]) {
    const filePath = options.files[kind];
    const ext = path.extname(filePath).replace('.', '') || 'csv';
    const key = rawReportKey(options.runId, kind, ext);
    const body = await readFile(filePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        Body: body,
        ContentType: ext === 'csv' ? 'text/csv' : 'application/octet-stream',
      }),
    );
    keys[kind] = key;
  }

  return {
    runId: options.runId,
    bucket: options.bucket,
    keys,
    downloadedAt: new Date().toISOString(),
  };
}
