/**
 * Login to ProviderSoft and capture UserReportId + export network URLs
 * for all four Gluck reports (DevTools Network equivalent via Playwright).
 *
 * Usage (repo root, .env with PROVIDERSOFT_*):
 *   npm run capture:reports -w @white-glove/providersoft-bot
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadProviderSoftCredentials } from './credentials.js';
import { loadRepoDotEnv } from './load-dotenv.js';
import {
  ALL_BOT_KINDS,
  REPORT_LINK_NAMES,
  loginUrl,
  type BotReportKind,
} from './report-config.js';

loadRepoDotEnv();

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

type CapturedRequest = {
  url: string;
  method: string;
  resourceType: string;
  userReportId?: string;
};

function parseUserReportId(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.searchParams.get('UserReportId') ?? undefined;
  } catch {
    const m = url.match(/UserReportId=(\d+)/i);
    return m?.[1];
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

async function main() {
  const creds = await loadProviderSoftCredentials();
  const outDir = path.join(repoRoot, 'docs');
  await mkdir(outDir, { recursive: true });

  const requests: CapturedRequest[] = [];
  const byKind: Partial<
    Record<
      BotReportKind,
      { pageUrl?: string; userReportId?: string; exportUrls: string[] }
    >
  > = {};

  for (const kind of ALL_BOT_KINDS) {
    byKind[kind] = { exportUrls: [] };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (/ReportView|ReportWizard|Export|Excel|\.csv|UserReportId/i.test(url)) {
      requests.push({
        url,
        method: req.method(),
        resourceType: req.resourceType(),
        userReportId: parseUserReportId(url),
      });
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] ?? '';
    if (/ReportView|Export|Excel|spreadsheet|csv|octet-stream/i.test(url + ct)) {
      requests.push({
        url,
        method: 'RESPONSE',
        resourceType: ct,
        userReportId: parseUserReportId(url),
      });
    }
  });

  console.log(`Login → ${loginUrl(creds.baseUrl)}`);
  await page.goto(loginUrl(creds.baseUrl), { waitUntil: 'domcontentloaded' });
  await page.locator('#unametxt').fill(creds.username);
  await page.locator('#passtxt').fill(creds.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForLoadState('networkidle').catch(() => undefined);

  if (/login\.aspx/i.test(page.url())) {
    throw new Error('Login failed — still on login page');
  }
  console.log(`Logged in → ${page.url()}`);

  const reportsListUrl = `${creds.baseUrl.replace(/\/$/, '')}/ReportWizard/ReportsList.aspx`;
  await page.goto(reportsListUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const listHtml = await page.content();
  const linkRe =
    /<a[^>]+href=["']([^"']*ReportView\.aspx\?UserReportId=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const discovered: Array<{ id: string; href: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(listHtml))) {
    discovered.push({
      href: m[1],
      id: m[2],
      text: m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  console.log(`ReportsList: found ${discovered.length} saved reports with UserReportId`);

  function matchKind(text: string): BotReportKind | undefined {
    const t = text.toLowerCase();
    for (const kind of ALL_BOT_KINDS) {
      const name = REPORT_LINK_NAMES[kind].toLowerCase();
      if (t.includes(name)) return kind;
    }
    return undefined;
  }

  for (const row of discovered) {
    const kind = matchKind(row.text);
    if (!kind) continue;
    byKind[kind]!.userReportId = row.id;
    byKind[kind]!.pageUrl = new URL(row.href, creds.baseUrl).href;
    console.log(`  mapped ${kind} → UserReportId=${row.id} (${row.text})`);
  }

  for (const kind of ALL_BOT_KINDS) {
    const linkName = REPORT_LINK_NAMES[kind];
    const id = byKind[kind]?.userReportId;
    console.log(`\n--- ${kind} (${linkName}) ---`);

    if (id) {
      const url = `${creds.baseUrl.replace(/\/$/, '')}/ReportWizard/ReportView.aspx?UserReportId=${id}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto(reportsListUrl, { waitUntil: 'domcontentloaded' });
      const link = page.getByRole('link', { name: linkName, exact: false }).first();
      await link.waitFor({ state: 'visible', timeout: 60_000 });
      await link.click();
    }
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const pageUrl = page.url();
    const userReportId = parseUserReportId(pageUrl) ?? byKind[kind]?.userReportId;
    byKind[kind]!.pageUrl = pageUrl;
    byKind[kind]!.userReportId = userReportId;
    console.log(`  page: ${pageUrl}`);
    console.log(`  UserReportId: ${userReportId ?? '(not in URL)'}`);

    try {
      await page.getByRole('button', { name: 'Modify Report' }).click({ timeout: 15_000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Next >>' }).click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Next >>' }).click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.getByRole('button', { name: 'Next >>' }).click();
      await page.waitForLoadState('networkidle').catch(() => undefined);

      const exportBtn = page.getByRole('button', { name: 'Export to Excel' });
      if (await exportBtn.isVisible()) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 120_000 }),
          exportBtn.click(),
        ]);
        const exportUrl = download.url();
        byKind[kind]!.exportUrls.push(exportUrl);
        console.log(`  export: ${exportUrl}`);
        console.log(`  file: ${download.suggestedFilename()}`);
        await download.cancel().catch(() => undefined);
      }
    } catch (err) {
      console.log(
        `  export skip: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await page.goto(reportsListUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  await browser.close();

  const reportIds = Object.fromEntries(
    ALL_BOT_KINDS.map((kind) => [kind, byKind[kind]?.userReportId ?? null]),
  ) as Record<BotReportKind, string | null>;

  const payload = {
    capturedAt: new Date().toISOString(),
    baseUrl: creds.baseUrl,
    username: creds.username,
    reportsListUrl,
    discoveredReports: discovered,
    reportIds,
    byKind,
    networkHits: unique(
      requests
        .filter((r) => r.userReportId || /Export|Excel|csv/i.test(r.url))
        .map((r) => r.url),
    ),
    requests: requests.slice(-200),
  };

  const outFile = path.join(outDir, 'providersoft-report-network.json');
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log('Report IDs:', reportIds);

  console.log('\nSuggested .env lines:');
  console.log(`PROVIDERSOFT_REPORT_OPENED_ID=${reportIds.opened_cases ?? '4526'}`);
  console.log(`PROVIDERSOFT_REPORT_CLOSED_ID=${reportIds.closed_cases ?? ''}`);
  console.log(`PROVIDERSOFT_REPORT_DISCHARGE_ID=${reportIds.discharge_service ?? ''}`);
  console.log(`PROVIDERSOFT_REPORT_SESSIONS_ID=${reportIds.verified_sessions ?? '4026'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
