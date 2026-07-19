import type { ProviderSoftCredentials } from './credentials.js';
import { loginUrl } from './report-config.js';

export type CookieJar = Map<string, string>;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

export function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseSetCookie(header: string | null, jar: CookieJar) {
  if (!header) return;
  for (const part of splitSetCookie(header)) {
    const nv = part.split(';')[0]?.trim();
    if (!nv) continue;
    const eq = nv.indexOf('=');
    if (eq <= 0) continue;
    jar.set(nv.slice(0, eq), nv.slice(eq + 1));
  }
}

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=[^;]+=)/);
}

function applySetCookies(res: Response, jar: CookieJar) {
  const cookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of cookies) parseSetCookie(c as string, jar);
}

export function pickHidden(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<input[^>]*name=["']${escapeRe(name)}["'][^>]*value=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m?.[1] !== undefined) return decodeHtml(m[1]);
  const re2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${escapeRe(name)}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2?.[1] !== undefined ? decodeHtml(m2[1]) : undefined;
}

/** Collect ASP.NET hidden fields into a URLSearchParams body. */
export function collectHiddenFields(html: string): URLSearchParams {
  const body = new URLSearchParams();
  const re =
    /<input[^>]*type=["']hidden["'][^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const value = attr(tag, 'value') ?? '';
    body.set(name, decodeHtml(value));
  }
  return body;
}

export function findSubmitByValue(
  html: string,
  value: string,
): { name: string; value: string } | undefined {
  const re = /<(?:input|button)[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const v = attr(tag, 'value');
    const name = attr(tag, 'name');
    if (!name || !v) continue;
    if (v.trim().toLowerCase() === value.trim().toLowerCase()) {
      return { name, value: v };
    }
  }
  // Buttons sometimes put text between tags
  const btnRe = /<button[^>]*name=["']([^"']+)["'][^>]*>([^<]*)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = btnRe.exec(html))) {
    if (m[2]?.trim().toLowerCase() === value.trim().toLowerCase()) {
      return { name: m[1]!, value: m[2]!.trim() };
    }
  }
  return undefined;
}

/** Resolve form `name` for an element id (Telerik/ASP.NET). */
export function pickNameById(html: string, id: string): string | undefined {
  const clean = id.replace(/^#/, '');
  const re = new RegExp(
    `<input[^>]*id=["']${escapeRe(clean)}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  if (!tag) {
    // try name that mirrors id with $ instead of _
    return clean.includes('_') ? clean.replace(/_/g, '$') : undefined;
  }
  return attr(tag, 'name') ?? clean.replace(/_/g, '$');
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return m?.[1];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) {
    const u = new URL(base);
    return `${u.origin}${path}`;
  }
  return `${base}/${path.replace(/^\//, '')}`;
}

export class PsHttpClient {
  readonly jar: CookieJar = new Map();
  constructor(readonly creds: ProviderSoftCredentials) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': UA,
      Cookie: cookieHeader(this.jar),
      ...extra,
    };
  }

  async get(url: string): Promise<{ status: number; url: string; html: string; location?: string }> {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: this.headers(),
    });
    applySetCookies(res, this.jar);
    const location = res.headers.get('location') ?? undefined;
    // Follow one hop for same-site redirects (except download binary)
    if (res.status >= 300 && res.status < 400 && location && !/Download\.asp/i.test(location)) {
      const next = joinUrl(this.creds.baseUrl, location);
      return this.get(next);
    }
    const html = await res.text();
    return { status: res.status, url, html, location };
  }

  async postForm(
    url: string,
    body: URLSearchParams,
  ): Promise<{ status: number; url: string; html: string; location?: string; raw: Response }> {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers({
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: new URL(this.creds.baseUrl).origin,
        Referer: url,
      }),
      body,
    });
    applySetCookies(res, this.jar);
    const location = res.headers.get('location') ?? undefined;
    const html =
      location && /Download\.asp/i.test(location) ? '' : await res.text();
    return { status: res.status, url, html, location, raw: res };
  }

  async getBinary(url: string): Promise<Buffer> {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: this.headers({ Accept: '*/*' }),
    });
    applySetCookies(res, this.jar);
    if (!res.ok) {
      throw new Error(`Download failed HTTP ${res.status} for ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async login(): Promise<void> {
    const url = loginUrl(this.creds.baseUrl);
    const page = await this.get(url);
    const viewState = pickHidden(page.html, '__VIEWSTATE');
    const viewStateGen = pickHidden(page.html, '__VIEWSTATEGENERATOR');
    if (!viewState || !viewStateGen) {
      throw new Error('HTTP login: missing __VIEWSTATE on login page');
    }
    const body = new URLSearchParams({
      __EVENTTARGET: 'btnLogin',
      __EVENTARGUMENT: '',
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      unametxt: this.creds.username,
      passtxt: this.creds.password,
    });
    const eventValidation = pickHidden(page.html, '__EVENTVALIDATION');
    if (eventValidation) body.set('__EVENTVALIDATION', eventValidation);

    const post = await this.postForm(url, body);
    const authOk = [...this.jar.keys()].some((k) =>
      k.toLowerCase().startsWith('.providersoftauth'),
    );
    if (!authOk && post.status !== 302) {
      throw new Error(
        `HTTP login failed (status=${post.status}, location=${post.location ?? 'none'})`,
      );
    }
    if (!authOk) {
      // Some environments set cookie on follow
      if (post.location) {
        await this.get(joinUrl(this.creds.baseUrl, post.location));
      }
    }
    const stillMissing = ![...this.jar.keys()].some((k) =>
      k.toLowerCase().startsWith('.providersoftauth'),
    );
    if (stillMissing) {
      throw new Error('HTTP login failed: auth cookie not set');
    }
  }
}
