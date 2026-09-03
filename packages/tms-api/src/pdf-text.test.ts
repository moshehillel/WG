import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWeeklySessionText } from '@white-glove/tms-db';
import { extractPdfLatinText, PDF_NO_TEXT_ERROR, pdfTextFromBody } from './pdf-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flatePdfWithText(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const len = compressed.length;
  const body =
    '%PDF-1.4\n' +
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n' +
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n' +
    `4 0 obj<< /Length ${len} /Filter /FlateDecode >>stream\n` +
    compressed.toString('latin1') +
    '\nendstream\nendobj\n' +
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n' +
    'xref\n0 6\n0000000000 65535 f \ntrailer<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

describe('pdf-text', () => {
  it('extracts text from FlateDecode content streams', () => {
    const pdf = flatePdfWithText('Student Name: Aiden Odne');
    // Raw latin1 scan of the file must NOT see the string (compressed).
    expect(pdf.toString('latin1')).not.toContain('Student Name');
    expect(extractPdfLatinText(pdf)).toContain('Student Name: Aiden Odne');
  });

  it('reads real Frontline fixture when present', () => {
    const fixture = path.join(__dirname, '../../../rs-converter/_fixture.pdf');
    if (!fs.existsSync(fixture)) return;
    const text = extractPdfLatinText(fs.readFileSync(fixture));
    expect(text).toMatch(/Student Name:\s*Aiden Odne/i);
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBe(1);
    expect(rows[0]?.dateOfService).toBe('08/11/2026');
    expect(rows[0]?.beginTime.toLowerCase()).toContain('8:50');
  });

  it('pdfTextFromBody returns empty for image-only base64 shell', () => {
    // Minimal PDF with no text operators.
    const empty = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    expect(pdfTextFromBody({ pdfBase64: empty.toString('base64') })).toBe('');
    expect(PDF_NO_TEXT_ERROR).toMatch(/no readable text/i);
  });
});
