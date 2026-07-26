/** MR/admission lookup missed and name search returned multiple Active HHA patients. */
export class AmbiguousPatientNameError extends Error {
  readonly firstName: string;
  readonly lastName: string;
  readonly matchCount: number;

  constructor(firstName: string, lastName: string, matchCount: number) {
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || '(unknown name)';
    super(
      `Cannot verify patient: Program Id / admission lookup found no match, and HHA has ${matchCount} Active patients named "${name}". Manual HHA link required before syncing this row.`,
    );
    this.name = 'AmbiguousPatientNameError';
    this.firstName = firstName;
    this.lastName = lastName;
    this.matchCount = matchCount;
  }
}
