import { describe, expect, it, vi } from 'vitest';
import {
  fetchUnscheduledForSessions,
  unscheduledDateRangeForSessions,
  UnscheduledFetchError,
} from './fetch-unscheduled-for-sessions.js';
import type { VerifiedSessionRow } from '@white-glove/shared';

vi.mock('@white-glove/hha-client', () => ({
  spaTokenFromEnv: vi.fn(() => undefined),
  ensureEntSpaToken: vi.fn(async () => {
    throw new Error('MFA cookies expired');
  }),
  fetchAllUnscheduledServices: vi.fn(),
}));

describe('fetchUnscheduledForSessions', () => {
  it('throws when ENT auth fails instead of skipping', async () => {
    await expect(
      fetchUnscheduledForSessions([], {
        HHA_ENT_GRAPHQL_ENABLED: 'true',
        HHA_USE_MOCK: 'false',
      }),
    ).rejects.toBeInstanceOf(UnscheduledFetchError);
  });
});

describe('unscheduledDateRangeForSessions', () => {
  it('uses explicit env dates when set', () => {
    const range = unscheduledDateRangeForSessions([], {
      HHA_UNSCHEDULED_FROM_DATE: '2026-07-24',
      HHA_UNSCHEDULED_TO_DATE: '2026-08-04',
    });
    expect(range).toEqual({ fromDate: '2026-07-24', toDate: '2026-08-04' });
  });

  it('uses min/max visit dates from session rows', () => {
    const rows = [
      { sessionId: 'a', visitDate: '2026-08-01' },
      { sessionId: 'b', visitDate: '07/28/2026' },
    ] as VerifiedSessionRow[];
    const range = unscheduledDateRangeForSessions(rows, {});
    expect(range).toEqual({ fromDate: '2026-07-28', toDate: '2026-08-01' });
  });
});
