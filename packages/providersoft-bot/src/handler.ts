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

type PipelineKind = ReportKind | 'caregiver_codes' | 'discharge_service' | 'new_services';

export interface DownloadEvent {
  runId?: string;
  dryRun?: boolean;
  reportDate?: string;
  reportKinds?: Array<PipelineKind>;
  /** Per-kind date windows (ISO YYYY-MM-DD or M/D/YYYY). */
  dateRanges?: Partial<Record<PipelineKind, { from: string; to: string }>>;
  /** When true, write stub CSVs instead of hitting ProviderSoft (useful for pipeline tests). */
  useStubs?: boolean;
}

/** Normalize ISO YYYY-MM-DD or M/D/YYYY → ProviderSoft M/D/YYYY. */
function toPsDate(raw: string): string {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return s;
}

function normalizeDateRanges(
  ranges: DownloadEvent['dateRanges'] | undefined,
): Partial<Record<BotReportKind, { from: string; to: string }>> | undefined {
  if (!ranges || typeof ranges !== 'object') return undefined;
  const out: Partial<Record<BotReportKind, { from: string; to: string }>> = {};
  for (const [kind, range] of Object.entries(ranges)) {
    if (!range?.from || !range?.to) continue;
    if (!ALL_BOT_KINDS.includes(kind as BotReportKind)) continue;
    out[kind as BotReportKind] = { from: toPsDate(range.from), to: toPsDate(range.to) };
  }
  return Object.keys(out).length ? out : undefined;
}

function resolveDownloadKinds(event: DownloadEvent): BotReportKind[] {
  if (event.reportKinds?.length) {
    return event.reportKinds.filter((k) => ALL_BOT_KINDS.includes(k as BotReportKind)) as BotReportKind[];
  }
  return pipelineKindsFromEnv();
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
 * Live ProviderSoft download handler (HTTP-primary + Playwright fallback in Docker Lambda, or stubs).
 * HTTP exports include Gender:; Playwright is kept as fallback. Set
 * PROVIDERSOFT_PREFER_PLAYWRIGHT=true only to force Playwright-first (e.g. debugging).
 */
export const handler: Handler<DownloadEvent, DownloadResult> = async (event) => {
  const input = PipelineRunInputSchema.parse({
    runId: event.runId ?? defaultRunId(event.reportDate),
    dryRun: event.dryRun ?? false,
    reportDate: event.reportDate,
    reportKinds: event.reportKinds,
    dateRanges: event.dateRanges,
  });
  const dateRanges = normalizeDateRanges(event.dateRanges ?? input.dateRanges);

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
    const preferPlaywright =
      process.env.PROVIDERSOFT_PREFER_PLAYWRIGHT === 'true' ||
      process.env.PROVIDERSOFT_PREFER_PLAYWRIGHT === '1';
    console.log(
      `[ps-bot] handler: preferPlaywright=${preferPlaywright} stubs=${stubs} kinds=${resolveDownloadKinds(event).join(',')}`,
    );
    const local = stubs
      ? await writeStubReports(downloadDir)
      : await downloadReports({
          credentials: await loadProviderSoftCredentials(process.env.PROVIDERSOFT_SECRET_ARN),
          downloadDir,
          headless: env.HEADLESS ?? true,
          kinds: resolveDownloadKinds(event),
          dateRanges,
          preferPlaywright,
          onStep: (step, detail) => console.log(`[ps-bot] ${step}: ${detail}`),
        });

    const pipelineFiles: Partial<Record<BotReportKind, string>> = {};
    for (const kind of resolveDownloadKinds(event)) {
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