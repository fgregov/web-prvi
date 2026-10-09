// Renvara demo CRM · Croatian date, time and money formatting (viewer's local timezone).

const LOCALE = 'hr-HR';
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const moneyFmt = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day "YYYY-MM-DD" of a Date. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now = new Date()) {
  return dayKey(now);
}

/** [start, end) of a local calendar day as Date instants (for /api/calendar). */
export function dayRange(key) {
  const start = parseDayKey(key);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Local date "YYYY-MM-DD" + time "HH:MM" → UTC ISO instant. */
export function toInstant(key, time) {
  const [h, m] = time.split(':').map(Number);
  const date = parseDayKey(key);
  date.setHours(h, m, 0, 0);
  return date.toISOString();
}

/** UTC ISO instant → local "HH:MM". */
export function timeKey(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDaysKey(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/** "YYYY-MM-DD" → Date at local midnight. */
export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Default calendar slot: the next full hour today, or 09:00 tomorrow when it is late. */
export function nextMeetingSlot(now = new Date()) {
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  slot.setHours(slot.getHours() + 1);
  if (slot.getHours() >= 21 || dayKey(slot) !== dayKey(now)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return { date: dayKey(tomorrow), time: '09:00' };
  }
  return { date: dayKey(slot), time: `${pad(slot.getHours())}:00` };
}

export function formatTime(iso) {
  return timeFmt.format(new Date(iso));
}

function relativeDay(date, now) {
  const diff = Math.round((parseDayKey(dayKey(date)) - parseDayKey(dayKey(now))) / 86_400_000);
  if (diff === 0) return 'Danas';
  if (diff === -1) return 'Jučer';
  if (diff === 1) return 'Sutra';
  return null;
}

/** "Danas, 14:32" · "Jučer, 09:10" · "12. listopada 2026., 14:32" */
export function formatDateTime(iso, now = new Date()) {
  const date = new Date(iso);
  return `${relativeDay(date, now) ?? dateFmt.format(date)}, ${timeFmt.format(date)}`;
}

/** "YYYY-MM-DD" → "Danas" / "Sutra" / "12. listopada 2026." */
export function formatDay(key, now = new Date()) {
  const date = parseDayKey(key);
  return relativeDay(date, now) ?? dateFmt.format(date);
}

export function formatShortDay(key) {
  return shortDateFmt.format(parseDayKey(key));
}

/** Agenda heading: "Danas · ponedjeljak, 5. listopada" */
export function formatAgendaDay(key, now = new Date()) {
  const date = parseDayKey(key);
  const rel = relativeDay(date, now);
  const long = weekdayFmt.format(date);
  return rel ? `${rel} · ${long}` : long.charAt(0).toUpperCase() + long.slice(1);
}

export function formatMoney(value, currency = 'EUR') {
  if (value === null || value === undefined || value === '') return '—';
  return currency === 'EUR'
    ? moneyFmt.format(Number(value))
    : new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value));
}

/** Calendar slot of a task: "09:00–10:00", "11:00" or "Cijeli dan". */
export function formatSlot(task) {
  if (!task.scheduledStartAt) return '';
  if (task.allDay) return 'Cijeli dan';
  const start = formatTime(task.scheduledStartAt);
  return task.scheduledEndAt ? `${start}–${formatTime(task.scheduledEndAt)}` : start;
}

/** "Danas, 09:00–10:00" · "Sutra · Cijeli dan" · "12. listopada 2026., 14:00" */
export function formatSchedule(task, now = new Date()) {
  if (!task.scheduledStartAt) return '';
  const day = formatDay(task.scheduledDate ?? dayKey(new Date(task.scheduledStartAt)), now);
  return `${day}, ${formatSlot(task)}`;
}

/** Deadline: "Rok: Danas" · "Rok: 12. listopada 2026., 14:00" */
export function formatDue(task, now = new Date()) {
  if (task.dueDate) return `Rok: ${formatDay(task.dueDate, now)}`;
  if (task.dueAt) return `Rok: ${formatDateTime(task.dueAt, now)}`;
  return '';
}

export function initials(name) {
  return (
    String(name)
      .replace(/d\.o\.o\.?|j\.d\.o\.o\.?/gi, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  );
}
