import { describe, expect, it } from 'vitest';
import {
  filterServiceCodesForContract,
  matchByName,
  normalizeRefName,
  parseServiceCodesFromXml,
} from './reference-resolve.js';

describe('reference-resolve', () => {
  it('normalizes names for matching', () => {
    expect(normalizeRefName('Extended Home Care Therapy')).toBe('extended home care therapy');
  });

  it('matches contract by exact and fuzzy name', () => {
    const haystack = [{ id: '61591', name: 'Extended Home Care Therapy' }];
    expect(matchByName('extended home care therapy', haystack)?.id).toBe('61591');
  });

  it('parses ContractID from GetBillingServiceCodes blocks', () => {
    const xml = `
      <ServiceCodes>
        <ServiceCode>
          <ServiceCodeID>232853</ServiceCodeID>
          <ServiceCodeName>PT</ServiceCodeName>
          <ContractName>Other Contract</ContractName>
          <ContractID>111</ContractID>
        </ServiceCode>
        <ServiceCode>
          <ServiceCodeID>313582</ServiceCodeID>
          <ServiceCodeName>PT</ServiceCodeName>
          <ContractName>Americare Certified</ContractName>
          <ContractID>37925</ContractID>
        </ServiceCode>
      </ServiceCodes>`;
    const rows = parseServiceCodesFromXml(xml);
    expect(rows).toEqual([
      { id: '232853', name: 'PT', contractId: '111', contractName: 'Other Contract' },
      {
        id: '313582',
        name: 'PT',
        contractId: '37925',
        contractName: 'Americare Certified',
      },
    ]);
    expect(filterServiceCodesForContract(rows, 37925)).toEqual([
      {
        id: '313582',
        name: 'PT',
        contractId: '37925',
        contractName: 'Americare Certified',
      },
    ]);
  });

  it('keeps unscoped rows when ContractID is absent (sandbox/legacy)', () => {
    const rows = parseServiceCodesFromXml(
      `<ServiceCodeID>9</ServiceCodeID><ServiceCodeName>PT</ServiceCodeName>`,
    );
    expect(filterServiceCodesForContract(rows, 37925)).toEqual([{ id: '9', name: 'PT' }]);
  });
});
