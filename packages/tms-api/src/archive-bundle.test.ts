import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  archiveDownloadName,
  isPdfBytes,
  mergePdfBuffers,
  mergedArchiveFilename,
  sortArchivesByDate,
  zipStoredFiles,
} from './archive-bundle.js';

async function onePagePdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(label, { x: 20, y: 100, size: 12 });
  return Buffer.from(await doc.save());
}

describe('archive bundle', () => {
  it('sorts by week, then by the time the file was saved', () => {
    const rows = sortArchivesByDate([
      { id: 'b', weekStart: '2026-09-14', createdAt: '2026-09-23T15:32:00.000Z', filename: 'later.pdf' },
      { id: 'a', weekStart: '2026-09-07', createdAt: '2026-09-23T15:00:00.000Z', filename: 'early-week.pdf' },
      { id: 'c', weekStart: '2026-09-14', createdAt: '2026-09-22T14:18:00.000Z', filename: 'first.pdf' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  it('names the merged PDF from the first and last week', () => {
    expect(
      mergedArchiveFilename([
        { weekStart: '2026-09-14', createdAt: '2026-09-23T00:00:00.000Z' },
        { weekStart: '2026-09-07', createdAt: '2026-09-22T00:00:00.000Z' },
      ]),
    ).toBe('archive-2026-09-07-to-2026-09-14.pdf');
  });

  it('keeps zip names unique and dated', () => {
    const used = new Set<string>();
    const first = archiveDownloadName(
      { weekStart: '2026-09-14', filename: 'RS Report.pdf', providerName: 'Regine SOUVERAIN' },
      0,
      used,
    );
    const second = archiveDownloadName(
      { weekStart: '2026-09-14', filename: 'RS Report.pdf', providerName: 'Regine SOUVERAIN' },
      1,
      used,
    );
    expect(first).toBe('01_2026-09-14_Regine-SOUVERAIN_RS-Report.pdf');
    expect(second).not.toBe(first);
    expect(second.startsWith('02_2026-09-14_')).toBe(true);
  });

  it('merges PDFs in the order given', async () => {
    const merged = await mergePdfBuffers([await onePagePdf('one'), await onePagePdf('two')]);
    expect(isPdfBytes(merged)).toBe(true);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(2);
  });

  it('stores each file in the zip under its name', () => {
    const zip = zipStoredFiles([
      { name: '01_a.pdf', data: Buffer.from('%PDF-1') },
      { name: '02_b.pdf', data: Buffer.from('%PDF-2') },
    ]);
    const text = zip.toString('latin1');
    expect(text.includes('01_a.pdf')).toBe(true);
    expect(text.includes('02_b.pdf')).toBe(true);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
