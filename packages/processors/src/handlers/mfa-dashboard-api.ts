import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  applyHhaSecretFromArn,
  completeHhaMfaRenewal,
  mfaStatusFromEnv,
  startHhaMfaRenewal,
} from '@white-glove/hha-client';
import {
  PipelineReportKindSchema,
  type PipelineRunInput,
} from '@white-glove/shared';
import { getObjectText, listAllObjects } from '../s3.js';
import {
  aggregateWeekSummaries,
  previousEasternWeekWindow,
  runIdFromValidateSummaryKey,
  type ListedValidateSummary,
  type ValidateSummaryArtifact,
} from '../week-summary.js';
import { renderDashboardHtml } from './mfa-dashboard-ui.js';

const sfn = new SFNClient({});

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-dashboard-key',
};

const ALLOWED_KINDS = new Set([
  'opened_cases',
  'closed_cases',
  'discharge_service',
  'new_services',
  'verified_sessions',
  'caregiver_codes',
]);

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
    body: JSON.stringify(body),
  };
}

function html(statusCode: number, body: string) {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8', ...cors },
    body,
  };
}

function unauthorized() {
  return json(401, { error: 'Unauthorized — provide x-dashboard-key or ?key=' });
}

function buildLiveRunId(now: Date = new Date()): string {
  return `manual-live-${now.toISOString().replace(/[:.]/g, '-')}`;
}

