/**
 * Program Type → HHA ContractID (prod GetContracts name match, 2026-07-24).
 * Regenerate: node packages/hha-client/scripts/lookup-reference-data.mjs && node packages/hha-client/scripts/generate-hha-config.mjs
 */
import { normalizeProgramType } from './program-types.js';

export const PROGRAM_CONTRACT_MAP: Readonly<Record<string, number>> = {
  "Able Health Care Service": 71791,
  "ADAPT": 71460,
  "Americare Certified": 37925,
  "Anthem Therapy": 70848,
  "Arc Hudson Brookside School": 69489,
  "Baldwin UFSD": 68715,
  "Belleville Public Schools Therapy": 69786,
  "Bethpage UFSD": 63956,
  "BOE MTAC": 28071,
  "BOE MTAC PreK": 69491,
  "BOE Therapy RSA": 70345,
  "Briah Home Care": 67854,
  "Carle Place UFSD": 73734,
  "Cigna Therapy Services": 38049,
  "City School District of New Rochelle": 64431,
  "DCF Regional School Therapy": 70112,
  "Dutchess County Therapy": 68539,
  "Elmont UFSD Therapy": 69787,
  "Empire Bluecross Blueshield Therapy": 14582,
  "Extended Home Care Therapy": 61591,
  "Fidelis Care - New Jersey (WGJ)": 64724,
  "Fred S. Keller School": 72817,
  "Garden City UFSD Therapy": 65496,
  "GHI THERAPY": 41856,
  "Glen Cove City School District": 66275,
  "Greenburgh North Castle UFSD": 66340,
  "Herricks UFSD Therapy": 71776,
  "Hewlett-Woodmere UFSD Therapy": 71779,
  "Hicksville UFSD Therapy": 70017,
  "HIP Therapy": 42167,
  "Horizon Commercial NJ Therapy": 73383,
  "Horizon NJ": 64723,
  "Hughes Roger": 70125,
  "Island Park UFSD": 73268,
  "Island Trees Union Free School District": 62737,
  "Levittown UFSD": 66149,
  "Locust Valley School District": 69868,
  "Lynbrook Union Free School District": 73028,
  "Malverne UFSD": 58311,
  "Manchester Regional High School": 64784,
  "Manhasset Union Free School District": 52159,
  "MOESC": 67234,
  "NYS Medical Indemnity Fund Therapy": 30204,
  "OYSTER BAY-EAST NORWICH CSD Therapy": 69932,
  "Pine Bush School District": 46847,
  "Poughkeepsie City School District": 52298,
  "Preferred Certified Therapy": 71792,
  "Revival Home Health Care Therapy": 19159,
  "Royal Care Certified Services - Therapy": 63939,
  "Somers CSD": 72847,
  "Sunburst Workforce Advisors": 72543,
  "Sunshine State Health Plan": 64301,
  "Syosset Central School District": 66031,
  "Tuxedo Therapy": 72794,
  "Ulster County": 69395,
  "United Healthcare of New Jersey (WGJ)": 64720,
  "United Healthcare Therapy": 57611,
  "Valley Stream Central High School District Therapy": 69490,
  "Valley Stream School District 24": 67134,
  "Valley Stream School District Thirty": 67107,
  "Westbury UFSD": 66237,
  "Westchester DOH": 52891,
  "Woodstown-Pilesgrove Regional School District": 71697,
};

const byNormalized = new Map<string, number>(
  Object.entries(PROGRAM_CONTRACT_MAP).map(([name, id]) => [normalizeProgramType(name), id]),
);

/** Resolve HHA ContractID from ProviderSoft Program Type (exact name match in HHA). */
export function lookupContractId(programType: string | undefined): number | undefined {
  const key = normalizeProgramType(programType);
  if (!key) return undefined;
  return byNormalized.get(key);
}
