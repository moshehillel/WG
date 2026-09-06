import * as XLSX from 'xlsx';

export function rowsToXlsxBuffer(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
): Buffer {
  const aoa = [headers, ...rows.map((r) => r.map((c) => (c == null ? '' : c)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}
