import { calendarDateInZone } from '../time/zoned.ts';

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

export function waitingBand(days: number): WaitingBand {
  if (days >= 10) return 'black';
  if (days >= 5) return 'red';
  return 'yellow';
}

/** Most urgent first: black, red, yellow; the longest wait first within a band. */
export function byUrgency<T extends { waitingDays: number }>(a: T, b: T): number {
  return b.waitingDays - a.waitingDays;
}
