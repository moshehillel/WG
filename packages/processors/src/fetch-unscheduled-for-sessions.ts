import {
  ensureEntSpaToken,
  fetchAllUnscheduledServices,
  resolveEntCoordinatorIds,
  spaTokenFromEnv,
  type EntGraphqlConfig,
} from '@white-glove/hha-client';
import type { UnscheduledServiceRow, VerifiedSessionRow } from '@white-glove/shared';
import { normalizeVisitDate } from '@white-glove/shared';

export interface UnscheduledFetchResult {
  rows: UnscheduledServiceRow[];
  fromDate: string;
  toDate: string;
  skipped: boolean;
  skipReason?: string;
  /** Cached ENT SPA token used for getUnscheduledServices (reuse for visit create). */
  spaToken?: string;
}

/** ENT auth or GraphQL failure — sessions Lambda should fail, not continue without EVV data. */
export class UnscheduledFetchError extends Error {
  override name = 'UnscheduledFetchError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function failUnscheduled(message: string, cause?: unknown): never {
  const detail = cause instanceof Error ? cause.message : cause ? String(cause) : '';
  const suffix = detail && !message.includes(detail) ? `: ${detail}` : '';
  const hint = /target crashed|devtools|browser/i.test(`${message}${suffix}`)
    ? ''
    : ' Renew HHA MFA on the White Glove dashboard if cookies expired, then re-run.';
  throw new UnscheduledFetchError(`${message}${suffix}.${hint}`.trim(), cause instanceof Error ? { cause } : undefined);
}

function addCalendarDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Align GraphQL window with API Report (7 days) or explicit env / session visit dates. */
export function unscheduledDateRangeForSessions(
  rows: VerifiedSessionRow[],
  env: NodeJS.ProcessEnv = process.env,
): { fromDate: string; toDate: string } {
  if (env.HHA_UNSCHEDULED_FROM_DATE?.trim() && env.HHA_UNSCHEDULED_TO_DATE?.trim()) {
    return {
      fromDate: env.HHA_UNSCHEDULED_FROM_DATE.trim(),
      toDate: env.HHA_UNSCHEDULED_TO_DATE.trim(),
    };
  }

  const visitDates = rows
    .map((r) => normalizeVisitDate(r.visitDate))
    .filter((d): d is string => Boolean(d));

  if (visitDates.length) {
    visitDates.sort();
    return { fromDate: visitDates[0]!, toDate: visitDates[visitDates.length - 1]! };
  }

  const toDate = new Date().toISOString().slice(0, 10);
  return { fromDate: addCalendarDays(toDate, -7), toDate };
}

export async function fetchUnscheduledForSessions(
  sessionRows: VerifiedSessionRow[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<UnscheduledFetchResult> {
  const { fromDate, toDate } = unscheduledDateRangeForSessions(sessionRows, env);

  if (env.HHA_USE_MOCK === 'true' || env.HHA_ENT_GRAPHQL_ENABLED === 'false') {
    return {
      rows: [],
      fromDate,
      toDate,
      skipped: true,
      skipReason: 'HHA ENT GraphQL disabled or mock mode',
    };
  }

  let token: string;
  try {
    token = spaTokenFromEnv(env) ?? (await ensureEntSpaToken(env));
  } catch (err) {
    failUnscheduled('HHA ENT login or SPA token capture failed', err);
  }
  const spaToken = token;

  const config: EntGraphqlConfig = {
    coordinatorId: await resolveEntCoordinatorIds(token, env),
    userId: env.HHA_ENT_USER_ID ? Number(env.HHA_ENT_USER_ID) : undefined,
    providerId: env.HHA_ENT_PROVIDER_ID ? Number(env.HHA_ENT_PROVIDER_ID) : undefined,
    officeIds: env.HHA_ENT_OFFICE_IDS,
  };

  const result = await fetchAllUnscheduledServices(token, {
    fromDate,
    toDate,
    pageSize: Number(env.HHA_PAGE_SIZE ?? 100),
    config,
  });

  if (result.status !== 200 || result.errors) {
    failUnscheduled(
      `HHA getUnscheduledServices failed (HTTP ${result.status})`,
      result.errors ? JSON.stringify(result.errors) : undefined,
    );
  }

  return { rows: result.rows, fromDate, toDate, skipped: false, spaToken };
}
