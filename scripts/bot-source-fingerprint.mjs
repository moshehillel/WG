/**
 * Stable content hash of sources that end up inside the ProviderSoft bot image.
 * Used to tag ECR images (src-<hash>) and to fail deploys when the running
 * image is stale relative to the local tree.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = [
  'packages/providersoft-bot/Dockerfile',
  'packages/providersoft-bot/package.json',
  'packages/providersoft-bot/src',
  'packages/shared/package.json',
  'packages/shared/src',
];

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'tmp-column-probe',
  'tmp',
  'coverage',
  '.playwright',
  'downloads',
]);

function shouldHashFile(rel) {
  const base = path.basename(rel);
  if (base === 'Dockerfile') return true;
  return /\.(ts|tsx|js|mjs|cjs|json)$/i.test(base) && !base.endsWith('.map');
}

function collectFiles(abs, relBase, out) {
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (shouldHashFile(relBase)) out.push(relBase.replace(/\\/g, '/'));
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of fs.readdirSync(abs).sort()) {
    if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
    collectFiles(path.join(abs, name), path.join(relBase, name), out);
  }
}

export function listBotFingerprintFiles(root = repoRoot) {
  const files = [];
  for (const relRoot of ROOTS) {
    const abs = path.join(root, relRoot);
    if (!fs.existsSync(abs)) continue;
    collectFiles(abs, relRoot, files);
  }
  return [...new Set(files)].sort();
}

export function botSourceFingerprint(root = repoRoot) {
  const hash = crypto.createHash('sha256');
  for (const rel of listBotFingerprintFiles(root)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, rel)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function botSourceTag(fingerprint = botSourceFingerprint()) {
  return `src-${fingerprint}`;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const fp = botSourceFingerprint();
  console.log(
    JSON.stringify(
      { fingerprint: fp, tag: botSourceTag(fp), files: listBotFingerprintFiles().length },
      null,
      2,
    ),
  );
}