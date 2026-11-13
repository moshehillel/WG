import { SESIS_ORIGIN_DEFAULT, SESIS_WORKSPACE_DEFAULT } from "./config.js";

export interface SesisCredentials {
  baseUrl: string;
  workspace: string;
  username: string;
  password: string;
}

export function loadSesisCredentials(): SesisCredentials {
  const baseUrl = process.env.SESIS_BASE_URL?.trim() || SESIS_ORIGIN_DEFAULT;
  const workspace = process.env.SESIS_WORKSPACE?.trim() || SESIS_WORKSPACE_DEFAULT;
  const username = process.env.SESIS_USERNAME?.trim() ?? "";
  const password = process.env.SESIS_PASSWORD ?? "";
  if (!username || !password) {
    throw new Error(
      "Set SESIS_USERNAME and SESIS_PASSWORD (repo-root .env) for a live SESIS download",
    );
  }
  return { baseUrl, workspace, username, password };
}
