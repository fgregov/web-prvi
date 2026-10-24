const nf = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 3 });
const nf0 = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 1 });
const mf = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const compact = new Intl.NumberFormat('hr-HR', { notation: 'compact', maximumFractionDigits: 1 });
const TZ = 'Europe/Zagreb';

export const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? '—' : nf.format(v));
export const fmtDec1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : nf1.format(v));
export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : nf0.format(v));
export const fmtMoney = (v: number | null | undefined) => (v === null || v === undefined ? '—' : mf.format(v));
export const fmtCompact = (v: number) => (Math.abs(v) >= 1000 ? compact.format(v) : nf.format(v));
export const fmtQty = (v: number | null | undefined, unit?: string) =>
  v === null || v === undefined ? '—' : unit && unit !== 'kom' ? `${nf.format(v)} ${unit}` : nf.format(v);

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}.${m}.${y}.`;
  }
  return new Date(v).toLocaleDateString('hr-HR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('hr-HR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${nf.format(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${nf.format(Math.round(n / 102.4) / 10)} KB`;
  return `${nf.format(Math.round(n / 104857.6) / 10)} MB`;
}

/** Današnji datum u zoni Europe/Zagreb (YYYY-MM-DD). */
export function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function relativeTime(v: string | null | undefined): string {
  if (!v) return 'nikad';
  const diff = Date.now() - new Date(v).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'upravo';
  if (m < 60) return `prije ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `prije ${h} h`;
  const d = Math.round(h / 24);
  return `prije ${d} ${d === 1 ? 'dan' : 'dana'}`;
}
