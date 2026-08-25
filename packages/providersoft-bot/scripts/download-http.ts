#!/usr/bin/env node
/**
 * Download Gluck open + new service reports via ProviderSoft HTTP (no Playwright).
 *
 * Usage:
 *   npm run download:http -- --out DIR
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadProviderSoftCredentials } from "../src/credentials.js";
import { downloadReportsViaHttp } from "../src/http-download.js";
import { loadRepoDotEnv } from "../src/load-dotenv.js";
import {
  BOT_REPORT_FILENAMES,
  defaultDateRange,
  type BotReportKind,
} from "../src/report-config.js";

loadRepoDotEnv();

const DEFAULT_OUT = "C:\\Users\\Moshe\\Downloads\\bot-http-download";
const DEFAULT_KINDS: BotReportKind[] = [
  "opened_cases",
  "closed_cases",
  "discharge_service",
  "new_services",
  "caregiver_codes",
];

function parseArgs(argv: string[]): {
  out: string;
  kinds: BotReportKind[];
  compareOpen?: string;
  compareNew?: string;
} {
  let out = process.env.LOCAL_DOWNLOAD_DIR ?? DEFAULT_OUT;
  let kinds = [...DEFAULT_KINDS];
  let compareOpen =
    process.env.COMPARE_OPEN ?? "C:\\Users\\Moshe\\Downloads\\Gluck open (5).csv";
  let compareNew =
    process.env.COMPARE_NEW ?? "C:\\Users\\Moshe\\Downloads\\new service (1).csv";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) {
      out = argv[++i]!;
    } else if (a === "--kinds" && argv[i + 1]) {
      kinds = argv[++i]!.split(",").map((k) => k.trim()) as BotReportKind[];
    } else if (a === "--compare-open" && argv[i + 1]) {
      compareOpen = argv[++i]!;
    } else if (a === "--compare-new" && argv[i + 1]) {
      compareNew = argv[++i]!;
    } else if (a === "--no-compare") {
      compareOpen = undefined;
      compareNew = undefined;
    }
  }
  return { out, kinds, compareOpen, compareNew };
}

function parseCsvHeader(text: string): string[] {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return first.split(",").map((h) => h.trim());
}

function hasGender(headers: string[]): boolean {
  return headers.some((h) => /^gender:?$/i.test(h.replace(/^\uFEFF/, "")));
}

function summarizeHeaders(label: string, headers: string[]): void {
  const gender = hasGender(headers);
  console.log("\n=== " + label + " ===");
  console.log("columns (" + headers.length + "): " + headers.join(" | "));
  console.log("Gender present: " + (gender ? "YES" : "NO"));
}

function diffHeaders(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const norm = (h: string) => h.replace(/^\uFEFF/, "").replace(/:$/, "").trim().toLowerCase();
  const setA = new Set(a.map(norm).filter(Boolean));
  const setB = new Set(b.map(norm).filter(Boolean));
  return {
    onlyA: [...setA].filter((x) => !setB.has(x)),
    onlyB: [...setB].filter((x) => !setA.has(x)),
  };
}

async function main() {
  const { out, kinds, compareOpen, compareNew } = parseArgs(process.argv.slice(2));
  const downloadDir = path.resolve(out);
  await mkdir(downloadDir, { recursive: true });

  console.log("HTTP download ->", downloadDir);
  console.log("kinds:", kinds.join(", "));
  for (const kind of kinds) {
    const range = defaultDateRange(kind);
    console.log("  " + kind + " date window: " + range.from + " -> " + range.to);
  }

  const credentials = await loadProviderSoftCredentials();
  console.log("baseUrl:", credentials.baseUrl);
  console.log("username:", credentials.username ? "(set)" : "(missing)");

  const result = await downloadReportsViaHttp({
    credentials,
    downloadDir,
    kinds,
    onStep: (step, detail) => console.log("[" + step + "] " + detail),
  });

  console.log("\nDownloaded files:");
  for (const [kind, file] of Object.entries(result.files)) {
    console.log("  " + kind + ": " + file);
  }

  const compareByKind: Partial<Record<BotReportKind, string | undefined>> = {
    opened_cases: compareOpen,
    new_services: compareNew,
  };

  for (const kind of kinds) {
    const file = result.files[kind];
    if (!file) continue;
    const httpText = await readFile(file, "utf8");
    const httpHeaders = parseCsvHeader(httpText);
    const dataRows = httpText.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1;
    summarizeHeaders(
      "HTTP " + BOT_REPORT_FILENAMES[kind] + " (" + path.basename(file) + ")",
      httpHeaders,
    );
    console.log("data rows: " + Math.max(0, dataRows) + "  bytes: " + Buffer.byteLength(httpText, "utf8"));

    const comparePath = compareByKind[kind];
    if (!comparePath) continue;
    try {
      const refText = await readFile(comparePath, "utf8");
      const refHeaders = parseCsvHeader(refText);
      summarizeHeaders("Playwright/UI ref: " + path.basename(comparePath), refHeaders);
      const { onlyA, onlyB } = diffHeaders(httpHeaders, refHeaders);
      console.log("Header diff (normalized, ignore trailing colon):");
      console.log("  only in HTTP: " + (onlyA.length ? onlyA.join(", ") : "(none)"));
      console.log("  only in ref:  " + (onlyB.length ? onlyB.join(", ") : "(none)"));
      const same =
        onlyA.length === 0 &&
        onlyB.length === 0 &&
        httpHeaders.filter(Boolean).length === refHeaders.filter(Boolean).length;
      console.log("  same columns: " + (same ? "YES" : "NO"));
    } catch (err) {
      console.log("Compare skipped for " + kind + ": " + (err instanceof Error ? err.message : err));
    }
  }

  console.log("\nSUCCESS");
}

main().catch((err) => {
  console.error("\nFAILURE");
  console.error(err);
  process.exit(1);
});