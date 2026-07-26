/**
 * Service Type (ProviderSoft API Report) → HHA ServiceCodeID (prod GetBillingServiceCodes, 2026-07-24).
 * 47/60 sample types matched; unmatched SI/ABA variants may need manual HHA codes.
 * Regenerate: node packages/hha-client/scripts/lookup-reference-data.mjs && node packages/hha-client/scripts/generate-hha-config.mjs
 */
export interface ServiceCodeMapping {
  /** ProviderSoft Service Type name (API Report column). */
  providerSoftCode: string;
  /** HHA ServiceCodeID. */
  hhaCode: string;
  description: string;
  createIfMissing: boolean;
  defaultSessionTriage: 'auto_approve' | 'verify_clocking' | 'skip';
}

export const SERVICE_CODE_MAP: ServiceCodeMapping[] = [
  {
    providerSoftCode: "EI SLP w/Feeding",
    hhaCode: "1403664",
    description: "EI SLP w/Feeding",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "OT BCBS",
    hhaCode: "973449",
    description: "OT BCBS",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT CHHA",
    hhaCode: "56330",
    description: "OT CHHA",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT CHHA EXTENDED",
    hhaCode: "56330",
    description: "OT CHHA EXTENDED",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT Chha SCA 3",
    hhaCode: "56330",
    description: "OT Chha SCA 3",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT CIGNA",
    hhaCode: "973449",
    description: "OT CIGNA",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT EI",
    hhaCode: "973449",
    description: "OT EI",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "OT GHI",
    hhaCode: "973449",
    description: "OT GHI",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT HC Eval",
    hhaCode: "973449",
    description: "OT HC Eval",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT NYS 103",
    hhaCode: "973449",
    description: "OT NYS 103",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT NYS 105",
    hhaCode: "973449",
    description: "OT NYS 105",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT NYS 112 45 min",
    hhaCode: "973449",
    description: "OT NYS 112 45 min",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT NYS 115",
    hhaCode: "973449",
    description: "OT NYS 115",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "OT school Group",
    hhaCode: "1288142",
    description: "OT school Group",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT additional Services",
    hhaCode: "1468175",
    description: "PT additional Services",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT additional Services 30",
    hhaCode: "1277004",
    description: "PT additional Services 30",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT BCBS",
    hhaCode: "232853",
    description: "PT BCBS",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT CHHA",
    hhaCode: "56330",
    description: "PT CHHA",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT CHHA SCA2",
    hhaCode: "56330",
    description: "PT CHHA SCA2",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT EI",
    hhaCode: "232853",
    description: "PT EI",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "PT EI TELA",
    hhaCode: "232853",
    description: "PT EI TELA",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "PT EI UND",
    hhaCode: "232853",
    description: "PT EI UND",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "PT FT",
    hhaCode: "232853",
    description: "PT FT",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT GHI",
    hhaCode: "232853",
    description: "PT GHI",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT HC Eval",
    hhaCode: "232853",
    description: "PT HC Eval",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 103",
    hhaCode: "1080677",
    description: "PT NYS 103",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 105",
    hhaCode: "232853",
    description: "PT NYS 105",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 107",
    hhaCode: "232853",
    description: "PT NYS 107",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 110",
    hhaCode: "232853",
    description: "PT NYS 110",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 114",
    hhaCode: "232853",
    description: "PT NYS 114",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS 115 45 min",
    hhaCode: "232853",
    description: "PT NYS 115 45 min",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT NYS eval 105",
    hhaCode: "232853",
    description: "PT NYS eval 105",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT School",
    hhaCode: "1276986",
    description: "PT School",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "PT School Group",
    hhaCode: "1337538",
    description: "PT School Group",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SI",
    hhaCode: "57061",
    description: "SI",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SI- ABA 1 West",
    hhaCode: "1346117",
    description: "SI- ABA 1 West",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP CHHA",
    hhaCode: "56330",
    description: "SLP CHHA",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP CHHA SCA 2",
    hhaCode: "56330",
    description: "SLP CHHA SCA 2",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP CIGNA Eval",
    hhaCode: "1403664",
    description: "SLP CIGNA Eval",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP EI",
    hhaCode: "1403664",
    description: "SLP EI",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "SLP EI TELA",
    hhaCode: "1403664",
    description: "SLP EI TELA",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "SLP EI UND",
    hhaCode: "1403664",
    description: "SLP EI UND",
    createIfMissing: false,
    defaultSessionTriage: 'skip',
  },
  {
    providerSoftCode: "SLP HC EVAL",
    hhaCode: "1087120",
    description: "SLP HC EVAL",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP NYS 105",
    hhaCode: "1403664",
    description: "SLP NYS 105",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP NYS 114",
    hhaCode: "1403664",
    description: "SLP NYS 114",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP School",
    hhaCode: "1322092",
    description: "SLP School",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: "SLP School 60",
    hhaCode: "1418465",
    description: "SLP School 60",
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
];

const byName = new Map<string, ServiceCodeMapping>(
  SERVICE_CODE_MAP.map((m) => [m.providerSoftCode.trim().toLowerCase(), m]),
);

export function lookupServiceCode(code: string | undefined): ServiceCodeMapping | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toLowerCase();
  return (
    byName.get(normalized) ??
    SERVICE_CODE_MAP.find(
      (m) =>
        m.providerSoftCode.toUpperCase() === code.trim().toUpperCase() ||
        m.hhaCode === code.trim(),
    )
  );
}

/** Known-unmapped Service Types from prod lookup — rows using these must error until mapped in HHA. */
export const UNMATCHED_SERVICE_TYPES: readonly string[] = [
  "SI TELA",
  "SI UND",
  "SI- ABA 1 Dutchess",
  "SI- ABA 1 NYC",
  "SI- ABA 1 Nassau",
  "SI- ABA 1 Rock",
  "SI- ABA 1 Suffolk",
  "SI- ABA 2 NYC",
  "SI- ABA 2 NYC UND",
  "SI- ABA 2 Suffolk",
  "SI- ABA 3 NYC",
  "SI- ABA 4 NYC",
  "SI-ABA 1 NYC UND"
];

const unmatchedSet = new Set(UNMATCHED_SERVICE_TYPES.map((s) => s.trim().toLowerCase()));

export function isUnmatchedServiceType(serviceType: string | undefined): boolean {
  if (!serviceType?.trim()) return false;
  return unmatchedSet.has(serviceType.trim().toLowerCase());
}

export function isUnknownServiceType(serviceType: string | undefined): boolean {
  if (!serviceType?.trim()) return true;
  return !lookupServiceCode(serviceType);
}
