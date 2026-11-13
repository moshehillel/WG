import type { SesisCredentials } from "./credentials.js";
import { pickHidden } from "./form.js";

export type CookieJar = Map<string, string>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export type SesisHttpResult =
  | { kind: "html"; status: number; url: string; html: string }
  | { kind: "redirect"; status: number; url: string; location: string }
  | { kind: "file"; status: number; url: string; bytes: Buffer };

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=[^;]+=)/);
}

function parseSetCookie(header: string | null, jar: CookieJar) {
  if (!header) return;
  for (const part of splitSetCookie(header)) {
    const nv = part.split(";")[0]?.trim();
    if (!nv) continue;
    const eq = nv.indexOf("=");
    if (eq <= 0) continue;
    jar.set(nv.slice(0, eq), nv.slice(eq + 1));
  }
}

function applySetCookies(res: Response, jar: CookieJar) {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of cookies) parseSetCookie(c as string, jar);
}

function isSpreadsheet(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  const cd = res.headers.get("content-disposition") ?? "";
  return /spreadsheetml|octet-stream/i.test(ct) || /attachment/i.test(cd);
}

export class SesisHttpClient {
  readonly jar: CookieJar = new Map();
  readonly origin: string;

  constructor(
    readonly creds: SesisCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.origin = new URL(creds.baseUrl).origin;
  }

  private headers(referer: string | undefined, extra?: Record<string, string>): Record<string, string> {
    const cookie = cookieHeader(this.jar);
    return {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(referer ? { Referer: referer } : {}),
      ...extra,
    };
  }

  async get(url: string, hops = 0): Promise<{ status: number; url: string; html: string }> {
    if (hops > 5) throw new Error("SESIS redirect limit");
    const res = await this.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: this.headers(undefined),
    });
    applySetCookies(res, this.jar);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.arrayBuffer();
      return this.get(new URL(location, url).href, hops + 1);
    }
    const html = await res.text();
    return { status: res.status, url, html };
  }

  async post(url: string, body: URLSearchParams, referer: string): Promise<SesisHttpResult> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      headers: this.headers(referer, {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: this.origin,
      }),
      body,
    });
    applySetCookies(res, this.jar);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      await res.arrayBuffer();
      return { kind: "redirect", status: res.status, url, location };
    }
    if (isSpreadsheet(res)) {
      const bytes = Buffer.from(await res.arrayBuffer());
      return { kind: "file", status: res.status, url, bytes };
    }
    const html = await res.text();
    return { kind: "html", status: res.status, url, html };
  }

  /** GET login page, POST the capture's sign-in form, then open Provider Assignment. */
  async login(): Promise<string> {
    const loginUrl = new URL("/userlogin.aspx", this.origin).href;
    const page = await this.get(loginUrl);
    const viewState = pickHidden(page.html, "__VIEWSTATE");
    const viewStateGen = pickHidden(page.html, "__VIEWSTATEGENERATOR");
    if (!viewState || !viewStateGen) {
      throw new Error("SESIS login page did not include __VIEWSTATE");
    }
    const body = new URLSearchParams({
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      inmsg: "0",
      txtWorkspaceID: this.creds.workspace,
      txtUserID: this.creds.username,
      txtPassword: this.creds.password,
      hiddenAdvancedLogin: "Y",
      btnSignIn: "Sign In",
    });
    const eventValidation = pickHidden(page.html, "__EVENTVALIDATION");
    if (eventValidation) body.set("__EVENTVALIDATION", eventValidation);

    const posted = await this.post(loginUrl, body, loginUrl);
    if (posted.kind !== "redirect" || !/userhome\.aspx/i.test(posted.location)) {
      throw new Error(`SESIS login failed (status=${posted.status})`);
    }
    await this.get(new URL(posted.location, loginUrl).href);
    const portal = await this.get(new URL("/pa/", this.origin).href);
    if (!/\/pa\/Home\.aspx/i.test(portal.url)) {
      throw new Error(`SESIS provider assignment page did not load (status=${portal.status})`);
    }
    if (portal.status !== 200) {
      throw new Error(`SESIS provider assignment page did not load (status=${portal.status})`);
    }
    return portal.html;
  }
}
