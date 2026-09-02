export interface SignEnvelope {
  envelopeId: string;
  vendor: 'docusign' | 'adobe' | 'email';
}

export async function createSignEnvelope(input: {
  signerEmail: string;
  signerName: string;
  weekId: string;
  pdf: Uint8Array;
}): Promise<SignEnvelope> {
  const base = process.env.TMS_DOCUSIGN_BASE_URL?.trim();
  const token = process.env.TMS_DOCUSIGN_TOKEN?.trim();
  const account = process.env.TMS_DOCUSIGN_ACCOUNT_ID?.trim();
  if (base && token && account && input.signerEmail) {
    const res = await fetch(`${base}/v2.1/accounts/${account}/envelopes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailSubject: `Please sign related-service timesheet`,
        status: 'sent',
        documents: [
          {
            documentBase64: Buffer.from(input.pdf).toString('base64'),
            name: `timesheet-${input.weekId}.pdf`,
            fileExtension: 'pdf',
            documentId: '1',
          },
        ],
        recipients: {
          signers: [
            {
              email: input.signerEmail,
              name: input.signerName || input.signerEmail,
              recipientId: '1',
              routingOrder: '1',
            },
          ],
        },
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { envelopeId?: string };
      if (body.envelopeId) return { envelopeId: body.envelopeId, vendor: 'docusign' };
    }
  }
  return { envelopeId: `email:${input.weekId}`, vendor: 'email' };
}

export function envelopeCompleted(payload: Record<string, unknown>): {
  envelopeId: string;
  completed: boolean;
} {
  const envelopeId = String(
    payload.envelopeId || payload.envelopeID || (payload.data as { envelopeId?: string } | undefined)?.envelopeId || '',
  );
  const event = String(payload.event || payload.status || payload.eventName || '').toLowerCase();
  const completed =
    event.includes('complet') ||
    event === 'signed' ||
    String(payload.status || '').toLowerCase() === 'completed';
  return { envelopeId, completed };
}
