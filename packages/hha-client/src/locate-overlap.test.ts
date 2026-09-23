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

const visit = {
  patientId: '24745304',
  visitDate: '2026-09-17',
  startTime: '9:00 am',
  endTime: '9:30 am',
  contractId: '186219',
  serviceCodeId: '313583',
  caregiverId: '81103',
  scheduleType: 'Skilled' as const,
};

describe('locateOrScheduleVisit overlap -310', () => {
  it('links the VisitID the other send just created instead of storing a blank failure', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      bodies.push(body);
      const method = body.match(/<([A-Za-z0-9]+) xmlns=/)?.[1] || '';
      if (method === 'SearchVisits') {
        const prior = bodies.filter((b) => b.includes('<SearchVisits ')).length;
        if (prior < 2) {
          return new Response(envelope('SearchVisits', '<Status>Success</Status><ErrorID>0</ErrorID>'), {
            status: 200,
          });
        }
        return new Response(
          envelope(
            'SearchVisits',
            '<Status>Success</Status><ErrorID>0</ErrorID><VisitID>1337400693</VisitID>',
          ),
          { status: 200 },
        );
      }
      if (method === 'CreateSchedule') {
        return new Response(
          envelope(
            'CreateSchedule',
            '<Status>Failed</Status><ErrorID>-310</ErrorID><ErrorMessage>Your shift is overlapping with Patient: [WGC-1/Maeve] Overlapping shifts are not allowed.</ErrorMessage>',
          ),
          { status: 200 },
        );
      }
      if (method === 'GetVisitInfoV2') {
        return new Response(
          envelope(
            'GetVisitInfoV2',
            '<Status>Success</Status><ErrorID>0</ErrorID><VisitID>1337400693</VisitID><ScheduleStartTime>2026-09-17 09:00</ScheduleStartTime><ScheduleEndTime>2026-09-17 09:30</ScheduleEndTime>',
          ),
          { status: 200 },
        );
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
    const result = await client.locateOrScheduleVisit(visit);
    expect(result).toEqual({ id: '1337400693', created: false });
    expect(bodies.filter((b) => b.includes('<CreateSchedule ')).length).toBe(1);
  });

  it('still throws a non-overlap -310 and does not invent a VisitID', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      const method = body.match(/<([A-Za-z0-9]+) xmlns=/)?.[1] || '';
      if (method === 'CreateSchedule') {
        return new Response(
          envelope(
            'CreateSchedule',
            '<Status>Failed</Status><ErrorID>-310</ErrorID><ErrorMessage>Caregiver cannot be scheduled for PT visit.</ErrorMessage>',
          ),
          { status: 200 },
        );
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
    await expect(client.locateOrScheduleVisit(visit)).rejects.toThrow(/cannot be scheduled for PT visit/);
  });
});
