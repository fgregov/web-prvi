// IZVJEŠTAJI (ADR-0015): what the browser and the server share — the report
// types, the periods, the filters and how they are checked, and the Croatian
// number formats. The numbers themselves are computed only on the server
// (src/reports/report-engine.ts); the page shows what it returns.
//
// Pure: calendar dates ("YYYY-MM-DD"), no timezone, no DOM. "Today" is the
// organization's calendar day (Europe/Zagreb), given by the caller.
import {
  addDays,
  isDateKey,
  quarterOf,
  quarterPeriod,
  shiftQuarter,
  validateRange,
} from './period.js';

/** The four reports of v1.0, and the right each needs besides reports.view. */
export const REPORT_TYPES = Object.freeze([
  { value: 'revenue', label: 'Ukupni prihod za razdoblje', file: 'Ukupni_prihod', right: null },
  { value: 'quarters', label: 'Promet po kvartalima', file: 'Promet_po_kvartalima', right: null },
  { value: 'won_lost', label: 'WON / LOST analiza', file: 'WON_LOST_analiza', right: null },
  {
    value: 'sales_reps',
    label: 'Usporedba prodajnih predstavnika',
    file: 'Usporedba_predstavnika',
    right: 'reports.sales_reps',
  },
]);

export const reportType = (value) => REPORT_TYPES.find((t) => t.value === value) ?? null;

/** Rights every report needs: the module and the opportunities it is made of. */
export const REPORT_BASE_RIGHTS = Object.freeze(['reports.view', 'opportunities.view']);

/** Whether `permissions` (a Set) allows a report type. */
export function canRunReport(permissions, type) {
  const def = reportType(type);
  return (
    Boolean(def) &&
    REPORT_BASE_RIGHTS.every((key) => permissions.has(key)) &&
    (!def.right || permissions.has(def.right))
  );
}

/** Which filters a report has (the page shows these, the server reads only these). */
export const REPORT_FILTERS = Object.freeze({
  revenue: ['period', 'customerId', 'opportunityId'],
  quarters: ['year', 'quarter', 'customerId', 'ownerId'],
  won_lost: ['period', 'customerId', 'ownerId', 'status'],
  sales_reps: ['period', 'ownerId', 'sort'],
});

export const PERIOD_PRESETS = Object.freeze([
  { value: 'current_month', label: 'Tekući mjesec' },
  { value: 'previous_month', label: 'Prethodni mjesec' },
  { value: 'current_quarter', label: 'Tekući kvartal' },
  { value: 'previous_quarter', label: 'Prethodni kvartal' },
  { value: 'current_year', label: 'Tekuća godina' },
  { value: 'quarter', label: 'Godina i kvartal' },
  { value: 'year', label: 'Godina' },
  { value: 'custom', label: 'Prilagođeno razdoblje (od – do)' },
]);

export const OUTCOME_FILTERS = Object.freeze([
  { value: 'all', label: 'SVI (WON i LOST)' },
  { value: 'won', label: 'WON' },
  { value: 'lost', label: 'LOST' },
]);

export const REP_SORTS = Object.freeze([
  { value: 'revenue', label: 'Ostvareni prihod' },
  { value: 'won', label: 'Broj WON prilika' },
  { value: 'win_rate', label: 'WIN RATE' },
]);

/** Owner filter value for opportunities without a sales representative. */
export const UNASSIGNED = '__none';
export const UNASSIGNED_LABEL = 'NEDODIJELJENO';

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Most closed opportunities one report may cover (beyond: narrow the filters). */
export const MAX_REPORT_DEALS = 5000;

export const REPORT_MESSAGES = Object.freeze({
  type: 'Odaberite vrstu izvještaja.',
  forbidden: 'Nemate pravo na ovaj izvještaj.',
  preset: 'Odaberite razdoblje.',
  year: `Odaberite godinu između ${MIN_YEAR}. i ${MAX_YEAR}.`,
  quarter: 'Odaberite kvartal.',
  status: 'Odaberite status.',
  sort: 'Odaberite redoslijed.',
  id: 'Neispravan odabir.',
  customer: 'Odabrani kupac nije dostupan.',
  opportunity: 'Odabrana prilika nije dostupna.',
  opportunityOfCustomer: 'Odabrana prilika ne pripada odabranom kupcu.',
  owner: 'Odabrani prodajni predstavnik nije dostupan.',
  tooMany: `Izvještaj obuhvaća više od ${MAX_REPORT_DEALS.toLocaleString('hr-HR')} prilika. Suzite razdoblje ili filtre.`,
});