async function loadWeekSummary(): Promise<ReturnType<typeof aggregateWeekSummaries>> {
  const bucket = process.env.REPORTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error('REPORTS_BUCKET is not configured on the dashboard API');
  }

  const window = previousEasternWeekWindow();
  const objects = await listAllObjects(bucket, 'runs/');
  const summaryObjects = objects.filter(
    (obj) => obj.Key && obj.Key.endsWith('/validate-summary.json') && obj.LastModified,
  );

  const listed: ListedValidateSummary[] = [];
  const concurrency = 8;
  for (let i = 0; i < summaryObjects.length; i += concurrency) {
    const chunk = summaryObjects.slice(i, i + concurrency);
    const loaded = await Promise.all(
      chunk.map(async (obj) => {
        const key = obj.Key!;
        const runId = runIdFromValidateSummaryKey(key);
        if (!runId || !obj.LastModified) return null;
        try {
          const text = await getObjectText(bucket, key);
          const artifact = JSON.parse(text) as ValidateSummaryArtifact;
          return {
            key,
            runId,
            lastModified: obj.LastModified,
            artifact: { ...artifact, runId: artifact.runId || runId },
          } satisfies ListedValidateSummary;
        } catch (err) {
          console.warn(
            `[mfa-dashboard] skip ${key}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      }),
    );
    for (const item of loaded) {
      if (item) listed.push(item);
    }
  }

  return aggregateWeekSummaries(listed, window);
}

function parseStartLiveBody(raw: string | undefined): {
  confirm?: string;
  reportKinds?: string[];
  dateRanges?: Record<string, { from?: string; to?: string }>;
} {
  if (!raw) return {};
  return JSON.parse(raw) as {
    confirm?: string;
    reportKinds?: string[];
    dateRanges?: Record<string, { from?: string; to?: string }>;
  };
}

async function startLiveRun(body: ReturnType<typeof parseStartLiveBody>) {
  if (body.confirm !== 'LIVE') {
    return json(400, {
      error: 'Safety check failed — POST body must include confirm:"LIVE"',
    });
  }

  const stateMachineArn = process.env.STATE_MACHINE_ARN?.trim();
  if (!stateMachineArn) {
    return json(503, { error: 'STATE_MACHINE_ARN is not configured on the dashboard API' });
  }

  const reportKinds = (body.reportKinds ?? []).filter((k) => ALLOWED_KINDS.has(k));
  if (!reportKinds.length) {
    return json(400, { error: 'Select at least one reportKinds entry' });
  }

  // Validate kinds against zod union
  for (const kind of reportKinds) {
    PipelineReportKindSchema.parse(kind);
  }

  const dateRanges: NonNullable<PipelineRunInput['dateRanges']> = {};
  for (const kind of reportKinds) {
    const range = body.dateRanges?.[kind];
    if (!range?.from || !range?.to) continue;
    // caregiver_codes is a reference export — dates are ignored by the bot
    if (kind === 'caregiver_codes') continue;
    dateRanges[kind as keyof typeof dateRanges] = {
      from: String(range.from).trim(),
      to: String(range.to).trim(),
    };
  }

  const input: PipelineRunInput = {
    runId: buildLiveRunId(),
    dryRun: false,
    sandbox: false,
    sandboxEmailFixtures: false,
    sandboxLiveFixtures: false,
    reportKinds: reportKinds as PipelineRunInput['reportKinds'],
    dateRanges,
  };

  const executionName = input.runId.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80);
  const started = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn,
      name: executionName,
      input: JSON.stringify(input),
    }),
  );

  return json(202, {
    ok: true,
    runId: input.runId,
    executionArn: started.executionArn ?? null,
    dryRun: false,
    sandbox: false,
    reportKinds: input.reportKinds,
    dateRanges: input.dateRanges,
    message:
      'LIVE run started with selected reports only. Nightly EventBridge schedules are unchanged.',
    pipelineConsoleUrl: process.env.PIPELINE_CONSOLE_URL || null,
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const expectedKey = process.env.DASHBOARD_API_KEY?.trim();
  if (!expectedKey) {
    return json(503, { error: 'Dashboard API not configured (missing DASHBOARD_API_KEY)' });
  }

  const provided =
    event.queryStringParameters?.key?.trim() ??
    event.headers?.['x-dashboard-key'] ??
    event.headers?.['X-Dashboard-Key'];
  if (!provided || provided !== expectedKey) return unauthorized();

  try {
    const action =
      event.queryStringParameters?.action?.trim() ??
      (event.requestContext.http.method === 'GET' ? 'status' : '');

    if (action === 'ui' && event.requestContext.http.method === 'GET') {
      const apiBase = `https://${event.requestContext.domainName}/`;
      return html(
        200,
        renderDashboardHtml({
          apiBase,
          key: expectedKey,
          consoleUrl: process.env.PIPELINE_CONSOLE_URL,
        }),
      );
    }

    if (action === 'weekSummary' && event.requestContext.http.method === 'GET') {
      const summary = await loadWeekSummary();
      return json(200, {
        ok: true,
        window: {
          start: summary.window.start.toISOString(),
          end: summary.window.end.toISOString(),
          startDate: summary.window.startDate,
          endDate: summary.window.endDate,
          label: summary.window.label,
          definition:
            'Mon-Sun US/Eastern week containing yesterday (so Monday still shows the week that ended Sunday; mid-week this is the current ops week). Counts come from non-sandbox runs/*/validate-summary.json whose LastModified falls in that window.',
        },
        counts: summary.counts,
        runIds: summary.runIds,
        summariesScanned: summary.summariesScanned,
      });
    }

    if (action === 'startLiveRun' && event.requestContext.http.method === 'POST') {
      return await startLiveRun(parseStartLiveBody(event.body));
    }

    await applyHhaSecretFromArn();

    if (action === 'status' || (event.requestContext.http.method === 'GET' && !action)) {
      return json(200, {
        ...mfaStatusFromEnv(),
        sandboxTriggerConfigured: Boolean(process.env.SANDBOX_API_KEY),
        liveRunConfigured: Boolean(process.env.STATE_MACHINE_ARN),
      });
    }

    if (action === 'start' && event.requestContext.http.method === 'POST') {
      const result = await startHhaMfaRenewal();
      return json(200, result);
    }

    if (action === 'complete' && event.requestContext.http.method === 'POST') {
      const body = event.body ? (JSON.parse(event.body) as { sessionId?: string; otp?: string }) : {};
      if (!body.sessionId || !body.otp) {
        return json(400, { error: 'sessionId and otp required' });
      }
      const status = await completeHhaMfaRenewal(body.sessionId, body.otp);
      return json(200, { ok: true, ...status });
    }

    return json(400, {
      error:
        'Unknown action — use ui, status, weekSummary, start, complete, or startLiveRun',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mfa-dashboard]', message);
    return json(500, { error: message });
  }
};