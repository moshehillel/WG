import { describe, expect, it } from 'vitest';
import {
  buildHandoffConfirmationReply,
  buildHandoffEmail,
  buildLunaSystemPrompt,
  checkLunaGuestRateLimit,
  LUNA_GUEST_USER,
  normalizeHandoffContact,
  parseLunaModelJson,
  resetLunaGuestRateLimits,
} from './luna.js';
import { lunaKnowledgePrompt } from './luna-knowledge.js';

describe('luna', () => {
  it('ships error catalog, how-to, and conversation policy in the system prompt', () => {
    const prompt = buildLunaSystemPrompt();
    expect(prompt).toContain(lunaKnowledgePrompt().slice(0, 80));
    expect(prompt).toMatch(/paste the exact error/i);
    expect(prompt).toMatch(/No HHA pay code rate/i);
    expect(prompt).toMatch(/Invalid PayCodeID/i);
    expect(prompt).toMatch(/ErrorID=-310/);
    expect(prompt).toMatch(/ErrorID=-415/);
    expect(prompt).toMatch(/Accepted Services SP/i);
    expect(prompt).toMatch(/speech must be ST/i);
    expect(prompt).toMatch(/No HHA ContractID/i);
    expect(prompt).toMatch(/billing codes/i);
    expect(prompt).toMatch(/parentally placed/i);
    expect(prompt).toMatch(/Session is not signed/i);
    expect(prompt).toMatch(/page-break/i);
    expect(prompt).toMatch(/Frontline reason/i);
    expect(prompt).toMatch(/CPT units/i);
    expect(prompt).toMatch(/copy-pasted/i);
    expect(prompt).toMatch(/import caseload/i);
    expect(prompt).toMatch(/no peer/i);
    expect(prompt).toMatch(/Service type is required/i);
    expect(prompt).toMatch(/PDF upload/i);
    expect(prompt).toMatch(/Send to HHA/i);
    expect(prompt).toMatch(/Makeup-Weekly/i);
    expect(prompt).toMatch(/Documentation/i);
    expect(prompt).toMatch(/Last service/i);
    expect(prompt).toMatch(/handoff/i);
    expect(prompt).not.toMatch(/HHA_USE_PRODUCTION\s*=\s*false/i);
  });

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

  it('requires name and valid email for handoff contact', () => {
    expect(() => normalizeHandoffContact({ contactName: '', contactEmail: 'a@b.co' })).toThrow(
      /name/i,
    );
    expect(() => normalizeHandoffContact({ contactName: 'Ada', contactEmail: 'not-an-email' })).toThrow(
      /email/i,
    );
    expect(normalizeHandoffContact({ contactName: '  Ada  ', contactEmail: 'Ada@Example.COM' })).toEqual(
      {
        contactName: 'Ada',
        contactEmail: 'ada@example.com',
      },
    );
  });

  it('confirms handoff with her contact email only', () => {
    expect(buildHandoffConfirmationReply('ada@example.com')).toBe(
      'Thanks — I’ve sent this to our team. We’ll follow up with you at ada@example.com.',
    );
    expect(buildHandoffConfirmationReply('')).toBe(
      'Thanks — I’ve sent this to our team. We’ll follow up at the email you provided.',
    );
    expect(buildHandoffConfirmationReply('ada@example.com')).not.toMatch(
      /mshglck|advancedautomations|sent to moshe/i,
    );
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
      contactName: 'Ada Therapist',
      contactEmail: 'ada.reply@example.com',
      messages: [
        { role: 'user', content: 'Submit fails' },
        { role: 'assistant', content: 'Which error?' },
        { role: 'user', content: 'Network error' },
      ],
    });
    expect(subject).toContain('ada.reply@example.com');
    expect(subject).toContain('Ada Therapist');
    expect(text).toMatch(/=== CONTACT \(reply here\) ===[\s\S]*Name: Ada Therapist[\s\S]*Email: ada\.reply@example\.com/);
    expect(text).toContain('Signed-in account name: Ada Therapist');
    expect(text).toContain('Signed-in account email: therapist@example.com');
    expect(text).toContain('Cannot submit timesheet.');
    expect(text).toContain('User: Submit fails');
    expect(text).toContain('Luna: Which error?');
    expect(text).toContain('https://wgfront.netlify.app/');
  });

  it('builds guest handoff without signed-in account details', () => {
    const { text } = buildHandoffEmail({
      user: LUNA_GUEST_USER,
      pageUrl: 'https://wgfront.netlify.app/',
      summary: 'Cannot sign in.',
      timestamp: '2026-09-07T00:00:00.000Z',
      contactName: 'Guest User',
      contactEmail: 'guest@example.com',
      messages: [{ role: 'user', content: 'Login fails' }],
    });
    expect(text).toContain('not signed in');
    expect(text).toContain('guest / login screen');
    expect(text).not.toContain('Signed-in account email:');
  });

  it('rate-limits guest Luna keys', () => {
    resetLunaGuestRateLimits();
    expect(checkLunaGuestRateLimit('t', 2, 60_000, 1_000)).toBeNull();
    expect(checkLunaGuestRateLimit('t', 2, 60_000, 1_001)).toBeNull();
    expect(checkLunaGuestRateLimit('t', 2, 60_000, 1_002)).toMatch(/too many/i);
    expect(checkLunaGuestRateLimit('t', 2, 60_000, 62_000)).toBeNull();
  });
});
