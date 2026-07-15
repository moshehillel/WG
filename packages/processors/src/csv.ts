import { parse } from 'csv-parse/sync';

export function parseCsv(content: string): Record<string, string>[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return records;
}

/** Normalize header keys: trim, lower-case, spaces → underscores. */
export function normalizeHeaders(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, '_');
    out[normalized] = value?.trim() ?? '';
  }
  return out;
}

export function firstField(row: Record<string, string>, ...candidates: string[]): string | undefined {
  for (const name of candidates) {
    const value = row[name];
    if (value) return value;
  }
  return undefined;
}

export function truthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1' || v === 'ei' || v === 'early intervention';
}
