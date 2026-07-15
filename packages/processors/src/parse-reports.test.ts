import { describe, expect, it } from 'vitest';
import { parseClosedCases, parseOpenedCases, parseVerifiedSessions } from './parse-reports.js';

describe('parseOpenedCases', () => {
  it('maps flexible headers and detects EI', () => {
    const csv = [
      'Case ID,First Name,Last Name,Program Type,Service Code',
      'C1,Ann,Bee,Early Intervention,HHA001',
      'C2,Cal,Dee,Home Health,PCA001',
    ].join('\n');
    const rows = parseOpenedCases(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].isEarlyIntervention).toBe(true);
    expect(rows[1].serviceCode).toBe('PCA001');
  });
});

describe('parseClosedCases', () => {
  it('parses closed cases', () => {
    const csv = 'case_id,status,closed_date\nC9,Closed,2026-07-01\n';
    const rows = parseClosedCases(csv);
    expect(rows[0]).toMatchObject({ caseId: 'C9', status: 'Closed' });
  });
});

describe('parseVerifiedSessions', () => {
  it('parses sessions', () => {
    const csv =
      'session_id,patient_id,service_code,visit_date,start_time,end_time\ns1,p1,PCA001,2026-07-14,09:00,10:00\n';
    const rows = parseVerifiedSessions(csv);
    expect(rows[0].sessionId).toBe('s1');
    expect(rows[0].startTime).toBe('09:00');
  });
});
