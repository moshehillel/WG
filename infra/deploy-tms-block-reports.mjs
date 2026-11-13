/**
 * Code deploy for incorrect-error reports, Luna block explanations, and Billu tickets.
 * Does not change HHA_USE_PRODUCTION, coordinator ids, or the Luna chat OpenAI path.
 * If LUNA_SUPPORT_EMAIL is still an old inbox, only that one variable is updated.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-block-reports-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-block-reports.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';
const billu = 'bmarkowitz@whiteglovecare.net';

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

const bundled = fs.readFileSync(outfile, 'utf8');
for (const needle of [billu, 'moshe@advancedautomations.net', 'A written explanation could not be generated']) {
  if (!bundled.includes(needle)) {
    throw new Error(`Bundle missing ${needle}`);
  }
}
console.log('bundled', outfile);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);
console.log('zipped', zipPath, fs.statSync(zipPath).size);

const beforeEnvRaw = execSync(
  `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
  { encoding: 'utf8' },
);
const beforeEnv = JSON.parse(beforeEnvRaw);
if (String(beforeEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error('Refusing deploy: HHA_USE_PRODUCTION is not true');
}
const beforeCoordinator = beforeEnv.HHA_COORDINATOR_ID;

const out = execSync(
  `aws lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);

execSync(
  `aws lambda wait function-updated --function-name ${fnName}`,
  { stdio: 'inherit' },
);

let envNote = 'LUNA_SUPPORT_EMAIL already Billu';
if (String(beforeEnv.LUNA_SUPPORT_EMAIL || '').toLowerCase() !== billu) {
  const next = { ...beforeEnv, LUNA_SUPPORT_EMAIL: billu };
  if (next.HHA_USE_PRODUCTION !== 'true') throw new Error('Refusing env update: HHA flag');
  if (next.HHA_COORDINATOR_ID !== beforeCoordinator) throw new Error('Refusing env update: coordinator changed');
  const changed = Object.keys(next).filter((key) => next[key] !== beforeEnv[key]);
  if (changed.length !== 1 || changed[0] !== 'LUNA_SUPPORT_EMAIL') {
    throw new Error(`Refusing env update; keys would change: ${changed.join(',')}`);
  }
  const envFile = path.join(outDir, 'env.json');
  fs.writeFileSync(envFile, JSON.stringify({ Variables: next }));
  try {
    execSync(
      `aws lambda update-function-configuration --function-name ${fnName} --environment file://${envFile.replace(/\\/g, '/')} --query LastModified --output text`,
      { encoding: 'utf8' },
    );
    execSync(`aws lambda wait function-updated --function-name ${fnName}`, { stdio: 'inherit' });
    envNote = `LUNA_SUPPORT_EMAIL updated from ${beforeEnv.LUNA_SUPPORT_EMAIL} to ${billu}`;
  } finally {
    fs.unlinkSync(envFile);
  }
}

const afterEnv = JSON.parse(
  execSync(
    `aws lambda get-function-configuration --function-name ${fnName} --query Environment.Variables --output json`,
    { encoding: 'utf8' },
  ),
);
if (String(afterEnv.HHA_USE_PRODUCTION) !== 'true') {
  throw new Error('HHA_USE_PRODUCTION changed');
}
if (afterEnv.HHA_COORDINATOR_ID !== beforeCoordinator) {
  throw new Error('HHA_COORDINATOR_ID changed');
}
const drifted = Object.keys(beforeEnv).filter(
  (key) => key !== 'LUNA_SUPPORT_EMAIL' && afterEnv[key] !== beforeEnv[key],
);
if (drifted.length) throw new Error(`Env drifted: ${drifted.join(',')}`);

const stamp = [
  'TMS incorrect-error reports + Luna block explanations + Billu tickets',
  `Function: ${fnName}`,
  out.trim(),
  envNote,
  `HHA_USE_PRODUCTION: ${afterEnv.HHA_USE_PRODUCTION}`,
  `HHA_COORDINATOR_ID: ${afterEnv.HHA_COORDINATOR_ID}`,
  `LUNA_SUPPORT_EMAIL: ${afterEnv.LUNA_SUPPORT_EMAIL}`,
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'cdk-tms-block-reports-deploy-out.txt'), stamp);
console.log(stamp);
