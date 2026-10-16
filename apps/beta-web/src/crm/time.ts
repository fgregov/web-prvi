// Timezone helpers for the CRM. Calendar values are interpreted in the
// organization's timezone; everything stored is a UTC instant or a plain date.
import { calendarDateInZone, startOfDayInZone } from '@renvara/domain';

export { calendarDateInZone, startOfDayInZone };

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** [start, end) of a calendar day in a timezone, as instants (23 or 25 hours on DST days). */
export function dayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: startOfDayInZone(date, timeZone),
    end: startOfDayInZone(addDays(date, 1), timeZone),
  };
}

/** The instant of a wall-clock time ("HH:MM") on a calendar day in a timezone. */
export function zonedDateTime(date: string, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const target = hh * 60 + mm;
  let guess = new Date(startOfDayInZone(date, timeZone).getTime() + target * 60_000);
  // A DST change inside the day shifts wall-clock time by the offset delta: correct once.
  const wall = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(guess);
  const [gh, gm] = wall.split(':').map(Number) as [number, number];
  guess = new Date(guess.getTime() + (target - (gh * 60 + gm)) * 60_000);
  return guess;
}

export const toIso = (value: Date) => value.toISOString();
