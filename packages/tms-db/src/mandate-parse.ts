import { disciplineFromServiceType, parseFrequencyPerWeek } from './mandate.js';
import type { Discipline } from './types.js';

export interface ParsedMandatePdf {
  firstName: string;
  lastName: string;
  dob: string;
  serviceType: string;
  discipline: Discipline | '';
  frequencyPerWeek: number | null;
  frequencyRaw: string;
  ratioGroup: boolean;
  programId: string;
  programType: string;
  warnings: string[];
}

function field(text: string, labels: string[]): string {
  const blob = String(text || '').replace(/\r/g, '');
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, 'i');
    const m = blob.match(re);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Caseload / mandate PDF: parse once, then save. */
export function parseMandatePdfText(text: string): ParsedMandatePdf {
  const warnings: string[] = [];
  const nameRaw =
    field(text, [
      "child'?s name",
      'child name',
      'student name',
      'student',
      'name',
    ]) || '';
  let firstName = '';
  let lastName = '';
  if (nameRaw.includes(',')) {
    const [last, ...rest] = nameRaw.split(',');
    lastName = last.trim();
    firstName = rest.join(' ').trim();
  } else {
    const parts = nameRaw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) firstName = parts[0] ?? '';
    else if (parts.length > 1) {
      lastName = parts.slice(0, -1).join(' ');
      firstName = parts[parts.length - 1] ?? '';
    }
  }
  const dob = field(text, ['date of birth', 'd\\.o\\.b', 'dob', 'birth']);
  const serviceType = field(text, ['service type', 'service detail', 'service']);
  const frequencyRaw = field(text, ['mandate frequency', 'frequency', 'mandate', 'freq']);
  const programId = field(text, ['program id', 'programid']);
  const programType = field(text, ['program type', 'program']);
  const frequencyPerWeek = parseFrequencyPerWeek(frequencyRaw);
  const ratioGroup = /\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(
    `${serviceType} ${text}`,
  );
  if (!firstName && !lastName) warnings.push('Could not read child name from the PDF.');
  if (!serviceType) warnings.push('Could not read service type from the PDF.');
  if (frequencyPerWeek == null) warnings.push('Could not read mandate frequency from the PDF.');
  return {
    firstName,
    lastName,
    dob,
    serviceType,
    discipline: disciplineFromServiceType(serviceType),
    frequencyPerWeek,
    frequencyRaw,
    ratioGroup,
    programId,
    programType,
    warnings,
  };
}
