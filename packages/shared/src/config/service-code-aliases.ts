/**
 * Program-scoped ProviderSoft Service Type → HHA billing code *name* aliases.
 * Imported from client Excel (API Mappings); resolve ID live on the contract by name.
 * Do not read xlsx at runtime. Refresh:
 *   python scripts/import-service-code-aliases.py "API Mappings (1).xlsx"
 */
import { normalizeProgramType } from './program-types.js';
import { normalizeLookupName } from '../utils/name-match.js';

export interface ServiceCodeAlias {
  /** ProviderSoft Program Type / HHA contract name scope. */
  programType: string;
  /** ProviderSoft Service Type. */
  providerSoftCode: string;
  /** HHA ServiceCodeName on that program's contract (may differ from PS). */
  hhaServiceCodeName: string;
  /** Optional known ServiceCodeID when resolved offline; prefer name on contract. */
  hhaCode?: string;
}

export const SERVICE_CODE_ALIAS_MAP: readonly ServiceCodeAlias[] = [
  {
    programType: "ADAPT",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "ADAPT",
    providerSoftCode: "PT School 30",
    hhaServiceCodeName: "PT School 30",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT CHHA SCA",
    hhaServiceCodeName: "OT SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT CHHA SCA 2",
    hhaServiceCodeName: "OT Discipline",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT Chha SCA 3",
    hhaServiceCodeName: "OT SCA 3",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT GE CHHA",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT HC Eval SCA",
    hhaServiceCodeName: "OT SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT HC Eval SCA 2",
    hhaServiceCodeName: "OT Discipline",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "OT HC eval SCA 3",
    hhaServiceCodeName: "OT SCA 3",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT CHHA EXTENDED",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT CHHA SCA",
    hhaServiceCodeName: "PT SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT CHHA SCA2",
    hhaServiceCodeName: "PT Discipline",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT GE CHHA",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT HC Eval SCA",
    hhaServiceCodeName: "PT SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "PT HC Eval SCA 2",
    hhaServiceCodeName: "PT Discipline",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP CHHA",
    hhaServiceCodeName: "ST",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP CHHA SCA",
    hhaServiceCodeName: "ST SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP CHHA SCA 2",
    hhaServiceCodeName: "ST Discipline",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP GE CHHA",
    hhaServiceCodeName: "ST",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "SLP HC EVAL",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP HC EVAL SCA",
    hhaServiceCodeName: "ST SCA",
  },
  {
    programType: "Americare Certified",
    providerSoftCode: "SLP HC EVAL SCA 2",
    hhaServiceCodeName: "ST Discipline",
  },
  {
    programType: "Arc Hudson Brookside School",
    providerSoftCode: "PT additional Services",
    hhaServiceCodeName: "PT additional Services 60",
  },
  {
    programType: "Arc Hudson Brookside School",
    providerSoftCode: "PT additional Services 30",
    hhaServiceCodeName: "PT additional Services 30",
  },
  {
    programType: "Arc Hudson Brookside School",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Arc Hudson Brookside School",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT Annual Review Meeting 15",
    hhaServiceCodeName: "OT Annual Review Meeting 15",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT AR Meeting 15",
    hhaServiceCodeName: "OT Annual Review Meeting 15",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT Meeting 30",
    hhaServiceCodeName: "OT Meeting 30",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT meeting 40",
    hhaServiceCodeName: "OT meeting 40",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT Push in",
    hhaServiceCodeName: "OT Push-in",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT Push in40",
    hhaServiceCodeName: "OT Pushin 40",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT school",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT school \"no peer available\"",
    hhaServiceCodeName: "OT school",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT school Group40",
    hhaServiceCodeName: "OT School Group40",
  },
  {
    programType: "Baldwin UFSD",
    providerSoftCode: "OT school40",
    hhaServiceCodeName: "OT School40",
  },
  {
    programType: "Belleville Public Schools Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Belleville Public Schools Therapy",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School 45",
  },
  {
    programType: "Belleville Public Schools Therapy",
    providerSoftCode: "PT School 40 Makeup",
    hhaServiceCodeName: "PT School 45",
  },
  {
    programType: "Bellmore Union Free School District Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Bellmore Union Free School District Therapy",
    providerSoftCode: "PT School group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "Bethpage UFSD",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Bethpage UFSD",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "SLP School Group",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT 46.50",
    hhaServiceCodeName: "OT 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT 50.00",
    hhaServiceCodeName: "OT 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT 52.50",
    hhaServiceCodeName: "OT 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT 54.00",
    hhaServiceCodeName: "OT 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT 62.00",
    hhaServiceCodeName: "OT BOE40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE",
    hhaServiceCodeName: "O1",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE Dpee",
    hhaServiceCodeName: "OT BOE Dpee",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE Group",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE Group Dpee",
    hhaServiceCodeName: "OT BOE Group Dpee",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE Group0",
    hhaServiceCodeName: "OT NB",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE Group40",
    hhaServiceCodeName: "OT BOE Group40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT BOE40",
    hhaServiceCodeName: "OT BOE40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 25.00",
    hhaServiceCodeName: "OT Group 2 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 26.25",
    hhaServiceCodeName: "OT Group 2 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 46.50",
    hhaServiceCodeName: "OT Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 50.00",
    hhaServiceCodeName: "OT Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 52.50",
    hhaServiceCodeName: "OT Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 54.00",
    hhaServiceCodeName: "OT Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 62.00",
    hhaServiceCodeName: "OT Group/Single 40m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 66.67",
    hhaServiceCodeName: "OT Group/Single 40m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "OT GROUP 72.00",
    hhaServiceCodeName: "OT Group/Single 40m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP 33.33",
    hhaServiceCodeName: "SLP 20m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP 46.50",
    hhaServiceCodeName: "SLP 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP 50.00",
    hhaServiceCodeName: "SLP 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP 62.00",
    hhaServiceCodeName: "SLP BOE 40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE",
    hhaServiceCodeName: "SLP BOE",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE 40",
    hhaServiceCodeName: "SLP BOE 40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE Group",
    hhaServiceCodeName: "SLP BOE Group",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE Group 40",
    hhaServiceCodeName: "SLP BOE Group 40",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE Group 60",
    hhaServiceCodeName: "SLP BOE Group 60",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP BOE Group0",
    hhaServiceCodeName: "SLP BOE Group NB",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 15.50",
    hhaServiceCodeName: "SLP Group 3 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 16.67",
    hhaServiceCodeName: "SLP Group 3 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 23.25",
    hhaServiceCodeName: "SLP Group 2 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 25.00",
    hhaServiceCodeName: "SLP Group 2 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 46.50",
    hhaServiceCodeName: "SLP Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 50.00",
    hhaServiceCodeName: "SLP Group/Single 30m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 62.00",
    hhaServiceCodeName: "SLP Group/Single 40m",
  },
  {
    programType: "BOE MTAC",
    providerSoftCode: "SLP GROUP 66.67",
    hhaServiceCodeName: "SLP Group/Single 40m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT 45.50",
    hhaServiceCodeName: "OT 26m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT 49.00",
    hhaServiceCodeName: "OT 28m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT 50.75",
    hhaServiceCodeName: "OT 29m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT 52.50",
    hhaServiceCodeName: "OT 30m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE Dpee",
    hhaServiceCodeName: "OT BOE Dpee",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE Group",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE Group Dpee",
    hhaServiceCodeName: "OT BOE Group Dpee",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE Group0",
    hhaServiceCodeName: "OT NB",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE Group40",
    hhaServiceCodeName: "OT BOE Group40",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT BOE40",
    hhaServiceCodeName: "OT BOE40",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "OT GROUP 52.50",
    hhaServiceCodeName: "OT Group/Single 30m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP 46.50",
    hhaServiceCodeName: "SLP 30m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE",
    hhaServiceCodeName: "SLP BOE",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE 40",
    hhaServiceCodeName: "SLP BOE 40",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE Group",
    hhaServiceCodeName: "SLP BOE Group",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE Group 40",
    hhaServiceCodeName: "SLP BOE Group 40",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE Group 60",
    hhaServiceCodeName: "SLP BOE Group 60",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP BOE Group0",
    hhaServiceCodeName: "SLP BOE Group NB",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP GROUP 23.25",
    hhaServiceCodeName: "SLP Group 2 30m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP GROUP 38.75",
    hhaServiceCodeName: "SLP Group/Single 25m",
  },
  {
    programType: "BOE MTAC PreK",
    providerSoftCode: "SLP GROUP 46.50",
    hhaServiceCodeName: "SLP Group/Single 30m",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "OT BOE",
    hhaServiceCodeName: "OT BOE",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "OT BOE Group",
    hhaServiceCodeName: "OT BOE Group",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "OT BOE Group0",
    hhaServiceCodeName: "OT NB",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "SLP BOE",
    hhaServiceCodeName: "SLP BOE",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "SLP BOE Group",
    hhaServiceCodeName: "SLP BOE Group",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "SLP BOE Group/Single",
    hhaServiceCodeName: "SLP BOE Group/Single",
  },
  {
    programType: "BOE Therapy RSA",
    providerSoftCode: "SLP BOE Group0",
    hhaServiceCodeName: "SLP NB",
  },
  {
    programType: "Carle Place UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Carle Place UFSD",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "CIGNA - FL",
    providerSoftCode: "MLTC Recert",
    hhaServiceCodeName: "MLTC Recert",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "OT CIGNA",
    hhaServiceCodeName: "OT Home",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "OT Cigna Eval",
    hhaServiceCodeName: "OT Home",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT Home",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "PT CIGNA",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "PT Cigna Eval",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "SLP CIGNA",
    hhaServiceCodeName: "ST Home",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "SLP CIGNA Eval",
    hhaServiceCodeName: "ST Home",
  },
  {
    programType: "Cigna Therapy Services",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "ST Home",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "Annual Review",
    hhaServiceCodeName: "Annual Review visit",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "OT Annual Review",
    hhaServiceCodeName: "OT Annual Review 60",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "OT Progress Report",
    hhaServiceCodeName: "IEP Documentation",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "PT Annual Review",
    hhaServiceCodeName: "Annual Review visit",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT school",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT visit",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "PT School 45",
    hhaServiceCodeName: "PT School 45",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP CSE meeting",
    hhaServiceCodeName: "ST CSE Meeting 45 min",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP meeting 30",
    hhaServiceCodeName: "ST Meeting 30",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP meeting 40",
    hhaServiceCodeName: "ST CSE Meeting 45 min",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP Meeting 60",
    hhaServiceCodeName: "ST Meeting 60",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP school \"no peer available\"",
    hhaServiceCodeName: "ST School",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP School 60",
    hhaServiceCodeName: "SLP School 60",
  },
  {
    programType: "City School District of New Rochelle",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "SLP School Group",
  },
  {
    programType: "DCF Regional School Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "DCF Regional School Therapy",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Dutchess County Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Elmont UFSD Therapy",
    providerSoftCode: "PT Annual Review",
    hhaServiceCodeName: "PT Annual Review",
  },
  {
    programType: "Elmont UFSD Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Elmont UFSD Therapy",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Elmont UFSD Therapy",
    providerSoftCode: "SLP school",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Elsie Soloff",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "Empire Bluecross Blueshield Florida",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT Eval",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "OT BCBS",
    hhaServiceCodeName: "G0152",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "OT BCBS Eval",
    hhaServiceCodeName: "G0152",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "G0152",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "PT BCBS",
    hhaServiceCodeName: "EMPIRE PT G0151",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "PT BCBS Eval",
    hhaServiceCodeName: "EMPIRE PT G0151",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "EMPIRE PT G0151",
  },
  {
    programType: "Empire Bluecross Blueshield Therapy",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "G0153",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "Occupational Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "OT CHHA EXTENDED",
    hhaServiceCodeName: "Occupational Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT SOC/ROC OASIS",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "Physical Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "PT CHHA EXTENDED",
    hhaServiceCodeName: "Physical Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT SOC/ROC OASIS",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "SLP CHHA",
    hhaServiceCodeName: "Speech Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "SLP CHHA EXTENDED",
    hhaServiceCodeName: "Speech Therapy",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "SLP Eval",
    hhaServiceCodeName: "ST SOC/ROC OASIS",
  },
  {
    programType: "Extended Home Care Therapy",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "ST SOC/ROC OASIS",
  },
  {
    programType: "Fidelis Care - New Jersey (WGJ)",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "S9131",
  },
  {
    programType: "Fred S. Keller School",
    providerSoftCode: "SLP additional Services",
    hhaServiceCodeName: "SLP Additional Services",
  },
  {
    programType: "Fred S. Keller School",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "PT School GC Makeup",
    hhaServiceCodeName: "PT 15",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT Group",
  },
  {
    programType: "Garden City UFSD Therapy",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT 15",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "OT GHI",
    hhaServiceCodeName: "G0152 $115",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "OT GHI EVAL",
    hhaServiceCodeName: "G0152 $115",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "PT GHI",
    hhaServiceCodeName: "G0151 $115",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "G0151 $115",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "SLP GHI",
    hhaServiceCodeName: "G0153 $115",
  },
  {
    programType: "GHI THERAPY",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "G0153 $115",
  },
  {
    programType: "Glen Cove City School District",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Glen Cove City School District",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Greenburgh North Castle UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Greenburgh North Castle UFSD",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Greenburgh North Castle UFSD",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT School Eval",
  },
  {
    programType: "Greenburgh North Castle UFSD",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "Herricks UFSD Therapy",
    providerSoftCode: "OT meeting 40",
    hhaServiceCodeName: "OT Meeting 40",
  },
  {
    programType: "Herricks UFSD Therapy",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Herricks UFSD Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT consult 30",
    hhaServiceCodeName: "OT Meeting/Consultation 30",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT Meeting 30",
    hhaServiceCodeName: "OT Meeting/Consultation 30",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT meeting 60",
    hhaServiceCodeName: "OT Meeting 60",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT School Eval",
    hhaServiceCodeName: "OT School Eval",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "PT meeting 30",
    hhaServiceCodeName: "PT Meeting 30",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "PT School 17",
    hhaServiceCodeName: "PT School 17",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "PT School 45",
    hhaServiceCodeName: "PT 45",
  },
  {
    programType: "Hewlett-Woodmere UFSD Therapy",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT School Eval",
  },
  {
    programType: "Hicksville UFSD Therapy",
    providerSoftCode: "OT school",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Hicksville UFSD Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Hicksville UFSD Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Hicksville UFSD Therapy",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School 45",
  },
  {
    programType: "Hicksville UFSD Therapy",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "HIP Therapy",
    providerSoftCode: "OT HIP",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "HIP Therapy",
    providerSoftCode: "PT HIP",
    hhaServiceCodeName: "G0151",
  },
  {
    programType: "HIP Therapy",
    providerSoftCode: "PT HIP Eval",
    hhaServiceCodeName: "S9131",
  },
  {
    programType: "HIP Therapy",
    providerSoftCode: "SLP HIP",
    hhaServiceCodeName: "S9128",
  },
  {
    programType: "Horizon Commercial NJ Therapy",
    providerSoftCode: "G0151",
    hhaServiceCodeName: "PT 97140",
  },
  {
    programType: "Horizon Commercial NJ Therapy",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "G0151",
  },
  {
    programType: "Horizon Commercial NJ Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT Eval 97162",
  },
  {
    programType: "Hughes Roger",
    providerSoftCode: "SLP CHHA",
    hhaServiceCodeName: "ST",
  },
  {
    programType: "Hughes Roger",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "ST",
  },
  {
    programType: "Island Park UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Island Park UFSD",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Island Park UFSD",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Island Trees Union Free School District",
    providerSoftCode: "SLP Meeting 60",
    hhaServiceCodeName: "SLP meeting 60",
  },
  {
    programType: "Island Trees Union Free School District",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Island Trees Union Free School District",
    providerSoftCode: "SLP School 45",
    hhaServiceCodeName: "SLP School 45",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT additional Services",
    hhaServiceCodeName: "PT Additional Services",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT meeting 30",
    hhaServiceCodeName: "PT additional Services 30",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT meeting 40",
    hhaServiceCodeName: "PT Meeting 40",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School 40",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "PT School Group 40",
    hhaServiceCodeName: "PT Group 40",
  },
  {
    programType: "Levittown UFSD",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP 30 min session",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "OT school 60",
    hhaServiceCodeName: "OT School 60",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "OT school 60 makeup",
    hhaServiceCodeName: "OT School 60",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT additional Services 30",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School 40",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT School 40 Makeup",
    hhaServiceCodeName: "PT School 40",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT School 60",
    hhaServiceCodeName: "PT School 60",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "PT School Makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP Consult 42",
    hhaServiceCodeName: "SLP Consult 42",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP School 42",
    hhaServiceCodeName: "SLP School 42",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "SLP School Group",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP School Group 42",
    hhaServiceCodeName: "SLP School Group 42",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP School Makeup",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Locust Valley School District",
    providerSoftCode: "SLP School Makeup 42",
    hhaServiceCodeName: "SLP School 42",
  },
  {
    programType: "Malverne UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "Physical Therapy Services",
  },
  {
    programType: "Manchester Regional High School",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "Progress Report 20",
    hhaServiceCodeName: "Progress report 20",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "Progress report write up",
    hhaServiceCodeName: "Progress Report Write up",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT meeting 30",
    hhaServiceCodeName: "PT School Meeting 30",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT meeting 40",
    hhaServiceCodeName: "PT School Meeting 40",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT Progress Report",
    hhaServiceCodeName: "PT Progress Notes Write Up",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School42",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT School 40 Makeup",
    hhaServiceCodeName: "PT School40",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT school makeup",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "PT School40",
    hhaServiceCodeName: "PT School40",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "Speech / Language Services",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "SLP School 45",
    hhaServiceCodeName: "SLP 40",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "SLP SCHOOL EVAL",
    hhaServiceCodeName: "Speech Evaluation",
  },
  {
    programType: "Manhasset Union Free School District",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "Speech Group Session",
  },
  {
    programType: "MOESC",
    providerSoftCode: "PT additional Services",
    hhaServiceCodeName: "PT additional Services",
  },
  {
    programType: "MOESC",
    providerSoftCode: "PT additional Services 15",
    hhaServiceCodeName: "PT additional Services 15 min",
  },
  {
    programType: "MOESC",
    providerSoftCode: "PT additional Services 30",
    hhaServiceCodeName: "PT additional Services 30 min",
  },
  {
    programType: "MOESC",
    providerSoftCode: "PT additional Services 45",
    hhaServiceCodeName: "PT Additonal Services 45 min",
  },
  {
    programType: "MOESC",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT school Services",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "97165",
    hhaServiceCodeName: "OT Eval 97165 083",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "OT 97110 083",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT Eval 97165 - 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 100",
    hhaServiceCodeName: "OT 97110 100",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 100 EVAL",
    hhaServiceCodeName: "OT EVAL 97166 100",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 101",
    hhaServiceCodeName: "OT 97110 101",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 103",
    hhaServiceCodeName: "OT 97110 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 104",
    hhaServiceCodeName: "OT 97110 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 104 45 min",
    hhaServiceCodeName: "OT 97110 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 105",
    hhaServiceCodeName: "OT 97110 105",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 110 45 min",
    hhaServiceCodeName: "OT 97110 110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 112",
    hhaServiceCodeName: "OT 97110-112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 112 45 min",
    hhaServiceCodeName: "OT 97110-112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 113",
    hhaServiceCodeName: "OT 97110 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 114",
    hhaServiceCodeName: "OT 97110 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 115",
    hhaServiceCodeName: "OT 97110 115",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS 116",
    hhaServiceCodeName: "OT 97110 116",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 103",
    hhaServiceCodeName: "OT 97110 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 104",
    hhaServiceCodeName: "OT Eval 97167 -104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS Eval 105",
    hhaServiceCodeName: "OT Eval 97167 105",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS Eval 106",
    hhaServiceCodeName: "OT Eval 97165 - 106",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 110",
    hhaServiceCodeName: "OT eval 97165 - 110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 112",
    hhaServiceCodeName: "OT Eval 97166 - 112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 113",
    hhaServiceCodeName: "OT Eval 97167 - 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 114",
    hhaServiceCodeName: "OT Eval 97167 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 115",
    hhaServiceCodeName: "OT eval 97165 115",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "OT NYS EVAL 116",
    hhaServiceCodeName: "OT Eval 97167 - 116",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "PT 97140 083",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT Eval 97163 083",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 103",
    hhaServiceCodeName: "PT 97140 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 103 45 min",
    hhaServiceCodeName: "PT 97140 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 104",
    hhaServiceCodeName: "PT 97140 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 104 45 min",
    hhaServiceCodeName: "PT 97140 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 105",
    hhaServiceCodeName: "PT 97140 105",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 106",
    hhaServiceCodeName: "PT 97110 106",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 107",
    hhaServiceCodeName: "PT 97140 107",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 110",
    hhaServiceCodeName: "PT - 97140  110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 112",
    hhaServiceCodeName: "PT 97140 112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 113",
    hhaServiceCodeName: "PT 97140 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 114",
    hhaServiceCodeName: "PT 97140 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 115",
    hhaServiceCodeName: "PT 97140 115",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 115 45 min",
    hhaServiceCodeName: "PT 97140 115",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 116",
    hhaServiceCodeName: "PT 97140 116",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS 116 45 min",
    hhaServiceCodeName: "PT 97140 116",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 103",
    hhaServiceCodeName: "PT Eval 97162- 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 104",
    hhaServiceCodeName: "PT Eval 97162 - 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 104 45 MIN EVAL",
    hhaServiceCodeName: "PT Eval 97162 - 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS eval 105",
    hhaServiceCodeName: "PT Eval 97163 105",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 106",
    hhaServiceCodeName: "PT Eval 97163 - 106",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 107",
    hhaServiceCodeName: "PT Eval 97162 107",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 110",
    hhaServiceCodeName: "PT Eval 97161 - 110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 112",
    hhaServiceCodeName: "PT Eval 97163 - 112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 113",
    hhaServiceCodeName: "PT Eval 97161 - 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 114",
    hhaServiceCodeName: "PT 97161 - 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "PT NYS EVAL 115",
    hhaServiceCodeName: "PT Eval 97161 - 115",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 103",
    hhaServiceCodeName: "ST 92507 103",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 104",
    hhaServiceCodeName: "ST 92507 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 105",
    hhaServiceCodeName: "ST 92507 105",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 105 Eval",
    hhaServiceCodeName: "ST Eval",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 106",
    hhaServiceCodeName: "ST 92507 106",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 110",
    hhaServiceCodeName: "ST 92526 110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 112",
    hhaServiceCodeName: "ST 92507 112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 113",
    hhaServiceCodeName: "ST 92507 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 114",
    hhaServiceCodeName: "SLP 92507 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 114 45 MIN",
    hhaServiceCodeName: "SLP 92507 114",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS 115",
    hhaServiceCodeName: "ST 92507 115 Visit",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS EVAL 103",
    hhaServiceCodeName: "ST Eval",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS EVAL 104",
    hhaServiceCodeName: "ST Eval 92523 - 104",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS EVAL 110",
    hhaServiceCodeName: "ST eval 92524- 110",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS eval 112",
    hhaServiceCodeName: "SLP Eval 92523 112",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS EVAL 113",
    hhaServiceCodeName: "ST Eval 92507- 113",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS EVAL 114",
    hhaServiceCodeName: "ST Eval",
  },
  {
    programType: "NYS Medical Indemnity Fund Therapy",
    providerSoftCode: "SLP NYS eval 115",
    hhaServiceCodeName: "ST 92507-115",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "FT",
    hhaServiceCodeName: "PT Family Training",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "OT Meeting 30",
    hhaServiceCodeName: "OT Meeting 30",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "OT meeting 40",
    hhaServiceCodeName: "OT Meeting 40",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "PT FT",
    hhaServiceCodeName: "PT Family Training 60",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "PT school eval",
    hhaServiceCodeName: "PT school eval",
  },
  {
    programType: "OYSTER BAY-EAST NORWICH CSD Therapy",
    providerSoftCode: "PT school group",
    hhaServiceCodeName: "PT school group",
  },
  {
    programType: "PINE BUSH SCHOOL DISTRICT",
    providerSoftCode: "OT Eval",
    hhaServiceCodeName: "OT Eval",
  },
  {
    programType: "PINE BUSH SCHOOL DISTRICT",
    providerSoftCode: "OT school",
    hhaServiceCodeName: "OT 30",
  },
  {
    programType: "Poughkeepsie City School District",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT school",
  },
  {
    programType: "Poughkeepsie City School District",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT school",
  },
  {
    programType: "Poughkeepsie City School District",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT school eval",
  },
  {
    programType: "Poughkeepsie City School District",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT school group",
  },
  {
    programType: "Preferred Certified",
    providerSoftCode: "PT CHHA PREF",
    hhaServiceCodeName: "Physical Therapy",
  },
  {
    programType: "Preferred Certified",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT SOC/ROC OASIS",
  },
  {
    programType: "Revival Home Health Care Therapy",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "OT CHAA",
  },
  {
    programType: "Revival Home Health Care Therapy",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT CHAA EVAL",
  },
  {
    programType: "Revival Home Health Care Therapy",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "PT CHAA",
  },
  {
    programType: "Revival Home Health Care Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT CHAA EVAL",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "Occupational Therapy",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "OT Evaluation",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "Physical Therapy",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "PT Evaluation",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "SLP CHHA",
    hhaServiceCodeName: "Speech Language Pathologist",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "SLP Eval",
    hhaServiceCodeName: "SLP Evaluation",
  },
  {
    programType: "Royal Care Certified Services - Therapy",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "SLP Evaluation",
  },
  {
    programType: "Somers CSD",
    providerSoftCode: "SLP School 60",
    hhaServiceCodeName: "School 60",
  },
  {
    programType: "Sunburst Workforce Advisors",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School 30",
  },
  {
    programType: "Sunburst Workforce Advisors",
    providerSoftCode: "SLP School 15",
    hhaServiceCodeName: "SLP School 15",
  },
  {
    programType: "Sunburst Workforce Advisors",
    providerSoftCode: "SLP School 60",
    hhaServiceCodeName: "SLP School 60",
  },
  {
    programType: "Sunshine State Health Plan",
    providerSoftCode: "PT CHHA",
    hhaServiceCodeName: "S9131",
  },
  {
    programType: "Sunshine State Health Plan",
    providerSoftCode: "PT HC Eval",
    hhaServiceCodeName: "S9131",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "OT meeting 40",
    hhaServiceCodeName: "OT meeting 40",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "OT school Makeup",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "SLP additional Services",
    hhaServiceCodeName: "SLP hourly",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP 30 min session",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "SLP SCHOOL EVAL",
    hhaServiceCodeName: "SLP eval",
  },
  {
    programType: "Syosset Central School District",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "SLP Group",
  },
  {
    programType: "Tuxedo Therapy",
    providerSoftCode: "OT School 15",
    hhaServiceCodeName: "OT School 15",
  },
  {
    programType: "Tuxedo Therapy",
    providerSoftCode: "OT school 60",
    hhaServiceCodeName: "OT school 60",
  },
  {
    programType: "Tuxedo Therapy",
    providerSoftCode: "OT School Eval",
    hhaServiceCodeName: "OT School Eval",
  },
  {
    programType: "Tuxedo Therapy",
    providerSoftCode: "SLP SCHOOL EVAL",
    hhaServiceCodeName: "SLP School Eval",
  },
  {
    programType: "Ulster County",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Ulster County",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "United Healthcare of New Jersey (WGJ)",
    providerSoftCode: "OT CHHA",
    hhaServiceCodeName: "97535",
  },
  {
    programType: "United Healthcare of New Jersey (WGJ)",
    providerSoftCode: "OT HC Eval",
    hhaServiceCodeName: "97535",
  },
  {
    programType: "United Healthcare of New Jersey (WGJ)",
    providerSoftCode: "SLP CHHA",
    hhaServiceCodeName: "92507",
  },
  {
    programType: "United Healthcare of New Jersey (WGJ)",
    providerSoftCode: "SLP HC EVAL",
    hhaServiceCodeName: "92507",
  },
  {
    programType: "United Healthcare Therapy",
    providerSoftCode: "OT UHT",
    hhaServiceCodeName: "OT",
  },
  {
    programType: "United Healthcare Therapy",
    providerSoftCode: "OT UHT Eval",
    hhaServiceCodeName: "OT Evaluation",
  },
  {
    programType: "United Healthcare Therapy",
    providerSoftCode: "PT UHT",
    hhaServiceCodeName: "PT",
  },
  {
    programType: "United Healthcare Therapy",
    providerSoftCode: "PT UHT eval",
    hhaServiceCodeName: "PT Evaluation",
  },
  {
    programType: "Valley Stream Central High School District Therapy",
    providerSoftCode: "OT School",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Valley Stream Central High School District Therapy",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Valley Stream Central High School District Therapy",
    providerSoftCode: "OT school Group40",
    hhaServiceCodeName: "OT School Group40",
  },
  {
    programType: "Valley Stream Central High School District Therapy",
    providerSoftCode: "OT School40",
    hhaServiceCodeName: "OT School40",
  },
  {
    programType: "Valley Stream School District",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District",
    providerSoftCode: "PT school eval",
    hhaServiceCodeName: "PT school eval",
  },
  {
    programType: "Valley Stream School District",
    providerSoftCode: "PT school group",
    hhaServiceCodeName: "PT school group",
  },
  {
    programType: "Valley Stream School District",
    providerSoftCode: "PT schools",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "OT Meeting 30",
    hhaServiceCodeName: "OT Meeting 30",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "OT school",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "OT school \"no peer available\"",
    hhaServiceCodeName: "OT School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "OT School Eval",
    hhaServiceCodeName: "OT School Eval",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "PT meeting 30",
    hhaServiceCodeName: "PT meeting 30",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT School Eval",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "ST School",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "SLP school Group",
    hhaServiceCodeName: "SLP School Group",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "SLP School Group Makeup",
    hhaServiceCodeName: "SLP School Group",
  },
  {
    programType: "Valley Stream School District 24",
    providerSoftCode: "SLP School Makeup",
    hhaServiceCodeName: "ST School",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "OT school Group",
    hhaServiceCodeName: "OT School Group",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT school \"no peer available\"",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT Eval",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "Valley Stream School District Thirty",
    providerSoftCode: "PT schools",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "PT Annual Review",
    hhaServiceCodeName: "Annual Review",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "PT School",
    hhaServiceCodeName: "PT School",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "PT School 40",
    hhaServiceCodeName: "PT School 42",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "PT School 60",
    hhaServiceCodeName: "PT School 60",
  },
  {
    programType: "Westbury UFSD",
    providerSoftCode: "PT School Group",
    hhaServiceCodeName: "PT School Group",
  },
  {
    programType: "Westchester DOH",
    providerSoftCode: "SLP School",
    hhaServiceCodeName: "SLP School",
  },
  {
    programType: "Woodstown-Pilesgrove Regional School District",
    providerSoftCode: "PT School Eval",
    hhaServiceCodeName: "PT School Eval",
  },
];

function aliasKey(programType: string, providerSoftCode: string): string {
  return `${normalizeProgramType(programType)}\0${normalizeLookupName(providerSoftCode)}`;
}

const byProgramAndPs = new Map<string, ServiceCodeAlias>(
  SERVICE_CODE_ALIAS_MAP.map((a) => [aliasKey(a.programType, a.providerSoftCode), a]),
);

const psCodesWithAlias = new Set(
  SERVICE_CODE_ALIAS_MAP.map((a) => normalizeLookupName(a.providerSoftCode)),
);

/** Program-scoped alias first (Excel). Names need not match when mapped. */
export function lookupServiceCodeAlias(
  providerSoftCode: string | undefined,
  programType?: string,
): ServiceCodeAlias | undefined {
  if (!providerSoftCode?.trim() || !programType?.trim()) return undefined;
  return byProgramAndPs.get(aliasKey(programType, providerSoftCode));
}

export function hasServiceCodeAlias(providerSoftCode: string | undefined): boolean {
  if (!providerSoftCode?.trim()) return false;
  return psCodesWithAlias.has(normalizeLookupName(providerSoftCode));
}
