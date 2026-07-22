import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseChildName,
  parseClosedCases,
  parseDischargeService,
  parseOpenedCases,
  parseVerifiedSessions,
} from './parse-reports.js';

const samplesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/samples',
);

describe('parseChildName', () => {
  it('splits Gluck Last First format', () => {
    expect(parseChildName('Aboagye Zachary')).toEqual({
      lastName: 'Aboagye',
      firstName: 'Zachary',
    });
  });
});

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

  it('maps Gluck open.csv headers', () => {
    const csv = readFileSync(path.join(samplesDir, 'gluck-open.csv'), 'utf8');
    const rows = parseOpenedCases(csv);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      caseId: '1012074',
      firstName: 'Zachary',
      lastName: 'Aboagye',
      serviceCode: 'SI',
      isEarlyIntervention: true,
    });
  });
});

describe('parseClosedCases', () => {
  it('parses closed cases', () => {
    const csv = 'case_id,status,closed_date\nC9,Closed,2026-07-01\n';
    const rows = parseClosedCases(csv);
    expect(rows[0]).toMatchObject({ caseId: 'C9', status: 'Closed' });
  });

  it('maps Gluck closure.csv', () => {
    const csv = readFileSync(path.join(samplesDir, 'gluck-closure.csv'), 'utf8');
    const rows = parseClosedCases(csv);
    expect(rows[0]).toMatchObject({
      caseId: '917976',
      lastName: 'Landolfi',
      firstName: 'Gianna',
      closedDate: '07/15/2026',
    });
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

  it('maps API Report headers', () => {
    const csv = readFileSync(path.join(samplesDir, 'api-report.csv'), 'utf8');
    const rows = parseVerifiedSessions(csv);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].caseId).toBeTruthy();
    expect(rows[0].visitDate).toMatch(/\d/);
    expect(rows[0].serviceCode).toBeTruthy();
  });
});

describe('parseDischargeService', () => {
  it('maps discharge service.csv', () => {
    const csv = readFileSync(path.join(samplesDir, 'discharge-service.csv'), 'utf8');
    const rows = parseDischargeService(csv);
    expect(rows[0]).toMatchObject({
      caseId: '1068547',
      serviceCode: 'SI',
      dischargeDate: '07/14/2026',
    });
  });
});
