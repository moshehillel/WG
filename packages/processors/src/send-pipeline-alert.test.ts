import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sesSend, snsSend } = vi.hoisted(() => ({
  sesSend: vi.fn(),
  snsSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(() => ({ send: sesSend })),
  SendRawEmailCommand: vi.fn((input: unknown) => input),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: snsSend })),
  PublishCommand: vi.fn((input: unknown) => input),
}));

import { sendPipelineAlert } from './send-pipeline-alert.js';

describe('sendPipelineAlert', () => {
  beforeEach(() => {
    sesSend.mockReset();
    snsSend.mockReset();
    delete process.env.ALERT_ALWAYS_SNS;
  });

  it('sends HTML via SES when primary FROM succeeds (no topic → no SNS)', async () => {
    sesSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      alertEmails: 'a@example.com,b@example.com',
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(result).toEqual({
      channel: 'ses',
      sesCount: 2,
      snsFallback: false,
      snsPublished: false,
    });
    expect(sesSend).toHaveBeenCalledTimes(2);
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alongside SES when topicArn is set (dual channel)', async () => {
    sesSend.mockResolvedValue({});
    snsSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      alertEmails: 'a@example.com,b@example.com',
      topicArn: 'arn:aws:sns:us-east-1:123:topic',
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(result).toEqual({
      channel: 'dual',
      sesCount: 2,
      snsFallback: false,
      snsPublished: true,
    });
    expect(sesSend).toHaveBeenCalledTimes(2);
    expect(snsSend).toHaveBeenCalledTimes(1);
  });

  it('skips dual SNS when alwaysSns is false and SES succeeds', async () => {
    sesSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      alertEmails: 'a@example.com,b@example.com',
      topicArn: 'arn:aws:sns:us-east-1:123:topic',
      alwaysSns: false,
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(result).toEqual({
      channel: 'ses',
      sesCount: 2,
      snsFallback: false,
      snsPublished: false,
    });
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('retries with fallback FROM before SNS when primary fails', async () => {
    sesSend
      .mockRejectedValueOnce(new Error('MessageRejected'))
      .mockRejectedValueOnce(new Error('MessageRejected'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    snsSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      fromEmailFallback: 'verified@example.com',
      alertEmails: 'a@example.com,b@example.com',
      topicArn: 'arn:aws:sns:us-east-1:123:topic',
      alwaysSns: false,
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(result).toEqual({
      channel: 'ses',
      sesCount: 2,
      snsFallback: false,
      snsPublished: false,
    });
    expect(sesSend).toHaveBeenCalledTimes(4);
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('falls back to SNS plain text only when all SES attempts fail', async () => {
    sesSend.mockRejectedValue(new Error('MessageRejected'));
    snsSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      fromEmailFallback: 'verified@example.com',
      alertEmails: 'a@example.com',
      topicArn: 'arn:aws:sns:us-east-1:123:topic',
      alwaysSns: false,
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(result).toEqual({
      channel: 'sns',
      sesCount: 0,
      snsFallback: true,
      snsPublished: true,
    });
    expect(sesSend).toHaveBeenCalledTimes(2);
    expect(snsSend).toHaveBeenCalledTimes(1);
  });

  it('always uses SendRawEmail with deliverability headers', async () => {
    sesSend.mockResolvedValue({});

    await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      replyTo: 'elefkowitz@whiteglovecare.net',
      alertEmails: 'a@example.com',
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
    });

    expect(sesSend).toHaveBeenCalledTimes(1);
    const raw = sesSend.mock.calls[0]![0] as { RawMessage?: { Data?: Buffer } };
    const mime = raw.RawMessage!.Data!.toString('utf8');
    expect(mime).toContain('Reply-To: elefkowitz@whiteglovecare.net');
    expect(mime).toContain('List-Id:');
    expect(mime).toContain('Auto-Submitted: auto-generated');
  });

  it('uses SendRawEmail when CSV attachments are present', async () => {
    sesSend.mockResolvedValue({});

    const result = await sendPipelineAlert({
      fromEmail: 'alerts@advancedautomations.net',
      alertEmails: 'a@example.com',
      subject: 'Test',
      textBody: 'plain',
      htmlBody: '<p>html</p>',
      attachments: [
        {
          filename: 'failures.csv',
          content: 'reportKind,status\nnew_services,failed\n',
          contentType: 'text/csv; charset=utf-8',
        },
      ],
    });

    expect(result).toEqual({
      channel: 'ses',
      sesCount: 1,
      snsFallback: false,
      snsPublished: false,
    });
    expect(sesSend).toHaveBeenCalledTimes(1);
    const raw = sesSend.mock.calls[0]![0] as { RawMessage?: { Data?: Buffer } };
    expect(raw.RawMessage?.Data).toBeInstanceOf(Buffer);
    const mime = raw.RawMessage!.Data!.toString('utf8');
    expect(mime).toContain('filename="failures.csv"');
    expect(mime).toContain('Content-Disposition: attachment');
  });
});
