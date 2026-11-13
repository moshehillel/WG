/**
 * Deploy Therapy Team 10022046 and coordinator-by-last-name (A–Q Grace 67321, R–Z Billu 84898).
 * SessionsFn and OpenedFn only. New services runs inside OpenedFn.
 * Does not change EventBridge schedules, start Step Functions, or touch TMS.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const targets = [
  {
    id: 'sessions',
    fnName: 'WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD',
    entry: 'packages/processors/src/handlers/sessions.ts',
  },
  {
    id: 'opened',
    fnName: 'WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC',
    entry: 'packages/processors/src/handlers/opened.ts',
  },
];

/**
 * Minified resolveTherapyAssignment keeps the ids in locals:
 * var Team=10022046,Grace=67321,Billu=84898[, nameMaps…];
 * … coordinatorId:initial<="Q"?Grace:Billu
 */
function assertAssignmentBundle(id, bundled) {
  const decl = bundled.match(
    /var ([A-Za-z0-9_$]+)=10022046,([A-Za-z0-9_$]+)=67321,([A-Za-z0-9_$]+)=84898(?:[;,]|$)/,
  );
  if (!decl) {
    throw new Error(`${id} bundle missing Therapy Team 10022046 with Grace 67321 and Billu 84898`);
  }
  const [, team, grace, billu] = decl;
  const split = new RegExp(
    `teamId:${team},coordinatorId:[A-Za-z0-9_$]+<=["']Q["']\\?${grace}:${billu}`,
  );
  if (!split.test(bundled)) {
    throw new Error(`${id} bundle missing A–Q / R–Z coordinator split (Grace 67321, Billu 84898)`);
  }
  if (!bundled.includes('missing provider last name')) {
    throw new Error(`${id} bundle missing missing-last-name guard`);
  }
  if (!bundled.includes('WGCC Therapy Services') || !bundled.includes('Therapy Team')) {
    throw new Error(`${id} bundle missing TeamID name labels for verify messages`);
  }
}

execSync('npm run build -w @white-glove/shared', { stdio: 'inherit', cwd: repoRoot });

const built = [];
for (const target of targets) {
  const outDir = path.join(__dirname, `proc-${target.id}-therapy-assignment-asset`);
  const outfile = path.join(outDir, 'index.mjs');
  const zipPath = path.join(__dirname, `proc-${target.id}-therapy-assignment.zip`);
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
  assertAssignmentBundle(target.id, bundled);
  console.log(target.id, 'bundle', fs.statSync(outfile).size, 'has 10022046 and A-Q/R-Z split');
  built.push({ ...target, outfile, zipPath });
}

for (const target of built) {
  if (fs.existsSync(target.zipPath)) fs.unlinkSync(target.zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${target.outfile.replace(/'/g, "''")}','${(target.outfile + '.map').replace(/'/g, "''")}' -DestinationPath '${target.zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );

  const out = execSync(
    `aws lambda update-function-code --function-name ${target.fnName} --zip-file fileb://${target.zipPath} --region us-east-1 --query "{CodeSha256:CodeSha256,LastModified:LastModified,CodeSize:CodeSize}" --output json`,
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
}

console.log('therapy assignment deployed. schedules not changed.');
