/**
 * Deploy Coordinator 2 on OpenedFn only (Gluck open + new services).
 * update-function-code only. Does not deploy SessionsFn, TMS, or CDK.
 * Does not change EventBridge schedules or start Step Functions.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const target = {
  id: 'opened',
  fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
  entry: 'packages/processors/src/handlers/opened.ts',
};

const rules = [
  'WhiteGlove-MondayApiPreview',
  'WhiteGloveStack-TuesdaySessionsScheduleC5134705-0uEUJoPO4wcQ',
  'WhiteGloveStack-NightlyCaseReportsSchedule20498DCD-BuDJo8jy9dRx',
];

function assertCoordinator2Bundle(bundled) {
  const decl = bundled.match(
    /var ([A-Za-z0-9_$]+)=10022046,([A-Za-z0-9_$]+)=67321,([A-Za-z0-9_$]+)=84898(?:[;,]|$)/,
  );
  if (!decl) {
    throw new Error('bundle missing Therapy Team 10022046 with Grace 67321 and Billu 84898');
  }
  const [, team, grace, billu] = decl;
  const split = new RegExp(
    `teamId:${team},coordinatorId:[A-Za-z0-9_$]+<=["']Q["']\\?${grace}:${billu}`,
  );
  if (!split.test(bundled)) {
    throw new Error('bundle missing A–Q / R–Z coordinator split (Grace 67321, Billu 84898)');
  }
  if (!bundled.includes('CoordinatorID2')) {
    throw new Error('bundle missing CoordinatorID2');
  }
  if (!bundled.includes('missing provider last name')) {
    throw new Error('bundle missing missing-last-name guard');
  }
  if (!bundled.includes('Grace Greenfeld') || !bundled.includes('Billu Markowitz')) {
    throw new Error('bundle missing Grace Greenfeld and Billu Markowitz verify names');
  }
  if (!bundled.includes('Therapy Team')) {
    throw new Error('bundle missing Therapy Team label');
  }
  if (bundled.includes('>68033<') || bundled.includes('>81103<') || bundled.includes('>67322<')) {
    throw new Error('bundle writes a blocked coordinator id');
  }
}

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });

const outDir = path.join(__dirname, 'proc-opened-coordinator-2-asset');
const outfile = path.join(outDir, 'index.mjs');
const zipPath = path.join(__dirname, 'proc-opened-coordinator-2.zip');
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

await esbuild.build({
  entryPoints: [path.join(repoRoot, target.entry)],
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
assertCoordinator2Bundle(bundled);
console.log(target.id, 'bundle', fs.statSync(outfile).size, 'has CoordinatorID2');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${outfile.replace(/'/g, "''")}','${(outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: 'inherit' },
);

const out = execSync(
  `aws lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
  { encoding: 'utf8', cwd: __dirname },
);
console.log(target.id, out.trim());
execSync(`aws lambda wait function-updated --function-name ${target.fnName} --region us-east-1`, {
  stdio: 'inherit',
});
const confirmed = execSync(
  `aws lambda get-function-configuration --function-name ${target.fnName} --region us-east-1 --query "{FunctionName:FunctionName,CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize,State:State,LastUpdateStatus:LastUpdateStatus}" --output json`,
  { encoding: 'utf8' },
);
console.log(target.id, 'confirmed', confirmed.trim());

for (const name of rules) {
  const rule = execSync(
    `aws events describe-rule --name ${name} --region us-east-1 --query "{Name:Name,State:State,ScheduleExpression:ScheduleExpression}" --output json`,
    { encoding: 'utf8' },
  );
  console.log('rule', rule.trim());
  const parsed = JSON.parse(rule);
  if (parsed.State !== 'ENABLED') {
    throw new Error(`${name} is ${parsed.State}`);
  }
}

console.log('Coordinator 2 deployed to OpenedFn. SessionsFn not updated. Schedules not changed. No step functions execution.');
