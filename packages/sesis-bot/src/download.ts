import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SesisHttpClient } from "./client.js";
import {
  BID_STATUS_FIELD,
  CONTEXT_EVENT_TARGET,
  CONTEXT_FIELD,
  EXPORT_BUTTON_NAME,
  EXPORT_BUTTON_VALUE,
  OPEN_BIDS_EVENT_TARGET,
  POSSIBLE_BIDS_STATUS,
  SESIS_AGE_GROUPS,
  SESIS_DOWNLOAD_FILENAMES,
  type SesisAgeGroup,
  type SesisDownloadKind,
} from "./config.js";
import type { SesisCredentials } from "./credentials.js";
import { collectFormFields, isStatusChoice, listSelectOptions, statusSlug } from "./form.js";

export interface SesisDownloadOptions {
  credentials: SesisCredentials;
  downloadDir: string;
  fetchImpl?: typeof fetch;
  onStep?: (step: string, detail: string) => void;
}

export type SesisDownloadFiles = Record<SesisDownloadKind, string>;

export interface SesisExtraFile {
  age: SesisAgeGroup;
  status: string;
  path: string;
}

const HOME_STATUS_FIELDS = [
  {
    field: "ctl00$MainPlaceholder$AssignmentStatusDropDownList2016",
    slug: "assignment-status",
  },
  {
    field: "ctl00$MainPlaceholder$MandateStatusDropDownList",
    slug: "mandate-status",
  },
] as const;

export function fillContextBody(html: string, contextValue: string): URLSearchParams {
  const body = collectFormFields(html);
  body.set("__EVENTTARGET", CONTEXT_EVENT_TARGET);
  body.set("__EVENTARGUMENT", "");
  body.set(CONTEXT_FIELD, contextValue);
  body.delete(EXPORT_BUTTON_NAME);
  return body;
}

/** Post the Provider Assignment form onto SubmitBid.aspx. Does not place a bid. */
export function fillOpenBidsBody(html: string): URLSearchParams {
  const body = collectFormFields(html);
  body.set("__EVENTTARGET", OPEN_BIDS_EVENT_TARGET);
  body.set("__EVENTARGUMENT", "");
  body.delete(EXPORT_BUTTON_NAME);
  return body;
}

export function fillExportBody(
  html: string,
  spec: { contextValue: string; bidStatus?: string; fields?: Record<string, string> },
): URLSearchParams {
  const body = collectFormFields(html);
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set(CONTEXT_FIELD, spec.contextValue);
  if (spec.bidStatus !== undefined) body.set(BID_STATUS_FIELD, spec.bidStatus);
  for (const [name, value] of Object.entries(spec.fields ?? {})) body.set(name, value);
  body.set(EXPORT_BUTTON_NAME, EXPORT_BUTTON_VALUE);
  return body;
}

export function ageFileToken(age: SesisAgeGroup): string {
  return age === "preschool" ? "preschool" : "school-age";
}

export function assertSesisSpreadsheet(bytes: Buffer, label: string): void {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`SESIS ${label} did not return a spreadsheet`);
  }
}

async function ensureContext(
  client: SesisHttpClient,
  pageUrl: string,
  html: string,
  age: SesisAgeGroup,
  onStep?: SesisDownloadOptions["onStep"],
): Promise<string> {
  const wanted = SESIS_AGE_GROUPS[age].value;
  const current = collectFormFields(html).get(CONTEXT_FIELD);
  if (current === wanted) return html;
  onStep?.("context", SESIS_AGE_GROUPS[age].label);
  const posted = await client.post(pageUrl, fillContextBody(html, wanted), pageUrl);
  if (posted.kind !== "html" || posted.status !== 200) {
    throw new Error(
      `SESIS context switch to ${SESIS_AGE_GROUPS[age].label} failed (status=${posted.status})`,
    );
  }
  return posted.html;
}

