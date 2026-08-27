import { describe, expect, it } from 'vitest';
import {
  applyGroupServiceRemap,
  isGroupServiceType,
  remapGroupServiceType,
  roundMinutesToNearest15,
  stripGroupFromServiceType,
} from './remap-group-service.js';

function remap(
  serviceType: string,
  durationMinutes: number,
  payRate: string | number,
): string | undefined {
  return remapGroupServiceType({ serviceType, durationMinutes, payRate }).serviceType;
}

function remapped(
  serviceType: string,
  durationMinutes: number,
  payRate: string | number,
): boolean {
  return remapGroupServiceType({ serviceType, durationMinutes, payRate }).remapped;
}

describe('roundMinutesToNearest15', () => {
  it('maps typical nearest-15 ranges and half-up midpoints', () => {
    expect(roundMinutesToNearest15(15)).toBe(15);
    expect(roundMinutesToNearest15(30)).toBe(30);
    expect(roundMinutesToNearest15(40)).toBe(45);
    expect(roundMinutesToNearest15(45)).toBe(45);
    expect(roundMinutesToNearest15(60)).toBe(60);

    expect(roundMinutesToNearest15(8)).toBe(15);
    expect(roundMinutesToNearest15(22)).toBe(15);
    expect(roundMinutesToNearest15(20)).toBe(15);
    expect(roundMinutesToNearest15(23)).toBe(30);
    expect(roundMinutesToNearest15(25)).toBe(30);
    expect(roundMinutesToNearest15(35)).toBe(30);
    expect(roundMinutesToNearest15(37)).toBe(30);
    expect(roundMinutesToNearest15(38)).toBe(45);
    expect(roundMinutesToNearest15(50)).toBe(45);
    expect(roundMinutesToNearest15(52)).toBe(45);
    expect(roundMinutesToNearest15(53)).toBe(60);
    expect(roundMinutesToNearest15(67)).toBe(60);

    expect(roundMinutesToNearest15(7.5)).toBe(15);
    expect(roundMinutesToNearest15(22.5)).toBe(30);
    expect(roundMinutesToNearest15(37.5)).toBe(45);
    expect(roundMinutesToNearest15(52.5)).toBe(60);
  });

  it('leaves 0 and 75+ outside the 15/30/45/60 buckets', () => {
    expect(roundMinutesToNearest15(0)).toBe(0);
    expect(roundMinutesToNearest15(7)).toBe(0);
    expect(roundMinutesToNearest15(68)).toBe(75);
    expect(roundMinutesToNearest15(75)).toBe(75);
  });
});

describe('stripGroupFromServiceType', () => {
  it('strips Group and collapses spaces for PT / OT / ST school groups', () => {
    expect(stripGroupFromServiceType('PT School Group')).toBe('PT School');
    expect(stripGroupFromServiceType('OT School Group')).toBe('OT School');
    expect(stripGroupFromServiceType('ST School Group')).toBe('ST School');
    expect(stripGroupFromServiceType('OT school Group')).toBe('OT school');
    expect(stripGroupFromServiceType('PT School  Group')).toBe('PT School');
    expect(stripGroupFromServiceType('PT School group')).toBe('PT School');
    expect(stripGroupFromServiceType('PT SCHOOL GROUP')).toBe('PT SCHOOL');
  });
});

