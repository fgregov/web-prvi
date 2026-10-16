import { calendarDateInZone, startOfDayInZone, type CalendarDate } from '../time/zoned.ts';

/**
 * FEEDBACK OVERVIEW: how long a sent offer has been waiting for the customer.
 *
 * Calendar days in the organization's timezone, the sending day being day 1:
 * sent today → 1D, yesterday → 2D, nine dates ago → 10D. Counted on calendar
 * dates (never elapsed milliseconds), so DST changes cannot shift a band.
 */
export function offerWaitingDays(sentAt: Date, asOf: Date, timeZone: string): number {
  const day = (instant: Date) => {
    const [y, m, d] = calendarDateInZone(instant, timeZone).split('-').map(Number);
    return Date.UTC(y as number, (m as number) - 1, d as number) / 86_400_000;
  };
  return Math.max(1, day(asOf) - day(sentAt) + 1);
}

/** 1–4D yellow (initial wait) · 5–9D red (follow up) · 10D+ black (critical). */
export type WaitingBand = 'yellow' | 'red' | 'black';

/** The first waiting day of each band. */
export const BAND_START_DAY: Readonly<Record<WaitingBand, number>> = {
  yellow: 1,
  red: 5,
  black: 10,
};

export function waitingBand(days: number): WaitingBand {
  if (days >= BAND_START_DAY.black) return 'black';
  if (days >= BAND_START_DAY.red) return 'red';
  return 'yellow';
}

const addDays = (date: CalendarDate, days: number): CalendarDate => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + days))
    .toISOString()
    .slice(0, 10);
};

/**
 * The moment a sent offer enters a band: the band's first calendar day (in the
 * organization's timezone) at the time of day it was sent. Yellow (1D) is the
 * sending moment itself; red (5D) is four dates later at the same wall-clock
 * time, so offerWaitingDays() at that moment is exactly the band's first day.
 */
export function bandEntryAt(sentAt: Date, band: WaitingBand, timeZone: string): Date {
  const sentDay = calendarDateInZone(sentAt, timeZone);
  const sinceStartOfDay = sentAt.getTime() - startOfDayInZone(sentDay, timeZone).getTime();
  const day = addDays(sentDay, BAND_START_DAY[band] - 1);
  const entry = startOfDayInZone(day, timeZone).getTime() + sinceStartOfDay;
  // A daylight-saving change can push the same wall-clock time past midnight: stay on the day.
  const nextDay = startOfDayInZone(addDays(day, 1), timeZone).getTime();
  return new Date(Math.min(entry, nextDay - 1));
}

/** Most urgent first: black, red, yellow; the longest wait first within a band. */
export function byUrgency<T extends { waitingDays: number }>(a: T, b: T): number {
  return b.waitingDays - a.waitingDays;
}
