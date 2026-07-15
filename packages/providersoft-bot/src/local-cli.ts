#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@white-glove/shared';
import { loadProviderSoftCredentials } from './credentials.js';
import { downloadReports, writeStubReports } from './download-reports.js';
import { uploadReportsToS3 } from './upload.js';

async function main() {
  const args = new Set(process.argv.slice(2));
  const stubs = args.has('--stubs');
  const upload = args.has('--upload');
  const env = getEnv();
  const downloadDir = path.resolve(env.LOCAL_DOWNLOAD_DIR ?? './downloads');
  await mkdir(downloadDir, { recursive: true });

  const local = stubs
    ? await writeStubReports(downloadDir)
    : await downloadReports({
        credentials: await loadProviderSoftCredentials(),
        downloadDir,
        headless: env.HEADLESS ?? true,
      });

  console.log('Downloaded:', local.files);

  if (upload) {
    if (!env.REPORTS_BUCKET) throw new Error('REPORTS_BUCKET required for --upload');
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await uploadReportsToS3({
      runId,
      bucket: env.REPORTS_BUCKET,
      files: local.files,
    });
    console.log('Uploaded:', result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
