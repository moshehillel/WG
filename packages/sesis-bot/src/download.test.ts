import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BID_STATUS_FIELD,
  CONTEXT_FIELD,
  EXPORT_BUTTON_NAME,
  EXPORT_BUTTON_VALUE,
  POSSIBLE_BIDS_STATUS,
  SESIS_AGE_GROUPS,
  SESIS_DOWNLOAD_FILENAMES,
} from "./config.js";
import type { SesisCredentials } from "./credentials.js";
import { downloadSesisReports } from "./download.js";
import { assignmentPage, loginPage } from "./fixtures/redacted-pages.js";
import { writeStubReports } from "./stub-reports.js";

const credentials: SesisCredentials = {
  baseUrl: "https://sesis.example.test",
  workspace: "NYCONFIG",
  username: "EXAMPLE\\user",
  password: "test-password",
};

interface Seen {
  method: string;
  path: string;
  params: URLSearchParams;
  cookie: string;
}

function xlsx(filename: string): Response {
  return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment;filename=${filename}`,
    },
  });
}

function html(body: string, status = 200, extra?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });
}

function recordedFetch(seen: Seen[]): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    let params = new URLSearchParams();
    const body = init?.body;
    if (typeof body === "string") params = new URLSearchParams(body);
    else if (body instanceof URLSearchParams) params = body;
    const headers = new Headers(init?.headers);
    seen.push({
      method,
      path: url.pathname,
      params,
      cookie: headers.get("cookie") ?? "",
    });

    if (method === "GET" && url.pathname === "/userlogin.aspx") return html(loginPage());
    if (method === "POST" && url.pathname === "/userlogin.aspx") {
      return html("", 302, {
        location: "/userhome.aspx?js=Y",
        "set-cookie": "SESISAUTH=stub-session; Path=/",
      });
    }
    if (method === "GET" && url.pathname === "/userhome.aspx") return html("<html>ok</html>");
    if (method === "GET" && url.pathname === "/pa/") {
      return html("", 302, { location: "/pa/Home.aspx" });
    }
    if (method === "GET" && url.pathname === "/pa/Home.aspx") {
      return html(assignmentPage({ viewState: "vs-home-sa", context: "0", bids: false }));
    }
    if (method === "POST" && url.pathname === "/pa/Home.aspx") {
      if (params.get(EXPORT_BUTTON_NAME)) return xlsx("Mandates.xlsx");
      const context = params.get(CONTEXT_FIELD) === "1" ? "1" : "0";
      const viewState = context === "1" ? "vs-home-pre" : "vs-home-sa";
      return html(assignmentPage({ viewState, context, bids: false }));
    }
    if (method === "POST" && url.pathname === "/pa/SubmitBid.aspx") {
      if (params.get(EXPORT_BUTTON_NAME)) return xlsx("SubmitBids.xlsx");
      const context = params.get(CONTEXT_FIELD) === "0" ? "0" : "1";
      const viewState = context === "0" ? "vs-bid-sa" : "vs-bid-pre";
      return html(assignmentPage({ viewState, context, bids: true }));
    }
    return html("missing", 404);
  };
}

describe("SESIS redacted download", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("replays login and the four workbook posts", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sesis-redacted-"));
    const seen: Seen[] = [];
    const result = await downloadSesisReports({
      credentials,
      downloadDir: dir,
      fetchImpl: recordedFetch(seen),
    });

    const posts = seen.filter((s) => s.method === "POST");
    const login = posts.find((s) => s.path === "/userlogin.aspx");
    expect(login?.params.get("txtWorkspaceID")).toBe("NYCONFIG");
    expect(login?.params.get("txtUserID")).toBe("EXAMPLE\\user");
    expect(login?.params.get("txtPassword")).toBe("test-password");
    expect(login?.params.get("btnSignIn")).toBe("Sign In");
    expect(login?.params.get("hiddenAdvancedLogin")).toBe("Y");
    expect(login?.params.get("inmsg")).toBe("0");
    expect(login?.params.get("__VIEWSTATE")).toBe("vs-login");

    const homeGets = seen.filter((s) => s.method === "GET" && s.path === "/pa/Home.aspx");
    expect(homeGets[0]?.cookie).toContain("SESISAUTH=stub-session");

    const exports = posts.filter((s) => s.params.get(EXPORT_BUTTON_NAME) === EXPORT_BUTTON_VALUE);
    expect(exports.slice(0, 4).map((s) => [s.path, s.params.get(CONTEXT_FIELD), s.params.get(BID_STATUS_FIELD)])).toEqual([
      ["/pa/Home.aspx", SESIS_AGE_GROUPS.school_age.value, null],
      ["/pa/Home.aspx", SESIS_AGE_GROUPS.preschool.value, null],
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.preschool.value, POSSIBLE_BIDS_STATUS],
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.school_age.value, POSSIBLE_BIDS_STATUS],
    ]);
    expect(exports.slice(4).map((s) => [s.path, s.params.get(CONTEXT_FIELD), s.params.get(BID_STATUS_FIELD)])).toEqual([
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.school_age.value, "1"],
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.school_age.value, "4"],
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.preschool.value, "1"],
      ["/pa/SubmitBid.aspx", SESIS_AGE_GROUPS.preschool.value, "4"],
    ]);
    expect(exports.slice(0, 4).map((s) => s.params.get("__VIEWSTATE"))).toEqual([
      "vs-home-sa",
      "vs-home-pre",
      "vs-bid-pre",
      "vs-bid-sa",
    ]);
    expect(exports.every((s) => s.params.get("__EVENTTARGET") === "")).toBe(true);
    expect(exports.every((s) => s.params.get("ctl00$FiscalYearsDropDownList") === "31")).toBe(true);
    expect(exports.every((s) => !s.params.has("ctl00$MainPlaceholder$PlaceBidButton"))).toBe(true);

    const switches = posts.filter((s) => s.params.get("__EVENTTARGET") === CONTEXT_FIELD);
    expect(switches.map((s) => [s.path, s.params.get(CONTEXT_FIELD)])).toEqual([
      ["/pa/Home.aspx", "1"],
      ["/pa/SubmitBid.aspx", "0"],
      ["/pa/SubmitBid.aspx", "1"],
    ]);

    const opened = posts.find((s) => s.params.get("__EVENTTARGET") === "ctl00$SubmitBidsLinkButton");
    expect(opened?.path).toBe("/pa/SubmitBid.aspx");
    expect(opened?.params.get(CONTEXT_FIELD)).toBe("1");
    expect(opened?.params.has(EXPORT_BUTTON_NAME)).toBe(false);

    for (const filename of Object.values(SESIS_DOWNLOAD_FILENAMES)) {
      const bytes = await readFile(path.join(dir, filename));
      expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    }
    expect(Object.values(result.files).map((file) => path.basename(file)).sort()).toEqual(
      Object.values(SESIS_DOWNLOAD_FILENAMES).sort(),
    );
    expect(result.extraFiles.map((file) => path.basename(file.path)).sort()).toEqual([
      "possible-bids-preschool-awarded.xlsx",
      "possible-bids-preschool-not-awarded.xlsx",
      "possible-bids-school-age-awarded.xlsx",
      "possible-bids-school-age-not-awarded.xlsx",
    ]);
  });

  it("writes four stub workbooks without a password", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sesis-stub-"));
    const { files } = await writeStubReports(dir);
    expect(Object.keys(files).sort()).toEqual([
      "awarded_cases_preschool",
      "awarded_cases_school_age",
      "possible_bids_preschool",
      "possible_bids_school_age",
    ]);
    for (const file of Object.values(files)) {
      const bytes = await readFile(file);
      expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    }
  });
});
