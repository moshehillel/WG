import {
  DescribeRuleCommand,
  DisableRuleCommand,
  EnableRuleCommand,
  EventBridgeClient,
} from '@aws-sdk/client-eventbridge';
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
const eventbridge = new EventBridgeClient({});

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

/** Live dryRun=false schedules controlled by the dashboard toggle (not Monday preview). */
const LIVE_SCHEDULE_DEFS = [
  {
    envKey: 'LIVE_SCHEDULE_NIGHTLY_RULE',
    id: 'nightly_cases',
    label: 'Nightly case reports',
    detail:
      'Gluck open/closure, new services, discharge — every night ~11pm Eastern (dryRun:false)',
  },
  {
    envKey: 'LIVE_SCHEDULE_TUESDAY_RULE',
    id: 'tuesday_sessions',
    label: 'Tuesday sessions',
    detail:
      'Verified visits (API Report) + caregiver codes — Tuesday ~11pm Eastern (dryRun:false)',
  },
] as const;

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

function configuredLiveScheduleRules(): Array<{
  envKey: string;
  id: string;
  label: string;
  detail: string;
  name: string;
}> {
  return LIVE_SCHEDULE_DEFS.map((def) => {
    const name = process.env[def.envKey]?.trim() ?? '';
    return { ...def, name };
  }).filter((r) => r.name);
}

async function loadLiveScheduleStatus() {
  const configured = configuredLiveScheduleRules();
  if (!configured.length) {
    return {
      configured: false,
      enabled: false,
      rules: [] as Array<{
        id: string;
        name: string;
        label: string;
        detail: string;
        state: string | null;
      }>,
      note: 'Live schedule rule names are not configured on this Lambda yet.',
      excludes:
        'Monday dry-run preview (MondayPreviewSchedule) is not controlled by this toggle.',
    };
  }

  const rules = await Promise.all(
    configured.map(async (rule) => {
      try {
        const described = await eventbridge.send(
          new DescribeRuleCommand({ Name: rule.name }),
        );
        return {
          id: rule.id,
          name: rule.name,
          label: rule.label,
          detail: rule.detail,
          state: described.State ?? null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mfa-dashboard] describe rule ${rule.name}: ${message}`);
        return {
          id: rule.id,
          name: rule.name,
          label: rule.label,
          detail: rule.detail,
          state: null as string | null,
          error: message,
        };
      }
    }),
  );

  const known = rules.filter((r) => r.state === 'ENABLED' || r.state === 'DISABLED');
  const enabled = known.length > 0 && known.every((r) => r.state === 'ENABLED');

  return {
    configured: true,
    enabled,
    rules,
    note: enabled
      ? 'Live EventBridge schedules are ON (nightly cases + Tuesday sessions).'
      : 'Live EventBridge schedules are OFF.',
    excludes:
      'Monday dry-run preview (MondayPreviewSchedule) is not controlled by this toggle.',
  };
}

async function setLiveSchedules(body: {
  enabled?: boolean;
  confirm?: string;
}) {
  const wantEnabled = body.enabled === true;
  const expectedConfirm = wantEnabled ? 'SCHEDULE_ON' : 'SCHEDULE_OFF';
  if (body.confirm !== expectedConfirm) {
    return json(400, {
      error: `Safety check failed — POST body must include confirm:"${expectedConfirm}" and enabled:${wantEnabled}`,
    });
  }

  const configured = configuredLiveScheduleRules();
  if (!configured.length) {
    return json(503, {
      error: 'Live schedule rules are not configured (LIVE_SCHEDULE_*_RULE env missing)',
    });
  }

  for (const rule of configured) {
    if (wantEnabled) {
      await eventbridge.send(new EnableRuleCommand({ Name: rule.name }));
    } else {
      await eventbridge.send(new DisableRuleCommand({ Name: rule.name }));
    }
    console.info(
      JSON.stringify({
        event: 'setLiveSchedules',
        rule: rule.name,
        id: rule.id,
        enabled: wantEnabled,
      }),
    );
  }

  const status = await loadLiveScheduleStatus();
  return json(200, {
    ok: true,
    ...status,
    message: wantEnabled
      ? 'Live schedules enabled (nightly cases + Tuesday sessions).'
      : 'Live schedules disabled.',
  });
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
  console.info(
    JSON.stringify({
      event: 'startLiveRun',
      runId: input.runId,
      reportKinds: input.reportKinds,
      dateRanges: input.dateRanges,
    }),
  );
  const started = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn,
      name: executionName,
      input: JSON.stringify(input),
    }),
  );
  console.info(
    JSON.stringify({
      event: 'startLiveRun.started',
      runId: input.runId,
      executionArn: started.executionArn ?? null,
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

    if (action === 'scheduleStatus' && event.requestContext.http.method === 'GET') {
      return json(200, { ok: true, ...(await loadLiveScheduleStatus()) });
    }

    if (action === 'setLiveSchedules' && event.requestContext.http.method === 'POST') {
      const body = event.body
        ? (JSON.parse(event.body) as { enabled?: boolean; confirm?: string })
        : {};
      return await setLiveSchedules(body);
    }

    if (action === 'startLiveRun' && event.requestContext.http.method === 'POST') {
      return await startLiveRun(parseStartLiveBody(event.body));
    }

    await applyHhaSecretFromArn();

    if (action === 'status' || (event.requestContext.http.method === 'GET' && !action)) {
      const liveSchedules = await loadLiveScheduleStatus();
      return json(200, {
        ...mfaStatusFromEnv(),
        sandboxTriggerConfigured: Boolean(process.env.SANDBOX_API_KEY),
        liveRunConfigured: Boolean(process.env.STATE_MACHINE_ARN),
        liveSchedules,
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
        'Unknown action — use ui, status, weekSummary, scheduleStatus, setLiveSchedules, start, complete, or startLiveRun',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mfa-dashboard]', message);
    return json(500, { error: message });
  }
};
