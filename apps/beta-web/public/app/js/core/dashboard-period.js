// The one authoritative dashboard period (DashboardPeriodContext). Home widgets,
// the period selector and the module shells read it from here; nothing else
// computes quarters. Kept for the browser session, so leaving Home and coming
// back keeps the choice; a new session starts at the current quarter.
import {
  currentQuarterPeriod,
  formatDateKey,
  isCurrentPeriod,
  parsePeriod,
  periodRangeLabel,
  periodTitle,
} from './period.js';

const KEY = 'renvara.dashboard.period';
const listeners = new Set();

export const todayKey = () => formatDateKey(new Date());

export function getDashboardPeriod() {
  try {
    const stored = parsePeriod(JSON.parse(sessionStorage.getItem(KEY) ?? 'null'));
    if (stored) return stored;
  } catch {
    /* storage blocked: default */
  }
  return currentQuarterPeriod(todayKey());
}

export function setDashboardPeriod(period) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(period));
  } catch {
    /* storage blocked: this page only */
  }
  listeners.forEach((listener) => listener(period));
}

/** Back to the default; called on logout. */
export function resetDashboardPeriod() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function onDashboardPeriodChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What widgets need to know about a period. */
export function describePeriod(period, today = todayKey()) {
  const title = periodTitle(period);
  const range = periodRangeLabel(period);
  return {
    period,
    title,
    range,
    isCurrent: isCurrentPeriod(period, today),
    accessibleLabel: `Odabrani period ${title}, ${range}`,
  };
}
