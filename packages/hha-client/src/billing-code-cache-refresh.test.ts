import { describe, expect, it, vi } from 'vitest';
import { SoapHhaClientAdapter } from './soap-adapter.js';

function envelope(method: string, inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method}Response xmlns="https://www.hhaexchange.com/apis/hhaws.integration">
      <${method}Result>
        ${inner}
      </${method}Result>
    </${method}Response>
  </soap:Body>
</soap:Envelope>`;
}

function billingXml(rows: Array<{ id: string; name: string }>): string {
  const blocks = rows
    .map(
      (row) => `<ServiceCode>
        <ServiceCodeID>${row.id}</ServiceCodeID>
        <ServiceCodeName>${row.name}</ServiceCodeName>
        <ContractID>186219</ContractID>
      </ServiceCode>`,
    )
    .join('');
  return envelope(
    'GetBillingServiceCodes',
    `<Status>Success</Status><ErrorID>0</ErrorID>${blocks}`,
  );
}

const ELMONT = 'Elmont UFSD Therapy';
const CONTRACT = 186219;

function clientWithCatalog(catalog: () => Array<{ id: string; name: string }>) {
  let billingCalls = 0;
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    const method = body.match(/<([A-Za-z0-9]+) xmlns=/)?.[1] || '';
    if (method === 'GetBillingServiceCodes') {
      billingCalls += 1;
      return new Response(billingXml(catalog()), { status: 200 });
    }
    return new Response(envelope(method || 'Unknown', '<Status>Success</Status><ErrorID>0</ErrorID>'), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  const client = new SoapHhaClientAdapter({
    baseUrl: 'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx',
    auth: { appName: 't', appSecret: 't', appKey: 't' },
    fetchImpl,
  });
  return {
    client,
    billingCalls: () => billingCalls,
  };
}

describe('contract billing code cache refresh', () => {
  it('does not call HHA twice when the first live list already lacks the code', async () => {
    const { client, billingCalls } = clientWithCatalog(() => [
      { id: '1', name: 'PT School' },
    ]);
    await expect(client.resolveServiceCodeId('PT School eval', CONTRACT, ELMONT)).resolves.toBeUndefined();
    // Skilled + Non-Skilled. No second refresh — this read was already live.
    expect(billingCalls()).toBe(2);
  });

  it('refreshes a warm snapshot once and matches capitalization differences', async () => {
    let published = false;
    const { client, billingCalls } = clientWithCatalog(() => {
      const rows = [{ id: '1', name: 'PT School' }];
      if (published) {
        rows.push(
          { id: '2', name: 'PT School Eval' },
          { id: '3', name: 'PT Additional Services 60' },
        );
      }
      return rows;
    });

    await expect(client.resolveServiceCodeId('PT School', CONTRACT, ELMONT)).resolves.toBe('1');
    expect(billingCalls()).toBe(2);

    published = true;
    await expect(client.resolveServiceCodeId('PT School eval', CONTRACT, ELMONT)).resolves.toBe('2');
    expect(billingCalls()).toBe(4);

    await expect(
      client.resolveServiceCodeId('PT additional services 60', CONTRACT, ELMONT),
    ).resolves.toBe('3');
    expect(billingCalls()).toBe(4);
  });

  it('asks HHA again on the next send when the refresh still lacks the new code', async () => {
    let published = false;
    const { client, billingCalls } = clientWithCatalog(() => {
      const rows = [{ id: '1', name: 'PT School' }];
      if (published) rows.push({ id: '2', name: 'PT School Eval' });
      return rows;
    });

    await expect(client.resolveServiceCodeId('PT School', CONTRACT, ELMONT)).resolves.toBe('1');
    await expect(client.resolveServiceCodeId('PT School eval', CONTRACT, ELMONT)).resolves.toBeUndefined();
    expect(billingCalls()).toBe(4);

    published = true;
    await expect(client.resolveServiceCodeId('PT School eval', CONTRACT, ELMONT)).resolves.toBe('2');
    expect(billingCalls()).toBe(6);
  });
});
