import { PRINCIPAL_SIGN_ANCHOR, PRINCIPAL_SIGN_TAB } from './timesheet.js';

export interface SignEnvelope {
  envelopeId: string;
  vendor: 'docusign' | 'adobe' | 'email';
}

type DocuSignCreds = {
  baseUrl: string;
  token: string;
  accountId: string;
  webhookUrl?: string;
};

/**
 * Prefer env vars; optionally merge JSON from TMS_DOCUSIGN_SECRET_ARN
 * ({ baseUrl, accessToken|token, accountId, webhookUrl? }).
 */
export async function applyDocuSignSecretFromArn(): Promise<void> {
  const arn = process.env.TMS_DOCUSIGN_SECRET_ARN?.trim();
  if (!arn) return;
  try {
    const { GetSecretValueCommand, SecretsManagerClient } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({});
    const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    if (!res.SecretString) return;
    const parsed = JSON.parse(res.SecretString) as Record<string, unknown>;
    const baseUrl = String(parsed.baseUrl || parsed.base_url || '').trim();
    const token = String(parsed.accessToken || parsed.token || parsed.access_token || '').trim();
    const accountId = String(parsed.accountId || parsed.account_id || '').trim();
    const webhookUrl = String(parsed.webhookUrl || parsed.webhook_url || '').trim();
    if (baseUrl) process.env.TMS_DOCUSIGN_BASE_URL = baseUrl;
    if (token) process.env.TMS_DOCUSIGN_TOKEN = token;
    if (accountId) process.env.TMS_DOCUSIGN_ACCOUNT_ID = accountId;
    if (webhookUrl) process.env.TMS_ESIGN_WEBHOOK_URL = webhookUrl;
  } catch (err) {
    console.warn(
      '[esign] DocuSign secret load failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

function readDocuSignCreds(): DocuSignCreds | null {
  const baseUrl = process.env.TMS_DOCUSIGN_BASE_URL?.trim() || '';
  const token = process.env.TMS_DOCUSIGN_TOKEN?.trim() || '';
  const accountId = process.env.TMS_DOCUSIGN_ACCOUNT_ID?.trim() || '';
  if (!baseUrl || !token || !accountId) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    accountId,
    webhookUrl: process.env.TMS_ESIGN_WEBHOOK_URL?.trim() || undefined,
  };
}

export async function createSignEnvelope(input: {
  signerEmail: string;
  signerName: string;
  weekId: string;
  pdf: Uint8Array;
}): Promise<SignEnvelope> {
  await applyDocuSignSecretFromArn();
  const creds = readDocuSignCreds();
  if (creds && input.signerEmail) {
    const webhook = creds.webhookUrl;
    const body: Record<string, unknown> = {
      emailSubject: 'Please sign related-service timesheet',
      emailBlurb:
        'Please review and sign the related-service timesheet.\n\nPowered by advancedautomations.net',
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
            tabs: {
              signHereTabs: [
                {
                  documentId: '1',
                  pageNumber: PRINCIPAL_SIGN_TAB.pageNumber,
                  anchorString: PRINCIPAL_SIGN_ANCHOR,
                  anchorUnits: 'pixels',
                  anchorXOffset: '8',
                  anchorYOffset: '-28',
                },
              ],
            },
          },
        ],
      },
      customFields: {
        textCustomFields: [
          { name: 'weekId', value: input.weekId, show: 'false' },
        ],
      },
    };
    if (webhook) {
      body.eventNotification = {
        url: webhook,
        loggingEnabled: 'true',
        requireAcknowledgment: 'true',
        includeDocuments: 'false',
        envelopeEvents: [{ envelopeEventStatusCode: 'completed' }],
        recipientEvents: [{ recipientEventStatusCode: 'Completed' }],
      };
    }
    const res = await fetch(`${creds.baseUrl}/v2.1/accounts/${creds.accountId}/envelopes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = (await res.json()) as { envelopeId?: string };
      if (json.envelopeId) return { envelopeId: json.envelopeId, vendor: 'docusign' };
    } else {
      const detail = await res.text().catch(() => '');
      console.error('[esign] DocuSign create failed', res.status, detail.slice(0, 500));
    }
  }
  return { envelopeId: `email:${input.weekId}`, vendor: 'email' };
}

/** Void a pending DocuSign envelope (no-op for email: stubs). */
export async function voidSignEnvelope(
  envelopeId: string,
  reason = 'Therapist cancelled timesheet approval request',
): Promise<{ ok: boolean; skipped?: boolean }> {
  const id = String(envelopeId || '').trim();
  if (!id || id.startsWith('email:')) return { ok: true, skipped: true };
  await applyDocuSignSecretFromArn();
  const creds = readDocuSignCreds();
  if (!creds) return { ok: true, skipped: true };
  try {
    const res = await fetch(
      `${creds.baseUrl}/v2.1/accounts/${creds.accountId}/envelopes/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${creds.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'voided', voidedReason: reason.slice(0, 200) }),
      },
    );
    if (res.ok || res.status === 400) {
      // 400 often means already voided/completed — treat as best-effort.
      return { ok: true };
    }
    const detail = await res.text().catch(() => '');
    console.warn('[esign] DocuSign void failed', res.status, detail.slice(0, 300));
    return { ok: false };
  } catch (err) {
    console.warn('[esign] DocuSign void error', err instanceof Error ? err.message : err);
    return { ok: false };
  }
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
