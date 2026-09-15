/**
 * Deploy: signed-PDF download on SignNow webhook + View backfill,
 * and switch TmsApiFn HHA path to production (Moshe explicit).
 * Then refresh signed PDF + Send-to-HHA for the James/Madison locked week.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-hha-prod-signed-pdf-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-hha-prod-signed-pdf.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const WEEK_ID = '8d9599a8-3266-4dbe-9349-6028c3e78195';

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: opts.cwd || __dirname, stdio: opts.stdio || 'pipe' });
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/tms-api/src/handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  outfile,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});
console.log('bundled', outfile);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const codeOut = sh(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
);
console.log('code', codeOut.trim());

// Wait for code update to settle before env update
sh(`aws lambda wait function-updated --function-name ${fnName}`);

const cfgRaw = sh(
  `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
);
const env = JSON.parse(cfgRaw);
const beforeHha = {
  HHA_USE_MOCK: env.HHA_USE_MOCK,
  HHA_USE_PRODUCTION: env.HHA_USE_PRODUCTION,
  HHA_ALLOW_PRODUCTION: env.HHA_ALLOW_PRODUCTION,
  TMS_ALLOW_DEV_HEADERS: env.TMS_ALLOW_DEV_HEADERS ?? null,
};
env.HHA_USE_MOCK = 'false';
env.HHA_USE_PRODUCTION = 'true';
env.HHA_ALLOW_PRODUCTION = 'true';
env.TMS_ALLOW_DEV_HEADERS = '1'; // ops invoke for refresh-pdf + HHA push, then restore

const envFile = path.join(__dirname, 'tmp-tms-hha-prod-env.json');
fs.writeFileSync(envFile, JSON.stringify({ Variables: env }));
sh(
  `aws lambda update-function-configuration --function-name ${fnName} --environment file://${envFile} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,LastModified:LastModified}" --output json`,
  { stdio: 'inherit' },
);
sh(`aws lambda wait function-updated --function-name ${fnName}`);

function httpEvent(method, rawPath, bodyObj) {
  return {
    version: '2.0',
    routeKey: `${method} ${rawPath}`,
    rawPath,
    headers: {
      'content-type': 'application/json',
      'x-tms-role': 'admin',
      'x-tms-email': 'moshe@advancedautomations.net',
    },
    requestContext: {
      http: { method, path: rawPath },
    },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    isBase64Encoded: false,
  };
}

function invoke(label, event) {
  const payloadPath = path.join(__dirname, `tmp-invoke-${label}.json`);
  const outPath = path.join(__dirname, `tmp-invoke-${label}-out.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(event));
  sh(
    `aws lambda invoke --function-name ${fnName} --cli-binary-format raw-in-base64-out --payload file://${payloadPath} ${outPath}`,
  );
  const raw = fs.readFileSync(outPath, 'utf8');
  console.log(`\n=== ${label} ===`);
  console.log(raw.slice(0, 4000));
  return raw;
}

const pdfOut = invoke(
  'refresh-pdf',
  httpEvent('POST', `/admin/weeks/${WEEK_ID}/refresh-signed-pdf`, {}),
);
const hhaOut = invoke('hha-push', httpEvent('POST', `/weeks/${WEEK_ID}/hha`, {}));

// Restore DEV headers to prior (unset) so prod stays locked down for admin UI auth
if (!beforeHha.TMS_ALLOW_DEV_HEADERS) {
  delete env.TMS_ALLOW_DEV_HEADERS;
} else {
  env.TMS_ALLOW_DEV_HEADERS = beforeHha.TMS_ALLOW_DEV_HEADERS;
}
fs.writeFileSync(envFile, JSON.stringify({ Variables: env }));
const finalEnv = sh(
  `aws lambda update-function-configuration --function-name ${fnName} --environment file://${envFile} --query "{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,TMS_ALLOW_DEV_HEADERS:Environment.Variables.TMS_ALLOW_DEV_HEADERS,LastModified:LastModified}" --output json`,
);
sh(`aws lambda wait function-updated --function-name ${fnName}`);

const summary = [
  'TMS HHA → PRODUCTION + signed PDF webhook/backfill',
  `Function: ${fnName}`,
  `Week pushed: ${WEEK_ID} (James Vasaturo / Madison Gluck, weekStart 2026-08-31)`,
  `HHA before: ${JSON.stringify(beforeHha)}`,
  `HHA after: USE_MOCK=false USE_PRODUCTION=true ALLOW_PRODUCTION=true`,
  `Code: ${codeOut.trim()}`,
  `Final env: ${finalEnv.trim()}`,
  '',
  'Sandbox failure (prior): Service code "PT school 30" not found in HHA billing codes for this contract',
  '',
  'refresh-signed-pdf response:',
  pdfOut.slice(0, 1500),
  '',
  'HHA push response:',
  hhaOut.slice(0, 2500),
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-hha-prod-signed-pdf-deploy-out.txt'), summary);
console.log('\n' + summary);
console.log('wrote cdk-tms-hha-prod-signed-pdf-deploy-out.txt');
