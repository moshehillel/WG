import { describe, expect, it } from 'vitest';
import { assertLiveDownloadNeverStubs } from './handler.js';
import { assertStubZipNeverServesLive } from './stub-handler.js';

describe('live stub guards', () => {
  it('Docker handler throws when stubs would run', () => {
    expect(() => assertLiveDownloadNeverStubs(true, 'test')).toThrow(/refused stubs/i);
    expect(() => assertLiveDownloadNeverStubs(false, 'test')).not.toThrow();
  });

  it('stub zip throws on live dryRun=false path', () => {
    const prev = process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS;
    delete process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS;
    try {
      expect(() => assertStubZipNeverServesLive({ dryRun: false })).toThrow(/refused a live path/i);
      expect(() => assertStubZipNeverServesLive({})).toThrow(/refused a live path/i);
      expect(() => assertStubZipNeverServesLive({ dryRun: true })).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS;
      else process.env.PROVIDERSOFT_ALLOW_LIVE_PATH_STUBS = prev;
    }
  });
});
