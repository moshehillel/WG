/**
 * HTTP-only ProviderSoft login probe (no Playwright).
 *
 * Usage (from repo root, with values in `.env`):
 *   npm run login:probe -w @white-glove/providersoft-bot
 */
import { loadProviderSoftCredentials } from './credentials.js';
import { loadRepoDotEnv } from './load-dotenv.js';

loadRepoDotEnv();

type CookieJar = Map<string, string>;

function parseSetCookie(header: string | null, jar: CookieJar) {
  if (!header) return;
  // fetch may fold multiple Set-Cookie into one in some runtimes; split carefully
  for (const part of splitSetCookie(header)) {
    const nv = part.split(';')[0]?.trim();
    if (!nv) continue;
    const eq = nv.indexOf('=');
    if (eq <= 0) continue;
    jar.set(nv.slice(0, eq), nv.slice(eq + 1));
  }
}

function splitSetCookie(header: string): string[] {
  // Naive but OK for typical ASP.NET cookies (no Expires with commas in practice here).
  return header.split(/,(?=[^;]+=)/);
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function mask(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

function pickHidden(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m?.[1] !== undefined) return m[1];
  // alternate attribute order
  const re2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i',
  );
  return html.match(re2)?.[1];
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) {
    const u = new URL(base);
    return `${u.origin}${path}`;
  }
  return `${base}/${path.replace(/^\//, '')}`;
}

async function main() {
  const creds = await loadProviderSoftCredentials();
  const loginUrl = joinUrl(creds.baseUrl, 'security/login.aspx');
  const jar: CookieJar = new Map();

  console.log(`1) GET ${loginUrl}`);
  const getRes = await fetch(loginUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
  });
  // undici/node may expose getSetCookie
  const getSetCookies =
    typeof getRes.headers.getSetCookie === 'function'
      ? getRes.headers.getSetCookie()
      : [getRes.headers.get('set-cookie')].filter(Boolean);
  for (const c of getSetCookies) parseSetCookie(c as string, jar);

  const html = await getRes.text();
  const viewState = pickHidden(html, '__VIEWSTATE');
  const viewStateGen = pickHidden(html, '__VIEWSTATEGENERATOR');
  const eventValidation = pickHidden(html, '__EVENTVALIDATION');

  console.log(`   HTTP ${getRes.status}`);
  console.log(`   cookies: ${[...jar.keys()].join(', ') || '(none)'}`);
  console.log(`   __VIEWSTATE: ${viewState ? 'found' : 'MISSING'}`);
  console.log(`   __VIEWSTATEGENERATOR: ${viewStateGen ? 'found' : 'MISSING'}`);
  console.log(`   __EVENTVALIDATION: ${eventValidation ? 'found' : 'not present'}`);

  if (!viewState || !viewStateGen) {
    throw new Error('Could not parse ASP.NET form tokens from login page');
  }

  const body = new URLSearchParams({
    __EVENTTARGET: 'btnLogin',
    __EVENTARGUMENT: '',
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGen,
    unametxt: creds.username,
    passtxt: creds.password,
  });
  if (eventValidation) body.set('__EVENTVALIDATION', eventValidation);

  console.log(`2) POST ${loginUrl} (username=${creds.username})`);
  const postRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Origin: new URL(creds.baseUrl).origin,
      Referer: loginUrl,
      Cookie: cookieHeader(jar),
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
    body,
  });

  const postSetCookies =
    typeof postRes.headers.getSetCookie === 'function'
      ? postRes.headers.getSetCookie()
      : [postRes.headers.get('set-cookie')].filter(Boolean);
  for (const c of postSetCookies) parseSetCookie(c as string, jar);

  const location = postRes.headers.get('location');
  const authCookieName = [...jar.keys()].find((k) =>
    k.toLowerCase().startsWith('.providersoftauth'),
  );
  const authCookie = authCookieName ? jar.get(authCookieName) : undefined;

  console.log(`   HTTP ${postRes.status}`);
  console.log(`   Location: ${location ?? '(none)'}`);
  console.log(
    `   Auth cookie: ${
      authCookieName
        ? `${authCookieName}=${mask(authCookie ?? '')}`
        : '(not set)'
    }`,
  );

  const ok =
    postRes.status === 302 &&
    !!location &&
    /default\.aspx|MyWindow\.aspx/i.test(location) &&
    !!authCookie;

  if (ok) {
    console.log('\nSUCCESS: HTTP login works without a bot.');
    console.log('Next: capture report download Network requests with this session.');
    process.exitCode = 0;
  } else {
    const snippet = (await postRes.text()).slice(0, 300).replace(/\s+/g, ' ');
    console.log('\nFAILED: login did not look successful.');
    if (snippet) console.log(`Body snippet: ${snippet}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
