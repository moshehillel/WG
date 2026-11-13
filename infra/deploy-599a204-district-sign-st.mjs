/**
 * Deploy 599a204: district lookup, slash-date signatures, speech discipline ST.
 * Code-only. Does not change HHA_USE_PRODUCTION.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { stampLambdaGitEnv, readGitSha } from './deploy-stamp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const gitSha = readGitSha();
const region = 'us-east-1';

if (!gitSha.startsWith('599a204')) {
  throw new Error(`Refusing to deploy unexpected SHA ${gitSha}`);
}

const targets = [
  {
    id: 'tms-api',
    entry: 'packages/tms-api/src/handler.ts',
    fnName: 'WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ',
    mustInclude: [
      'District not found.',
      'Session is not signed',
      'TSSLD',
      'SPEECH',
    ],
  },
  {
    id: 'opened',
    entry: 'packages/processors/src/handlers/opened.ts',
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
    mustInclude: [
      'overlap-existing',
      'Overlapping shifts are not allowed',
      'ensureAcceptedServices',
      'SPEECH',
    ],
  },
];

for (const t of targets) {
  const outDir = path.join(__dirname, `deploy-599a204-${t.id}-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `deploy-599a204-${t.id}.zip`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  await esbuild.build({
    entryPoints: [path.join(repoRoot, t.entry)],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    outfile,
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    define: { 'process.env.TMS_GIT_SHA': JSON.stringify(gitSha) },
    mainFields: ['module', 'main'],
    external: ['playwright', 'playwright-core', '@playwright/test'],
  });

  const bundled = fs.readFileSync(outfile, 'utf8');
  for (const needle of t.mustInclude) {
    if (!bundled.includes(needle)) {
      throw new Error(`${t.id} bundle missing required string: ${needle}`);
    }
  }
  if (
    bundled.includes('==="SLP")return"SP"') ||
    bundled.includes('==="SLP"?"SP"') ||
    bundled.includes("speech therapy:\"SP\"") ||
    bundled.includes('"speech therapy":"SP"')
  ) {
    throw new Error(`${t.id} bundle still maps speech to SP`);
  }
  console.log(`${t.id}: bundled ${fs.statSync(outfile).size} bytes OK`);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const codeOut = execSync(
    `aws lambda update-function-code --region ${region} --function-name ${t.fnName} --zip-file fileb://${zipPath} --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
    { encoding: 'utf8', cwd: __dirname },
  );
  console.log(t.id, codeOut.trim());
  const stamped = stampLambdaGitEnv(t.fnName, { sha: gitSha });
  const env = execSync(
    `aws lambda get-function-configuration --region ${region} --function-name ${t.fnName} --query "{HHA_USE_PRODUCTION:Environment.Variables.HHA_USE_PRODUCTION,HHA_USE_MOCK:Environment.Variables.HHA_USE_MOCK,TMS_GIT_SHA:Environment.Variables.TMS_GIT_SHA,TMS_BUILT_AT:Environment.Variables.TMS_BUILT_AT,CodeSize:CodeSize,LastModified:LastModified}" --output json`,
    { encoding: 'utf8' },
  );
  console.log(t.id, 'env', env.trim());
  const envObj = JSON.parse(env);
  if (t.id === 'tms-api') {
    if (String(envObj.HHA_USE_PRODUCTION || '').toLowerCase() !== 'true') {
      throw new Error(`HHA_USE_PRODUCTION not true: ${env}`);
    }
    if (String(envObj.HHA_USE_MOCK || '').toLowerCase() === 'true') {
      throw new Error(`HHA_USE_MOCK unexpectedly true: ${env}`);
    }
  }
  if (String(envObj.TMS_GIT_SHA || '') !== gitSha) {
    throw new Error(`TMS_GIT_SHA mismatch: ${envObj.TMS_GIT_SHA} vs ${gitSha}`);
  }
  console.log(`${t.id} LIVE_OK sha=${stamped.sha}`);
}
