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

/** Match <input>/<button> tags even when attribute values contain ">" (e.g. value="Next >>"). */
function matchInputOrButtonTags(html: string): string[] {
  const re = /<(?:input|button)\b(?:[^"'<>]*|"[^"]*"|'[^']*')*>/gi;
  return html.match(re) ?? [];
}

/** Collect ASP.NET hidden fields into a URLSearchParams body. */
export function collectHiddenFields(html: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const tag of matchInputOrButtonTags(html)) {
    if (!/\btype\s*=\s*["']hidden["']/i.test(tag)) continue;
    const name = attr(tag, 'name');
    if (!name) continue;
    const value = attr(tag, 'value') ?? '';
    body.set(name, decodeHtml(value));
  }
  return body;
}

const SKIP_INPUT_TYPES = new Set([
  'submit',
  'button',
  'image',
  'reset',
  'file',
]);

/**
 * Collect a browser-like form POST body: hidden + text + checked boxes/radios +
 * selected <select> + <textarea>. Needed for Report Wizard Step 2 (column checkboxes).
 */
export function collectFormFields(html: string): URLSearchParams {
  const body = new URLSearchParams();

  for (const tag of matchInputOrButtonTags(html)) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const type = (attr(tag, 'type') ?? 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) continue;
    if (type === 'checkbox' || type === 'radio') {
      if (!/\bchecked\b/i.test(tag)) continue;
      body.append(decodeHtml(name), decodeHtml(attr(tag, 'value') ?? 'on'));
      continue;
    }
    body.set(decodeHtml(name), decodeHtml(attr(tag, 'value') ?? ''));
  }

  const selectRe =
    /<select\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/select>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = selectRe.exec(html))) {
    const selectTag = `<select${sm[1]}>`;
    const name = attr(selectTag, 'name');
    if (!name) continue;
    const multiple = /\bmultiple\b/i.test(selectTag);
    const inner = sm[2] ?? '';
    const optRe = /<option\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    const selectedVals: string[] = [];
    let first: string | undefined;
    while ((om = optRe.exec(inner))) {
      const optTag = `<option${om[1]}>`;
      const val = attr(optTag, 'value') ?? om[2]?.replace(/<[^>]+>/g, '').trim() ?? '';
      if (first === undefined) first = val;
      if (/\bselected\b/i.test(optTag)) selectedVals.push(val);
    }
    if (multiple) {
      // Unselected multi-selects must NOT post the first option — that ANDs a
      // bogus filter (e.g. Closure Reason=Age Out) and returns empty open reports.
      for (const v of selectedVals) {
        body.append(decodeHtml(name), decodeHtml(v));
      }
      continue;
    }
    body.set(decodeHtml(name), decodeHtml(selectedVals[0] ?? first ?? ''));
  }

  const taRe =
    /<textarea\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/textarea>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = taRe.exec(html))) {
    const name = attr(`<textarea${tm[1]}>`, 'name');
    if (!name) continue;
    body.set(decodeHtml(name), decodeHtml(tm[2] ?? ''));
  }

  return body;
}

export function findSubmitByValue(
  html: string,
  value: string,
): { name: string; value: string; type?: string } | undefined {
  const want = value.trim().toLowerCase();
  for (const tag of matchInputOrButtonTags(html)) {
    const raw = attr(tag, 'value');
    const name = attr(tag, 'name');
    if (!name || raw === undefined) continue;
    const v = decodeHtml(raw);
    if (v.trim().toLowerCase() === want) {
      // Post the decoded label (ASP.NET expects "Next >>", not "Next &gt;&gt;")
      return {
        name: decodeHtml(name),
        value: v,
        type: (attr(tag, 'type') ?? 'submit').toLowerCase(),
      };
    }
  }
  // Buttons sometimes put text between tags
  const btnRe = /<button[^>]*name=["']([^"']+)["'][^>]*>([^<]*)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = btnRe.exec(html))) {
    const label = decodeHtml(m[2] ?? '').trim();
    if (label.toLowerCase() === want) {
      return { name: decodeHtml(m[1]!), value: label, type: 'submit' };
    }
  }
  return undefined;
}

/** Resolve form `name` for an element id (Telerik/ASP.NET). */
export function pickNameById(html: string, id: string): string | undefined {
  const clean = id.replace(/^#/, '');
  for (const tag of matchInputOrButtonTags(html)) {
    if (attr(tag, 'id') === clean) {
      return attr(tag, 'name') ?? clean.replace(/_/g, '$');
    }
  }
  return undefined;
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
