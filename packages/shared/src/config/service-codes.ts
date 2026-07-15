/**
 * Placeholder service-code map until the client provides the catalog.
 * Maps ProviderSoft codes → HHA codes / triage defaults for sessions.
 */
export interface ServiceCodeMapping {
  providerSoftCode: string;
  hhaCode: string;
  description: string;
  /** If true, automation may create the code in HHA when missing (once API supports it). */
  createIfMissing: boolean;
  /** Default session triage when this code is present. */
  defaultSessionTriage: 'auto_approve' | 'verify_clocking' | 'skip';
}

export const SERVICE_CODE_MAP: ServiceCodeMapping[] = [
  // Examples — replace with real codes from client
  {
    providerSoftCode: 'HHA001',
    hhaCode: 'HHA001',
    description: 'Placeholder skilled nursing',
    createIfMissing: false,
    defaultSessionTriage: 'verify_clocking',
  },
  {
    providerSoftCode: 'PCA001',
    hhaCode: 'PCA001',
    description: 'Placeholder personal care',
    createIfMissing: false,
    defaultSessionTriage: 'auto_approve',
  },
];

export function lookupServiceCode(code: string | undefined): ServiceCodeMapping | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  return SERVICE_CODE_MAP.find(
    (m) => m.providerSoftCode.toUpperCase() === normalized || m.hhaCode.toUpperCase() === normalized,
  );
}
