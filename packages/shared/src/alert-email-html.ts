import type { PipelineException, ProcessorResult } from './types/pipeline.js';
import type { ParseReportCounts } from './exception-guidance.js';
import {
  formatReportsSummary,
  formatSessionOutcomeSummary,
  partitionExceptionsForAlert,
} from './exception-guidance.js';
import {
  buildPipelineResultCsvRows,
  formatResultsTableHtml,
} from './alert-results-csv.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(label: string, tone: 'sandbox' | 'dryrun' | 'live' | 'fixture' | 'fail'): string {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    sandbox: { bg: '#ccfbf1', fg: '#0f766e' },
    dryrun: { bg: '#fef3c7', fg: '#b45309' },
    live: { bg: '#fee2e2', fg: '#b91c1c' },
    fixture: { bg: '#e0e7ff', fg: '#4338ca' },
    fail: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const c = colors[tone];
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${c.bg};color:${c.fg};">${escapeHtml(label)}</span>`;
}

function section(title: string, body: string): string {
  return `
    <tr><td style="padding:20px 24px 8px 24px;">
      <h2 style="margin:0;font-size:14px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">${escapeHtml(title)}</h2>
    </td></tr>
    <tr><td style="padding:0 24px 16px 24px;">${body}</td></tr>`;
}

function listBlock(lines: string[]): string {
  if (lines.length === 0) return '';
  const items = lines
    .map((line) => line.replace(/^\s+/, ''))
    .map(
      (line) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;">${escapeHtml(line)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff;">${items}</table>`;
}

/**
 * Summary + inline results table (email-client safe).
 * No Succeeded name-dump section — success rows live in the Results table / CSV.
 */
export function formatPipelineAlertHtml(options: {
  runId: string;
  ok: boolean;
  hardFailures: number;
  exceptions: PipelineException[];
  opened?: ProcessorResult;
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
  parseCounts?: ParseReportCounts;
  pipelineStep?: string;
  pipelineError?: string;
  dryRun?: boolean;
  sandbox?: boolean;
  sandboxEmailFixtures?: boolean;
  logoUrl?: string;
  hasCsvAttachments?: boolean;
}): string {
  const { actionable } = partitionExceptionsForAlert(options.exceptions);
  const sandbox = options.sandbox ?? false;
  const dryRun = options.dryRun ?? false;
  const fixture = options.sandboxEmailFixtures ?? false;

  let modeBadge = badge('Live run', 'live');
  if (fixture) modeBadge = badge('Sandbox email preview — fixture CSVs only', 'fixture');
  else if (sandbox) modeBadge = badge('Sandbox — no HHA writes', 'sandbox');
  else if (dryRun) modeBadge = badge('Dry-run preview', 'dryrun');

  const sessionLines = formatSessionOutcomeSummary(options.sessions, options.exceptions);

  let resultLine = 'Completed';
  let resultColor = '#059669';
  if (options.pipelineStep) {
    resultLine = 'Pipeline stopped';
    resultColor = '#dc2626';
  } else if (!options.ok) {
    resultLine =
      sandbox || dryRun
        ? `FAILED — ${options.hardFailures} row(s) would be blocked on live run`
        : `FAILED — ${options.hardFailures} row(s) blocked from HHA sync`;
    resultColor = '#dc2626';
  } else if (actionable.length > 0) {
    resultLine = `${actionable.length} note(s) need review`;
    resultColor = '#d97706';
  } else {
    resultLine = 'All checks passed';
  }

  const reportLines = formatReportsSummary({
    parse: options.parseCounts,
    opened: options.opened,
    newServices: options.newServices,
    closed: options.closed,
    discharge: options.discharge,
    sessions: options.sessions,
  });

  const logoBlock = options.logoUrl
    ? `<img src="${escapeHtml(options.logoUrl)}" alt="Advanced Automations" width="160" style="display:block;max-width:160px;height:auto;" />`
    : `<div style="font-size:22px;font-weight:700;letter-spacing:0.04em;color:#fff;">Advanced Automations</div>`;

  const pipelineBlock =
    options.pipelineStep || options.pipelineError
      ? section(
          'Pipeline error',
          `<p style="margin:0 0 8px;font-size:14px;color:#0f172a;"><strong>Step:</strong> ${escapeHtml(options.pipelineStep ?? 'unknown')}</p>
           <p style="margin:0;font-size:14px;color:#475569;">${escapeHtml(options.pipelineError ?? '')}</p>`,
        )
      : '';

  const resultRows = buildPipelineResultCsvRows({
    exceptions: options.exceptions,
    opened: options.opened,
    newServices: options.newServices,
    closed: options.closed,
    discharge: options.discharge,
    sessions: options.sessions,
  });
  const resultsTableBlock =
    resultRows.length > 0
      ? section('Results', formatResultsTableHtml(resultRows))
      : '';

  const attachNote = options.hasCsvAttachments
    ? `<p style="margin:0;font-size:13px;color:#0f766e;line-height:1.5;"><strong>Attachments:</strong> <code style="background:#ecfdf5;padding:2px 6px;border-radius:4px;">failures.csv</code> / <code style="background:#ecfdf5;padding:2px 6px;border-radius:4px;">results.csv</code> for Excel import. Row detail is in the Results table above.</p>`
    : `<p style="margin:0;font-size:12px;color:#94a3b8;">Full JSON: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">s3://…/runs/${escapeHtml(options.runId)}/exceptions.json</code></p>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.08);">
        <tr><td style="padding:24px;background:linear-gradient(135deg,#0f766e 0%,#115e59 55%,#134e4a 100%);color:#fff;">
          <table role="presentation" width="100%"><tr>
            <td>${logoBlock}</td>
            <td align="right" style="vertical-align:top;">
              <div style="font-size:13px;opacity:0.9;">White Glove Pipeline</div>
              <div style="font-size:11px;opacity:0.75;margin-top:4px;">Built by Advanced Automations</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 24px 0 24px;">
          ${modeBadge}
          <p style="margin:12px 0 4px;font-size:13px;color:#64748b;">Run ID</p>
          <p style="margin:0 0 16px;font-size:15px;font-family:ui-monospace,monospace;">${escapeHtml(options.runId)}</p>
          <div style="padding:14px 16px;border-radius:12px;background:#f8fafc;border-left:4px solid ${resultColor};">
            <strong style="color:${resultColor};font-size:15px;">${escapeHtml(resultLine)}</strong>
          </div>
        </td></tr>
        ${pipelineBlock}
        ${section('Summary by report', listBlock(reportLines))}
        ${sessionLines.length > 0 ? section('API Report (sessions) overview', listBlock(sessionLines)) : ''}
        ${resultsTableBlock}
        ${section('Details', attachNote)}
        <tr><td style="padding:8px 24px 24px 24px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0 16px;" />
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
            Advanced Automations · White Glove Care automation<br/>
            <a href="https://www.advancedautomations.net" style="color:#0d9488;text-decoration:none;">advancedautomations.net</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
