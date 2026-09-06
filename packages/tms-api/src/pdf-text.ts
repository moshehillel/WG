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

function tryInflate(payload: Buffer): string | undefined {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync] as const) {
    try {
      return fn(payload).toString('latin1');
    } catch {
      /* try next inflater */
    }
  }
  return undefined;
}

/** Dictionary text for the object that owns this stream (not a prior endobj). */
function dictSliceBeforeStream(raw: string, streamIdx: number): string {
  const before = raw.slice(0, streamIdx);
  const re = /(?:^|[\r\n])\d+\s+\d+\s+obj\b/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) last = m.index;
  if (last < 0) return before.slice(Math.max(0, streamIdx - 400));
  return before.slice(last);
}

function streamHasTextOps(content: string): boolean {
  return /\)\s*Tj\b|\]\s*TJ\b|<[0-9A-Fa-f\s]+>\s*Tj\b/.test(content);
}

/**
 * Inflate every content stream in the PDF (all pages). Prefer /Length so binary
 * payloads that happen to contain the ASCII "endstream" are not truncated.
 * Skip image/font streams (no Tj/TJ) so binary does not create false text hits.
 */
function inflatePdfStreams(buf: Buffer): string {
  const raw = buf.toString('latin1');
  // Keep uncompressed page content from the raw file, but only via text operators
  // (extractOperators), not by concatenating the whole binary PDF into the search blob.
  const parts: string[] = [];
  if (streamHasTextOps(raw)) parts.push(raw);
  const streamKeyword = /(?:^|[^a-z])stream(\r\n|\n|\r)/gi;
  let m: RegExpExecArray | null;
  while ((m = streamKeyword.exec(raw))) {
    // Match may include a leading non-letter; data starts after "stream" + EOL.
    const eol = m[1] || '\n';
    const streamWordAt = m[0].lastIndexOf('stream');
    const dataStart = m.index + streamWordAt + 'stream'.length + eol.length;
    const dictSlice = dictSliceBeforeStream(raw, m.index + streamWordAt);
    const lenMatch = /\/Length\s+(\d+)\b/.exec(dictSlice);
    let payload: Buffer | undefined;
    if (lenMatch) {
      const len = Number(lenMatch[1]);
      if (Number.isFinite(len) && len >= 0 && dataStart + len <= raw.length) {
        payload = Buffer.from(raw.slice(dataStart, dataStart + len), 'latin1');
        // Skip past this stream body (and a following EOL if present).
        let next = dataStart + len;
        if (raw[next] === '\r' || raw[next] === '\n') next += 1;
        if (raw.startsWith('\n', next) && raw[next - 1] === '\r') next += 1;
        streamKeyword.lastIndex = Math.max(streamKeyword.lastIndex, next);
      }
    }
    if (!payload) {
      const end = raw.indexOf('endstream', dataStart);
      if (end < 0) continue;
      let slice = raw.slice(dataStart, end);
      while (slice.endsWith('\n') || slice.endsWith('\r')) slice = slice.slice(0, -1);
      payload = Buffer.from(slice, 'latin1');
      streamKeyword.lastIndex = Math.max(streamKeyword.lastIndex, end + 'endstream'.length);
    }
    const inflated = tryInflate(payload);
    if (inflated && streamHasTextOps(inflated)) parts.push(inflated);
  }
  return parts.join('\n');
}

/** Pull visible strings from session-notes / mandate PDFs (incl. FlateDecode streams). */
export function extractPdfLatinText(buf: Buffer): string {
  return extractOperators(inflatePdfStreams(buf));
}

export const PDF_NO_TEXT_ERROR =
  'This is for weekly session notes PDFs only (Frontline or Therapist Activity text). Caseloads go to Mandates → Import. Scanned PDFs won’t work.';

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
