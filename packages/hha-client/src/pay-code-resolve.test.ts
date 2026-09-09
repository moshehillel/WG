import { describe, expect, it } from 'vitest';
import { pickFirstPayCodeForDiscipline } from '@white-glove/shared';
import { resolvePayCodeIdFromCatalog, resolveHhaPayCodeName } from './pay-code-resolve.js';

const SAMPLE_ROWS = [
  { id: '200431', name: 'OT $70' },
  { id: '200432', name: 'OT $70.50' },
  { id: '176130', name: 'PT $70' },
  { id: '260780', name: 'ST $70' },
  { id: '299841', name: 'ST $52.50' },
  { id: '302198', name: 'PT $71.79' },
  { id: '176129', name: 'PT 65' },
];

describe('pay-code-resolve', () => {
  it('maps OT70 to OT $70', () => {
    expect(resolvePayCodeIdFromCatalog('OT70', SAMPLE_ROWS)).toBe('200431');
  });

  it('maps OT $70 exactly', () => {
    expect(resolvePayCodeIdFromCatalog('OT $70', SAMPLE_ROWS)).toBe('200431');
  });

  it('maps SLP70 to ST $70', () => {
    expect(resolvePayCodeIdFromCatalog('SLP70', SAMPLE_ROWS)).toBe('260780');
  });

  it('maps SLP $52.5 to ST $52.50', () => {
    expect(resolvePayCodeIdFromCatalog('SLP $52.5', SAMPLE_ROWS)).toBe('299841');
  });

  it('does not map OT70 to OT $70.50', () => {
    expect(resolvePayCodeIdFromCatalog('OT70', SAMPLE_ROWS)).toBe('200431');
    expect(resolvePayCodeIdFromCatalog('OT70.5', SAMPLE_ROWS)).toBe('200432');
  });

  it('maps SLP52.5 to ST $52.50', () => {
    expect(resolvePayCodeIdFromCatalog('SLP52.5', SAMPLE_ROWS)).toBe('299841');
    expect(resolvePayCodeIdFromCatalog('SLP52', SAMPLE_ROWS)).toBeUndefined();
  });

  it('exact-matches decimal HHA rates', () => {
    expect(resolvePayCodeIdFromCatalog('PT71.79', SAMPLE_ROWS)).toBe('302198');
    expect(resolvePayCodeIdFromCatalog('PT71', SAMPLE_ROWS)).toBeUndefined();
  });

  it('matches PT65 without dollar sign in HHA', () => {
    expect(resolvePayCodeIdFromCatalog('PT65', SAMPLE_ROWS)).toBe('176129');
  });

  it('maps OT Group $34', () => {
    const rows = [...SAMPLE_ROWS, { id: 'g34', name: 'OT Group $34' }];
    expect(resolvePayCodeIdFromCatalog('OT Group $34', rows)).toBe('g34');
  });

  it('returns HHA display name for resolved PS code', () => {
    expect(resolveHhaPayCodeName('OT70', SAMPLE_ROWS)).toBe('OT $70');
    expect(resolveHhaPayCodeName('OT $70', SAMPLE_ROWS)).toBe('OT $70');
  });

  it('re-exports discipline fallback picker used by EVV placeholder', () => {
    expect(pickFirstPayCodeForDiscipline('OT', SAMPLE_ROWS)?.id).toBe('200431');
  });
});
