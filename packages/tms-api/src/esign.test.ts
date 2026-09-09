import { describe, expect, it } from 'vitest';
import { envelopeCompleted, isSignNowConfigured } from './esign.js';

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
});
