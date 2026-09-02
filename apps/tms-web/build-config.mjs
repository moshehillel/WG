import { writeFileSync } from 'node:fs';

const apiUrl = process.env.TMS_API_URL || '';
const userPoolId = process.env.TMS_USER_POOL_ID || '';
const clientId = process.env.TMS_CLIENT_ID || '';

writeFileSync(
  'config.js',
  `window.TMS_CONFIG={apiUrl:${JSON.stringify(apiUrl)},userPoolId:${JSON.stringify(userPoolId)},clientId:${JSON.stringify(clientId)}};`,
);

console.log('Wrote config.js', apiUrl ? `(api: ${apiUrl})` : '(api: empty — set TMS_API_URL)');
