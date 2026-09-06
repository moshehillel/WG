import { describe, expect, it } from 'vitest';
import { formatMailError } from './mail.js';

describe('formatMailError', () => {
  it('explains SES sandbox / unverified recipient', () => {
    const msg = formatMailError(
      new Error(
        'Email address is not verified. The following identities failed the check in region US-EAST-1: mgluck@whiteglovecare.net',
      ),
    );
    expect(msg).toMatch(/mgluck@whiteglovecare\.net/);
    expect(msg).toMatch(/sandbox|verified/i);
  });
});
