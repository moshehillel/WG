import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { buildSandboxEmailFixturePipelineInput, buildSandboxLiveFixturePipelineInput, buildSandboxPipelineInput } from '@white-glove/shared';

const sfn = new SFNClient({});

function unauthorized(): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'Unauthorized — provide ?key=YOUR_SANDBOX_KEY',
  };
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;line-height:1.5}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const expectedKey = process.env.SANDBOX_API_KEY?.trim();
  if (!expectedKey) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'Sandbox trigger is not configured (missing SANDBOX_API_KEY).',
    };
  }

  const provided =
    event.queryStringParameters?.key?.trim() ??
    (event.rawQueryString
      ? new URLSearchParams(event.rawQueryString).get('key')?.trim() || undefined
      : undefined) ??
    event.headers?.['x-sandbox-key'] ??
    event.headers?.['X-Sandbox-Key'];
  if (!provided || provided !== expectedKey) return unauthorized();

  const stateMachineArn = process.env.STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'Missing STATE_MACHINE_ARN on sandbox trigger Lambda.',
    };
  }

  const useLiveFixtures = event.queryStringParameters?.live === '1';
  const useFixtures =
    useLiveFixtures ||
    event.queryStringParameters?.fixtures === '1' ||
    event.queryStringParameters?.emailPreview === '1';
  const input = useLiveFixtures
    ? buildSandboxLiveFixturePipelineInput()
    : useFixtures
      ? buildSandboxEmailFixturePipelineInput()
      : buildSandboxPipelineInput();
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
    message: useLiveFixtures
      ? 'Sandbox live fixture run started (one patient → HHA sandbox1 writes).'
      : useFixtures
      ? 'Sandbox email preview started (fixture CSVs only — fake data).'
      : 'Sandbox run started. Same logic as live — no HHA writes. Email summary in 5–20 minutes.',
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

  const body = useFixtures
    ? `
<p><strong>Sandbox email preview started.</strong> Fake fixture CSVs only — no ProviderSoft download, no HHA writes.</p>
<ul>
  <li>Run ID: <code>${input.runId}</code></li>
  <li>Execution ARN: <code>${started.executionArn ?? '(unknown)'}</code></li>
  <li>Reports: Gluck open, new service, closure, discharge, API Report, caregiver codes (all SANDBOX-FIX rows)</li>
</ul>
<p>Preview email arrives when the run finishes (usually 2–5 minutes). Results table is in the email body; CSV also attached for Excel.</p>
${consoleBase ? `<p><a href="${consoleBase}">Open Step Functions console</a></p>` : ''}
<p style="color:#666">Add <code>?fixtures=1</code> to this URL for fixture mode. Bookmark with your <code>?key=</code>.</p>`
    : `
<p><strong>Sandbox run started.</strong> No changes will be written to HHA.</p>
<ul>
  <li>Run ID: <code>${input.runId}</code></li>
  <li>Execution ARN: <code>${started.executionArn ?? '(unknown)'}</code></li>
  <li>Reports: Gluck open, closure, discharge service, new service, API Report (7-day Verified Date), caregiver codes</li>
</ul>
<p>Results email arrives when the run finishes (usually 5–20 minutes). Results table is in the email body; CSV also attached for Excel.</p>
${consoleBase ? `<p><a href="${consoleBase}">Open Step Functions console</a></p>` : ''}
<p style="color:#666">Bookmark this URL with your <code>?key=</code> to re-run anytime. Add <code>?fixtures=1</code> for fake CSV email preview.</p>`;

  return {
    statusCode: 202,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: htmlPage(useFixtures ? 'White-glove sandbox email preview' : 'White-glove sandbox started', body),
  };
};
