#!/usr/bin/env node
/**
 * Headed Playwright training CLI for ProviderSoft.
 *
 * Usage (repo root, credentials in `.env`):
 *   npm run train:bot -w @white-glove/providersoft-bot
 *   npm run train:bot -w @white-glove/providersoft-bot -- --login-only
 *   npm run train:bot -w @white-glove/providersoft-bot -- --report=opened_cases
 *   npm run train:bot -w @white-glove/providersoft-bot -- --keep-open
 *
 * Dates are computed automatically (not hardcoded):
 *   daily reports  → today → today
 *   API Report     → 7 days ago → today
 * Optional --from/--to only overrides daily reports; API stays weekly.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getEnv } from '@white-glove/shared';
import { loadProviderSoftCredentials } from './credentials.js';
import { downloadReports, loginOnly } from './download-reports.js';
import { loadRepoDotEnv } from './load-dotenv.js';
import {
  ALL_BOT_KINDS,
  defaultDateRange,
  loadReportUserIds,
  type BotReportKind,
} from './report-config.js';

loadRepoDotEnv();

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const [k, ...rest] = arg.slice(2).split('=');
      values.set(k!, rest.join('='));
    } else if (arg.startsWith('--')) {
      flags.add(arg.slice(2));
    }
  }
  return { flags, values };
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

function onStep(step: string, detail: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step.padEnd(16)} ${detail}`);
}

function parseKinds(reportArg: string | undefined): BotReportKind[] | undefined {
  if (!reportArg) return undefined;
  if (reportArg === 'all') return [...ALL_BOT_KINDS];
  const kind = reportArg as BotReportKind;
  if (!ALL_BOT_KINDS.includes(kind)) {
    throw new Error(
      `Unknown --report=${reportArg}. Use: ${ALL_BOT_KINDS.join(' | ')} | all`,
    );
  }
  return [kind];
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const loginOnlyFlag = flags.has('login-only');
  const keepOpen = flags.has('keep-open') || loginOnlyFlag;
  const from = values.get('from');
  const to = values.get('to');
  const dateRange = from && to ? { from, to } : undefined;

  const env = getEnv();
  const downloadDir = path.resolve(env.LOCAL_DOWNLOAD_DIR ?? './downloads');
  await mkdir(downloadDir, { recursive: true });

  const creds = await loadProviderSoftCredentials();
  const reportIds = loadReportUserIds();
  const kinds = parseKinds(values.get('report'));

  console.log('ProviderSoft train:bot');
  console.log(`  baseUrl:     ${creds.baseUrl}`);
  console.log(`  username:    ${creds.username}`);
  console.log(`  downloadDir: ${downloadDir}`);
  console.log(`  headless:    false (training always headed)`);
  console.log(`  reportIds:   ${JSON.stringify(reportIds)}`);
  const planned = kinds ?? ALL_BOT_KINDS;
  console.log(`  kinds:       ${planned.join(', ')}`);
  for (const kind of planned) {
    const range =
      dateRange && kind !== 'verified_sessions' ? dateRange : defaultDateRange(kind);
    const label = kind === 'verified_sessions' ? 'weekly' : 'daily';
    console.log(`  ${kind}: ${range.from} → ${range.to} (${label})`);
  }
  if (dateRange) {
    console.log(`  note: --from/--to overrides daily reports only`);
  }
  console.log('');

  if (loginOnlyFlag) {
    const session = await loginOnly({
      credentials: creds,
      downloadDir,
      headless: false,
      keepOpen: true,
      onStep,
    });
    console.log('\nBrowser left open for inspection. Press Enter to close…');
    await waitForEnter('');
    await session.close();
    return;
  }

  try {
    const result = await downloadReports({
      credentials: creds,
      downloadDir,
      headless: false,
      kinds,
      reportIds,
      dateRange,
      keepOpen,
      onStep,
    });
    console.log('\nDownloaded files:');
    for (const [kind, file] of Object.entries(result.files)) {
      console.log(`  ${kind}: ${file}`);
    }
  } catch (err) {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  if (keepOpen) {
    console.log('\n--keep-open set; press Enter to exit.');
    await waitForEnter('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
