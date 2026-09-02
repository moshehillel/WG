import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/tms-web');
const out = path.join(root, 'netlify-upload/white-glove-tms');

const apiUrl = process.env.TMS_API_URL || 'PASTE_YOUR_TmsApiUrl_HERE';
const userPoolId = process.env.TMS_USER_POOL_ID || '';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css']) {
  cpSync(path.join(src, file), path.join(out, file));
}

writeFileSync(
  path.join(out, 'config.js'),
  `window.TMS_CONFIG={apiUrl:${JSON.stringify(apiUrl)},userPoolId:${JSON.stringify(userPoolId)}};\n`,
);

writeFileSync(
  path.join(out, 'README.txt'),
  `White Glove Therapy — Netlify upload folder
==========================================

1. Open config.js and replace PASTE_YOUR_TmsApiUrl_HERE with your AWS TmsApiUrl
   (from: npm run cdk -w @white-glove/infra -- deploy)

2. In Netlify: Add new site -> Deploy manually -> drag THIS FOLDER onto the page.

3. Open the Netlify site URL. Use the role dropdown (therapist / admin) to test.

API stays on White Glove AWS. This folder is only the static UI.

To rebuild this folder from source:
  npm run tms:netlify
  TMS_API_URL=https://... npm run tms:netlify
`,
);

console.log(`Ready: ${out}`);
if (apiUrl.includes('PASTE_')) {
  console.log('Edit config.js with your TmsApiUrl before uploading to Netlify.');
}
