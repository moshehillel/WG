/**
 * Closure defaults — client confirmed Jul 2026: Discharged To = "Home", reason = case termination.
 * HHA GetPatientDischargeTo has no literal "Home"; maps to **self/family/friend** (ID 198).
 */
export const DEFAULT_DISCHARGE_TO_NAME = 'Home';

/** HHA label for DEFAULT_DISCHARGE_TO_NAME (GetPatientDischargeTo). */
export const HHA_DISCHARGE_TO_LABEL = 'self/family/friend';

/** Prod lookup Jul 2026 — override via HHA_DISCHARGE_TO_ID in env. */
export const DEFAULT_DISCHARGE_TO_ID = '198';

export const DEFAULT_DISCHARGE_REASON_LABEL = 'case termination';

export function resolveDischargeToId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = env.HHA_DISCHARGE_TO_ID?.trim();
  return id || DEFAULT_DISCHARGE_TO_ID;
}