async function saveNamedExport(
  client: SesisHttpClient,
  pageUrl: string,
  html: string,
  filename: string,
  spec: { contextValue: string; bidStatus?: string; fields?: Record<string, string> },
  downloadDir: string,
  onStep?: SesisDownloadOptions["onStep"],
): Promise<void> {
  onStep?.("export", filename);
  const posted = await client.post(pageUrl, fillExportBody(html, spec), pageUrl);
  if (posted.kind !== "file" || posted.status !== 200) {
    throw new Error(`SESIS ${filename} failed (status=${posted.status})`);
  }
  assertSesisSpreadsheet(posted.bytes, filename);
  await writeFile(path.join(downloadDir, filename), posted.bytes);
}

/**
 * Log in and save the four workbooks from the capture:
 * awarded cases (Mandates.xlsx) and possible bids (SubmitBids.xlsx),
 * each for school age and preschool.
 *
 * The school-age bids capture also sent __EVENTTARGET for the age dropdown
 * on the export itself, after a cancelled context-only post. This replays a
 * context postback first, then an export with an empty event target, which
 * matches both awarded-case exports and the preschool bids export.
 */
export async function downloadSesisReports(
  options: SesisDownloadOptions,
): Promise<{ files: SesisDownloadFiles; extraFiles: SesisExtraFile[] }> {
  await mkdir(options.downloadDir, { recursive: true });
  const client = new SesisHttpClient(options.credentials, options.fetchImpl);
  const origin = client.origin;
  const homeUrl = new URL("/pa/Home.aspx", origin).href;
  const bidUrl = new URL("/pa/SubmitBid.aspx", origin).href;

  options.onStep?.("login", origin);
  let homeHtml = await client.login();

  const files = {} as SesisDownloadFiles;
  const extraFiles: SesisExtraFile[] = [];

  for (const kind of ["awarded_cases_school_age", "awarded_cases_preschool"] as const) {
    const age: SesisAgeGroup = kind.endsWith("preschool") ? "preschool" : "school_age";
    homeHtml = await ensureContext(client, homeUrl, homeHtml, age, options.onStep);
    const awardedName = SESIS_DOWNLOAD_FILENAMES[kind];
    await saveNamedExport(
      client,
      homeUrl,
      homeHtml,
      awardedName,
      { contextValue: SESIS_AGE_GROUPS[age].value },
      options.downloadDir,
      options.onStep,
    );
    files[kind] = path.join(options.downloadDir, awardedName);
    await exportHomeStatuses(client, homeUrl, homeHtml, age, options, extraFiles);
  }

  options.onStep?.("open", "possible bids");
  const opened = await client.post(bidUrl, fillOpenBidsBody(homeHtml), homeUrl);
  if (opened.kind !== "html" || opened.status !== 200) {
    throw new Error(`SESIS possible-bids page failed (status=${opened.status})`);
  }
  let bidHtml = opened.html;

  for (const kind of ["possible_bids_preschool", "possible_bids_school_age"] as const) {
    const age: SesisAgeGroup = kind.endsWith("preschool") ? "preschool" : "school_age";
    bidHtml = await ensureContext(client, bidUrl, bidHtml, age, options.onStep);
    const bidName = SESIS_DOWNLOAD_FILENAMES[kind];
    await saveNamedExport(
      client,
      bidUrl,
      bidHtml,
      bidName,
      { contextValue: SESIS_AGE_GROUPS[age].value, bidStatus: POSSIBLE_BIDS_STATUS },
      options.downloadDir,
      options.onStep,
    );
    files[kind] = path.join(options.downloadDir, bidName);
  }

  for (const age of ["school_age", "preschool"] as const) {
    bidHtml = await ensureContext(client, bidUrl, bidHtml, age, options.onStep);
    await exportOtherBidStatuses(client, bidUrl, bidHtml, age, options, extraFiles);
  }

  return { files, extraFiles };
}

/**
 * Open bids only: In Progress on SubmitBid.aspx for preschool and school age.
 * Does not export awarded cases and does not place a bid.
 */
