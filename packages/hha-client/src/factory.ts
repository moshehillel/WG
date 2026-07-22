import { getEnv, type Env } from '@white-glove/shared';
import { HttpHhaClient } from './http-client.js';
import { MockHhaClient } from './mock-client.js';
import { SoapHhaClientAdapter } from './soap-adapter.js';
import type { HhaClient } from './types.js';

export function createHhaClient(env: Env = getEnv()): HhaClient {
  const useMock = env.HHA_USE_MOCK !== false;
  if (useMock) {
    return new MockHhaClient();
  }

  const appName = process.env.HHA_APP_NAME;
  const appSecret = process.env.HHA_APP_SECRET;
  const appKey = process.env.HHA_APP_KEY;
  const baseUrl = env.HHA_BASE_URL;

  if (baseUrl && appName && appSecret && appKey) {
    const allowReasonLookup =
      process.env.HHA_ALLOW_REASON_LOOKUP === 'true' ||
      process.env.HHA_ALLOW_REASON_LOOKUP === '1';
    const reasonLookupBaseUrl =
      process.env.HHA_REASON_LOOKUP_URL ??
      (allowReasonLookup
        ? 'https://app.hhaexchange.com/Integration/ENT/V1.8/ws.asmx'
        : undefined);
    const reasonLookupVisitId = process.env.HHA_REASON_LOOKUP_VISIT_ID
      ? Number(process.env.HHA_REASON_LOOKUP_VISIT_ID)
      : undefined;

    return new SoapHhaClientAdapter({
      baseUrl,
      auth: { appName, appSecret, appKey },
      defaultOfficeId: process.env.HHA_OFFICE_ID ? Number(process.env.HHA_OFFICE_ID) : undefined,
      reasonLookupBaseUrl,
      reasonLookupVisitId,
    });
  }

  if (baseUrl && env.HHA_API_KEY) {
    return new HttpHhaClient({ baseUrl, apiKey: env.HHA_API_KEY });
  }

  return new MockHhaClient();
}
