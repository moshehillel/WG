import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

export function sheetRowsFromBuffer(bytes, { headerRow = 0 } = {}) {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow });
}

export function detectBidHeaderRow(bytes) {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const cells = (rows[i] || []).map((cell) => String(cell).toLowerCase());
    if (cells.includes('service type') && (cells.includes('student nycid') || cells.includes('student id'))) return i;
  }
  return 0;
}

export function detectAddressHeaderRow(bytes) {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const cells = (rows[i] || []).map((cell) => String(cell).toLowerCase());
    if (cells.includes('street address') && (cells.includes('admin dbn') || cells.includes('phys site bldg code'))) {
      return i;
    }
  }
  return 0;
}

export function parseBidWorkbook(bytes) {
  return sheetRowsFromBuffer(bytes, { headerRow: detectBidHeaderRow(bytes) });
}

export function parseAddressWorkbook(bytes) {
  return sheetRowsFromBuffer(bytes, { headerRow: detectAddressHeaderRow(bytes) });
}

export function writeFixtureWorkbook(rows, sheetName = 'Bids') {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
