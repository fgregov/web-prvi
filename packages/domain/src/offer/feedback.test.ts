import { describe, expect, it } from 'vitest';
import { byUrgency, offerWaitingDays, waitingBand } from './feedback.ts';

const TZ = 'Europe/Zagreb';
const at = (iso: string) => new Date(iso);

describe('offer feedback wait', () => {
  it('counts the sending day as day 1', () => {
    const now = at('2026-10-09T10:00:00Z');
    expect(offerWaitingDays(at('2026-10-09T06:00:00Z'), now, TZ)).toBe(1);
    expect(offerWaitingDays(at('2026-10-08T21:00:00Z'), now, TZ)).toBe(2);
    expect(offerWaitingDays(at('2026-10-05T12:00:00Z'), now, TZ)).toBe(5);
    expect(offerWaitingDays(at('2026-09-30T12:00:00Z'), now, TZ)).toBe(10);
  });

  it('uses local calendar dates, not 24-hour blocks', () => {
    // 23:30 local on the 8th → 00:30 local on the 9th: one hour, but day 2.
    expect(offerWaitingDays(at('2026-10-08T21:30:00Z'), at('2026-10-08T22:30:00Z'), TZ)).toBe(2);
    // 00:10 → 23:50 local on the same day: almost 24 hours, still day 1.
    expect(offerWaitingDays(at('2026-10-08T22:10:00Z'), at('2026-10-09T21:50:00Z'), TZ)).toBe(1);
  });

  it('is not shifted by daylight-saving changes', () => {
    // Clocks go back on 25 Oct 2026 (a 25-hour day): 25.10. 00:30 → 29.10. 23:50 is
    // 5 days and 20 minutes of elapsed time, but 5 calendar dates → 5D (red), not 6D.
    expect(offerWaitingDays(at('2026-10-24T22:30:00Z'), at('2026-10-29T22:50:00Z'), TZ)).toBe(5);
    // Clocks go forward on 29 Mar 2026 (a 23-hour day): 28.3. 00:30 → 6.4. 00:10 is
    // under 9 days of elapsed time, but the 10th calendar date → 10D (black), not 9D.
    expect(offerWaitingDays(at('2026-03-27T23:30:00Z'), at('2026-04-05T22:10:00Z'), TZ)).toBe(10);
  });

  it('never goes below day 1', () => {
    expect(offerWaitingDays(at('2026-10-10T10:00:00Z'), at('2026-10-09T10:00:00Z'), TZ)).toBe(1);
  });

  it('bands: 1–4 yellow, 5–9 red, 10+ black', () => {
    expect([1, 4, 5, 9, 10, 12].map(waitingBand)).toEqual([
      'yellow',
      'yellow',
      'red',
      'red',
      'black',
      'black',
    ]);
  });

  it('sorts by urgency, longest wait first', () => {
    const items = [1, 12, 5, 10, 4, 9].map((waitingDays) => ({ waitingDays }));
    expect(items.sort(byUrgency).map((i) => i.waitingDays)).toEqual([12, 10, 9, 5, 4, 1]);
  });
});
