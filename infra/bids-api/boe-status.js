/** BOE award status machine and day-clock helpers. */

export const AWARD_STATUSES = [
  'awarded-pending-provider',
  'awarded-confirmed-provider',
  'coordinating-start',
  'active-on-gila',
  'cancelled-bids-rejected',
];

export const STATUS_LABELS = {
  'awarded-pending-provider': 'Awarded — pending provider',
  'awarded-confirmed-provider': 'Awarded — confirmed provider',
  'coordinating-start': 'In process of coordinating start',
  'active-on-gila': 'Active — on Gila',
  'cancelled-bids-rejected': 'Cancelled — bids rejected',
};

export function normalizeAwardStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (AWARD_STATUSES.includes(raw)) return raw;
  if (/pending/.test(raw)) return 'awarded-pending-provider';
  if (/confirm/.test(raw)) return 'awarded-confirmed-provider';
  if (/coordinat|start/.test(raw)) return 'coordinating-start';
  if (/gila|active/.test(raw)) return 'active-on-gila';
  if (/cancel|reject/.test(raw)) return 'cancelled-bids-rejected';
  return 'awarded-pending-provider';
}

export function canTransition(from, to) {
  const a = normalizeAwardStatus(from);
  const b = normalizeAwardStatus(to);
  if (a === b) return true;
  if (b === 'cancelled-bids-rejected') return a !== 'active-on-gila';
  const order = AWARD_STATUSES.filter((s) => s !== 'cancelled-bids-rejected');
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return false;
  return j === i + 1 || j === i;
}

export function awardDayFromDate(awardDate, now = Date.now()) {
  const started = Date.parse(awardDate || '');
  if (Number.isNaN(started)) return 1;
  return Math.min(5, Math.max(1, Math.floor((now - started) / 86400000) + 1));
}

export function boeClockDecision({ awardDate, hasProvider, startedAt, status, now = Date.now() }) {
  const normalized = normalizeAwardStatus(status);
  if (normalized === 'cancelled-bids-rejected' || normalized === 'active-on-gila') {
    return { day: awardDayFromDate(awardDate, now), reject: false, remind: false };
  }
  const day = awardDayFromDate(awardDate, now);
  if (!hasProvider && day >= 5) {
    return {
      day: 5,
      reject: true,
      remind: false,
      reason: 'No provider found within five days.',
      nextStatus: 'cancelled-bids-rejected',
    };
  }
  if (hasProvider && !startedAt && day >= 5) {
    return {
      day,
      reject: false,
      remind: true,
      text: 'She accepted this award and has not started within five days of the award date. This reminder does not reject the case.',
    };
  }
  return { day, reject: false, remind: false };
}
