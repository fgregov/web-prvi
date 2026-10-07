// Renvara · dashboard periods: quarters and custom date ranges.
//
// Pure date math on calendar dates ("YYYY-MM-DD"); no timezone, no DOM.
// Shared by the browser (Home period selector) and the server (dashboard
// summary), so both agree on what "Q3 2026" means.
//
// Quarters follow the fiscal year. Today it starts in January (calendar
// quarters); an organization setting can change FISCAL_YEAR_START_MONTH later
// without touching callers.

export const FISCAL_YEAR_START_MONTH = 1;

export const PERIOD_MESSAGES = Object.freeze({
  endBeforeStart: 'Završni datum ne može biti prije početnog datuma.',
  missingDates: 'Odaberite početni i završni datum.',
  tooLong: 'Odaberite period kraći od tri godine.',
});

/** Longest custom period, in days (inclusive). */
export const MAX_PERIOD_DAYS = 1100;

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

const toUtc = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export function isDateKey(value) {
  return typeof value === 'string' && DATE.test(value) && fromUtc(toUtc(value)) === value;
}

export const addDays = (key, days) => fromUtc(toUtc(key) + days * DAY);

/** Number of calendar days from `start` to `end`, both included. */
export const daysInclusive = (start, end) => Math.round((toUtc(end) - toUtc(start)) / DAY) + 1;

/** The fiscal quarter a date falls in. The fiscal year is named after the year it starts in. */
export function quarterOf(key, startMonth = FISCAL_YEAR_START_MONTH) {
  const [y, m] = key.split('-').map(Number);
  const offset = (m - startMonth + 12) % 12;
  return { year: m >= startMonth ? y : y - 1, quarter: Math.floor(offset / 3) + 1 };
}

/** { year, quarter } moved by `n` quarters (negative = earlier). */
export function shiftQuarter({ year, quarter }, n) {
  const index = year * 4 + (quarter - 1) + n;
  return { year: Math.floor(index / 4), quarter: (index % 4) + 1 };
}

export function quarterPeriod(year, quarter, startMonth = FISCAL_YEAR_START_MONTH) {
  const firstMonth = startMonth - 1 + (quarter - 1) * 3; // 0-based, may pass December
  const start = new Date(Date.UTC(year, firstMonth, 1));
  const end = new Date(Date.UTC(year, firstMonth + 3, 0));
  return {
    type: 'QUARTER',
    year,
    quarter,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export const currentQuarterPeriod = (todayKey) => {
  const { year, quarter } = quarterOf(todayKey);
  return quarterPeriod(year, quarter);
};

export const customPeriod = (startDate, endDate) => ({ type: 'CUSTOM', startDate, endDate });

export const samePeriod = (a, b) =>
  Boolean(a && b) && a.type === b.type && a.startDate === b.startDate && a.endDate === b.endDate;

/** Current (operational) view only for the current quarter; everything else is history. */
export const isCurrentPeriod = (period, todayKey) =>
  period.type === 'QUARTER' && samePeriod(period, currentQuarterPeriod(todayKey));

/** A stored period, checked; null when it is not a valid period. */
export function parsePeriod(value) {
  if (!value || typeof value !== 'object') return null;
  if (!isDateKey(value.startDate) || !isDateKey(value.endDate)) return null;
  if (value.endDate < value.startDate) return null;
  if (value.type === 'QUARTER') {
    const q = quarterPeriod(Number(value.year), Number(value.quarter));
    return samePeriod(q, value) ? q : null;
  }
  return value.type === 'CUSTOM' ? customPeriod(value.startDate, value.endDate) : null;
}

/** null when valid, otherwise the message to show. */
export function validateRange(startDate, endDate) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) return PERIOD_MESSAGES.missingDates;
  if (endDate < startDate) return PERIOD_MESSAGES.endBeforeStart;
  if (daysInclusive(startDate, endDate) > MAX_PERIOD_DAYS) return PERIOD_MESSAGES.tooLong;
  return null;
}

/** "Q3 2026" or "Prilagođeni period". */
export const periodTitle = (period) =>
  period.type === 'QUARTER' ? `Q${period.quarter} ${period.year}` : 'Prilagođeni period';

/** "1.7. – 30.9.2026." · "15.11.2025. – 15.2.2026." */
export function periodRangeLabel(period) {
  const [sy, sm, sd] = period.startDate.split('-').map(Number);
  const [ey, em, ed] = period.endDate.split('-').map(Number);
  const start = sy === ey ? `${sd}.${sm}.` : `${sd}.${sm}.${sy}.`;
  return `${start} – ${ed}.${em}.${ey}.`;
}

/**
 * The period a selection is compared with: the previous quarter, or the
 * equally long range right before a custom period.
 */
export function previousPeriod(period) {
  if (period.type === 'QUARTER') {
    const prev = shiftQuarter(period, -1);
    return quarterPeriod(prev.year, prev.quarter);
  }
  const length = daysInclusive(period.startDate, period.endDate);
  return customPeriod(addDays(period.startDate, -length), addDays(period.startDate, -1));
}

export const formatDateKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
