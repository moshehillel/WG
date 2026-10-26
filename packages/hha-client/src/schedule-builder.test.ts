import { describe, expect, it } from 'vitest';
import { buildCreateScheduleBody, inferCreateScheduleType } from './schedule-builder.js';

const base = {
  patientId: '123',
  contractId: '456',
  serviceCodeId: '789',
  caregiverId: '1011',
  startTime: '9:00 AM',
  endTime: '9:30 AM',
};

describe('inferCreateScheduleType', () => {
  it('uses Skilled for therapy disciplines (OT/PT/ST/SLP)', () => {
    expect(inferCreateScheduleType('OT HC Eval')).toBe('Skilled');
    expect(inferCreateScheduleType('PT CHHA')).toBe('Skilled');
    expect(inferCreateScheduleType('SLP CHHA')).toBe('Skilled');
    expect(inferCreateScheduleType('ST')).toBe('Skilled');
  });

  it('uses Skilled for school therapy billing names (PT/OT school 30)', () => {
    expect(inferCreateScheduleType('PT school 30')).toBe('Skilled');
    expect(inferCreateScheduleType('OT school group 30')).toBe('Skilled');
    expect(inferCreateScheduleType('ST school 42')).toBe('Skilled');
  });

  it('uses Skilled for HHA long therapy names', () => {
    expect(inferCreateScheduleType('Physical Therapy')).toBe('Skilled');
    expect(inferCreateScheduleType('Occupational Therapy')).toBe('Skilled');
    expect(inferCreateScheduleType('Speech Therapy')).toBe('Skilled');
  });

  it('uses Non-Skilled for aide / unknown codes', () => {
    expect(inferCreateScheduleType('PCA Hourly')).toBe('Non-Skilled');
    expect(inferCreateScheduleType('HHA')).toBe('Non-Skilled');
    expect(inferCreateScheduleType(undefined)).toBe('Non-Skilled');
  });
});

describe('buildCreateScheduleBody', () => {
  it('converts MM/DD/YYYY VisitDate to YYYY-MM-DD for AllXsd', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '09/04/2026',
    });
    expect(xml).toContain('<VisitDate>2026-09-04</VisitDate>');
    expect(xml).not.toContain('09/04/2026');
  });

  it('converts MM/DD/YY VisitDate to YYYY-MM-DD for AllXsd', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '09/16/26',
    });
    expect(xml).toContain('<VisitDate>2026-09-16</VisitDate>');
    expect(xml).not.toContain('09/16/26');
  });

  it('keeps ISO VisitDate unchanged', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
    });
    expect(xml).toContain('<VisitDate>2026-09-04</VisitDate>');
  });

  it('defaults OT service types to ScheduleType Skilled', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
      serviceCode: 'OT HC Eval',
    });
    expect(xml).toContain('<ScheduleType>Skilled</ScheduleType>');
  });

  it('defaults PCA service types to ScheduleType Non-Skilled', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
      serviceCode: 'PCA Hourly',
    });
    expect(xml).toContain('<ScheduleType>Non-Skilled</ScheduleType>');
  });

  it('honors explicit scheduleType override', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
      serviceCode: 'OT HC Eval',
      scheduleType: 'Non-Skilled',
    });
    expect(xml).toContain('<ScheduleType>Non-Skilled</ScheduleType>');
  });

  it('includes AuthorizationID on PrimaryBillTo when set', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
      authorizationId: '998877',
    });
    expect(xml).toContain('<AuthorizationID>998877</AuthorizationID>');
    expect(xml).toMatch(/<PrimaryBillTo>[\s\S]*<AuthorizationID>998877<\/AuthorizationID>[\s\S]*<\/PrimaryBillTo>/);
  });

  it('splits a 60-minute visit into Hours 1 and Minutes 0', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-22',
      startTime: '2:30 PM',
      endTime: '3:30 PM',
      durationMinutes: 60,
      serviceCode: 'PT additional services 60',
    });
    expect(xml).toContain('<Hours>1</Hours>');
    expect(xml).toContain('<Minutes>0</Minutes>');
    expect(xml).toContain('<ScheduleStartTime>1430</ScheduleStartTime>');
    expect(xml).toContain('<ScheduleEndTime>1530</ScheduleEndTime>');
  });

  it('keeps a 30-minute visit as Hours 0 and Minutes 30', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-22',
      durationMinutes: 30,
    });
    expect(xml).toContain('<Hours>0</Hours>');
    expect(xml).toContain('<Minutes>30</Minutes>');
  });

  it('omits AuthorizationID when unset', () => {
    const xml = buildCreateScheduleBody({
      ...base,
      visitDate: '2026-09-04',
    });
    expect(xml).not.toContain('AuthorizationID');
  });
});
