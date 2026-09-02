export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Monday YYYY-MM-DD for a Date Of Service MM/DD/YYYY or ISO date. */
export function weekStartFromDos(dos: string): string {
  const dt = parseDos(dos);
  if (!dt) return '';
  const day = dt.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return isoDate(dt);
}

export function isoDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function parseDos(value: string): Date | null {
  const s = String(value || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])));
}

export function formatDos(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}
