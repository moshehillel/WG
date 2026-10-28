import { normalizeLookupName, stripProviderDisciplineSuffixes } from '@white-glove/shared';
import { psDateToIso } from './hha-time.js';

export type PatientIdentityChart = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
};

export type PatientIdentityStudent = {
  firstName?: string;
  /** When set, an HHA first name of "first + middle" is this same child. */
  middleName?: string;
  lastName?: string;
  dob?: string;
  dateOfBirth?: string;
};

/**
 * First/last key for an HHA chart vs a TMS child.
 * Case, punctuation, and therapy suffixes (PT*) fold away.
 * Equality only — "Ann" is not "Anna", and "Max" is not "Maxine".
 */
export function patientNameKey(value: string | undefined): string {
  return normalizeLookupName(stripProviderDisciplineSuffixes(value));
}

/** Calendar day YYYY-MM-DD. Format differences (03/12/2018 vs 2018-03-12) are the same day. */
export function patientDobKey(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const iso = psDateToIso(value.trim());
  const day = iso?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return day;
}

/**
 * Chart first name is TMS first and TMS middle joined, as HHA sometimes stores both
 * in FirstName (Muhammad + Ali → "Muhammad Ali"). Not a prefix or substring match.
 */
function chartFirstIsStudentFirstPlusMiddle(
  student: PatientIdentityStudent,
  chartFirst: string,
): boolean {
  const middle = patientNameKey(student.middleName);
  if (!middle) return false;
  const combined = patientNameKey(`${student.firstName ?? ''} ${student.middleName ?? ''}`);
  return combined === chartFirst;
}

/**
 * True only when first name, last name, and date of birth are the same child.
 * First name is equal, or the chart first name is TMS first plus TMS middle.
 * A missing name or DOB on either side is not a match.
 */
export function patientIdentityMatches(
  student: PatientIdentityStudent,
  chart: PatientIdentityChart,
): boolean {
  const studentFirst = patientNameKey(student.firstName);
  const studentLast = patientNameKey(student.lastName);
  const chartFirst = patientNameKey(chart.firstName);
  const chartLast = patientNameKey(chart.lastName);
  if (!studentFirst || !studentLast || !chartFirst || !chartLast) return false;
  const firstOk =
    studentFirst === chartFirst || chartFirstIsStudentFirstPlusMiddle(student, chartFirst);
  if (!firstOk || studentLast !== chartLast) return false;
  const studentDob = patientDobKey(student.dob ?? student.dateOfBirth);
  const chartDob = patientDobKey(chart.dateOfBirth);
  if (!studentDob || !chartDob) return false;
  return studentDob === chartDob;
}

function personLabel(first?: string, last?: string): string {
  const name = [first, last]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return name || 'unknown';
}

function dobLabel(value: string | undefined): string {
  return patientDobKey(value) || value?.trim() || 'missing';
}

/** Session failure when the chosen HHA chart is a different child. */
export function formatHhaPatientMismatch(options: {
  patientId: string;
  chart: PatientIdentityChart;
  student: PatientIdentityStudent;
}): string {
  const chartName = personLabel(options.chart.firstName, options.chart.lastName);
  const studentName = personLabel(options.student.firstName, options.student.lastName);
  const chartDob = dobLabel(options.chart.dateOfBirth);
  const studentDob = dobLabel(options.student.dob ?? options.student.dateOfBirth);
  return (
    `HHA patient ${options.patientId} is ${chartName} (dob ${chartDob}), ` +
    `not ${studentName} (dob ${studentDob}). Refusing to transfer.`
  );
}
