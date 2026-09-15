import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { IConstruct } from 'constructs';

/**
 * Marker metadata: Lambda code is owned by deploy-*.mjs (UpdateFunctionCode),
 * not by CDK asset hashes. Prevents config-only `cdk deploy` (alert emails, etc.)
 * from overwriting live hotfixes — Sep 14 cdk-alert-miris rollback.
 *
 * CloudFormation omits Code on update → leaves the running package untouched
 * while still allowing Environment / timeout / IAM changes.
 *
 * Greenfield / first create: synth with `-c lockHotfixLambdaCode=false` so Code
 * is included, deploy once, then leave the default (locked) for day-to-day.
 */
export const OUT_OF_BAND_CODE_METADATA = 'whiteglove:outOfBandCode';

const LOCK_CONTEXT_KEY = 'lockHotfixLambdaCode';

/** True unless explicitly disabled via `-c lockHotfixLambdaCode=false`. */
export function shouldLockHotfixLambdaCode(scope: IConstruct): boolean {
  const raw = scope.node.tryGetContext(LOCK_CONTEXT_KEY);
  if (raw === undefined || raw === null || raw === '') return true;
  return String(raw).toLowerCase() !== 'false' && String(raw) !== '0';
}

/**
 * Strip Code from the CFN resource so stack updates cannot republish stale bundles.
 * Call after constructing each function that deploy scripts update out-of-band.
 */
export function lockOutOfBandLambdaCode(fn: lambda.IFunction): void {
  if (!shouldLockHotfixLambdaCode(fn)) return;

  const cfn = fn.node.defaultChild;
  if (!(cfn instanceof lambda.CfnFunction)) {
    // DockerImageFunction also uses CfnFunction; anything else — skip quietly.
    return;
  }

  cfn.addPropertyDeletionOverride('Code');
  cfn.addMetadata(OUT_OF_BAND_CODE_METADATA, true);
  cdk.Tags.of(fn).add('OutOfBandCode', 'true');
}
