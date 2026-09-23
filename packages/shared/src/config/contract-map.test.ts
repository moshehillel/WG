import { describe, expect, it } from 'vitest';
import { lookupContractId, PROGRAM_CONTRACT_MAP } from './contract-map.js';

describe('lookupContractId', () => {
  it('resolves program type to HHA ContractID', () => {
    expect(lookupContractId('Extended Home Care Therapy')).toBe(61591);
    expect(lookupContractId('extended home care therapy')).toBe(61591);
  });

  it('treats a period as optional so Fred S Keller matches ContractID 72817', () => {
    expect(lookupContractId('Fred S. Keller School')).toBe(72817);
    expect(lookupContractId('Fred S keller school')).toBe(72817);
  });

  it('does not match a different school', () => {
    expect(lookupContractId('Keller School')).toBeUndefined();
    expect(lookupContractId('Westbury UFSD')).toBe(66237);
    expect(lookupContractId('Westbury UFSD')).not.toBe(72817);
  });

  it('returns undefined for unknown program types', () => {
    expect(lookupContractId('Unknown Program')).toBeUndefined();
    expect(lookupContractId(undefined)).toBeUndefined();
  });

  it('maps all EVV and no-EVV program types', () => {
    expect(Object.keys(PROGRAM_CONTRACT_MAP).length).toBe(63);
  });
});
