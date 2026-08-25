/** Map ProviderSoft Basic Mandate Frequency → HHA CreatePatientAuthorization Period. */
export function mapMandateFrequencyToPeriod(frequency: string | undefined): string | undefined {
  const n = (frequency ?? '').trim().toLowerCase();
  if (!n) return undefined;
  if (n === 'weekly') return 'Weekly';
  if (n === 'monthly') return 'Monthly';
  if (n === 'daily') return 'Daily';
  if (n === 'authorization' || n === 'entire period' || n === 'entire') return 'Entire Period';
  return undefined;
}

/** Parse Times per Basic Mandate / Total Units into HHA Maximum (integer). */
export function parseAuthMaximum(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
