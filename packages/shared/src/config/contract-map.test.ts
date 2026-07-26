import { describe, expect, it } from 'vitest';
import { lookupContractId, PROGRAM_CONTRACT_MAP } from './contract-map.js';

describe('lookupContractId', () => {
  it('resolves program type to HHA ContractID', () => {
    expect(lookupContractId('Extended Home Care Therapy')).toBe(61591);
    expect(lookupContractId('extended home care therapy')).toBe(61591);
  });

  it('returns undefined for unknown program types', () => {
    expect(lookupContractId('Unknown Program')).toBeUndefined();
    expect(lookupContractId(undefined)).toBeUndefined();
  });

  it('maps all EVV and no-EVV program types', () => {
    expect(Object.keys(PROGRAM_CONTRACT_MAP).length).toBe(63);
  });
});
