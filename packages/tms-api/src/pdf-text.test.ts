import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWeeklySessionText } from '@white-glove/tms-db';
import { extractPdfLatinText, PDF_NO_TEXT_ERROR, pdfTextFromBody } from './pdf-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flateContentObj(objNum: number, text: string, injectAscii?: string): string {
  // Optional ASCII "endstream" inside the uncompressed content becomes part of
  // the Flate payload — Length-based readers must not stop early on that.
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET${injectAscii || ''}`;
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const len = compressed.length;
  return (
    `${objNum} 0 obj<< /Length ${len} /Filter /FlateDecode >>stream\n` +
    compressed.toString('latin1') +
    `\nendstream\nendobj\n`
  );
}

function flatePdfWithText(text: string): Buffer {
  const body =
    '%PDF-1.4\n' +
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n' +
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n' +
    flateContentObj(4, text) +
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n' +
    'xref\n0 6\n0000000000 65535 f \ntrailer<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

/** Two-page PDF; page 2 content includes literal "endstream" inside the stream bytes. */
function flatePdfTwoPages(page1: string, page2: string): Buffer {
  const body =
    '%PDF-1.4\n' +
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
    '2 0 obj<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>endobj\n' +
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources<< /Font<< /F1 7 0 R >> >> >>endobj\n' +
    '4 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources<< /Font<< /F1 7 0 R >> >> >>endobj\n' +
    flateContentObj(5, page1) +
    flateContentObj(6, page2, ' endstream decoy ') +
    '7 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n' +
    'xref\n0 8\ntrailer<< /Size 8 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

describe('pdf-text', () => {
  it('extracts text from FlateDecode content streams', () => {
    const pdf = flatePdfWithText('Student Name: Aiden Odne');
    // Raw latin1 scan of the file must NOT see the string (compressed).
    expect(pdf.toString('latin1')).not.toContain('Student Name');
    expect(extractPdfLatinText(pdf)).toContain('Student Name: Aiden Odne');
  });

  it('extracts text from every page of a multi-page PDF', () => {
    const pdf = flatePdfTwoPages(
      'Student Name: Odne, Aiden 09/01/2026 9:00 am 9:30 am Service Provided: page one gait',
      'Student Name: Odne, Aiden 09/02/2026 10:00 am 10:30 am Service Provided: page two balance',
    );
    const text = extractPdfLatinText(pdf);
    expect(text).toMatch(/page one gait/i);
    expect(text).toMatch(/page two balance/i);
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.dateOfService === '09/01/2026')).toBe(true);
    expect(rows.some((r) => r.dateOfService === '09/02/2026')).toBe(true);
  });

  it('reads real Frontline fixture when present', () => {
    const fixture = path.join(__dirname, '../../../rs-converter/_fixture.pdf');
    if (!fs.existsSync(fixture)) return;
    const text = extractPdfLatinText(fs.readFileSync(fixture));
    expect(text).toMatch(/Student Name:\s*Aiden Odne/i);
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.dateOfService === '08/11/2026')).toBe(true);
    expect(rows.find((r) => r.dateOfService === '08/11/2026')?.beginTime.toLowerCase()).toContain(
      '8:50',
    );
  });

  it('reads Therapist Activity Output fixture and parses sessions', () => {
    const fixture = path.join(__dirname, '../fixtures/therapist-activity-output.pdf');
    if (!fs.existsSync(fixture)) return;
    const text = extractPdfLatinText(fs.readFileSync(fixture));
    expect(text).toMatch(/Therapist Activity/i);
    expect(text).toMatch(/MORTE III,\s*ROBERTO/i);
    expect(PDF_NO_TEXT_ERROR).toMatch(/Therapist Activity/i);
    const rows = parseWeeklySessionText(text);
    expect(rows.length).toBe(12);
    expect(rows[0]?.studentName).toMatch(/MORTE III,\s*ROBERTO/i);
    expect(rows[0]?.beginTime.toLowerCase()).toContain('10:00');
    expect(rows[0]?.cptCodes).toContain('92507');
    expect(rows[0]?.signed).toBe(true);
    expect(rows.filter((r) => r.attendance === 'makeup')).toHaveLength(4);
    expect(rows.some((r) => /Speech Group/i.test(r.serviceType))).toBe(true);
    expect(rows[0]?.providerName).toMatch(/Astacio/i);
  });

  it('pdfTextFromBody returns empty for image-only base64 shell', () => {
    // Minimal PDF with no text operators.
    const empty = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    expect(pdfTextFromBody({ pdfBase64: empty.toString('base64') })).toBe('');
    expect(PDF_NO_TEXT_ERROR).toMatch(/weekly session notes PDFs only/i);
    expect(PDF_NO_TEXT_ERROR).toMatch(/Mandates → Import/i);
  });
});
