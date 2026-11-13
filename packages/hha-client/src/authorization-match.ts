import { psDateToIso } from './hha-time.js';
import { xmlFirstTag } from './hha-xml-parse.js';

/**
 * ProviderSoft often puts Authorization *status* in the Authorization Number
 * column (e.g. "approved"). Those are not unique keys — matching only on them
 * reuses an old From/To window instead of creating the new period.
 */
const NON_UNIQUE_AUTHORIZATION_NUMBER_TOKENS = new Set([
  'approved',
  'pending',
  'denied',
  'rejected',
  'active',
  'inactive',
  'expired',
  'cancelled',
  'canceled',
  'suspended',
  'draft',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
]);

/** True when the value is blank or a non-unique status/token word — not a real auth id. */
export function isNonUniqueAuthorizationNumber(authorizationNumber: string | undefined): boolean {
  const want = authorizationNumber?.trim().toLowerCase() ?? '';
  if (!want) return true;
  return NON_UNIQUE_AUTHORIZATION_NUMBER_TOKENS.has(want);
}

/** True when the number is safe to use as an idempotent unique AuthorizationNumber key. */
export function isUniqueAuthorizationNumber(authorizationNumber: string | undefined): boolean {
  return !isNonUniqueAuthorizationNumber(authorizationNumber);
}

export type ParsedPatientAuthorization = {
  authId: string;
  number: string;
  contractId?: string;
  serviceCodeId?: string;
  fromDate?: string;
  toDate?: string;
};

/** Normalize HHA / PS dates to YYYY-MM-DD for equality checks. */
export function normalizeAuthorizationDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return psDateToIso(value.trim()) ?? value.trim().slice(0, 10);
}

export function parsePatientAuthorizationBlocks(xml: string): ParsedPatientAuthorization[] {
  const blocks = [
    ...(xml.match(/<Authorization>[\s\S]*?<\/Authorization>/gi) ?? []),
    ...(xml.match(/<AuthorizationInfo>[\s\S]*?<\/AuthorizationInfo>/gi) ?? []),
    ...(xml.match(/<PatientAuthorization>[\s\S]*?<\/PatientAuthorization>/gi) ?? []),
  ];
  const out: ParsedPatientAuthorization[] = [];
  for (const block of blocks) {
    const authId =
      xmlFirstTag(block, 'AuthorizationID') ?? xmlFirstTag(block, 'ID') ?? '';
    if (!authId) continue;
    const number = (
      xmlFirstTag(block, 'AuthorizationNumber') ??
      xmlFirstTag(block, 'AuthNumber') ??
      ''
    ).trim();
    const contractId =
      xmlFirstTag(block, 'ContractID') ??
      block.match(/<Contract>\s*<ID>(\d+)/i)?.[1];
    const serviceCodeId =
      xmlFirstTag(block, 'ServiceCodeID') ??
      block.match(/<ServiceCode>\s*<ID>(\d+)/i)?.[1];
    const fromDate = normalizeAuthorizationDate(
      xmlFirstTag(block, 'FromDate') ?? xmlFirstTag(block, 'StartDate'),
    );
    const toDate = normalizeAuthorizationDate(
      xmlFirstTag(block, 'ToDate') ??
        xmlFirstTag(block, 'StopDate') ??
        xmlFirstTag(block, 'EndDate'),
    );
    out.push({
      authId,
      number,
      ...(contractId ? { contractId: String(contractId) } : {}),
      ...(serviceCodeId ? { serviceCodeId: String(serviceCodeId) } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    });
  }
  return out;
}

export type FindMatchingAuthorizationOptions = {
  authorizationNumber: string;
  contractId?: string;
  serviceCodeId?: string;
  fromDate?: string;
  toDate?: string;
};

/**
 * Prefer a true unique AuthorizationNumber match.
 * For status tokens ("approved", blank, …), only reuse when contract (+ service
 * when present) and From/To dates match the period being written.
 */
export function findMatchingAuthorizationId(
  auths: ParsedPatientAuthorization[],
  options: FindMatchingAuthorizationOptions,
): string | undefined {
  const wantNumber = options.authorizationNumber.trim().toLowerCase();
  const wantFrom = normalizeAuthorizationDate(options.fromDate);
  const wantTo = normalizeAuthorizationDate(options.toDate);
  const wantContract = options.contractId ? String(options.contractId) : undefined;
  const wantService = options.serviceCodeId ? String(options.serviceCodeId) : undefined;

  if (isUniqueAuthorizationNumber(options.authorizationNumber)) {
    for (const auth of auths) {
      if (auth.number.trim().toLowerCase() !== wantNumber) continue;
      if (wantContract && auth.contractId && auth.contractId !== wantContract) continue;
      return auth.authId;
    }
    return undefined;
  }

  // Non-unique / status token: require a period match (and contract/service when known).
  if (!wantFrom || !wantTo) return undefined;
  for (const auth of auths) {
    if (wantContract && auth.contractId && auth.contractId !== wantContract) continue;
    if (wantService && auth.serviceCodeId && auth.serviceCodeId !== wantService) continue;
    if (auth.fromDate !== wantFrom || auth.toDate !== wantTo) continue;
    return auth.authId;
  }
  return undefined;
}
