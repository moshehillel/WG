import type { Handler } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DownloadResult } from '@white-glove/shared';
import {
  DownloadResultSchema,
  getEnv,
  rawReferenceKey,
  rawReportKey,
  writeSandboxEmailFixtures,
  writeSandboxLiveFixtures,
} from '@white-glove/shared';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const s3 = new S3Client({});

export interface SandboxFixtureDownloadEvent {
  runId: string;
  sandbox?: boolean;
  sandboxEmailFixtures?: boolean;
  sandboxLiveFixtures?: boolean;
}

/** Sandbox-only: upload fake CSVs to this run's raw prefix (no ProviderSoft). */
export const handler: Handler<SandboxFixtureDownloadEvent, DownloadResult> = async (event) => {
  const useFixtures = Boolean(event.sandboxEmailFixtures || event.sandboxLiveFixtures);
  if (!event.sandbox || !useFixtures) {
    throw new Error('SandboxFixtureDownload requires sandbox + fixture flag');
  }

  const env = getEnv();
  const bucket = env.REPORTS_BUCKET;
  if (!bucket) throw new Error('REPORTS_BUCKET required');

  const downloadDir = await mkdtemp(path.join(tmpdir(), 'wg-fixtures-'));
  try {
    const local = event.sandboxLiveFixtures
      ? await writeSandboxLiveFixtures(downloadDir)
      : await writeSandboxEmailFixtures(downloadDir);
    const keys: DownloadResult['keys'] = {};
    const uploadedAt = new Date().toISOString();

    const uploads: Promise<void>[] = [];
    for (const [kind, filePath] of Object.entries(local.files)) {
      if (!filePath) continue;
      const body = await readFile(filePath);
      const key =
        kind === 'caregiver_codes' || kind === 'discharge_service' || kind === 'new_services'
          ? rawReferenceKey(
              event.runId,
              kind as 'caregiver_codes' | 'discharge_service' | 'new_services',
            )
          : rawReportKey(event.runId, kind as 'opened_cases' | 'closed_cases' | 'verified_sessions');
      keys[kind as keyof DownloadResult['keys']] = key;
      uploads.push(
        s3
          .send(
            new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/csv' }),
          )
          .then(() => undefined),
      );
    }
    await Promise.all(uploads);

    return DownloadResultSchema.parse({
      runId: event.runId,
      bucket,
      keys,
      downloadedAt: uploadedAt,
    });
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
};
