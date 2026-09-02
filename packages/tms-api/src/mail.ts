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

export async function createMailer(): Promise<Mailer> {
  const from = process.env.TMS_FROM_EMAIL || process.env.ALERT_FROM_EMAIL;
  if (!from) return new MemoryMailer();
  return {
    async send(message) {
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
    },
  };
}
