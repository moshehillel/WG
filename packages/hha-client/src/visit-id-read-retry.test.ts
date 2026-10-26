import { describe, expect, it } from 'vitest';
import { readVisitUntilReady, VISIT_ID_READ_RETRY_MS } from './soap-adapter.js';
import type { SoapCallResult } from './soap-client.js';

function result(partial: Partial<SoapCallResult>): SoapCallResult {
  return {
    ok: false,
    status: 'Failed',
    errorId: '-415',
    errorMessage: 'Invalid VisitID',
    raw: null,
    bodyXml: '',
    ...partial,
  };
}

describe('readVisitUntilReady', () => {
  it('spaces -415 reads by 5s, 10s, and 15s instead of a few seconds', () => {
    expect([...VISIT_ID_READ_RETRY_MS]).toEqual([5_000, 10_000, 15_000]);
    expect(VISIT_ID_READ_RETRY_MS.every((ms) => ms >= 5_000)).toBe(true);
  });

  it('waits the full gap before each extra read, then stops once the visit is readable', async () => {
    const reads: SoapCallResult[] = [
      result({}),
      result({}),
      result({ ok: true, status: 'Success', errorId: '0', bodyXml: '<VisitID>1</VisitID>' }),
    ];
    const waits: number[] = [];
    let calls = 0;
    const info = await readVisitUntilReady(
      async () => {
        calls += 1;
        return reads[calls - 1] ?? result({});
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([5_000, 10_000]);
    expect(info.ok).toBe(true);
  });

  it('does not wait when the first read succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    const info = await readVisitUntilReady(
      async () => {
        calls += 1;
        return result({ ok: true, status: 'Success', errorId: '0' });
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
    expect(info.ok).toBe(true);
  });
});
