import { describe, expect, it } from 'vitest';
import {
  findMatchingAuthorizationId,
  isNonUniqueAuthorizationNumber,
  isUniqueAuthorizationNumber,
  parsePatientAuthorizationBlocks,
} from './authorization-match.js';

describe('authorization-match', () => {
  it('treats status tokens and blank as non-unique', () => {
    expect(isNonUniqueAuthorizationNumber('approved')).toBe(true);
    expect(isNonUniqueAuthorizationNumber('PENDING')).toBe(true);
    expect(isNonUniqueAuthorizationNumber('')).toBe(true);
    expect(isNonUniqueAuthorizationNumber('  ')).toBe(true);
    expect(isUniqueAuthorizationNumber('API-S-123')).toBe(true);
    expect(isUniqueAuthorizationNumber('39920093')).toBe(true);
  });

  it('does not reuse number "approved" across different From/To windows', () => {
    const xml = `
      <Authorization>
        <ID>39920093</ID>
        <AuthorizationNumber>approved</AuthorizationNumber>
        <ContractID>37925</ContractID>
        <StartDate>2026-06-27</StartDate>
        <StopDate>2026-06-27</StopDate>
      </Authorization>
      <Authorization>
        <ID>39920097</ID>
        <AuthorizationNumber>approved</AuthorizationNumber>
        <ContractID>37925</ContractID>
        <StartDate>2026-06-27</StartDate>
        <StopDate>2026-06-27</StopDate>
      </Authorization>
    `;
    const auths = parsePatientAuthorizationBlocks(xml);
    expect(
      findMatchingAuthorizationId(auths, {
        authorizationNumber: 'approved',
        contractId: '37925',
        serviceCodeId: '313581',
        fromDate: '11/06/2026',
        toDate: '12/06/2026',
      }),
    ).toBeUndefined();
  });

  it('reuses status-token auth when contract + From/To match the period being written', () => {
    const xml = `
      <Authorization>
        <ID>50000001</ID>
        <AuthorizationNumber>approved</AuthorizationNumber>
        <ContractID>37925</ContractID>
        <ServiceCodeID>313581</ServiceCodeID>
        <StartDate>2026-11-06</StartDate>
        <StopDate>2026-12-06</StopDate>
      </Authorization>
    `;
    const auths = parsePatientAuthorizationBlocks(xml);
    expect(
      findMatchingAuthorizationId(auths, {
        authorizationNumber: 'approved',
        contractId: '37925',
        serviceCodeId: '313581',
        fromDate: '11/06/2026',
        toDate: '12/06/2026',
      }),
    ).toBe('50000001');
  });

  it('reuses a unique AuthorizationNumber on re-push even with different dates', () => {
    const xml = `
      <Authorization>
        <ID>111</ID>
        <AuthorizationNumber>API-S-999</AuthorizationNumber>
        <ContractID>37925</ContractID>
        <StartDate>2026-01-01</StartDate>
        <StopDate>2026-01-01</StopDate>
      </Authorization>
    `;
    const auths = parsePatientAuthorizationBlocks(xml);
    expect(
      findMatchingAuthorizationId(auths, {
        authorizationNumber: 'API-S-999',
        contractId: '37925',
        fromDate: '11/06/2026',
        toDate: '12/06/2026',
      }),
    ).toBe('111');
  });
});
