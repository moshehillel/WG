/**
 * Shared TMS API bundle gates so one-shot feature deploys cannot wipe each other.
 */
export function assertAmAndPlcBundleMarkers(bundled, label = 'bundle') {
  if (!bundled.includes('AM ${') || !/GROUP/i.test(bundled)) {
    throw new Error(`${label} missing AM Group→AM pay-code fallback markers`);
  }
  const hasCover =
    bundled.includes('Ambiguous HHA placements for ContractID') ||
    bundled.includes('placements cover') ||
    /placement period overlaps/i.test(bundled);
  if (!hasCover) {
    throw new Error(`${label} missing placement cover-date / -74 recovery markers`);
  }
}

/** Moshe: strip-duration school billing fallback must stay REMOVED. */
export function assertNoSchoolBillingStripFallback(bundled, label = 'bundle') {
  if (bundled.includes('stripSchoolBillingDurationBucket')) {
    throw new Error(`${label} still contains stripSchoolBillingDurationBucket — must be removed`);
  }
}

/** @deprecated Use assertNoSchoolBillingStripFallback — strip fallback was removed. */
export function assertSchoolBillingBundleMarkers(bundled, label = 'bundle') {
  assertNoSchoolBillingStripFallback(bundled, label);
}

export function assertAlreadyBilledBundleMarkers(bundled, label = 'bundle') {
  if (!bundled.includes('-401') || !/already/i.test(bundled)) {
    throw new Error(`${label} missing Already Billed (-401) confirm success markers`);
  }
}

export function assertVisitDateCoverBundleMarkers(bundled, label = 'bundle') {
  // visitDate passed into upsertContract / ensurePatientProgramContract cover path
  if (!bundled.includes('visitDate') && !/coverDate/i.test(bundled)) {
    throw new Error(`${label} missing visitDate cover-date reuse markers`);
  }
}

/** Combined gate for LIVE_OK deploys that must keep AM + plc and NOT reintroduce strip fallback. */
export function assertAmPlcSchoolBundleMarkers(bundled, label = 'bundle') {
  assertAmAndPlcBundleMarkers(bundled, label);
  assertNoSchoolBillingStripFallback(bundled, label);
}

export function assertAmPlcSchoolAnd401BundleMarkers(bundled, label = 'bundle') {
  assertAmPlcSchoolBundleMarkers(bundled, label);
  assertAlreadyBilledBundleMarkers(bundled, label);
  assertVisitDateCoverBundleMarkers(bundled, label);
}
