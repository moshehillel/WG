/** Map ProviderSoft gender values to HHA CreatePatient Gender (Male / Female). */
export function normalizeHhaGender(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === 'm' || v === 'male' || v === 'boy') return 'Male';
  if (v === 'f' || v === 'female' || v === 'girl') return 'Female';
  return raw;
}
