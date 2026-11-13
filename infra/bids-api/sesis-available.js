/**
 * Available-bids download only (In Progress). Does not place a bid.
 * Ported for the Bids import Lambda from packages/sesis-bot request shapes.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const CONTEXT_FIELD = 'ctl00$ddlSelectedUserContext';
const CONTEXT_EVENT_TARGET = 'ctl00$ddlSelectedUserContext';
const OPEN_BIDS_EVENT_TARGET = 'ctl00$SubmitBidsLinkButton';
const EXPORT_BUTTON_NAME = 'ctl00$MainPlaceholder$ExportToExcelButton';
const EXPORT_BUTTON_VALUE = 'Export To Excel';
const BID_STATUS_FIELD = 'ctl00$MainPlaceholder$BidStatusDropDownList';
const POSSIBLE_BIDS_STATUS = '3';
const AGE = { school_age: '0', preschool: '1' };

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return m?.[1];
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pickHidden(html, name) {
  const re = new RegExp(`<input[^>]*name=["']${name.replace(/\$/g, '\\$')}["'][^>]*value=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m?.[1] !== undefined) return decodeHtml(m[1]);
  const re2 = new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name.replace(/\$/g, '\\$')}["']`, 'i');
  const m2 = html.match(re2);
  return m2?.[1] !== undefined ? decodeHtml(m2[1]) : undefined;
}

function collectFormFields(html) {
  const body = new URLSearchParams();
  const tags = html.match(/<(?:input|button)\b(?:[^"'<>]*|"[^"]*"|'[^']*')*>/gi) || [];
  for (const tag of tags) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const type = (attr(tag, 'type') || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
    if (type === 'checkbox' || type === 'radio') {
      if (!/\bchecked\b/i.test(tag)) continue;
      body.append(decodeHtml(name), decodeHtml(attr(tag, 'value') || 'on'));
      continue;
    }
    body.set(decodeHtml(name), decodeHtml(attr(tag, 'value') || ''));
  }
  const selectRe = /<select\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/select>/gi;
  let sm;
  while ((sm = selectRe.exec(html))) {
    const selectTag = `<select${sm[1]}>`;
    const name = attr(selectTag, 'name');
    if (!name) continue;
    const inner = sm[2] || '';
    const optRe = /<option\b([^>]*(?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/option>/gi;
    let om;
    let selected;
    let first;
    while ((om = optRe.exec(inner))) {
      const optTag = `<option${om[1]}>`;
      const val = attr(optTag, 'value') ?? om[2]?.replace(/<[^>]+>/g, '').trim() ?? '';
      if (first === undefined) first = val;
      if (/\bselected\b/i.test(optTag)) selected = val;
    }
    body.set(decodeHtml(name), decodeHtml(selected ?? first ?? ''));
  }
  return body;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function applySetCookies(res, jar) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const header of cookies) {
    for (const part of String(header).split(/,(?=[^;]+=)/)) {
      const nv = part.split(';')[0]?.trim();
      if (!nv) continue;
      const eq = nv.indexOf('=');
      if (eq <= 0) continue;
      jar.set(nv.slice(0, eq), nv.slice(eq + 1));
    }
  }
}

function isSpreadsheet(res) {
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  return /spreadsheetml|octet-stream/i.test(ct) || /attachment/i.test(cd);
}

export class SesisClient {
  constructor(creds, fetchImpl = fetch) {
    this.creds = creds;
    this.fetchImpl = fetchImpl;
    this.jar = new Map();
    this.origin = new URL(creds.baseUrl).origin;
  }

  headers(referer, extra = {}) {
    const cookie = cookieHeader(this.jar);
    return {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(referer ? { Referer: referer } : {}),
      ...extra,
    };
  }

  async get(url, hops = 0) {
    if (hops > 5) throw new Error('SESIS redirect limit');
    const res = await this.fetchImpl(url, { method: 'GET', redirect: 'manual', headers: this.headers() });
    applySetCookies(res, this.jar);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.arrayBuffer();
      return this.get(new URL(location, url).href, hops + 1);
    }
    return { status: res.status, url, html: await res.text() };
  }

  async post(url, body, referer) {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers(referer, {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.origin,
      }),
      body,
    });
    applySetCookies(res, this.jar);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      await res.arrayBuffer();
      return { kind: 'redirect', status: res.status, url, location };
    }
    if (isSpreadsheet(res)) {
      return { kind: 'file', status: res.status, url, bytes: Buffer.from(await res.arrayBuffer()) };
    }
    return { kind: 'html', status: res.status, url, html: await res.text() };
  }

  async login() {
    const loginUrl = new URL('/userlogin.aspx', this.origin).href;
    const page = await this.get(loginUrl);
    const viewState = pickHidden(page.html, '__VIEWSTATE');
    const viewStateGen = pickHidden(page.html, '__VIEWSTATEGENERATOR');
    if (!viewState || !viewStateGen) throw new Error('SESIS login page did not include __VIEWSTATE');
    const body = new URLSearchParams({
      __EVENTTARGET: '',
      __EVENTARGUMENT: '',
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      inmsg: '0',
      txtWorkspaceID: this.creds.workspace,
      txtUserID: this.creds.username,
      txtPassword: this.creds.password,
      hiddenAdvancedLogin: 'Y',
      btnSignIn: 'Sign In',
    });
    const eventValidation = pickHidden(page.html, '__EVENTVALIDATION');
    if (eventValidation) body.set('__EVENTVALIDATION', eventValidation);
    const posted = await this.post(loginUrl, body, loginUrl);
    if (posted.kind !== 'redirect' || !/userhome\.aspx/i.test(posted.location)) {
      throw new Error(`SESIS login failed (status=${posted.status})`);
    }
    await this.get(new URL(posted.location, loginUrl).href);
    const portal = await this.get(new URL('/pa/', this.origin).href);
    if (!/\/pa\/Home\.aspx/i.test(portal.url) || portal.status !== 200) {
      throw new Error(`SESIS provider assignment page did not load (status=${portal.status})`);
    }
    return portal.html;
  }
}

function fillContextBody(html, contextValue) {
  const body = collectFormFields(html);
  body.set('__EVENTTARGET', CONTEXT_EVENT_TARGET);
  body.set('__EVENTARGUMENT', '');
  body.set(CONTEXT_FIELD, contextValue);
  body.delete(EXPORT_BUTTON_NAME);
  return body;
}

function fillOpenBidsBody(html) {
  const body = collectFormFields(html);
  body.set('__EVENTTARGET', OPEN_BIDS_EVENT_TARGET);
  body.set('__EVENTARGUMENT', '');
  body.delete(EXPORT_BUTTON_NAME);
  return body;
}

function fillExportBody(html, contextValue, withBidStatus = true) {
  const body = collectFormFields(html);
  body.set('__EVENTTARGET', '');
  body.set('__EVENTARGUMENT', '');
  body.set(CONTEXT_FIELD, contextValue);
  if (withBidStatus) body.set(BID_STATUS_FIELD, POSSIBLE_BIDS_STATUS);
  body.set(EXPORT_BUTTON_NAME, EXPORT_BUTTON_VALUE);
  return body;
}

export function fillOpenBidsBodyExport(html) {
  return fillOpenBidsBody(html);
}

export function fillPlaceBidBodyExport(html, plan = {}) {
  const body = collectFormFields(html);
  body.set('__EVENTTARGET', '');
  body.set('__EVENTARGUMENT', '');
  body.set('ctl00$MainPlaceholder$PlaceBidButton', 'Place Bid');
  if (plan.mandateId) body.set('ctl00$MainPlaceholder$MandateIdHidden', plan.mandateId);
  if (plan.assignmentId) body.set('ctl00$MainPlaceholder$AssignmentIdHidden', plan.assignmentId);
  if (plan.nycId) body.set('ctl00$MainPlaceholder$StudentIdHidden', plan.nycId);
  return body;
}

async function ensureContext(client, pageUrl, html, age) {
  const wanted = AGE[age];
  const current = collectFormFields(html).get(CONTEXT_FIELD);
  if (current === wanted) return html;
  const posted = await client.post(pageUrl, fillContextBody(html, wanted), pageUrl);
  if (posted.kind !== 'html' || posted.status !== 200) {
    throw new Error(`SESIS context switch failed (status=${posted.status})`);
  }
  return posted.html;
}

export async function downloadAvailableBidBytes(credentials, onStep) {
  const client = new SesisClient(credentials);
  const origin = client.origin;
  const homeUrl = new URL('/pa/Home.aspx', origin).href;
  const bidUrl = new URL('/pa/SubmitBid.aspx', origin).href;
  onStep?.('login', origin);
  const homeHtml = await client.login();
  onStep?.('open', 'available bids');
  const opened = await client.post(bidUrl, fillOpenBidsBody(homeHtml), homeUrl);
  if (opened.kind !== 'html' || opened.status !== 200) {
    throw new Error(`SESIS available-bids page failed (status=${opened.status})`);
  }
  let bidHtml = opened.html;
  const files = {};
  for (const age of ['preschool', 'school_age']) {
    bidHtml = await ensureContext(client, bidUrl, bidHtml, age);
    const filename = age === 'preschool' ? 'possible-bids-preschool.xlsx' : 'possible-bids-school-age.xlsx';
    onStep?.('export', filename);
    const posted = await client.post(bidUrl, fillExportBody(bidHtml, AGE[age]), bidUrl);
    if (posted.kind !== 'file' || posted.status !== 200 || posted.bytes.length < 4) {
      throw new Error(`SESIS ${filename} failed (status=${posted.status})`);
    }
    if (posted.bytes[0] !== 0x50 || posted.bytes[1] !== 0x4b) {
      throw new Error(`SESIS ${filename} did not return a spreadsheet`);
    }
    files[age === 'preschool' ? 'preschool' : 'schoolAge'] = posted.bytes;
  }
  return files;
}

export async function downloadAwardedBytes(credentials, onStep) {
  const client = new SesisClient(credentials);
  const origin = client.origin;
  const homeUrl = new URL('/pa/Home.aspx', origin).href;
  onStep?.('login', origin);
  let homeHtml = await client.login();
  const files = {};
  for (const age of ['school_age', 'preschool']) {
    homeHtml = await ensureContext(client, homeUrl, homeHtml, age);
    const filename = age === 'preschool' ? 'awarded-cases-preschool.xlsx' : 'awarded-cases-school-age.xlsx';
    onStep?.('export', filename);
    const posted = await client.post(homeUrl, fillExportBody(homeHtml, AGE[age], false), homeUrl);
    if (posted.kind !== 'file' || posted.status !== 200 || posted.bytes.length < 4) {
      throw new Error(`SESIS ${filename} failed (status=${posted.status})`);
    }
    if (posted.bytes[0] !== 0x50 || posted.bytes[1] !== 0x4b) {
      throw new Error(`SESIS ${filename} did not return a spreadsheet`);
    }
    files[age === 'preschool' ? 'preschool' : 'schoolAge'] = posted.bytes;
  }
  return files;
}
