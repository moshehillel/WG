#!/usr/bin/env node
/**
 * Download SESIS bids that are available now (In Progress), preschool and school age.
 *
 * Stub (no login, no network):
 *   npm run local:stubs
 *   npm run sesis:stubs
 * Live (SESIS_USERNAME, SESIS_PASSWORD, optional SESIS_WORKSPACE in repo-root .env):
 *   npm run local:download
 *   npm run sesis:download
 * Optional output directory: --out DIR
 * Default directory: <repo>/LOCAL_DOWNLOAD_DIR/sesis or <repo>/downloads/sesis
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSesisCredentials } from "./credentials.js";
import { downloadAvailableBids } from "./download.js";
import { loadRepoDotEnv } from "./load-dotenv.js";
import { writeStubReports } from "./stub-reports.js";

loadRepoDotEnv();

function parseArgs(argv: string[]): { stubs: boolean; out?: string } {
  let out: string | undefined;
  const stubs = argv.includes("--stubs");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
  }
  return { stubs, out };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function downloadDirFrom(out?: string): string {
  if (out) return path.resolve(out);
  const base = process.env.LOCAL_DOWNLOAD_DIR?.trim() || "./downloads";
  const rooted = path.isAbsolute(base) ? base : path.join(repoRoot(), base);
  return path.join(rooted, "sesis");
}

async function main() {
  const { stubs, out } = parseArgs(process.argv.slice(2));
  const downloadDir = downloadDirFrom(out);
  const local = stubs
    ? await writeStubReports(downloadDir)
    : await downloadAvailableBids({
        credentials: loadSesisCredentials(),
        downloadDir,
        onStep: (step, detail) => console.log(`[${step}] ${detail}`),
      });

  console.log(stubs ? "Stub files:" : "Downloaded:");
  for (const [kind, file] of Object.entries(local.files)) {
    if (!stubs && !kind.startsWith("possible_bids_")) continue;
    console.log(`  ${kind}: ${file}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