const monthStart = (key) => `${key.slice(0, 7)}-01`;
const monthEnd = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The calendar range of a preset ({ startDate, endDate }), or null for an unknown one. */
export function presetRange(preset, today, { year, quarter, from, to } = {}) {
  const y = Number(today.slice(0, 4));
  switch (preset) {
    case 'current_month':
      return { startDate: monthStart(today), endDate: monthEnd(today) };
    case 'previous_month': {
      const last = addDays(monthStart(today), -1);
      return { startDate: monthStart(last), endDate: last };
    }
    case 'current_quarter': {
      const q = quarterOf(today);
      return quarterPeriod(q.year, q.quarter);
    }
    case 'previous_quarter': {
      const q = shiftQuarter(quarterOf(today), -1);
      return quarterPeriod(q.year, q.quarter);
    }
    case 'current_year':
      return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
    case 'quarter':
      return quarterPeriod(Number(year), Number(quarter));
    case 'year':
      return { startDate: `${Number(year)}-01-01`, endDate: `${Number(year)}-12-31` };
    case 'custom':
      return { startDate: String(from ?? ''), endDate: String(to ?? '') };
    default:
      return null;
  }
}

const MONTHS = [
  'siječanj',
  'veljača',
  'ožujak',
  'travanj',
  'svibanj',
  'lipanj',
  'srpanj',
  'kolovoz',
  'rujan',
  'listopad',
  'studeni',
  'prosinac',
];

/** "05.10.2026." */
export function formatDateHr(key) {
  if (!isDateKey(key)) return '';
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}.`;
}

/** The period's name: "listopad 2026.", "Q3 2026.", "2026.", or "01.10.2026. – 15.10.2026.". */
export function periodLabel({ startDate, endDate }) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em] = endDate.split('-').map(Number);
  if (sd === 1 && sy === ey && sm === em && endDate === monthEnd(startDate)) {
    return `${MONTHS[sm - 1]} ${sy}.`;
  }
  if (sd === 1 && sm === 1 && endDate === `${sy}-12-31`) return `${sy}.`;
  const q = quarterOf(startDate);
  const qp = quarterPeriod(q.year, q.quarter);
  if (qp.startDate === startDate && qp.endDate === endDate) return `Q${q.quarter} ${q.year}.`;
  return `${formatDateHr(startDate)} – ${formatDateHr(endDate)}`;
}

const isYear = (v) => Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * Reads the filters of a report from untrusted input (the page, the API):
 * only the filters of that report, each checked. `today`: the organization's
 * calendar day. Returns `{ filters, errors }`; with errors, filters is null.
 * Whether a chosen customer, opportunity or representative exists is checked
 * by the server against the organization's records.
 */
export function normalizeReportFilters(input, today) {
  const errors = {};
  const raw = input && typeof input === 'object' ? input : {};
  const type = str(raw.type);
  if (!reportType(type)) return { filters: null, errors: { type: REPORT_MESSAGES.type } };
  const wanted = new Set(REPORT_FILTERS[type]);
  const filters = { type };

  if (wanted.has('period')) {
    const preset = str(raw.preset) || 'current_month';
    const year = Number(raw.year);
    const quarter = Number(raw.quarter);
    if (!PERIOD_PRESETS.some((p) => p.value === preset)) {
      errors.preset = REPORT_MESSAGES.preset;
    } else if ((preset === 'quarter' || preset === 'year') && !isYear(year)) {
      errors.year = REPORT_MESSAGES.year;
    } else if (preset === 'quarter' && ![1, 2, 3, 4].includes(quarter)) {
      errors.quarter = REPORT_MESSAGES.quarter;
    } else {
      const range = presetRange(preset, today, { year, quarter, from: raw.from, to: raw.to });
      const problem = validateRange(range.startDate, range.endDate);
      if (problem) errors.range = problem;
      else {
        filters.preset = preset;
        filters.from = range.startDate;
        filters.to = range.endDate;
        if (preset === 'quarter' || preset === 'year') filters.year = year;
        if (preset === 'quarter') filters.quarter = quarter;
      }
    }
  }
  if (wanted.has('year')) {
    const year =
      raw.year === undefined || raw.year === '' ? Number(today.slice(0, 4)) : Number(raw.year);
    if (!isYear(year)) errors.year = REPORT_MESSAGES.year;
    else filters.year = year;
    const quarter = str(raw.quarter) || 'all';
    if (quarter === 'all') filters.quarter = 'all';
    else if (['1', '2', '3', '4'].includes(quarter)) filters.quarter = Number(quarter);
    else errors.quarter = REPORT_MESSAGES.quarter;
    if (filters.year) {
      const q = filters.quarter === 'all' ? null : filters.quarter;
      filters.from = q ? quarterPeriod(filters.year, q).startDate : `${filters.year}-01-01`;
      filters.to = q ? quarterPeriod(filters.year, q).endDate : `${filters.year}-12-31`;
    }
  }
  for (const key of ['customerId', 'opportunityId', 'ownerId']) {
    if (!wanted.has(key)) continue;
    const value = str(raw[key]);
    if (value === '' || value === 'all') filters[key] = null;
    else if (key === 'ownerId' && value === UNASSIGNED) filters[key] = UNASSIGNED;
    else if (ID.test(value)) filters[key] = value;
    else errors[key] = REPORT_MESSAGES.id;
  }
  if (wanted.has('status')) {
    const status = str(raw.status) || 'all';
    if (OUTCOME_FILTERS.some((s) => s.value === status)) filters.status = status;
    else errors.status = REPORT_MESSAGES.status;
  }
  if (wanted.has('sort')) {
    const sort = str(raw.sort) || 'revenue';
    if (REP_SORTS.some((s) => s.value === sort)) filters.sort = sort;
    else errors.sort = REPORT_MESSAGES.sort;
  }
  return Object.keys(errors).length ? { filters: null, errors } : { filters, errors: {} };
}

/** Filters → the request body (and the address of the page): only what the report has. */
export function filtersToInput(filters) {
  const out = { type: filters.type };
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'type' || value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

// ------------------------------------------------------------- formats ---
const eurFormat = new Intl.NumberFormat('hr-HR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const countFormat = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('hr-HR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Not applicable: a rate or a change that cannot be computed (no division by zero). */
export const NOT_APPLICABLE = 'N/P';

/** Integer cents → "12.500,00 €" (Croatian format, no VAT added). */
export const formatEur = (cents) => eurFormat.format(cents / 100);
export const formatCount = (n) => countFormat.format(n);
/** 66.666… → "66,7 %"; null → "N/P". */
export const formatPercent = (value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? NOT_APPLICABLE
    : `${percentFormat.format(value)} %`;
/** +12.5 → "+12,5 %", −3 → "−3,0 %", null → "N/P". */
export const formatChange = (value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? NOT_APPLICABLE
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${percentFormat.format(Math.abs(value))} %`;

