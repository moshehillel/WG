/**
 * Out-of-band deploy of MfaDashboardFn (Function URL ops dashboard).
 *
 * Entry must be mfa-dashboard-api.ts. That module exports `handler` and
 * embeds the HTML via mfa-dashboard-ui.ts. Bundling the UI file alone
 * publishes renderDashboardHtml with no handler, and the Function URL
 * returns 502 (Runtime.HandlerNotFound).
 *
 * Does not change EventBridge schedules, HHA_USE_PRODUCTION, or billing aliases.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stampLambdaGitEnv } from './deploy-stamp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'infra', 'mfa-dashboard-749b-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(repoRoot, 'infra', 'mfa-dashboard-749b.zip');
const fn = 'WhiteGloveStack-MfaDashboardFn44DF466B-SCwe37fvdd1R';

console.log('building @white-glove/shared…');
execSync('npm run build -w @white-glove/shared', { cwd: repoRoot, stdio: 'inherit' });

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages/processors/src/handlers/mfa-dashboard-api.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  minify: true,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  mainFields: ['module', 'main'],
  external: ['playwright', 'playwright-core', '@playwright/test'],
});

const code = fs.readFileSync(outfile, 'utf8');
const hasHandlerExport = /export\{[^}]*\bhandler\b/.test(code) || /exports\.handler\b/.test(code);
const hasPauseCopy = /do not use unless ops/i.test(code) || /discharge paused/i.test(code);
const hasStatusAction = code.includes('Unknown action') && code.includes('weekSummary');
const hasIdentityLogin = code.includes('api/v2/account/login');
const hasVerifyMessage = code.includes('Verification code was not accepted');
if (!hasHandlerExport || !hasPauseCopy || !hasStatusAction || !hasIdentityLogin || !hasVerifyMessage) {
  throw new Error(
    `MfaDashboard bundle failed checks: handler=${hasHandlerExport} pause=${hasPauseCopy} status=${hasStatusAction} identityLogin=${hasIdentityLogin} verify=${hasVerifyMessage}`,
  );
}
if (code.length < 20_000) {
  throw new Error(`MfaDashboard bundle is only ${code.length} bytes — refusing to publish a UI-only zip`);
}
console.log({
  bytes: code.length,
  hasHandlerExport,
  hasDischargeService: code.includes('discharge_service'),
  hasPauseCopy,
  hasStatusAction,
});

fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }));
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`,
  { stdio: 'inherit' },
);

execSync(
  `aws lambda update-function-code --function-name ${fn} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSize:CodeSize,CodeSha256:CodeSha256,LastModified:LastModified,LastUpdateStatus:LastUpdateStatus}" --output json`,
  { stdio: 'inherit' },
);
execSync(`aws lambda wait function-updated --function-name ${fn} --region us-east-1`, {
  stdio: 'inherit',
});
console.log(stampLambdaGitEnv(fn));
console.log('MFA dashboard handler deployed');
