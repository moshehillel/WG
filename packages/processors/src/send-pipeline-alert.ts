import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendEmailCommand, SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';

const sns = new SNSClient({});
const ses = new SESClient({});

/** Soft cap so SES stays under the ~10MB raw message limit. */
const MAX_ATTACHMENT_CHARS = 4_500_000;

export interface PipelineAlertAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

function parseAlertEmails(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

function alertFromHeader(fromEmail: string, fromName?: string): string {
  const name = fromName?.trim() || 'White Glove Alerts';
  // Quote display name when it contains spaces (RFC 5322).
  return name.includes(' ') ? `"${name}" <${fromEmail}>` : `${name} <${fromEmail}>`;
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function truncateAttachments(
  attachments: PipelineAlertAttachment[],
): PipelineAlertAttachment[] {
  let total = 0;
  const kept: PipelineAlertAttachment[] = [];
  for (const att of attachments) {
    if (total + att.content.length > MAX_ATTACHMENT_CHARS) {
      console.warn(
        `Skipping email attachment ${att.filename} — would exceed SES size budget (${att.content.length} chars)`,
      );
      continue;
    }
    total += att.content.length;
    kept.push(att);
  }
  return kept;
}

/** Build a multipart MIME message for SES SendRawEmail (HTML + optional CSV attachments). */
export function buildRawMimeMessage(options: {
  fromHeader: string;
  to: string;
  replyTo: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: PipelineAlertAttachment[];
}): string {
  const mixed = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const alt = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const attachments = truncateAttachments(options.attachments ?? []);

  const headers = [
    `From: ${options.fromHeader}`,
    `To: ${options.to}`,
    `Reply-To: ${options.replyTo}`,
    `Subject: ${encodeSubject(options.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];

  const parts: string[] = [];
  parts.push(
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    options.textBody,
    '',
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    options.htmlBody,
    '',
    `--${alt}--`,
    '',
  );

  for (const att of attachments) {
    const contentType = att.contentType ?? 'text/csv; charset=utf-8';
    const b64 = Buffer.from(att.content, 'utf8').toString('base64');
    const wrapped = b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
    parts.push(
      `--${mixed}`,
      `Content-Type: ${contentType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      wrapped,
      '',
    );
  }

  parts.push(`--${mixed}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

interface SesBatchResult {
  sesCount: number;
  failures: string[];
}

async function sendSesHtmlBatch(options: {
  recipients: string[];
  fromEmail: string;
  fromName?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: PipelineAlertAttachment[];
}): Promise<SesBatchResult> {
  const source = alertFromHeader(options.fromEmail, options.fromName);
  let sesCount = 0;
  const failures: string[] = [];
  const attachments = truncateAttachments(options.attachments ?? []);
  const useRaw = attachments.length > 0;

  for (const to of options.recipients) {
    try {
      if (useRaw) {
        const raw = buildRawMimeMessage({
          fromHeader: source,
          to,
          replyTo: options.fromEmail,
          subject: options.subject,
          textBody: options.textBody,
          htmlBody: options.htmlBody,
          attachments,
        });
        await ses.send(
          new SendRawEmailCommand({
            Source: options.fromEmail,
            Destinations: [to],
            RawMessage: { Data: Buffer.from(raw, 'utf8') },
          }),
        );
      } else {
        await ses.send(
          new SendEmailCommand({
            Source: source,
            ReplyToAddresses: [options.fromEmail],
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Charset: 'UTF-8', Data: options.subject },
              Body: {
                Text: { Charset: 'UTF-8', Data: options.textBody },
                Html: { Charset: 'UTF-8', Data: options.htmlBody },
              },
            },
          }),
        );
      }
      sesCount += 1;
    } catch (err) {
      failures.push(to);
      const name = err instanceof Error ? err.name : 'Error';
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`SES HTML alert failed for ${to} (from ${options.fromEmail}) [${name}]: ${msg}`);
    }
  }

  return { sesCount, failures };
}

export async function sendPipelineAlert(options: {
  topicArn?: string;
  fromEmail?: string;
  fromEmailFallback?: string;
  fromName?: string;
  alertEmails?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: PipelineAlertAttachment[];
}): Promise<{ channel: 'ses' | 'sns' | 'mixed' | 'none'; sesCount: number; snsFallback: boolean }> {
  const recipients = parseAlertEmails(options.alertEmails);
  const primaryFrom = options.fromEmail?.trim();
  const fallbackFrom = options.fromEmailFallback?.trim();

  if (recipients.length === 0) {
    console.warn('No alert recipients configured (ALERT_EMAILS empty)');
    return { channel: 'none', sesCount: 0, snsFallback: false };
  }

  if (!primaryFrom && !fallbackFrom) {
    console.warn('No ALERT_FROM_EMAIL configured — cannot send HTML via SES');
  }

  const batchOpts = {
    recipients,
    fromName: options.fromName,
    subject: options.subject,
    textBody: options.textBody,
    htmlBody: options.htmlBody,
    attachments: options.attachments,
  };

  let result: SesBatchResult = { sesCount: 0, failures: recipients.slice() };

  if (primaryFrom) {
    result = await sendSesHtmlBatch({ ...batchOpts, fromEmail: primaryFrom });
  }

  if (result.sesCount === 0 && fallbackFrom && fallbackFrom !== primaryFrom) {
    console.warn(
      `Primary FROM ${primaryFrom ?? '(none)'} failed for all recipients — retrying with verified fallback ${fallbackFrom}`,
    );
    result = await sendSesHtmlBatch({ ...batchOpts, fromEmail: fallbackFrom });
  }

  const { sesCount, failures: sesFailures } = result;

  if (sesCount > 0) {
    if (sesFailures.length > 0) {
      console.warn(
        `SES sent HTML to ${sesCount}/${recipients.length} recipient(s). Failed (often unverified in SES sandbox): ${sesFailures.join(', ')}`,
      );
    }
    return {
      channel: sesFailures.length > 0 ? 'mixed' : 'ses',
      sesCount,
      snsFallback: false,
    };
  }

  if (options.topicArn) {
    console.warn(
      'All SES HTML sends failed — falling back to SNS plain text for all subscribers. ' +
        'CSV attachments are not included on SNS fallback. ' +
        'Verify alerts@ domain in SES or complete recipient verification to receive HTML.',
    );
    await sns.send(
      new PublishCommand({
        TopicArn: options.topicArn,
        Subject: options.subject,
        Message: options.textBody,
      }),
    );
    return { channel: 'sns', sesCount: 0, snsFallback: true };
  }

  return { channel: 'none', sesCount: 0, snsFallback: false };
}
