import { PDFDocument } from 'pdf-lib';

export type ArchiveBundleRow = {
  id?: string;
  weekStart?: string;
  createdAt?: string;
  filename?: string;
  providerName?: string;
};

/** Oldest week first, then the time the file was saved. */
export function sortArchivesByDate<T extends ArchiveBundleRow>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const dayA = String(a.weekStart || a.createdAt || '').slice(0, 10);
    const dayB = String(b.weekStart || b.createdAt || '').slice(0, 10);
    if (dayA !== dayB) return dayA.localeCompare(dayB);
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (created) return created;
    const file = String(a.filename || '').localeCompare(String(b.filename || ''));
    if (file) return file;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

export function isPdfBytes(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function archiveDownloadName(row: ArchiveBundleRow, index: number, used: Set<string>): string {
  const day = String(row.weekStart || row.createdAt || '').slice(0, 10) || 'undated';
  const who = String(row.providerName || '')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const file = String(row.filename || 'file.pdf')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .replace(/\s+/g, '-') || 'file.pdf';
  const prefix = String(index + 1).padStart(2, '0');
  let name = [prefix, day, who, file].filter(Boolean).join('_');
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const unique = `${stem}-${n}${ext}`;
  used.add(unique);
  return unique;
}

export function mergedArchiveFilename(rows: ArchiveBundleRow[]): string {
  const days = sortArchivesByDate(rows)
    .map((row) => String(row.weekStart || row.createdAt || '').slice(0, 10))
    .filter(Boolean);
  const span =
    days.length === 0
      ? 'selected'
      : days[0] === days[days.length - 1]
        ? days[0]
        : `${days[0]}-to-${days[days.length - 1]}`;
  return `archive-${span}.pdf`;
}

export async function mergePdfBuffers(parts: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(n: number): number[] {
  return [n & 255, (n >>> 8) & 255];
}

function u32(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}

/** Uncompressed ZIP so the browser can save several archive files in one download. */
export function zipStoredFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]);
    chunks.push(local, nameBytes, data);
    centrals.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0x0800),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
      ]),
      nameBytes,
    );
    offset += local.length + nameBytes.length + data.length;
  }
  let cdSize = 0;
  for (const part of centrals) cdSize += part.length;
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(cdSize),
    ...u32(offset),
    ...u16(0),
  ]);
  return Buffer.concat([...chunks, ...centrals, end]);
}
