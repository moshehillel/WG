import type { UnscheduledServiceRow } from './types/unscheduled.js';

/** GraphQL CallInMID / CallOutMID from getUnscheduledServices row (HAR: MultiInCallID / MultiOutCallID). */
export function unscheduledCallMids(row: UnscheduledServiceRow): {
  callInMid?: string;
  callOutMid?: string;
} {
  const callInMid = row.MultiInCallID ?? row.EVVInID;
  const callOutMid = row.MultiOutCallID ?? row.EVVOutID;
  return {
    callInMid: callInMid != null && String(callInMid).trim() ? String(callInMid) : undefined,
    callOutMid: callOutMid != null && String(callOutMid).trim() ? String(callOutMid) : undefined,
  };
}
