import zlib from 'node:zlib';

function decodePdfLiteral(inner: string): string {
  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/** Pull Tj / TJ string operators from already-decoded PDF content. */
function extractOperators(raw: string): string {
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(raw))) {
    const inner = m[0].slice(1, m[0].lastIndexOf(')'));
    chunks.push(decodePdfLiteral(inner));
  }
  const tj2 = /\[((?:(?:\\.|[^\\\]])+))\]\s*TJ/g;
  while ((m = tj2.exec(raw))) {
    const parts = [...m[1].matchAll(/\((?:\\.|[^\\)])*\)/g)].map((p) =>
      decodePdfLiteral(p[0].slice(1, -1)),
    );
    chunks.push(parts.join(''));
  }
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  while ((m = hex.exec(raw))) {
    const hexStr = m[1].replace(/\s+/g, '');
    let s = '';
    for (let i = 0; i + 1 < hexStr.length; i += 2) {
      s += String.fromCharCode(parseInt(hexStr.slice(i, i + 2), 16));
    }
    chunks.push(s);
  }
  // Newlines between operators preserve Frontline line layout for parsers.
  return chunks
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Inflate FlateDecode (and raw-deflate) streams; keep original bytes as fallback. */
function inflatePdfStreams(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts = [raw];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    let payload = Buffer.from(m[1], 'latin1');
    while (
      payload.length &&
      (payload[payload.length - 1] === 0x0a || payload[payload.length - 1] === 0x0d)
    ) {
      payload = payload.subarray(0, payload.length - 1);
    }
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync] as const) {
      try {
        parts.push(fn(payload).toString('latin1'));
        break;
      } catch {
        /* try next inflater */
      }
    }
  }
  return parts.join('\n');
}

/** Pull visible strings from session-notes / mandate PDFs (incl. FlateDecode streams). */
export function extractPdfLatinText(buf: Buffer): string {
  return extractOperators(inflatePdfStreams(buf));
}

export const PDF_NO_TEXT_ERROR =
  'This PDF has no readable text — export/save as text PDF or use CSV for caseload';

export function pdfTextFromBody(body: Record<string, unknown>): string {
  if (typeof body.pdfText === 'string' && body.pdfText.trim()) return body.pdfText;
  if (typeof body.text === 'string' && body.text.trim()) return body.text;
  if (typeof body.pdfBase64 === 'string' && body.pdfBase64.trim()) {
    return extractPdfLatinText(
      Buffer.from(body.pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64'),
    );
  }
  return '';
}

export function bodyHasPdfBytes(body: Record<string, unknown>): boolean {
  return typeof body.pdfBase64 === 'string' && Boolean(body.pdfBase64.trim());
}
