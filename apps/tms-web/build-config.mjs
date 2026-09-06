import { writeFileSync } from 'node:fs';

// Prefer public URL (e.g. https://wgfront.netlify.app/api) when set; else TMS_API_URL.
const apiUrl = (process.env.TMS_API_PUBLIC_URL || process.env.TMS_API_URL || '').replace(/\/$/, '');
const userPoolId = process.env.TMS_USER_POOL_ID || '';
const clientId = process.env.TMS_CLIENT_ID || '';

writeFileSync(
  'config.js',
  `window.TMS_CONFIG={apiUrl:${JSON.stringify(apiUrl)},userPoolId:${JSON.stringify(userPoolId)},clientId:${JSON.stringify(clientId)}};`,
);

console.log('Wrote config.js', apiUrl ? `(api: ${apiUrl})` : '(api: empty — set TMS_API_URL)');
