import { describe, expect, it } from 'vitest';
import { buildHandoffEmail, parseLunaModelJson } from './luna.js';

describe('luna', () => {
  it('parses ask and handoff JSON', () => {
    expect(parseLunaModelJson('{"reply":"Which page?","action":"ask","summary":""}')).toEqual({
      reply: 'Which page?',
      action: 'ask',
      summary: '',
    });
    expect(
      parseLunaModelJson(
        'noise {"reply":"I will escalate.","action":"handoff","summary":"PDF upload fails on Mandates."} trailing',
      ),
    ).toEqual({
      reply: 'I will escalate.',
      action: 'handoff',
      summary: 'PDF upload fails on Mandates.',
    });
  });

  it('builds handoff email with user + transcript', () => {
    const { subject, text } = buildHandoffEmail({
      user: {
        id: 'u1',
        cognitoSub: 'sub',
        email: 'therapist@example.com',
        role: 'therapist',
        displayName: 'Ada Therapist',
        providerId: 'p1',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      pageUrl: 'https://wgfront.netlify.app/',
      summary: 'Cannot submit timesheet.',
      timestamp: '2026-09-04T00:00:00.000Z',
      messages: [
        { role: 'user', content: 'Submit fails' },
        { role: 'assistant', content: 'Which error?' },
        { role: 'user', content: 'Network error' },
      ],
    });
    expect(subject).toContain('therapist@example.com');
    expect(text).toContain('Ada Therapist');
    expect(text).toContain('Cannot submit timesheet.');
    expect(text).toContain('User: Submit fails');
    expect(text).toContain('Luna: Which error?');
    expect(text).toContain('https://wgfront.netlify.app/');
  });
});
