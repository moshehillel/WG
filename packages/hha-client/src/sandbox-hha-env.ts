import { HHA_SANDBOX_SOAP_URL as SHARED_SANDBOX_URL } from '@white-glove/shared';

export const HHA_SANDBOX_SOAP_URL = SHARED_SANDBOX_URL;

/** Point SOAP reads at sandbox (clears production allow flag). */
export function applySandboxHhaReads(): void {
  process.env.HHA_USE_PRODUCTION = 'false';
  process.env.HHA_BASE_URL = HHA_SANDBOX_SOAP_URL;
  delete process.env.HHA_ALLOW_PRODUCTION;
}

/** Point SOAP writes at sandbox (same as reads for ENT V1.8). */
export function applySandboxHhaWrites(): void {
  applySandboxHhaReads();
}
