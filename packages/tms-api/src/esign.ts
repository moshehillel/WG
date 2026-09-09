export interface SignEnvelope {
  envelopeId: string;
  /** Client e-sign vendor is SignNow; `docusign` kept only for any legacy envelopes. */
  vendor: 'signnow' | 'docusign' | 'adobe' | 'email';
}

/**
 * Create a principal signing request for the timesheet PDF.
 *
 * White Glove uses **SignNow** (not DocuSign). A full SignNow REST integration is not
 * wired yet — "Send timesheet" always falls back to SES email + PDF attachment.
 * Legacy DocuSign REST helpers were removed from the send path so the product never
 * claims DocuSign.
 */
export async function createSignEnvelope(input: {
  signerEmail: string;
  signerName: string;
  weekId: string;
  pdf: Uint8Array;
}): Promise<SignEnvelope> {
  void input.pdf;
  void input.signerName;
  void input.signerEmail;
  return { envelopeId: `email:${input.weekId}`, vendor: 'email' };
}

/** Void a pending e-sign envelope (no-op for email stubs / until SignNow API exists). */
export async function voidSignEnvelope(
  envelopeId: string,
  _reason = 'Therapist cancelled timesheet approval request',
): Promise<{ ok: boolean; skipped?: boolean }> {
  const id = String(envelopeId || '').trim();
  if (!id || id.startsWith('email:')) return { ok: true, skipped: true };
  // No SignNow void API yet; legacy non-email ids are best-effort skipped.
  void _reason;
  return { ok: true, skipped: true };
}

export function envelopeCompleted(payload: Record<string, unknown>): {
  envelopeId: string;
  completed: boolean;
} {
  const data = (payload.data as Record<string, unknown> | undefined) || undefined;
  const envelopeSummary =
    (data?.envelopeSummary as Record<string, unknown> | undefined) ||
    (payload.envelopeSummary as Record<string, unknown> | undefined);
  const envelopeId = String(
    payload.envelopeId ||
      payload.envelopeID ||
      data?.envelopeId ||
      envelopeSummary?.envelopeId ||
      '',
  );
  const event = String(
    payload.event || payload.status || payload.eventName || data?.envelopeEvent || '',
  ).toLowerCase();
  const status = String(
    payload.status || envelopeSummary?.status || data?.envelopeStatus || '',
  ).toLowerCase();
  const completed =
    event.includes('complet') ||
    event === 'signed' ||
    event.includes('recipient-completed') ||
    status === 'completed';
  return { envelopeId, completed };
}
