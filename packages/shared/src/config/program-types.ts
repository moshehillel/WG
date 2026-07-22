/**
 * Program Type → session handling (from client, Jul 2026).
 * EVV programs: verify HHA mobile clocking before confirm.
 * No-EVV programs: auto-approve / direct entry (no clock match required).
 */
export type ProgramSessionMode = 'skip' | 'evv' | 'no_evv';

/** Normalize program type text for lookup (case-insensitive, collapse whitespace). */
export function normalizeProgramType(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\u2013/g, '-'); // en-dash → hyphen
}

/** Program types that require EVV clocking verification in HHA before confirm. */
export const EVV_PROGRAM_TYPES: readonly string[] = [
  'Americare Certified',
  'Royal Care Certified Services - Therapy',
  'Extended Home Care Therapy',
  'United Healthcare Therapy',
  'Empire Bluecross Blueshield Therapy',
  'HIP Therapy',
  'Cigna Therapy Services',
  'NYS Medical Indemnity Fund Therapy',
  'GHI THERAPY',
  'Revival Home Health Care Therapy',
  'Briah Home Care',
  'Anthem Therapy',
  'Able Health Care Service',
  'Fidelis Care - New Jersey (WGJ)',
  'Preferred Certified Therapy',
  'United Healthcare of New Jersey (WGJ)',
  'Horizon Commercial NJ Therapy',
  'Horizon NJ',
];

/** Program types with no EVV — direct entry / auto-approve path. */
export const NO_EVV_PROGRAM_TYPES: readonly string[] = [
  'Garden City UFSD Therapy',
  'Island Trees Union Free School District',
  'Malverne UFSD',
  'City School District of New Rochelle',
  'Syosset Central School District',
  'Baldwin UFSD',
  'BOE MTAC',
  'Manhasset Union Free School District',
  'Valley Stream School District Thirty',
  'OYSTER BAY-EAST NORWICH CSD Therapy',
  'Poughkeepsie City School District',
  'Valley Stream School District 24',
  'Greenburgh North Castle UFSD',
  'Lynbrook Union Free School District',
  'Levittown UFSD',
  'Pine Bush School District',
  'MOESC',
  'Westbury UFSD',
  'Dutchess County Therapy',
  'Valley Stream Central High School District Therapy',
  'Glen Cove City School District',
  'Ulster County',
  'BOE MTAC PreK',
  'Belleville Public Schools Therapy',
  'Elmont UFSD Therapy',
  'Locust Valley School District',
  'Hicksville UFSD Therapy',
  'Hughes Roger',
  'DCF Regional School Therapy',
  'BOE Therapy RSA',
  'ADAPT',
  'Westchester DOH',
  'Manchester Regional High School',
  'Woodstown-Pilesgrove Regional School District',
  'Herricks UFSD Therapy',
  'Hewlett-Woodmere UFSD Therapy',
  'Arc Hudson Brookside School',
  'Sunburst Workforce Advisors',
  'Fred S. Keller School',
  'Tuxedo Therapy',
  'Somers CSD',
  'Island Park UFSD',
  'Bethpage UFSD',
  'Sunshine State Health Plan',
  'Carle Place UFSD',
];

const evvSet = new Set(EVV_PROGRAM_TYPES.map(normalizeProgramType));
const noEvvSet = new Set(NO_EVV_PROGRAM_TYPES.map(normalizeProgramType));

export function programSessionMode(programType: string | undefined): ProgramSessionMode | undefined {
  const key = normalizeProgramType(programType);
  if (!key) return undefined;
  if (evvSet.has(key)) return 'evv';
  if (noEvvSet.has(key)) return 'no_evv';
  return undefined;
}
