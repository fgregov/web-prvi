import { describe, expect, it } from 'vitest';
import { calendarDateInZone, isCalendarDate, startOfDayInZone } from './zoned.ts';

describe('calendarDateInZone', () => {
  it('returns the local calendar day of an instant', () => {
    const instant = new Date('2026-10-03T22:30:00Z');
    expect(calendarDateInZone(instant, 'UTC')).toBe('2026-10-03');
    expect(calendarDateInZone(instant, 'Europe/Zagreb')).toBe('2026-10-04');
    expect(calendarDateInZone(instant, 'America/New_York')).toBe('2026-10-03');
  });
});

describe('startOfDayInZone', () => {
  it.each([
    ['2026-10-09', 'Europe/Zagreb', '2026-10-08T22:00:00.000Z'],
    ['2026-01-15', 'Europe/Zagreb', '2026-01-14T23:00:00.000Z'],
    ['2026-10-09', 'Asia/Kolkata', '2026-10-08T18:30:00.000Z'],
    ['2026-10-09', 'America/New_York', '2026-10-09T04:00:00.000Z'],
    ['2026-03-29', 'Europe/Zagreb', '2026-03-28T23:00:00.000Z'], // DST starts that night
    ['2026-10-25', 'Europe/Zagreb', '2026-10-24T22:00:00.000Z'], // DST ends that night
    ['2026-10-09', 'UTC', '2026-10-09T00:00:00.000Z'],
    ['2026-09-06', 'America/Santiago', '2026-09-06T04:00:00.000Z'], // midnight does not exist
  ])('%s in %s starts at %s (matches PostgreSQL)', (date, tz, expected) => {
    expect(startOfDayInZone(date, tz).toISOString()).toBe(expected);
  });

  it('rejects impossible dates', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(() => startOfDayInZone('2026-02-30', 'UTC')).toThrow(RangeError);
  });
});
