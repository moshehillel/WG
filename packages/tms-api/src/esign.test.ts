import { describe, expect, it } from 'vitest';
import { envelopeCompleted, isSignNowConfigured } from './esign.js';
import { PRINCIPAL_DATE_FIELD, PRINCIPAL_SIGN_FIELD, PROVIDER_DATE_FIELD } from './timesheet.js';

describe('esign', () => {
  it('detects SignNow webhook completion payloads', () => {
    expect(envelopeCompleted({ event: 'document.complete', document_id: 'doc-1' }).completed).toBe(
      true,
    );
    expect(envelopeCompleted({ event: 'document.complete', document_id: 'doc-1' }).envelopeId).toBe(
      'doc-1',
    );
    expect(envelopeCompleted({ event: 'completed', envelopeId: 'env-1' }).completed).toBe(true);
  });

  it('is not configured without secrets in test env', async () => {
    expect(await isSignNowConfigured()).toBe(false);
  });

  it('exposes principal signature and date field tabs for SignNow', () => {
    expect(PRINCIPAL_SIGN_FIELD.width).toBeGreaterThan(100);
    expect(PRINCIPAL_DATE_FIELD.x).toBeGreaterThan(PRINCIPAL_SIGN_FIELD.x);
  });

  it('exposes provider date field left of principal date', () => {
    expect(PROVIDER_DATE_FIELD.x).toBeLessThan(PRINCIPAL_DATE_FIELD.x);
    expect(PROVIDER_DATE_FIELD.y).toBe(PRINCIPAL_DATE_FIELD.y);
  });
});
