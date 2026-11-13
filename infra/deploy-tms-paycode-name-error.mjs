/**
 * Code deploy: Invalid PayCodeID (-74) errors name the pay code sent
 * (e.g. OT $62.5) and PayCodeID. Does not change HHA_USE_PRODUCTION.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

process.env.AWS_NO_VERIFY_SSL = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'tms-api-paycode-name-error-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'tms-api-paycode-name-error.zip');
const fnName = 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ';

console.log('building @white-glove/shared + @white-glove/tms-db…');
execSync('npm run build -w @white-glove/shared -w @white-glove/tms-db', {
  cwd: repoRoot,
  stdio: 'inherit',
});

const transferSrc = fs.readFileSync(
  path.join(repoRoot, 'packages/tms-api/src/hha-transfer.ts'),
  'utf8',
);
if (!transferSrc.includes('Invalid PayCodeID for "')) {
  throw new Error('hha-transfer.ts missing named PayCodeID error — aborting');
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

const bundled = fs.readFileSync(outfile, 'utf8');
if (!bundled.includes('Invalid PayCodeID for "') || !bundled.includes('not on this caregiver')) {
  throw new Error('Bundle missing named PayCodeID error — aborting');
}
console.log('bundle guard OK');

const aws = 'aws --no-verify-ssl';
const envQuery =
  '{HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_ALLOW_PRODUCTION:Environment.Variables.HHA_ALLOW_PRODUCTION,Handler:Handler,Runtime:Runtime}';
const envBefore = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log('env before', envBefore);
const before = JSON.parse(envBefore);
if (before.HHA_USE_PRODUCTION !== true && before.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`Refusing deploy: HHA_USE_PRODUCTION is ${before.HHA_USE_PRODUCTION}`);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}'${fs.existsSync(outfile + '.map') ? `, '${(outfile + '.map').replace(/'/g, "''")}'` : ''} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `${aws} lambda update-function-code --function-name ${fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(out);
stampLambdaGitEnv(fnName, { sha: readGitSha() });

const env = execSync(
  `${aws} lambda get-function-configuration --function-name ${fnName} --query "${envQuery}" --output json`,
  { encoding: 'utf8' },
);
console.log(env);
const after = JSON.parse(env);
if (after.HHA_USE_PRODUCTION !== true && after.HHA_USE_PRODUCTION !== 'true') {
  throw new Error(`HHA_USE_PRODUCTION changed: ${after.HHA_USE_PRODUCTION}`);
}
