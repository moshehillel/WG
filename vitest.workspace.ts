import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/hha-client',
  'packages/processors',
  'packages/providersoft-bot',
  'packages/tms-db',
  'packages/tms-api',
]);
