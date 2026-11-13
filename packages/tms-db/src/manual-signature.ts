import type { SessionRow } from './types.js';

function nameTokens(raw: string): string[] {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z\u00c0-\u024f\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/** Manual sessions that deliver a visit need a provider signature (attended / makeup). */
export function manualSessionNeedsSignature(session: Pick<SessionRow, 'attendance'>): boolean {
  return session.attendance === 'attended' || session.attendance === 'makeup';
}

/**
 * Typed e-signature for a manually entered session.
 * Must carry the provider's first and last name (credentials like ", PT" are fine).
 * Returns an error string, or null when the signature is acceptable.
 */
export function manualSignatureError(
  signatureName: string,
  provider: { firstName?: string; lastName?: string } | undefined,
): string | null {
  const typed = String(signatureName || '').trim();
  if (!typed) {
    return 'A signature is required on a manual session. Type the provider full name to sign.';
  }
  if (typed.length < 3) return 'Type the provider full name to sign this session.';
  if (!provider) return null;
  const typedTokens = new Set(nameTokens(typed));
  const first = nameTokens(provider.firstName || '');
  const last = nameTokens(provider.lastName || '');
  const hasAll = (parts: string[]) => parts.every((p) => typedTokens.has(p));
  if ((first.length && !hasAll(first.slice(0, 1))) || (last.length && !hasAll(last.slice(-1)))) {
    const expected = `${provider.firstName || ''} ${provider.lastName || ''}`.trim();
    return `The signature must be the provider's name (${expected}).`;
  }
  return null;
}
