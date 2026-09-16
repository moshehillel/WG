/** Map ProviderSoft Basic/Extended Mandate Frequency → HHA CreatePatientAuthorization Period. */
export function mapMandateFrequencyToPeriod(frequency: string | undefined): string | undefined {
  const n = (frequency ?? '').trim().toLowerCase();
  if (!n) return undefined;
  if (n === 'weekly') return 'Weekly';
  if (n === 'monthly') return 'Monthly';
  if (n === 'daily') return 'Daily';
  // TMS school-day cycle (e.g. 2 per 6 school days) → Weekly with Maximum = cycle Freq.
  if (n === 'school_day_cycle' || n === 'school day cycle') return 'Weekly';
  if (n === 'authorization' || n === 'entire period' || n === 'entire') return 'Entire Period';
  return undefined;
}

/**
 * Parse Times per Basic/Extended Mandate / Total Units into HHA Maximum (integer).
 * Returns undefined when blank, non-numeric, or ≤ 0 (never write Max Period = 0).
 */
export function parseAuthMaximum(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export type AuthMandateSource = 'basic' | 'extended';

export interface ResolvedAuthMandate {
  period: string;
  maximum: number;
  source: AuthMandateSource;
}

/**
 * Prefer Basic Mandate Frequency + Times when both are usable.
 * If Basic is blank or times ≤ 0, fall back to Extended Mandate Frequency + Times
 * (ProviderSoft new-service export for NYS / similar payers).
 */
export function resolveAuthMandate(options: {
  mandateFrequency?: string;
  mandateTimes?: string | number;
  extendedMandateFrequency?: string;
  extendedMandateTimes?: string | number;
}): ResolvedAuthMandate | undefined {
  const basicPeriod = mapMandateFrequencyToPeriod(options.mandateFrequency);
  const basicMaximum = parseAuthMaximum(options.mandateTimes);
  if (basicPeriod && basicMaximum !== undefined) {
    return { period: basicPeriod, maximum: basicMaximum, source: 'basic' };
  }

  const extendedPeriod = mapMandateFrequencyToPeriod(options.extendedMandateFrequency);
  const extendedMaximum = parseAuthMaximum(options.extendedMandateTimes);
  if (extendedPeriod && extendedMaximum !== undefined) {
    return { period: extendedPeriod, maximum: extendedMaximum, source: 'extended' };
  }

  return undefined;
}
