export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  attachmentName?: string;
  attachment?: Uint8Array;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ ok: boolean; id: string }>;
}

export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
    return { ok: true, id: `mem-${this.sent.length}` };
  }
}

/** Turn SES sandbox / identity errors into a clear message for the UI. */
export function formatMailError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/MessageRejected|not verified|Email address is not verified/i.test(msg)) {
    const match = msg.match(/US-EAST-1:\s*([^\s"']+)/i);
    const addr = match?.[1]?.replace(/,$/, '') || 'the signer address';
    return (
      `Could not email the timesheet to ${addr}. ` +
      `AWS SES is still in sandbox (or that address/domain is not verified), so only verified recipients can receive mail. ` +
      `Verify ${addr} (or finish verifying whiteglovecare.net) in SES, or request production access — then try Send timesheet again.`
    );
  }
  return msg || 'Could not send email.';
}

export async function createMailer(): Promise<Mailer> {
  const from = process.env.TMS_FROM_EMAIL || process.env.ALERT_FROM_EMAIL;
  if (!from) return new MemoryMailer();
  return {
    async send(message) {
      try {
        const { SESClient, SendEmailCommand, SendRawEmailCommand } = await import('@aws-sdk/client-ses');
        const ses = new SESClient({});
        if (message.attachment && message.attachmentName) {
          const boundary = `tms-${Date.now()}`;
          const raw = [
            `From: ${from}`,
            `To: ${message.to.join(', ')}`,
            `Subject: ${message.subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=utf-8',
            '',
            message.text,
            `--${boundary}`,
            `Content-Type: application/pdf; name="${message.attachmentName}"`,
            'Content-Transfer-Encoding: base64',
            `Content-Disposition: attachment; filename="${message.attachmentName}"`,
            '',
            Buffer.from(message.attachment).toString('base64'),
            `--${boundary}--`,
            '',
          ].join('\r\n');
          const out = await ses.send(
            new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } }),
          );
          return { ok: true, id: out.MessageId || 'ses' };
        }
        const out = await ses.send(
          new SendEmailCommand({
            Source: from,
            Destination: { ToAddresses: message.to },
            Message: {
              Subject: { Data: message.subject },
              Body: { Text: { Data: message.text } },
            },
          }),
        );
        return { ok: true, id: out.MessageId || 'ses' };
      } catch (err) {
        throw new Error(formatMailError(err));
      }
    },
  };
}
