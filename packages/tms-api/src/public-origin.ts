/** Public TMS site. Email links and same-host /api calls use this origin, with no path. */
export const TMS_PUBLIC_ORIGIN = 'https://tms.whiteglovecare.net';

/**
 * Site root only (scheme + host). A comma-separated CORS list contributes its first
 * origin. A trailing /api or other path is dropped so links are not doubled.
 */
export function tmsPublicOrigin(explicit?: string): string {
  const raw = String(
    explicit || process.env.TMS_SPA_ORIGIN || process.env.TMS_CORS_ORIGIN || TMS_PUBLIC_ORIGIN,
  );
  const first = raw.split(',')[0]?.trim() || TMS_PUBLIC_ORIGIN;
  try {
    const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return TMS_PUBLIC_ORIGIN;
    return `${url.protocol}//${url.host}`;
  } catch {
    return TMS_PUBLIC_ORIGIN;
  }
}
