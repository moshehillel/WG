import type { PipelineException, ProcessorResult } from './types/pipeline.js';
import {
  caregiverNameFromDetails,
  codeLabel,
  formatActionableReason,
  patientNameFromDetails,
  reportLabel,
} from './exception-guidance.js';

/** Ops CSV shows succeeded + failed only (skipped_by_rule is omitted). */
export type ResultCsvStatus = 'succeeded' | 'failed';

export interface ResultCsvRow {
  reportKind: string;
  reportLabel: string;
  status: ResultCsvStatus;
  rowId: string;
  patientName: string;
  caregiverName: string;
  programType: string;
  code: string;
  reason: string;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Ops-facing Row ID: space pipe-joined session keys for readability.
 * e.g. `268744|08/11/2026|4:40 PM|BOYCE TRUDY|1091` → `268744 | 08/11/2026 | …`
 * Does not change the underlying processing sessionId.
 */
export function formatOpsRowId(rowId: string): string {
  if (!rowId.includes('|')) return rowId;
  return rowId.replace(/\s*\|\s*/g, ' | ');
}

function programTypeFromDetails(details: PipelineException['details']): string {
  const raw = details?.programType;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

/**
 * Ops-facing exception code for CSV / email.
 * Legacy `parse_error` was used for missing-field / billing-guard stops — remap those so
 * ops do not think the CSV itself failed to parse. Keep true parse failures as parse_error.
 */
export function opsExceptionCode(ex: PipelineException): string {
  if (ex.code !== 'parse_error') return ex.code;
  const hasMissing =
    (typeof ex.details?.missing === 'string' && Boolean(ex.details.missing.trim())) ||
    (Array.isArray(ex.details?.missing) && ex.details.missing.length > 0);
  if (hasMissing) return 'missing_field';
  if (
    /missing required field|FAILED — missing|billing safety stop|invalid auth mandate|Basic Mandate Frequency|blank|Gender missing/i.test(
      ex.message,
    )
  ) {
    return 'missing_field';
  }
  return 'parse_error';
}

/** One CSV row per actionable exception (failed). Skipped-by-rule is excluded. */
export function exceptionToResultCsvRow(ex: PipelineException): ResultCsvRow {
  return {
    reportKind: ex.reportKind ?? '',
    reportLabel: reportLabel(ex.reportKind),
    status: 'failed',
    rowId: formatOpsRowId(ex.rowId ?? ''),
    patientName: patientNameFromDetails(ex.details) ?? '',
    caregiverName: caregiverNameFromDetails(ex.details) ?? '',
    programType: programTypeFromDetails(ex.details),
    code: opsExceptionCode(ex),
    reason: formatOpsRowId(formatActionableReason(ex, { includeParties: true })),
  };
}

/** Success rows collected by processors (optional). */
export function successesToResultCsvRows(
  result: ProcessorResult | undefined,
): ResultCsvRow[] {
  if (!result?.successes?.length) return [];
  return result.successes.map((s) => ({
    reportKind: result.reportKind,
    reportLabel: reportLabel(result.reportKind),
    status: 'succeeded' as const,
    rowId: formatOpsRowId(s.rowId),
    patientName: s.patientName ?? '',
    caregiverName: s.caregiverName ?? '',
    programType: s.programType ?? '',
    code: '',
    reason: 'Synced successfully',
  }));
}

export function buildPipelineResultCsvRows(options: {
  exceptions: PipelineException[];
  opened?: ProcessorResult;
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
}): ResultCsvRow[] {
  const failed = options.exceptions
    .filter((ex) => ex.code !== 'skipped_by_rule')
    .map(exceptionToResultCsvRow);
  const successes = [
    ...successesToResultCsvRows(options.opened),
    ...successesToResultCsvRows(options.newServices),
    ...successesToResultCsvRows(options.closed),
    ...successesToResultCsvRows(options.discharge),
    ...successesToResultCsvRows(options.sessions),
  ];
  return [...failed, ...successes].sort((a, b) => {
    const statusOrder: Record<ResultCsvStatus, number> = {
      failed: 0,
      succeeded: 1,
    };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return (
      a.reportLabel.localeCompare(b.reportLabel) ||
      a.patientName.localeCompare(b.patientName) ||
      a.rowId.localeCompare(b.rowId)
    );
  });
}

const CSV_HEADER =
  'reportKind,reportLabel,status,rowId,patientName,caregiverName,programType,code,reason';

export function formatResultsCsv(rows: ResultCsvRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.reportKind,
        row.reportLabel,
        row.status,
        row.rowId,
        row.patientName,
        row.caregiverName,
        row.programType,
        row.code,
        row.reason,
      ]
        .map((v) => csvEscape(String(v)))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Failures only — primary attachment for ops triage. */
export function formatFailuresCsv(rows: ResultCsvRow[]): string {
  return formatResultsCsv(rows.filter((r) => r.status === 'failed'));
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HTML_TABLE_COLUMNS: Array<{ key: keyof ResultCsvRow; label: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'reportLabel', label: 'Report' },
  { key: 'rowId', label: 'Row ID' },
  { key: 'patientName', label: 'Patient' },
  { key: 'caregiverName', label: 'Caregiver' },
  { key: 'programType', label: 'Program Type' },
  { key: 'code', label: 'Code' },
  { key: 'reason', label: 'Reason' },
];

/**
 * Email-client-safe results table fragment (inline styles, no scripts/CSS).
 * Used in the SES HTML body so ops can read rows without opening an attachment.
 */
export function formatResultsTableHtml(rows: ResultCsvRow[]): string {
  const failed = rows.filter((r) => r.status === 'failed').length;
  const succeeded = rows.filter((r) => r.status === 'succeeded').length;
  const cellBase =
    'padding:4px 6px;font-size:10px;line-height:1.35;border:1px solid #e2e8f0;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;';
  const headerCells = HTML_TABLE_COLUMNS.map((c) => {
    const width =
      c.key === 'status'
        ? 'width:52px;'
        : c.key === 'reportLabel'
          ? 'width:72px;'
          : c.key === 'code'
            ? 'width:64px;'
            : c.key === 'reason'
              ? 'width:28%;'
              : '';
    return `<th style="padding:4px 6px;text-align:left;font-size:9px;line-height:1.3;letter-spacing:0.03em;text-transform:uppercase;background:#0f766e;color:#ffffff;border:1px solid #0d9488;word-break:break-word;overflow-wrap:anywhere;${width}">${htmlEscape(c.label)}</th>`;
  }).join('');
  const bodyRows = rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      const statusColor = row.status === 'failed' ? '#b91c1c' : '#047857';
      const cells = HTML_TABLE_COLUMNS.map((c) => {
        const raw = String(row[c.key] ?? '');
        const style =
          c.key === 'status'
            ? `${cellBase}font-weight:700;color:${statusColor};background:${bg};`
            : `${cellBase}color:#0f172a;background:${bg};`;
        return `<td style="${style}">${htmlEscape(raw)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');

  return `<p style="margin:0 0 6px;font-size:11px;color:#475569;">${failed} failed · ${succeeded} succeeded</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:10px;background:#ffffff;">
  <thead><tr>${headerCells}</tr></thead>
  <tbody>
${bodyRows || `<tr><td colspan="8" style="padding:8px 6px;font-size:10px;color:#64748b;border:1px solid #e2e8f0;">No rows</td></tr>`}
  </tbody>
</table>`;
}

/** Standalone HTML document (S3 archive / local preview). Prefer email body table for SES. */
export function formatResultsHtml(rows: ResultCsvRow[]): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>White Glove run results</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;">
  <h1 style="margin:0 0 8px;font-size:20px;">White Glove — run results</h1>
  ${formatResultsTableHtml(rows)}
</body></html>
`;
}

export function buildAlertCsvAttachments(options: {
  exceptions: PipelineException[];
  opened?: ProcessorResult;
  newServices?: ProcessorResult;
  closed?: ProcessorResult;
  discharge?: ProcessorResult;
  sessions?: ProcessorResult;
}): Array<{ filename: string; content: string; contentType: string }> {
  const rows = buildPipelineResultCsvRows(options);
  const attachments: Array<{ filename: string; content: string; contentType: string }> = [];
  const failures = rows.filter((r) => r.status === 'failed');
  if (failures.length > 0) {
    attachments.push({
      filename: 'failures.csv',
      content: formatFailuresCsv(rows),
      contentType: 'text/csv; charset=utf-8',
    });
  }
  if (rows.length > 0) {
    attachments.push({
      filename: 'results.csv',
      content: formatResultsCsv(rows),
      contentType: 'text/csv; charset=utf-8',
    });
  }
  return attachments;
}

/** Re-export for callers that need code labels in other formats. */
export { codeLabel };
