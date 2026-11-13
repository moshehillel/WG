import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SESIS_DOWNLOAD_FILENAMES, type SesisDownloadKind } from "./config.js";
import type { SesisDownloadFiles } from "./download.js";

/** Minimal workbook marker so stub files are distinguishable without the live site. */
export function stubSpreadsheet(label: string): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(label, "utf8")]);
}

export async function writeStubReports(downloadDir: string): Promise<{ files: SesisDownloadFiles }> {
  await mkdir(downloadDir, { recursive: true });
  const files = {} as SesisDownloadFiles;
  const kinds = Object.keys(SESIS_DOWNLOAD_FILENAMES) as SesisDownloadKind[];
  for (const kind of kinds) {
    const filename = SESIS_DOWNLOAD_FILENAMES[kind];
    const dest = path.join(downloadDir, filename);
    await writeFile(dest, stubSpreadsheet(kind));
    files[kind] = dest;
  }
  return { files };
}
