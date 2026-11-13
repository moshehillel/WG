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
    throw new Error('HHA MFA required — stored hhamfa cookies did not skip MFA');
  }),
  fetchAllUnscheduledServices: vi.fn(),
  mfaStatusFromEnv: (env: NodeJS.ProcessEnv = {}) => {
    const renewedAt = env.HHA_ENT_HHAMFA_RENEWED_AT?.trim() || null;
    if (!renewedAt) {
      return {
        renewedAt: null,
        expiresAt: null,
        daysRemaining: null,
        needsReminder: true,
        cookieCount: 0,
      };
    }
    const renewed = new Date(renewedAt);
    const expires = new Date(renewed);
    expires.setUTCDate(expires.getUTCDate() + 30);
    const daysRemaining = Math.max(
      0,
      Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    return {
      renewedAt: renewed.toISOString(),
      expiresAt: expires.toISOString(),
      daysRemaining,
      needsReminder: daysRemaining <= 2,
      cookieCount: 1,
    };
  },
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

  it('keeps the 30-day MFA window open out of the cookies-expired hint', async () => {
    await expect(
      fetchUnscheduledForSessions([], {
        HHA_ENT_GRAPHQL_ENABLED: 'true',
        HHA_USE_MOCK: 'false',
        HHA_ENT_HHAMFA_RENEWED_AT: new Date().toISOString(),
      }),
    ).rejects.toThrow(/30-day HHA MFA window is still open/);
    await expect(
      fetchUnscheduledForSessions([], {
        HHA_ENT_GRAPHQL_ENABLED: 'true',
        HHA_USE_MOCK: 'false',
        HHA_ENT_HHAMFA_RENEWED_AT: new Date().toISOString(),
      }),
    ).rejects.not.toThrow(/cookies expired/);
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
