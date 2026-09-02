/** Pull visible strings from a simple PDF (session notes / mandate uploads). */
export function extractPdfLatinText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(raw))) {
    const inner = m[0].slice(1, m[0].lastIndexOf(')'));
    chunks.push(
      inner
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\'),
    );
  }
  const tj2 = /\[((?:(?:\\.|[^\\\]])+))\]\s*TJ/g;
  while ((m = tj2.exec(raw))) {
    const parts = [...m[1].matchAll(/\((?:\\.|[^\\)])*\)/g)].map((p) =>
      p[0].slice(1, -1).replace(/\\n/g, ' '),
    );
    chunks.push(parts.join(''));
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

export function pdfTextFromBody(body: Record<string, unknown>): string {
  if (typeof body.pdfText === 'string' && body.pdfText.trim()) return body.pdfText;
  if (typeof body.text === 'string' && body.text.trim()) return body.text;
  if (typeof body.pdfBase64 === 'string' && body.pdfBase64.trim()) {
    return extractPdfLatinText(Buffer.from(body.pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64'));
  }
  return '';
}
