import type { SessionRow, Student, WeeklyPeriod } from '@white-glove/tms-db';

function esc(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Minimal one-page PDF timesheet (fill-in lines for signer). */
export function buildTimesheetPdf(input: {
  week: WeeklyPeriod;
  providerLabel: string;
  signerName: string;
  signerEmail: string;
  rows: Array<{ session: SessionRow; student: Student | undefined }>;
}): Uint8Array {
  const lines: string[] = [
    `Related Service Timesheet`,
    `Provider: ${input.providerLabel}`,
    `Week of ${input.week.weekStart}  Status: ${input.week.status}`,
    `Signer: ${input.signerName} <${input.signerEmail}>`,
    '',
    'Child | DOS | In | Out | Attendance | Code',
  ];
  for (const row of input.rows) {
    const name = row.student
      ? `${row.student.firstName} ${row.student.lastName}`
      : row.session.studentId;
    lines.push(
      `${name} | ${row.session.dateOfService} | ${row.session.beginTime} | ${row.session.endTime} | ${row.session.attendance} | ${row.session.serviceType}`,
    );
  }
  lines.push('', 'Provider signature ____________________  Date __________');
  lines.push('Signer signature   ____________________  Date __________');
  const textOps = lines
    .map((line, i) => `BT /F1 10 Tf 36 ${720 - i * 14} Td (${esc(line)}) Tj ET`)
    .join('\n');
  const stream = `q\n${textOps}\nQ\n`;
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}