describe('remapGroupServiceType', () => {
  it('remaps 15 min at inclusive $11', () => {
    expect(remap('PT School Group', 15, 11)).toBe('PT School');
    expect(remapped('PT School Group', 15, 11)).toBe(true);
    expect(remap('PT School Group', 15, '11.0000')).toBe('PT School');
  });

  it('keeps group at 15 min when pay rate is $10.99', () => {
    expect(remap('PT School Group', 15, 10.99)).toBe('PT School Group');
    expect(remapped('PT School Group', 15, 10.99)).toBe(false);
  });

  it('remaps 30 min at inclusive $45', () => {
    expect(remap('PT School Group', 30, 45)).toBe('PT School');
  });

  it('remaps 40 min at $55 (40 rounds to 45)', () => {
    expect(roundMinutesToNearest15(40)).toBe(45);
    expect(remap('PT School Group', 40, 55)).toBe('PT School');
  });

  it('remaps 45 min at inclusive $55', () => {
    expect(remap('PT School Group', 45, 55)).toBe('PT School');
  });

  it('remaps 60 min at inclusive $60', () => {
    expect(remap('PT School Group', 60, 60)).toBe('PT School');
  });

  it('rounds 20 min to 15 and remaps at $11+', () => {
    expect(roundMinutesToNearest15(20)).toBe(15);
    expect(remap('PT School Group', 20, 11)).toBe('PT School');
  });

  it('leaves already-individual Service Type unchanged', () => {
    expect(isGroupServiceType('PT School')).toBe(false);
    expect(remap('PT School', 30, 70)).toBe('PT School');
    expect(remapped('PT School', 60, 90)).toBe(false);
    expect(remap('OT School', 45, 55)).toBe('OT School');
    expect(remap('ST School', 15, 11)).toBe('ST School');
  });

  it('strips Group from PT / OT / ST school types when threshold is met', () => {
    expect(remap('PT School Group', 30, 45)).toBe('PT School');
    expect(remap('OT School Group', 30, 45)).toBe('OT School');
    expect(remap('ST School Group', 30, 45)).toBe('ST School');
    expect(remap('OT school Group', 30, 45)).toBe('OT school');
  });

  it('treats PT SCHOOL GROUP as PT School regardless of case', () => {
    const result = remapGroupServiceType({
      serviceType: 'PT SCHOOL GROUP',
      durationMinutes: 30,
      payRate: 45,
    });
    expect(result.remapped).toBe(true);
    expect(result.serviceType?.toLowerCase()).toBe('pt school');
    expect(result.serviceType).toBe('PT School');
    expect(remap('PT SCHOOL GROUP', 15, 11)).toBe('PT School');
    expect(remap('pt school group', 60, 60)).toBe('PT School');
  });

  it('ignores group-of-3+ headcount — only the row Pay Rate is used', () => {
    const twoStudents = remapGroupServiceType({
      serviceType: 'PT School Group',
      durationMinutes: 30,
      payRate: 45,
    });
    const fiveStudentsSameRate = remapGroupServiceType({
      serviceType: 'PT School Group',
      durationMinutes: 30,
      payRate: 45,
    });
    expect(twoStudents.serviceType).toBe('PT School');
    expect(fiveStudentsSameRate.serviceType).toBe('PT School');
    expect(remap('PT School Group', 30, 35)).toBe('PT School Group');
  });

  it('keeps group when pay rate is below the bucket threshold', () => {
    expect(remap('PT School Group', 30, 44.99)).toBe('PT School Group');
    expect(remap('PT School Group', 40, 54.99)).toBe('PT School Group');
    expect(remap('PT School Group', 45, 54.99)).toBe('PT School Group');
    expect(remap('PT School Group', 60, 59.99)).toBe('PT School Group');
  });

  it('keeps group when rounded duration is 0 or 75+', () => {
    expect(remapped('PT School Group', 0, 100)).toBe(false);
    expect(remapped('PT School Group', 7, 100)).toBe(false);
    expect(remapped('PT School Group', 75, 100)).toBe(false);
    expect(remapped('PT School Group', 90, 100)).toBe(false);
  });

  it('does not remap without duration or pay rate', () => {
    expect(
      remapGroupServiceType({
        serviceType: 'PT School Group',
        durationMinutes: undefined,
        payRate: 70,
      }).remapped,
    ).toBe(false);
    expect(
      remapGroupServiceType({
        serviceType: 'PT School Group',
        durationMinutes: 30,
        payRate: undefined,
      }).remapped,
    ).toBe(false);
  });
});

describe('applyGroupServiceRemap', () => {
  it('uses scheduled begin/end from the API Report row', () => {
    const hit = applyGroupServiceRemap({
      serviceCode: 'PT School Group',
      startTime: '09:00 AM',
      endTime: '09:15 AM',
      payRate: '11',
    });
    expect(hit).toEqual({ serviceType: 'PT School', remapped: true, roundedMinutes: 15 });

    const miss = applyGroupServiceRemap({
      serviceCode: 'PT School Group',
      startTime: '09:00 AM',
      endTime: '09:15 AM',
      payRate: '10.99',
    });
    expect(miss.remapped).toBe(false);
    expect(miss.serviceType).toBe('PT School Group');
  });
});
