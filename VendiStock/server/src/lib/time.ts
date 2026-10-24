import { DateTime } from 'luxon';
import { TIMEZONE } from '../config.js';

export const nowIso = () => new Date().toISOString();

/** Datum (YYYY-MM-DD) u vremenskoj zoni Europe/Zagreb za zadani UTC trenutak. */
export function localDateOf(isoUtc: string | Date): string {
  const dt =
    isoUtc instanceof Date
      ? DateTime.fromJSDate(isoUtc)
      : DateTime.fromISO(isoUtc, { zone: 'utc' });
  return dt.setZone(TIMEZONE).toISODate()!;
}

export function localMonthOf(isoUtc: string): string {
  return localDateOf(isoUtc).slice(0, 7);
}

export function todayLocal(): string {
  return DateTime.now().setZone(TIMEZONE).toISODate()!;
}

export function nowLocal(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: TIMEZONE }).plus({ days }).toISODate()!;
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: TIMEZONE }).startOf('day');
  const b = DateTime.fromISO(to, { zone: TIMEZONE }).startOf('day');
  return Math.round(b.diff(a, 'days').days) + 1;
}

/** Pretvara lokalni datum (Europe/Zagreb) u UTC ISO početak dana. */
export function localDayStartUtc(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: TIMEZONE }).startOf('day').toUTC().toISO()!;
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s).isValid;
}

const COMMON_FORMATS = [
  'dd.MM.yyyy HH:mm:ss',
  'dd.MM.yyyy. HH:mm:ss',
  'd.M.yyyy HH:mm:ss',
  'd.M.yyyy. HH:mm:ss',
  'dd.MM.yyyy HH:mm',
  'dd.MM.yyyy. HH:mm',
  'd.M.yyyy H:mm',
  'd.M.yyyy. H:mm',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm",
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'dd.MM.yyyy',
  'dd.MM.yyyy.',
  'd.M.yyyy',
  'd.M.yyyy.',
  'yyyy-MM-dd',
  'dd/MM/yyyy',
];

/**
 * Parsira datum/vrijeme iz izvještaja. Vrijednosti bez oznake zone tumače se kao lokalno vrijeme
 * Europe/Zagreb (uključujući ljetno računanje vremena). Vraća UTC ISO ili null.
 */
export function parseSourceDateTime(input: unknown, format?: string | null): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    // Datumi iz XLSX ćelija nemaju zonu; ExcelJS ih vraća kao da su UTC "zidno vrijeme".
    const wall = DateTime.fromJSDate(input, { zone: 'utc' });
    const local = DateTime.fromObject(
      {
        year: wall.year,
        month: wall.month,
        day: wall.day,
        hour: wall.hour,
        minute: wall.minute,
        second: wall.second,
      },
      { zone: TIMEZONE },
    );
    return local.isValid ? local.toUTC().toISO() : null;
  }
  const s = String(input).trim();
  if (!s) return null;
  if (format) {
    const dt = DateTime.fromFormat(s, format, { zone: TIMEZONE });
    return dt.isValid ? dt.toUTC().toISO() : null;
  }
  // ISO s eksplicitnom zonom (Z ili +01:00)
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const dt = DateTime.fromISO(s, { setZone: true });
    return dt.isValid ? dt.toUTC().toISO() : null;
  }
  for (const f of COMMON_FORMATS) {
    const dt = DateTime.fromFormat(s, f, { zone: TIMEZONE });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  return null;
}

export function formatLocalDateTime(isoUtc: string | null | undefined): string {
  if (!isoUtc) return '';
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(TIMEZONE).toFormat('dd.MM.yyyy. HH:mm');
}

export function formatLocalDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  return DateTime.fromISO(isoDate).toFormat('dd.MM.yyyy.');
}
