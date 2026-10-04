/**
 * Timezone-aware calendar helpers built on Intl only (no runtime dependency).
 *
 * Storage rule: instants are stored as UTC `timestamptz`; calendar values
 * (due dates, expected close dates) are stored as plain `date` strings
 * (YYYY-MM-DD) and only become instants when interpreted in a timezone.
 */

/** ISO calendar date, e.g. "2026-10-09". */
export type CalendarDate = string & { readonly __brand?: 'CalendarDate' };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): value is CalendarDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function wallClock(instant: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Throws RangeError for names Intl does not know (mirrors the DB check). */
export function assertValidTimeZone(timeZone: string): void {
  partsFormatter(timeZone);
}

/** The calendar date an instant falls on in the given timezone. */
export function calendarDateInZone(instant: Date, timeZone: string): CalendarDate {
  const w = wallClock(instant, timeZone);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Offset (ms) of the timezone from UTC at the given instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * First instant of a calendar day in a timezone. Equivalent to PostgreSQL
 * `date::timestamp at time zone tz` (used by opportunity_overview ordering).
 * Handles DST transitions, including days that do not start at 00:00.
 */
export function startOfDayInZone(date: CalendarDate, timeZone: string): Date {
  const m = ISO_DATE.exec(date);
  if (!m || !isCalendarDate(date)) throw new RangeError(`Invalid calendar date: ${date}`);
  const naiveUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Two passes converge for every real-world timezone rule.
  let guess = naiveUtc - offsetMs(new Date(naiveUtc), timeZone);
  guess = naiveUtc - offsetMs(new Date(guess), timeZone);
  // In a spring-forward gap midnight does not exist; PostgreSQL moves forward.
  if (calendarDateInZone(new Date(guess), timeZone) < date) {
    guess += 60 * 60 * 1000;
  }
  return new Date(guess);
}
