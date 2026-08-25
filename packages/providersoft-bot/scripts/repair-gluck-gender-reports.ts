import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { loadProviderSoftCredentials } from "../src/credentials.js";
import { loadRepoDotEnv } from "../src/load-dotenv.js";
import { loginUrl, REPORT_DATE_INPUTS, formatPsDate, defaultDateRange } from "../src/report-config.js";

loadRepoDotEnv();
const OUT = path.join(process.cwd(), "tmp-column-probe");

const OPENED_COLS = [
  "Child's Name","Program Id","Date of Birth","Date of Intake","Provider Name","Child's Address","Child's City","Child's State",
  "Primary Contact Name","Primary Contact Phone","Primary Contact Email","Child's Phone","Child's Zip Code","Ongoing Care Plan",
  "Service Type","Total Units Remaining","Service Begin Date","Service End Date","Times per Basic Mandate","Basic Mandate Frequency",
  "Authorization Number","Program Type","Gender:",
];
const NEW_SVC_COLS = [
  "Child's Name","Program Id","Date of Birth","Provider Name","Child's Address","Child's City","Child's State",
  "Primary Contact Name","Primary Contact Phone","Child's Zip Code","Service Type","Service Begin Date","Service End Date",
  "Authorization Number","Program Type","Gender:",
];

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function login(page: Page, creds: { baseUrl: string; username: string; password: string }) {
  await page.goto(loginUrl(creds.baseUrl), { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  await page.locator("#unametxt").fill(creds.username);
  await page.locator("#passtxt").fill(creds.password);
  await page.getByRole("button", { name: "Login" }).click();
  await settle(page);
  if (/login\.aspx/i.test(page.url())) throw new Error("login failed");
}

async function selectColumns(page: Page, want: string[]) {
  return page.evaluate((cols) => {
    const wantSet = new Set(cols);
    const checked: string[] = [];
    for (const lab of Array.from(document.querySelectorAll('[id^="Content_RptRepeater_lblReportColumnName_"]'))) {
      const name = (lab.textContent || "").trim();
      const idx = lab.id.split("_").pop()!;
      const chk = document.getElementById("Content_RptRepeater_chkReportColumn_" + idx) as HTMLInputElement | null;
      if (!chk) continue;
      const should = wantSet.has(name);
      if (should !== chk.checked) chk.click();
      if (should) checked.push(name);
    }
    const missing = cols.filter((c) => !checked.includes(c));
    return { checked, missing, total: document.querySelectorAll('[id^="Content_RptRepeater_lblReportColumnName_"]').length };
  }, want);
}

async function buildAndMemorize(
  page: Page,
  base: string,
  name: string,
  cols: string[],
  dateKind: "opened_cases" | "new_services",
) {
  console.log("\n=== Build", name, "===");
  await page.goto(base + "/ReportWizard/ReportWizardStep1.aspx", { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  await page.locator("select").first().selectOption({ label: "Service Report" });
  await settle(page);
  await page.getByRole("button", { name: "Next >>" }).click({ timeout: 60000 });
  await settle(page);
  const draftId =
    new URL(page.url()).searchParams.get("UserReportid") ||
    new URL(page.url()).searchParams.get("UserReportId");
  console.log("draftId", draftId, page.url());
  const sel = await selectColumns(page, cols);
  console.log("columns", sel);
  if (sel.missing.length) throw new Error("Missing columns: " + sel.missing.join(", "));

  await page.getByRole("button", { name: "Next >>" }).click({ timeout: 60000 });
  await settle(page);
  const range = defaultDateRange(dateKind);
  const inputs = REPORT_DATE_INPUTS[dateKind];
  // Date of Intake for opened; Service Begin for new services — try known selectors, else first date pair
  const from = page.locator(inputs.from);
  const to = page.locator(inputs.to);
  if (await from.count()) {
    await from.fill(range.from);
    await to.fill(range.to);
    console.log("dates", range);
  } else {
    console.log("WARN: standard date selectors missing; leaving filters empty");
  }
  await page.getByRole("button", { name: "Next >>" }).click({ timeout: 60000 });
  await settle(page);
  // Step4 may only have Previous — go to ReportView directly
  await page.goto(base + `/ReportWizard/ReportView.aspx?UserReportId=${draftId}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await settle(page);

  // Export to verify Gender
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 180000 }),
    page.getByRole("button", { name: "Export to Excel" }).click({ timeout: 60000 }),
  ]);
  const csvPath = path.join(OUT, `rebuilt-${name.replace(/\s+/g, "-")}.csv`);
  await download.saveAs(csvPath);
  const header = (await readFile(csvPath, "utf8")).split(/\r?\n/)[0] ?? "";
  console.log("export header:", header);
  if (!/Gender/i.test(header)) throw new Error("Rebuilt export still lacks Gender for " + name);
  if (/Real DOB/i.test(header)) console.log("NOTE: Real DOB still present");

  // Memorize — fill report name if prompted
  page.once("dialog", async (d) => {
    console.log("dialog", d.type(), d.message());
    await d.accept(name);
  });
  await page.getByRole("button", { name: "Memorize" }).click({ timeout: 60000 });
  await settle(page);
  // Some PS builds use an on-page textbox instead of dialog
  const nameBox = page.locator("#Content_txtReportName, input[name*='ReportName'], input[id*='ReportName']");
  if (await nameBox.count()) {
    await nameBox.first().fill(name);
    const save = page.getByRole("button", { name: /Save|OK|Memorize/i });
    if (await save.count()) await save.first().click();
    await settle(page);
  }
  console.log("after memorize URL", page.url());
  const body = (await page.locator("body").innerText()).slice(0, 800);
  console.log(body);

  // Confirm final id from URL
  const finalId =
    new URL(page.url()).searchParams.get("UserReportId") ||
    new URL(page.url()).searchParams.get("UserReportid") ||
    draftId;
  return { name, userReportId: finalId!, header, csvPath };
}

/**
 * Rebuild + Memorize "Gluck open" and "new service" with Gender: columns.
 *
 * Usage (repo root):
 *   npm run train:rebuild-gender -w @white-glove/providersoft-bot
 *   npm run train:rebuild-gender -w @white-glove/providersoft-bot -- --headless
 *
 * After success, copy UserReportIds into `.env`:
 *   PROVIDERSOFT_REPORT_OPENED_ID=…
 *   PROVIDERSOFT_REPORT_NEW_SERVICES_ID=…
 */
async function main() {
  await mkdir(OUT, { recursive: true });
  const headless = process.argv.includes("--headless");
  const creds = await loadProviderSoftCredentials();
  const base = creds.baseUrl.replace(/\/$/, "");
  console.log(`repair-gluck-gender-reports (headless=${headless})`);
  const browser = await chromium.launch({ headless });
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  try {
    await login(page, creds);
    const opened = await buildAndMemorize(page, base, "Gluck open", OPENED_COLS, "opened_cases");
    const services = await buildAndMemorize(page, base, "new service", NEW_SVC_COLS, "new_services");
    const result = { opened, services, at: new Date().toISOString() };
    await writeFile(path.join(OUT, "rebuilt-report-ids.json"), JSON.stringify(result, null, 2));
    console.log("\nRESULT", JSON.stringify(result, null, 2));
    console.log("\nSuggested .env lines:");
    console.log(`PROVIDERSOFT_REPORT_OPENED_ID=${opened.userReportId}`);
    console.log(`PROVIDERSOFT_REPORT_NEW_SERVICES_ID=${services.userReportId}`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });