import { describe, expect, it, vi } from 'vitest';
import { SoapHhaClientAdapter } from './soap-adapter.js';

function soapOk(innerXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SearchCaregiversResponse xmlns="https://www.hhaexchange.com/apis/hhaws.integration">
      <SearchCaregiversResult>
        <Status>Success</Status>
        <ErrorID>0</ErrorID>
        ${innerXml}
      </SearchCaregiversResult>
    </SearchCaregiversResponse>
  </soap:Body>
</soap:Envelope>`;
}

describe('resolveCaregiverId inactive caregivers', () => {
  it('searches Status=All and matches inactive caregivers by name', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      bodies.push(body);
      expect(body).toContain('<Status>All</Status>');
      expect(body).not.toContain('<Status>Active</Status>');
      return new Response(
        soapOk(`
          <Caregivers>
            <CaregiverInfo>
              <CaregiverID>99123</CaregiverID>
              <FirstName>MAYA</FirstName>
              <LastName>JOHNSON</LastName>
              <Status>Inactive</Status>
            </CaregiverInfo>
          </Caregivers>`),
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      );
    }) as unknown as typeof fetch;

    const client = new SoapHhaClientAdapter({
      baseUrl: 'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx',
      auth: { appName: 't', appSecret: 't', appKey: 't' },
      fetchImpl,
    });

    await expect(client.resolveCaregiverId('JOHNSON MAYA')).resolves.toBe('99123');
    expect(bodies.length).toBeGreaterThan(0);
  });

  it('defaults SearchCaregivers status to All when omitted', async () => {
    let captured = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = String(init?.body ?? '');
      return new Response(soapOk('<Caregivers></Caregivers>'), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }) as unknown as typeof fetch;

    const client = new SoapHhaClientAdapter({
      baseUrl: 'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx',
      auth: { appName: 't', appSecret: 't', appKey: 't' },
      fetchImpl,
    });

    await client.getSoap().searchCaregivers({ firstName: 'A', lastName: 'B' });
    expect(captured).toContain('<Status>All</Status>');
  });
});
