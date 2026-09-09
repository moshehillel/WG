import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';

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

/** Headers for automated operational mail (avoid bulk/list headers that trigger spam filters). */
function deliverabilityHeaders(options: {
  fromEmail: string;
  replyTo: string;
  listId: string;
}): string[] {
  const messageId = `<pipeline-${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${options.fromEmail.split('@')[1] ?? 'amazonses.com'}>`;
  const unsub = encodeURIComponent('unsubscribe pipeline alerts');
  return [
    `Message-ID: ${messageId}`,
    `List-Id: ${options.listId}`,
    `List-Unsubscribe: <mailto:${options.replyTo}?subject=${unsub}>`,
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: OOF, AutoReply',
  ];
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
  fromEmail?: string;
}): string {
  const mixed = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const alt = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const attachments = truncateAttachments(options.attachments ?? []);
  const fromEmail = options.fromEmail ?? options.replyTo;

  const headers = [
    `From: ${options.fromHeader}`,
    `To: ${options.to}`,
    `Reply-To: ${options.replyTo}`,
    `Subject: ${encodeSubject(options.subject)}`,
    ...deliverabilityHeaders({
      fromEmail,
      replyTo: options.replyTo,
      listId: 'White Glove Pipeline Alerts <pipeline-alerts.whiteglovecare.net>',
    }),
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
  replyTo?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: PipelineAlertAttachment[];
}): Promise<SesBatchResult> {
  const source = alertFromHeader(options.fromEmail, options.fromName);
  const replyTo = options.replyTo?.trim() || options.fromEmail;
  let sesCount = 0;
  const failures: string[] = [];
  const attachments = truncateAttachments(options.attachments ?? []);

  for (const to of options.recipients) {
    try {
      const raw = buildRawMimeMessage({
        fromHeader: source,
        to,
        replyTo,
        subject: options.subject,
        textBody: options.textBody,
        htmlBody: options.htmlBody,
        attachments,
        fromEmail: options.fromEmail,
      });
      await ses.send(
        new SendRawEmailCommand({
          Source: options.fromEmail,
          Destinations: [to],
          RawMessage: { Data: Buffer.from(raw, 'utf8') },
        }),
      );
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

function resolveAlwaysSns(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  const raw = process.env.ALERT_ALWAYS_SNS?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  // Default true: SES can "succeed" while M365/Barracuda quarantine mail —
  // SNS email subscriptions remain the reliable path for White Glove staff.
  return true;
}

export type PipelineAlertResult = {
  channel: 'ses' | 'sns' | 'mixed' | 'dual' | 'none';
  sesCount: number;
  /** True when SNS was used because every SES attempt failed. */
  snsFallback: boolean;
  /** True whenever a message was published to the exception SNS topic. */
  snsPublished: boolean;
};

export async function sendPipelineAlert(options: {
  topicArn?: string;
  fromEmail?: string;
  fromEmailFallback?: string;
  fromName?: string;
  replyTo?: string;
  alertEmails?: string;
  /** When true (default), always publish SNS plain text in addition to SES HTML. */
  alwaysSns?: boolean;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments?: PipelineAlertAttachment[];
}): Promise<PipelineAlertResult> {
  const recipients = parseAlertEmails(options.alertEmails);
  const primaryFrom = options.fromEmail?.trim();
  const fallbackFrom = options.fromEmailFallback?.trim();
  const replyTo = options.replyTo?.trim();
  const alwaysSns = resolveAlwaysSns(options.alwaysSns);

  if (recipients.length === 0) {
    console.warn('No alert recipients configured (ALERT_EMAILS empty)');
    return { channel: 'none', sesCount: 0, snsFallback: false, snsPublished: false };
  }

  if (!primaryFrom && !fallbackFrom) {
    console.warn('No ALERT_FROM_EMAIL configured — cannot send HTML via SES');
  }

  const batchOpts = {
    recipients,
    fromName: options.fromName,
    replyTo,
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
  const shouldPublishSns =
    Boolean(options.topicArn) && (sesCount === 0 || alwaysSns);

  let snsPublished = false;
  let snsFallback = false;

  if (shouldPublishSns && options.topicArn) {
    if (sesCount === 0) {
      console.warn(
        'All SES HTML sends failed — SNS plain text is the primary delivery path. ' +
          'CSV attachments are SES-only (not on SNS). ' +
          'Optional: verify a SES From identity you own for HTML/CSV; WG domain/DKIM is not required for SNS alerts.',
      );
      snsFallback = true;
    } else {
      console.log(
        'Publishing SNS plain-text alert alongside SES HTML (ALERT_ALWAYS_SNS). ' +
          'SNS (AWS Notifications) is the primary reliable path; CSV attachments are SES-only.',
      );
    }
    await sns.send(
      new PublishCommand({
        TopicArn: options.topicArn,
        Subject: options.subject,
        Message: options.textBody,
      }),
    );
    snsPublished = true;
  }

  if (sesCount > 0) {
    if (sesFailures.length > 0) {
      console.warn(
        `SES sent HTML to ${sesCount}/${recipients.length} recipient(s). Failed (often unverified in SES sandbox): ${sesFailures.join(', ')}`,
      );
    }
    return {
      channel: snsPublished ? 'dual' : sesFailures.length > 0 ? 'mixed' : 'ses',
      sesCount,
      snsFallback: false,
      snsPublished,
    };
  }

  if (snsPublished) {
    return { channel: 'sns', sesCount: 0, snsFallback, snsPublished: true };
  }

  return { channel: 'none', sesCount: 0, snsFallback: false, snsPublished: false };
}
