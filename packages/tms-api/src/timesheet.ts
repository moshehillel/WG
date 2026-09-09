import type { SessionRow, Student, WeeklyPeriod } from '@white-glove/tms-db';

/** Letter landscape (pt). */
export const TIMESHEET_PAGE = { width: 792, height: 612 } as const;
const PAGE_W = TIMESHEET_PAGE.width;
const PAGE_H = TIMESHEET_PAGE.height;
const MARGIN_X = 28;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

/**
 * DocuSign signHere anchor (must appear in the PDF text stream near the principal box).
 * Prefer this over absolute coordinates so layout tweaks stay signable.
 */
export const PRINCIPAL_SIGN_ANCHOR = '/sig-principal/';

/** Fallback absolute DocuSign tab (top-left origin) for the principal signature line. */
export const PRINCIPAL_SIGN_TAB = {
  pageNumber: '1',
  xPosition: '430',
  yPosition: '470',
} as const;

/** TMS web CSS vars → PDF RGB (0–1). */
const C = {
  accent: [0.059, 0.463, 0.431] as const, // #0f766e
  accentDeep: [0.059, 0.373, 0.349] as const, // #0f5f59
  accentSoft: [0.835, 0.961, 0.937] as const, // #d5f5ef
  ink: [0.047, 0.2, 0.188] as const, // #0c3330
  muted: [0.353, 0.435, 0.42] as const, // #5a6f6b
  line: [0.765, 0.835, 0.816] as const, // #c3d5d0
  wash: [0.933, 0.957, 0.949] as const, // #eef4f2
  white: [1, 1, 1] as const,
  rowAlt: [0.965, 0.98, 0.976] as const,
};

type RGB = readonly [number, number, number];

function esc(s: string): string {
  // Helvetica WinAnsi: keep ASCII + common Latin-1; drop other Unicode.
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0);
    if (c === 0x2014 || c === 0x2013) out += '-'; // em/en dash
    else if (c === 0x2026) out += '...';
    else if (c === 0x00b7 || c === 0x2022) out += '-';
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c <= 0xff) out += ch;
    else out += '?';
  }
  return out
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Approximate Helvetica glyph width (WinAnsi / Latin-1). */
function textWidth(s: string, fontSize: number, bold = false): number {
  const factor = bold ? 0.55 : 0.5;
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 32) w += 0.28;
    else if (c < 32) w += 0.3;
    else if ('iIljtfr.,:;\'|'.includes(ch)) w += 0.28;
    else if ('mwMW@%'.includes(ch)) w += 0.78;
    else if (ch === ch.toUpperCase() && /[A-Z]/.test(ch)) w += 0.66;
    else w += 0.52;
  }
  return w * fontSize * (factor / 0.5) * (bold ? 1.02 : 1);
}

