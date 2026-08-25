import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { buildLivePipelineInput } from '@white-glove/shared';

const sfn = new SFNClient({});

const CONFIRM_VALUE = 'LIVE';

function unauthorized(): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'Unauthorized — provide ?key=YOUR_LIVE_KEY',
  };
}

function needsConfirm(): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: htmlPage(
      'Live run blocked',
      `<p><strong>Safety check:</strong> production HHA writes require <code>confirm=${CONFIRM_VALUE}</code>.</p>
<p>Bookmark URL shape: <code>?key=…&amp;confirm=${CONFIRM_VALUE}</code></p>
<p style="color:#b45309">This starts a <em>live</em> sessions pipeline (verified_sessions + caregiver_codes; dryRun=false, sandbox=false) — not sandbox / not full nightly.</p>`,
    ),
  };
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;line-height:1.5}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const expectedKey = process.env.LIVE_API_KEY?.trim();
  if (!expectedKey) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'Live trigger is not configured (missing LIVE_API_KEY).',
    };
  }

  const provided =
    event.queryStringParameters?.key?.trim() ??
    event.headers?.['x-live-key'] ??
    event.headers?.['X-Live-Key'];
  if (!provided || provided !== expectedKey) return unauthorized();

  const confirm = event.queryStringParameters?.confirm?.trim();
  if (confirm !== CONFIRM_VALUE) return needsConfirm();

  const stateMachineArn = process.env.STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'Missing STATE_MACHINE_ARN on live trigger Lambda.',
    };
  }

  const input = buildLivePipelineInput();
  const executionName = input.runId.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80);

  const started = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn,
      name: executionName,
      input: JSON.stringify(input),
    }),
  );

  const consoleBase = process.env.PIPELINE_CONSOLE_URL ?? '';
  const payload = {
    ok: true,
    runId: input.runId,
    executionArn: started.executionArn ?? null,
    dryRun: false,
    sandbox: false,
    reportKinds: input.reportKinds,
    message:
      'LIVE sessions run started (verified_sessions + caregiver_codes only). Production HHA writes. Nightly schedules unchanged.',
    pipelineConsoleUrl: consoleBase || null,
  };

  const wantsJson =
    event.queryStringParameters?.format === 'json' ||
    event.headers?.accept?.includes('application/json') ||
    event.headers?.Accept?.includes('application/json');

  if (wantsJson) {
    return {
      statusCode: 202,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    };
  }

  const body = `
<p style="color:#b45309"><strong>LIVE sessions run started.</strong> Production HHA writes for visits / pay codes only.</p>
<ul>
  <li>Run ID: <code>${input.runId}</code></li>
  <li>Execution ARN: <code>${started.executionArn ?? '(unknown)'}</code></li>
  <li>Flags: <code>dryRun=false</code>, <code>sandbox=false</code></li>
  <li>Reports: <code>verified_sessions</code> (API Report), <code>caregiver_codes</code> — not opened/closed/new_services/discharge</li>
</ul>
<p>Results email arrives when the run finishes (usually 5–20 minutes).</p>
${consoleBase ? `<p><a href="${consoleBase}">Open Step Functions console</a></p>` : ''}
<p style="color:#666">This link does <em>not</em> enable NightlyCaseReports / TuesdaySessions cron — those stay off until you deploy with schedule flags.</p>`;

  return {
    statusCode: 202,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: htmlPage('White-glove LIVE sessions run started', body),
  };
};