export async function downloadAvailableBids(
  options: SesisDownloadOptions,
): Promise<{ files: Pick<SesisDownloadFiles, "possible_bids_preschool" | "possible_bids_school_age"> }> {
  await mkdir(options.downloadDir, { recursive: true });
  const client = new SesisHttpClient(options.credentials, options.fetchImpl);
  const origin = client.origin;
  const homeUrl = new URL("/pa/Home.aspx", origin).href;
  const bidUrl = new URL("/pa/SubmitBid.aspx", origin).href;

  options.onStep?.("login", origin);
  const homeHtml = await client.login();

  options.onStep?.("open", "available bids");
  const opened = await client.post(bidUrl, fillOpenBidsBody(homeHtml), homeUrl);
  if (opened.kind !== "html" || opened.status !== 200) {
    throw new Error(`SESIS available-bids page failed (status=${opened.status})`);
  }
  let bidHtml = opened.html;
  const files = {} as Pick<SesisDownloadFiles, "possible_bids_preschool" | "possible_bids_school_age">;

  for (const kind of ["possible_bids_preschool", "possible_bids_school_age"] as const) {
    const age: SesisAgeGroup = kind.endsWith("preschool") ? "preschool" : "school_age";
    bidHtml = await ensureContext(client, bidUrl, bidHtml, age, options.onStep);
    const bidName = SESIS_DOWNLOAD_FILENAMES[kind];
    await saveNamedExport(
      client,
      bidUrl,
      bidHtml,
      bidName,
      { contextValue: SESIS_AGE_GROUPS[age].value, bidStatus: POSSIBLE_BIDS_STATUS },
      options.downloadDir,
      options.onStep,
    );
    files[kind] = path.join(options.downloadDir, bidName);
  }

  return { files };
}

async function exportHomeStatuses(
  client: SesisHttpClient,
  pageUrl: string,
  html: string,
  age: SesisAgeGroup,
  options: SesisDownloadOptions,
  extraFiles: SesisExtraFile[],
): Promise<void> {
  for (const spec of HOME_STATUS_FIELDS) {
    const choices = listSelectOptions(html, spec.field).filter(isStatusChoice);
    for (const choice of choices) {
      const filename = `awarded-cases-${ageFileToken(age)}-${spec.slug}-${statusSlug(choice.label)}.xlsx`;
      const saved = await tryExport(
        client,
        pageUrl,
        html,
        filename,
        {
          contextValue: SESIS_AGE_GROUPS[age].value,
          fields: { [spec.field]: choice.value },
        },
        options,
      );
      if (saved) extraFiles.push({ age, status: choice.label, path: saved });
    }
  }
}

async function exportOtherBidStatuses(
  client: SesisHttpClient,
  pageUrl: string,
  html: string,
  age: SesisAgeGroup,
  options: SesisDownloadOptions,
  extraFiles: SesisExtraFile[],
): Promise<void> {
  const choices = listSelectOptions(html, BID_STATUS_FIELD).filter(isStatusChoice);
  for (const choice of choices) {
    if (choice.value === POSSIBLE_BIDS_STATUS) continue;
    const filename = `possible-bids-${ageFileToken(age)}-${statusSlug(choice.label)}.xlsx`;
    const saved = await tryExport(
      client,
      pageUrl,
      html,
      filename,
      { contextValue: SESIS_AGE_GROUPS[age].value, bidStatus: choice.value },
      options,
    );
    if (saved) extraFiles.push({ age, status: choice.label, path: saved });
  }
}

async function tryExport(
  client: SesisHttpClient,
  pageUrl: string,
  html: string,
  filename: string,
  spec: { contextValue: string; bidStatus?: string; fields?: Record<string, string> },
  options: SesisDownloadOptions,
): Promise<string | undefined> {
  try {
    await saveNamedExport(client, pageUrl, html, filename, spec, options.downloadDir, options.onStep);
    return path.join(options.downloadDir, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    options.onStep?.("skip", message);
    return undefined;
  }
}