function truncate(s: string, fontSize: number, maxW: number, bold = false): string {
  const t = String(s || '');
  if (textWidth(t, fontSize, bold) <= maxW) return t;
  let out = t;
  while (out.length > 1 && textWidth(`${out}...`, fontSize, bold) > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function rgb(c: RGB): string {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`;
}

function rect(x: number, y: number, w: number, h: number, fill?: RGB, stroke?: RGB, lw = 0.75): string {
  const parts: string[] = [];
  if (fill) parts.push(`${rgb(fill)} rg`);
  if (stroke) parts.push(`${rgb(stroke)} RG`, `${lw} w`);
  parts.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
  if (fill && stroke) parts.push('B');
  else if (fill) parts.push('f');
  else parts.push('S');
  return parts.join(' ');
}

function line(x1: number, y1: number, x2: number, y2: number, color: RGB, lw = 0.8): string {
  return `${rgb(color)} RG ${lw} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function textAt(
  x: number,
  y: number,
  s: string,
  fontSize: number,
  color: RGB,
  bold = false,
  align: 'left' | 'center' | 'right' = 'left',
): string {
  const font = bold ? '/F2' : '/F1';
  let tx = x;
  if (align === 'center') tx = x - textWidth(s, fontSize, bold) / 2;
  if (align === 'right') tx = x - textWidth(s, fontSize, bold);
  return `BT ${font} ${fontSize} Tf ${rgb(color)} rg ${tx.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`;
}

/** Simple White Glove mark: rounded teal tile + white "WG". */
function brandMark(x: number, y: number, size: number): string {
  const r = size * 0.18;
  const ops: string[] = [];
  // Rounded rect path (approximate with four arcs via bezier)
  const w = size;
  const h = size;
  const k = 0.5523 * r;
  ops.push(`${rgb(C.white)} rg`);
  ops.push(`${(x + r).toFixed(2)} ${y.toFixed(2)} m`);
  ops.push(`${(x + w - r).toFixed(2)} ${y.toFixed(2)} l`);
  ops.push(
    `${(x + w - r + k).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + r - k).toFixed(2)} ${(x + w).toFixed(2)} ${(y + r).toFixed(2)} c`,
  );
  ops.push(`${(x + w).toFixed(2)} ${(y + h - r).toFixed(2)} l`);
  ops.push(
    `${(x + w).toFixed(2)} ${(y + h - r + k).toFixed(2)} ${(x + w - r + k).toFixed(2)} ${(y + h).toFixed(2)} ${(x + w - r).toFixed(2)} ${(y + h).toFixed(2)} c`,
  );
  ops.push(`${(x + r).toFixed(2)} ${(y + h).toFixed(2)} l`);
  ops.push(
    `${(x + r - k).toFixed(2)} ${(y + h).toFixed(2)} ${x.toFixed(2)} ${(y + h - r + k).toFixed(2)} ${x.toFixed(2)} ${(y + h - r).toFixed(2)} c`,
  );
  ops.push(`${x.toFixed(2)} ${(y + r).toFixed(2)} l`);
  ops.push(
    `${x.toFixed(2)} ${(y + r - k).toFixed(2)} ${(x + r - k).toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} c`,
  );
  ops.push('f');
  // Soft accent inset bar on left of mark
  ops.push(rect(x + 2, y + 2, 3, h - 4, C.accentSoft));
  const label = 'WG';
  const fs = size * 0.38;
  ops.push(
    textAt(x + w / 2, y + h / 2 - fs * 0.32, label, fs, C.accentDeep, true, 'center'),
  );
  return ops.join('\n');
}

type Col = { key: string; label: string; w: number; align: 'left' | 'center' | 'right' };

const COLS: Col[] = [
  { key: 'child', label: 'Child', w: 148, align: 'left' },
  { key: 'dos', label: 'DOS', w: 78, align: 'left' },
  { key: 'in', label: 'In', w: 48, align: 'center' },
  { key: 'out', label: 'Out', w: 48, align: 'center' },
  { key: 'att', label: 'Attendance', w: 88, align: 'left' },
  { key: 'code', label: 'Code', w: 118, align: 'left' },
  { key: 'notes', label: 'Notes', w: 208, align: 'left' },
];

type RowCells = Record<string, string>;

function statusLabel(status: string): string {
  const s = String(status || '').trim();
  if (!s) return '-';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildPageContent(input: {
  week: WeeklyPeriod;
  providerLabel: string;
  signerName: string;
  signerEmail: string;
  schoolDistrict?: string;
  rows: RowCells[];
  pageIndex: number;
  pageCount: number;
  showSignatures: boolean;
}): string {
  const ops: string[] = ['q'];
  const headerH = 58;
  const headerY = PAGE_H - headerH;

  // Page wash
  ops.push(rect(0, 0, PAGE_W, PAGE_H, C.wash));

  // Brand header
  ops.push(rect(0, headerY, PAGE_W, headerH, C.accentDeep));
  ops.push(rect(0, headerY - 3, PAGE_W, 3, C.accent));
  ops.push(brandMark(MARGIN_X, headerY + 11, 36));
  ops.push(textAt(MARGIN_X + 48, headerY + 32, 'White Glove', 16, C.white, true));
  const district = String(input.schoolDistrict || '').trim();
  ops.push(
    textAt(
      MARGIN_X + 48,
      headerY + 16,
      district
        ? truncate(district, 9.5, 280, false)
        : 'Related Service Timesheet',
      9.5,
      C.accentSoft,
      false,
    ),
  );
  ops.push(
    textAt(
      PAGE_W - MARGIN_X,
      headerY + 28,
      'CONFIDENTIAL',
      8,
      C.accentSoft,
      true,
      'right',
    ),
  );
  ops.push(
    textAt(
      PAGE_W - MARGIN_X,
      headerY + 14,
      district ? 'Related Service Timesheet' : 'Therapy Management System',
      8,
      C.white,
      false,
      'right',
    ),
  );

  // Meta card
  const metaY = headerY - 52;
  ops.push(rect(MARGIN_X, metaY, CONTENT_W, 42, C.white, C.line, 0.6));
  ops.push(rect(MARGIN_X, metaY, 4, 42, C.accent));

  const metaPad = MARGIN_X + 16;
  const colW = CONTENT_W / 4;
  const metaFields: Array<{ label: string; value: string }> = [
    { label: 'PROVIDER', value: input.providerLabel || '—' },
    { label: 'WEEK OF', value: input.week.weekStart || '—' },
    { label: 'STATUS', value: statusLabel(input.week.status) },
    {
      label: 'PRINCIPAL',
      value: input.signerName
        ? `${input.signerName}${input.signerEmail ? ` / ${input.signerEmail}` : ''}`
        : input.signerEmail || '—',
    },
  ];
  metaFields.forEach((f, i) => {
    const x = metaPad + i * colW;
    ops.push(textAt(x, metaY + 28, f.label, 7, C.muted, true));
    ops.push(
      textAt(x, metaY + 12, truncate(f.value, 10, colW - 18, true), 10, C.ink, true),
    );
  });

  // Table
  const tableTop = metaY - 14;
  const rowH = 20;
  const headH = 22;
  let y = tableTop - headH;

  // Header row
  ops.push(rect(MARGIN_X, y, CONTENT_W, headH, C.accent));
  let cx = MARGIN_X;
  for (const col of COLS) {
    const tx =
      col.align === 'left'
        ? cx + 8
        : col.align === 'right'
          ? cx + col.w - 8
          : cx + col.w / 2;
    ops.push(textAt(tx, y + 7, col.label, 8.5, C.white, true, col.align));
    cx += col.w;
  }

  // Body rows
  for (let i = 0; i < input.rows.length; i += 1) {
    y -= rowH;
    const fill = i % 2 === 0 ? C.white : C.rowAlt;
    ops.push(rect(MARGIN_X, y, CONTENT_W, rowH, fill));
    ops.push(line(MARGIN_X, y, MARGIN_X + CONTENT_W, y, C.line, 0.4));
    cx = MARGIN_X;
    const row = input.rows[i]!;
    for (const col of COLS) {
      const raw = row[col.key] || '';
      const maxW = col.w - 14;
      const cell = truncate(raw, 8.5, maxW);
      const tx =
        col.align === 'left'
          ? cx + 8
          : col.align === 'right'
            ? cx + col.w - 8
            : cx + col.w / 2;
      ops.push(textAt(tx, y + 6.5, cell, 8.5, C.ink, false, col.align));
      cx += col.w;
    }
  }
  // Table outer border
  const tableBottom = y;
  const tableH = tableTop - tableBottom;
  ops.push(rect(MARGIN_X, tableBottom, CONTENT_W, tableH, undefined, C.line, 0.7));

  if (input.showSignatures) {
    const sigTop = Math.min(tableBottom - 28, 168);
    const cardH = 88;
    const gap = 16;
    const cardW = (CONTENT_W - gap) / 2;
    const cardsY = Math.max(56, sigTop - cardH);

    ops.push(textAt(MARGIN_X, cardsY + cardH + 10, 'AUTHORIZATION', 8, C.muted, true));
    ops.push(line(MARGIN_X + 78, cardsY + cardH + 12, MARGIN_X + CONTENT_W, cardsY + cardH + 12, C.line, 0.5));

    const cards: Array<{ title: string; subtitle: string; x: number; principal?: boolean }> = [
      {
        title: 'Provider signature',
        subtitle: input.providerLabel || 'Therapist',
        x: MARGIN_X,
      },
      {
        title: 'Principal signature',
        subtitle: input.signerName || 'School principal / supervisor',
        x: MARGIN_X + cardW + gap,
        principal: true,
      },
    ];

    for (const card of cards) {
      ops.push(rect(card.x, cardsY, cardW, cardH, C.white, card.principal ? C.accent : C.line, card.principal ? 1.1 : 0.7));
      ops.push(rect(card.x, cardsY, 4, cardH, C.accent));
      ops.push(textAt(card.x + 14, cardsY + cardH - 18, card.title, 9.5, C.ink, true));
      ops.push(
        textAt(
          card.x + 14,
          cardsY + cardH - 32,
          truncate(card.subtitle, 8, cardW - 28),
          8,
          C.muted,
          false,
        ),
      );
      // Signature line
      ops.push(
        line(card.x + 14, cardsY + 36, card.x + cardW - 14, cardsY + 36, C.accent, 1),
      );
      ops.push(textAt(card.x + 14, cardsY + 40, 'Sign here', 7, C.line, false));
      // Date line
      const dateX = card.x + cardW - 120;
      ops.push(textAt(dateX, cardsY + 22, 'Date', 7.5, C.muted, true));
      ops.push(line(dateX + 28, cardsY + 20, card.x + cardW - 14, cardsY + 20, C.line, 0.8));
      if (card.principal) {
        // Tiny white anchor text for DocuSign tab placement
        ops.push(textAt(card.x + 14, cardsY + 6, PRINCIPAL_SIGN_ANCHOR, 4, C.white, false));
      }
    }
  } else if (input.pageIndex < input.pageCount - 1) {
    ops.push(
      textAt(
        PAGE_W / 2,
        64,
        'Continued on next page - signatures appear on the final page',
        8,
        C.muted,
        false,
        'center',
      ),
    );
  }

  // Footer (confidential + subtle Advanced Automations credit)
  ops.push(rect(0, 0, PAGE_W, 40, C.accentDeep));
  ops.push(
    textAt(
      MARGIN_X,
      22,
      'Confidential - for authorized White Glove and school personnel only. Do not redistribute.',
      7,
      C.accentSoft,
      false,
    ),
  );
  ops.push(
    textAt(
      PAGE_W - MARGIN_X,
      22,
      `Page ${input.pageIndex + 1} of ${input.pageCount}`,
      7,
      C.white,
      false,
      'right',
    ),
  );
  ops.push(
    textAt(
      PAGE_W / 2,
      9,
      'Powered by advancedautomations.net',
      6,
      C.accentSoft,
      false,
      'center',
    ),
  );

  ops.push('Q');
  return ops.join('\n');
}

function assemblePdf(pageStreams: string[]): Uint8Array {
  const pageCount = pageStreams.length;
  const pageObjNums: number[] = [];
  let nextObj = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pageObjNums.push(nextObj);
    nextObj += 2; // page + contents
  }
  const font1 = nextObj;
  const font2 = nextObj + 1;

  let body = '%PDF-1.4\n';
  const offsets = [0];
  let objIndex = 0;
  const writeObj = (content: string) => {
    offsets.push(Buffer.byteLength(body));
    body += `${objIndex + 1} 0 obj\n${content}\nendobj\n`;
    objIndex += 1;
  };

  writeObj('<< /Type /Catalog /Pages 2 0 R >>');
  writeObj(
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  );

  for (let i = 0; i < pageCount; i += 1) {
    const pageNum = pageObjNums[i]!;
    const contentNum = pageNum + 1;
    writeObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    const stream = pageStreams[i]!;
    const len = Buffer.byteLength(stream, 'utf8');
    writeObj(`<< /Length ${len} >>\nstream\n${stream}\nendstream`);
  }
  writeObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  writeObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objIndex + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer << /Size ${objIndex + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}

/**
 * Sessions shown on the DocuSign / email timesheet PDF.
 * Missed (absent / no-show) stay in TMS for makeup linking but are not signed for pay.
 * Matches HHA transfer: attended + makeup only.
 */
export function isTimesheetPdfAttendance(attendance: string): boolean {
  return attendance === 'attended' || attendance === 'makeup';
}

/** Branded White Glove related-service timesheet (landscape letter). */
export function buildTimesheetPdf(input: {
  week: WeeklyPeriod;
  providerLabel: string;
  signerName: string;
  signerEmail: string;
  /** School district name shown in the PDF header. */
  schoolDistrict?: string;
  rows: Array<{ session: SessionRow; student: Student | undefined; payAmount?: number | null }>;
}): Uint8Array {
  const dataRows: RowCells[] = input.rows
    .filter((row) => isTimesheetPdfAttendance(row.session.attendance || ''))
    .map((row) => {
    const name = row.student
      ? `${row.student.firstName} ${row.student.lastName}`
      : row.session.studentId;
    const notes = String(row.session.notes || row.session.location || '').trim();
    const cpt = String(row.session.cptLabel || (row.session.cptCodes || []).join(', ') || '').trim();
    return {
      child: name,
      dos: row.session.dateOfService || '',
      in: row.session.beginTime || '',
      out: row.session.endTime || '',
      att: row.session.attendance || '',
      code: cpt || row.session.serviceType || '',
      notes,
    };
  });

  // Layout budget: header+meta ~120, footer 36, signatures ~120 on last page
  const firstPageCapacity = 14;
  const contPageCapacity = 18;
  const chunks: RowCells[][] = [];
  if (dataRows.length === 0) {
    chunks.push([]);
  } else {
    let remaining = dataRows.slice();
    chunks.push(remaining.splice(0, firstPageCapacity));
    while (remaining.length) {
      chunks.push(remaining.splice(0, contPageCapacity));
    }
  }

  const pageCount = chunks.length;
  const streams = chunks.map((chunk, pageIndex) =>
    buildPageContent({
      week: input.week,
      providerLabel: input.providerLabel,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      schoolDistrict: input.schoolDistrict,
      rows: chunk,
      pageIndex,
      pageCount,
      showSignatures: pageIndex === pageCount - 1,
    }),
  );

  return assemblePdf(streams);
}
