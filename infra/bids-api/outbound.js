/** Outbound email (SES) and optional SMS (Twilio). Failures are logged, not thrown past the caller. */

export function mailConfigFromEnv(env = process.env) {
  const from = String(env.BIDS_FROM_EMAIL || env.ALERT_FROM_EMAIL || env.TMS_FROM_EMAIL || 'alerts@advancedautomations.net').trim();
  return { from, configured: Boolean(from) };
}

export function smsConfigFromEnv(env = process.env) {
  const sid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const token = String(env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(env.TWILIO_FROM_NUMBER || '').trim();
  return {
    configured: Boolean(sid && token && from),
    sid,
    token,
    from,
  };
}

export async function sendSesEmail({ to, subject, text, from }) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = new SESClient({});
  const out = await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject || '(no subject)' },
      Body: { Text: { Data: text || '' } },
    },
  }));
  return { ok: true, id: out.MessageId || 'ses', channel: 'email' };
}

export async function sendTwilioSms({ to, body, sid, token, from }) {
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.message || `Twilio HTTP ${res.status}`, channel: 'sms' };
  }
  return { ok: true, id: data.sid || 'twilio', channel: 'sms' };
}

export async function deliverQueuedMessage(message, env = process.env) {
  const channel = message.channel === 'sms' ? 'sms' : 'email';
  if (channel === 'sms') {
    const sms = smsConfigFromEnv(env);
    if (!sms.configured) {
      return { ok: false, skipped: true, error: 'SMS not configured', channel: 'sms' };
    }
    const to = String(message.to || '').trim();
    if (!to) return { ok: false, error: 'No phone number on this message.', channel: 'sms' };
    try {
      return await sendTwilioSms({
        to,
        body: message.body || message.text || '',
        sid: sms.sid,
        token: sms.token,
        from: sms.from,
      });
    } catch (err) {
      return { ok: false, error: err.message || 'SMS send failed', channel: 'sms' };
    }
  }
  const mail = mailConfigFromEnv(env);
  const to = String(message.to || '').trim();
  if (!to || !to.includes('@')) return { ok: false, error: 'No email address on this message.', channel: 'email' };
  try {
    return await sendSesEmail({
      to,
      subject: message.subject || 'White Glove Bids',
      text: message.body || message.text || '',
      from: mail.from,
    });
  } catch (err) {
    return { ok: false, error: err.message || 'Email send failed', channel: 'email' };
  }
}

export function collectQueuedMessages({ districts = [], trackers = [], districtAwards = [], unfilledCases = [] }) {
  const out = [];
  for (const district of districts) {
    for (const message of district.outreach?.messages || []) {
      if (message && message.sent !== true && message.status === 'ready') {
        out.push({
          id: `district:${district.id}:${message.kind || message.id}`,
          scope: 'district',
          districtId: district.id,
          channel: 'email',
          ...message,
        });
      }
    }
    if (district.questionsEmail && district.questionsEmail.sent !== true) {
      out.push({
        id: `district:${district.id}:questions`,
        scope: 'district',
        districtId: district.id,
        channel: 'email',
        ...district.questionsEmail,
      });
    }
  }
  for (const award of trackers) {
    for (const [key, draft] of Object.entries(award.drafts || {})) {
      if (draft && draft.sent !== true) {
        out.push({
          id: `award:${award.caseId}:${key}`,
          scope: 'award',
          caseId: award.caseId,
          channel: 'email',
          to: draft.to,
          subject: draft.subject || `Bids draft — ${key}`,
          body: draft.body || draft.reason || '',
          kind: key,
        });
      }
    }
  }
  for (const award of districtAwards) {
    for (const [key, draft] of [['payroll', award.payroll], ['billu', award.billu]]) {
      if (draft && draft.sent !== true) {
        out.push({
          id: `district-award:${award.caseId}:${key}`,
          scope: 'district-award',
          caseId: award.caseId,
          channel: 'email',
          to: draft.to,
          subject: draft.subject || key,
          body: draft.body || '',
          kind: key,
        });
      }
    }
  }
  for (const row of unfilledCases) {
    if (row.cseNotice && row.cseNotice.sent !== true) {
      out.push({
        id: `unfilled:${row.id}:cse`,
        scope: 'unfilled',
        caseId: row.id,
        channel: 'email',
        to: row.cseNotice.to || 'CSE',
        subject: 'CSE notice — five-day reject',
        body: row.cseNotice.body || row.cseNotice.reason || '',
        kind: 'cse',
      });
    }
  }
  return out;
}