/** "RENVARA_Ukupni_prihod_2026-10-01_2026-10-31.pdf" */
export function reportFileName(filters) {
  const def = reportType(filters.type);
  const range = filters.from && filters.to ? `_${filters.from}_${filters.to}` : '';
  return `RENVARA_${def?.file ?? 'Izvjestaj'}${range}.pdf`;
}

/** A PDF attachment name as the user typed it: safe characters, ".pdf", at most 120. */
export function cleanAttachmentName(value, fallback) {
  const base = str(value)
    .replace(/\.pdf$/i, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 110)
    .replace(/[._-]+$/, '');
  return base ? `${base}.pdf` : fallback;
}

export const reportSubject = (title, period) => `RENVARA CRM — ${title} — ${period}`;
export const REPORT_EMAIL_TEXT =
  'Poštovani, u privitku dostavljamo izvještaj generiran putem RENVARA CRM sustava za odabrano razdoblje.';

export const EMAIL_PATTERN = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[A-Za-z]{2,}$/;

/** The e-mail form, checked the same way on the page and the server. */
export function validateReportEmail(input) {
  const errors = {};
  const to = str(input?.to);
  if (!to) errors.to = 'Upišite e-mail adresu primatelja.';
  else if (to.length > 254 || !EMAIL_PATTERN.test(to)) errors.to = 'Neispravna e-mail adresa.';
  const subject = str(input?.subject);
  if (!subject) errors.subject = 'Upišite predmet poruke.';
  else if (subject.length > 200 || /[\r\n]/.test(subject)) errors.subject = 'Predmet je predug.';
  const message = typeof input?.message === 'string' ? input.message : '';
  if (message.length > 5000) errors.message = 'Tekst poruke je predug (najviše 5.000 znakova).';
  const name = str(input?.fileName);
  if (name.length > 150) errors.fileName = 'Naziv privitka je predug.';
  return errors;
}
