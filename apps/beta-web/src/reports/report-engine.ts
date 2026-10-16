// IZVJEŠTAJI: one engine for the four reports (ADR-0015). Every report starts
// from the same rows — the organization's closed opportunities (closedDeals) —
// and the same rules, so the same data always gives the same numbers:
//
//   WON / LOST      an opportunity's CURRENT status (won | lost). Reopened or
//                   re-closed deals count only as they are now.
//   date            closedAt: when it entered that status (set on close,
//                   cleared on reopen; never guessed from updatedAt). Periods
//                   and quarters are calendar days in the organization's
//                   timezone (Europe/Zagreb), start inclusive, end exclusive.
//   revenue         a WON deal's final amount (wonValue), else its estimate
//                   (value) — the same as the Dashboard's "Opportunity WON".
//                   No VAT is added; amounts are as entered.
//   potential       a LOST deal's estimate (never revenue).
//   money           summed in integer cents, EUR only; a deal in another
//                   currency is counted but its amount is left out (and said).
//   rates           WIN RATE = WON ÷ (WON + LOST) · 100, LOSS RATE likewise;
//                   N/P when nothing was closed (domain outcomeRates).
//   representative  the deal's owner (one per deal, no split); deals without
//                   one are NEDODIJELJENO, never dropped from the totals.
//
// The output is ready to show: the page and the PDF render the same report.
import { outcomeRates, toCents } from '@renvara/domain';
import { quarterPeriod } from '../../public/app/js/core/period.js';
import {
  formatChange,
  formatCount,
  formatDateHr,
  formatEur,
  formatPercent,
  MAX_REPORT_DEALS,
  NOT_APPLICABLE,
  periodLabel,
  PERIOD_PRESETS,
  REP_SORTS,
  OUTCOME_FILTERS,
  REPORT_MESSAGES,
  reportType,
  UNASSIGNED,
  UNASSIGNED_LABEL,
} from '../../public/app/js/core/reports.js';
import { CrmValidationError } from '../crm/errors.ts';
import { findInOrg, inOrg, leadLabel } from '../crm/scope.ts';
import { addDays, calendarDateInZone, startOfDayInZone } from '../crm/time.ts';
import type { CalendarDate, CrmContext, CrmData, MemberRole, MemberStatus } from '../crm/types.ts';

/** A member as the reports name them (from Korisnici; no personal data). */
export interface ReportMember {
  readonly id: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
}

/** Filters as normalized by normalizeReportFilters (core/reports.js). */
export interface ReportFilters {
  readonly type: 'revenue' | 'quarters' | 'won_lost' | 'sales_reps';
  readonly preset?: string;
  readonly from?: CalendarDate;
  readonly to?: CalendarDate;
  readonly year?: number;
  readonly quarter?: number | 'all';
  readonly customerId?: string | null;
  readonly opportunityId?: string | null;
  readonly ownerId?: string | null;
  readonly status?: 'all' | 'won' | 'lost';
  readonly sort?: 'revenue' | 'won' | 'win_rate';
}

/** One closed opportunity, the row every report is made of. */
export interface ClosedDeal {
  readonly id: string;
  readonly title: string;
  readonly status: 'won' | 'lost';
  readonly closedAt: string;
  /** closedAt as a calendar day in the organization's timezone. */
  readonly closedDate: CalendarDate;
  /** Revenue (won) or potential (lost) as entered; null = no amount entered. */
  readonly amount: number | null;
  readonly currency: string;
  /** The amount in EUR cents that is summed (0 without an amount or in another currency). */
  readonly cents: number;
  readonly otherCurrency: boolean;
  readonly noValue: boolean;
  readonly customerId: string | null;
  /** The customer, or "Lead: …" for a lead's deal before the lead is a customer. */
  readonly customerName: string;
  readonly ownerId: string | null;
  readonly ownerName: string;
}

export type CellFormat = 'text' | 'money' | 'count' | 'percent' | 'date';
export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly align: 'left' | 'right';
  /** Share of the table width (the PDF and the page use the same proportions). */
  readonly width: number;
}
export interface ReportRow {
  readonly kind: 'row' | 'group' | 'subtotal' | 'total' | 'muted';
  readonly cells: readonly string[];
  /** Indented under its group (a deal under its customer). */
  readonly indent?: boolean;
}
export interface ReportTable {
  readonly key: string;
  readonly title: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly empty: string;
}
export interface ReportChartItem {
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly tone?: 'won' | 'lost' | 'neutral' | 'highlight';
}
export interface ReportChart {
  readonly key: string;
  readonly kind: 'columns' | 'bars';
  readonly title: string;
  readonly items: readonly ReportChartItem[];
}
export interface ReportSummaryItem {
  readonly key: string;
  readonly label: string;
  readonly display: string;
  readonly hint?: string;
  readonly tone?: 'won' | 'lost' | 'neutral';
}

export interface Report {
  readonly type: ReportFilters['type'];
  readonly title: string;
  readonly generatedAt: string;
  /** "16.10.2026. u 14:05" in the organization's timezone. */
  readonly generatedLabel: string;
  readonly timeZone: string;
  readonly period: {
    readonly from: CalendarDate;
    readonly to: CalendarDate;
    readonly label: string;
  };
  readonly filters: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly summary: readonly ReportSummaryItem[];
  readonly charts: readonly ReportChart[];
  readonly tables: readonly ReportTable[];
  readonly notes: readonly string[];
  /** Nothing in the period/filters: the page and the PDF say so instead of showing zeros as results. */
  readonly empty: boolean;
  /** Raw numbers (tests, the API): cents and counts as computed. */
  readonly totals: Record<string, number | null>;
  /** The filters it was made with (normalized), for the PDF and the e-mail. */
  readonly input: ReportFilters;
}

const DEFAULT_NOTES = [
  'Prihod u izvještaju je vrijednost zaključenih (WON) prodajnih prilika, a ne nužno računovodstveno naplaćeni prihod.',
  'Iznosi su u EUR, kako su upisani u prilike (konačni iznos dobivene prilike, inače procijenjena vrijednost), bez automatskog dodavanja PDV-a.',
];

const hrCollator = new Intl.Collator('hr', { sensitivity: 'base' });
const byName = <T extends { name: string }>(a: T, b: T) => hrCollator.compare(a.name, b.name);

/** [from, to) instants of calendar days in the organization's timezone. */
function boundsOf(ctx: CrmContext, from: CalendarDate, to: CalendarDate) {
  return {
    from: startOfDayInZone(from, ctx.timeZone).getTime(),
    to: startOfDayInZone(addDays(to, 1), ctx.timeZone).getTime(),
  };
}

/**
 * The organization's closed opportunities, with what the reports need. The
 * names of representatives come from Korisnici (`members`), else from the
 * name saved on the opportunity.
 */
export function closedDeals(
  data: CrmData,
  ctx: CrmContext,
  members: readonly ReportMember[],
): ClosedDeal[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const out: ClosedDeal[] = [];
  for (const o of inOrg(data.opportunities, ctx)) {
    if ((o.status !== 'won' && o.status !== 'lost') || !o.closedAt) continue;
    const amount = o.status === 'won' ? (o.wonValue ?? o.value) : o.value;
    const otherCurrency = (o.currency || 'EUR') !== 'EUR';
    const customer = findInOrg(data.customers, ctx, o.companyId);
    const lead = customer ? undefined : findInOrg(data.leads, ctx, o.leadId);
    out.push({
      id: o.id,
      title: o.title,
      status: o.status,
      closedAt: o.closedAt,
      closedDate: calendarDateInZone(new Date(o.closedAt), ctx.timeZone),
      amount: amount ?? null,
      currency: o.currency || 'EUR',
      cents: amount === null || amount === undefined || otherCurrency ? 0 : toCents(amount),
      otherCurrency,
      noValue: amount === null || amount === undefined,
      customerId: customer?.id ?? null,
      customerName: customer
        ? customer.companyName
        : lead
          ? `Lead: ${leadLabel(lead)}`
          : 'Bez kupca',
      ownerId: o.ownerId,
      ownerName: o.ownerId
        ? (names.get(o.ownerId) ?? o.ownerName ?? 'Nepoznat korisnik')
        : UNASSIGNED_LABEL,
    });
  }
  return out.sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------- helpers ---
const sum = (deals: readonly ClosedDeal[]) => deals.reduce((s, d) => s + d.cents, 0);
const eurDeals = (deals: readonly ClosedDeal[]) => deals.filter((d) => !d.otherCurrency);
/** Average of the summed (EUR) deals, in cents; null without any. */
const averageCents = (deals: readonly ClosedDeal[]) => {
  const counted = eurDeals(deals);
  return counted.length ? Math.round(sum(counted) / counted.length) : null;
};
const money = (cents: number | null) => (cents === null ? NOT_APPLICABLE : formatEur(cents));

/** "12.500,00 €", "1.200,00 USD (nije uračunato)", "— (bez vrijednosti)". */
function dealAmount(d: ClosedDeal) {
  if (d.noValue) return `${formatEur(0)} (bez vrijednosti)`;
  if (d.otherCurrency) {
    return `${new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.amount ?? 0)} ${d.currency} (nije uračunato)`;
  }
  return formatEur(d.cents);
}

/** Notes about deals whose amount is not (fully) in the totals. */
function amountNotes(deals: readonly ClosedDeal[]) {
  const notes: string[] = [];
  const other = deals.filter((d) => d.otherCurrency).length;
  const none = deals.filter((d) => d.noValue).length;
  if (other) {
    notes.push(
      `${formatCount(other)} ${other === 1 ? 'prilika je' : 'prilika je'} u drugoj valuti: ubrojene su u broj prilika, ali ne i u iznose (nema automatske konverzije).`,
    );
  }
  if (none) {
    notes.push(
      `${formatCount(none)} ${none === 1 ? 'prilika nema' : 'prilika nema'} upisanu vrijednost: računa se kao 0,00 €.`,
    );
  }
  return notes;
}

function generatedLabel(ctx: CrmContext) {
  const date = calendarDateInZone(ctx.now, ctx.timeZone);
  const time = new Intl.DateTimeFormat('hr-HR', {
    timeZone: ctx.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ctx.now);
  return `${formatDateHr(date)} u ${time}`;
}

const presetName = (filters: ReportFilters) =>
  PERIOD_PRESETS.find((p) => p.value === filters.preset)?.label ?? 'Razdoblje';

// ------------------------------------------------------------- the engine ---
export interface ReportSource {
  readonly data: CrmData;
  readonly ctx: CrmContext;
  readonly members: readonly ReportMember[];
}

/**
 * Builds one report. Checks the chosen customer, opportunity and
 * representative against the organization's records (422 when not there).
 */
export function buildReport(source: ReportSource, filters: ReportFilters): Report {
  const { data, ctx, members } = source;
  const all = closedDeals(data, ctx, members);

  const customer = filters.customerId ? findInOrg(data.customers, ctx, filters.customerId) : null;
  if (filters.customerId && !customer) {
    throw new CrmValidationError(
      { customerId: REPORT_MESSAGES.customer },
      REPORT_MESSAGES.customer,
    );
  }
  const opportunity = filters.opportunityId
    ? findInOrg(data.opportunities, ctx, filters.opportunityId)
    : null;
  if (filters.opportunityId && !opportunity) {
    throw new CrmValidationError(
      { opportunityId: REPORT_MESSAGES.opportunity },
      REPORT_MESSAGES.opportunity,
    );
  }
  if (opportunity && customer && opportunity.companyId !== customer.id) {
    throw new CrmValidationError(
      { opportunityId: REPORT_MESSAGES.opportunityOfCustomer },
      REPORT_MESSAGES.opportunityOfCustomer,
    );
  }
  const memberIds = new Set(members.map((m) => m.id));
  const owners = new Set(all.map((d) => d.ownerId).filter(Boolean));
  if (
    filters.ownerId &&
    filters.ownerId !== UNASSIGNED &&
    !memberIds.has(filters.ownerId) &&
    !owners.has(filters.ownerId)
  ) {
    throw new CrmValidationError({ ownerId: REPORT_MESSAGES.owner }, REPORT_MESSAGES.owner);
  }

  const matches = (d: ClosedDeal) =>
    (!customer || d.customerId === customer.id) &&
    (!opportunity || d.id === opportunity.id) &&
    (!filters.ownerId ||
      (filters.ownerId === UNASSIGNED ? d.ownerId === null : d.ownerId === filters.ownerId));
  const inRange = (from: CalendarDate, to: CalendarDate) => {
    const b = boundsOf(ctx, from, to);
    return (d: ClosedDeal) => {
      const t = Date.parse(d.closedAt);
      return t >= b.from && t < b.to;
    };
  };
  const scoped = all.filter(matches);
  const ownerName = (id: string | null | undefined) =>
    id === UNASSIGNED
      ? UNASSIGNED_LABEL
      : (members.find((m) => m.id === id)?.name ??
        all.find((d) => d.ownerId === id)?.ownerName ??
        'Nepoznat korisnik');

  const filterList: Array<{ label: string; value: string }> = [];
  const def = reportType(filters.type);
  const from = filters.from as CalendarDate;
  const to = filters.to as CalendarDate;
  if (filters.type !== 'quarters') {
    filterList.push({
      label: 'Razdoblje',
      value: `${presetName(filters)}: ${formatDateHr(from)} – ${formatDateHr(to)}`,
    });
  } else {
    filterList.push({ label: 'Godina', value: `${filters.year}.` });
    filterList.push({
      label: 'Kvartal',
      value: filters.quarter === 'all' ? 'Svi kvartali' : `Q${filters.quarter}`,
    });
  }
  if ('customerId' in filters) {
    filterList.push({ label: 'Kupac', value: customer ? customer.companyName : 'Svi kupci' });
  }
  if ('opportunityId' in filters) {
    filterList.push({ label: 'Prilika', value: opportunity ? opportunity.title : 'Sve prilike' });
  }
  if ('ownerId' in filters) {
    filterList.push({
      label: 'Prodajni predstavnik',
      value: filters.ownerId ? ownerName(filters.ownerId) : 'Svi prodajni predstavnici',
    });
  }
  if (filters.status) {
    filterList.push({
      label: 'Status',
      value: OUTCOME_FILTERS.find((s) => s.value === filters.status)?.label ?? filters.status,
    });
  }
  if (filters.sort) {
    filterList.push({
      label: 'Poredak',
      value: REP_SORTS.find((s) => s.value === filters.sort)?.label ?? filters.sort,
    });
  }

  const base = {
    type: filters.type,
    title: def?.label ?? 'Izvještaj',
    generatedAt: ctx.now.toISOString(),
    generatedLabel: generatedLabel(ctx),
    timeZone: ctx.timeZone,
    period: { from, to, label: periodLabel({ startDate: from, endDate: to }) },
    filters: filterList,
    input: filters,
  };

  const limit = (deals: readonly ClosedDeal[]) => {
    if (deals.length > MAX_REPORT_DEALS) {
      throw new CrmValidationError({ range: REPORT_MESSAGES.tooMany }, REPORT_MESSAGES.tooMany);
    }
    return deals;
  };

  switch (filters.type) {
    case 'revenue':
      return {
        ...base,
        ...revenueReport(limit(scoped.filter(inRange(from, to)).filter((d) => d.status === 'won'))),
      };
    case 'quarters':
      return { ...base, ...quartersReport(ctx, scoped, filters, limit) };
    case 'won_lost':
      return { ...base, ...wonLostReport(limit(scoped.filter(inRange(from, to))), filters) };
    case 'sales_reps':
      return {
        ...base,
        ...salesRepsReport(limit(scoped.filter(inRange(from, to))), members, filters),
      };
  }
}

type Body = Omit<
  Report,
  'type' | 'title' | 'generatedAt' | 'generatedLabel' | 'timeZone' | 'period' | 'filters' | 'input'
>;

// ------------------------------------------------- 1 · revenue for a period ---
function revenueReport(won: readonly ClosedDeal[]): Body {
  const total = sum(won);
  const groups = new Map<string, { name: string; deals: ClosedDeal[] }>();
  for (const d of won) {
    const key = d.customerId ?? `~${d.customerName}`;
    const group = groups.get(key) ?? { name: d.customerName, deals: [] };
    group.deals.push(d);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort(byName);
  const rows: ReportRow[] = [];
  for (const g of ordered) {
    rows.push({
      kind: 'group',
      cells: [g.name, '', `${formatCount(g.deals.length)} WON`, formatEur(sum(g.deals))],
    });
    for (const d of g.deals) {
      rows.push({
        kind: 'row',
        indent: true,
        cells: [d.title, formatDateHr(d.closedDate), d.ownerName, dealAmount(d)],
      });
    }
  }
  if (won.length) {
    rows.push({
      kind: 'total',
      cells: ['Ukupno', '', `${formatCount(won.length)} WON`, formatEur(total)],
    });
  }
  return {
    summary: [
      { key: 'revenue', label: 'Ukupan prihod', display: formatEur(total), tone: 'won' },
      { key: 'won', label: 'Uspješno zaključene prilike (WON)', display: formatCount(won.length) },
      { key: 'customers', label: 'Kupci s WON prilikama', display: formatCount(groups.size) },
      {
        key: 'average',
        label: 'Prosječna vrijednost WON prilike',
        display: money(averageCents(won)),
      },
    ],
    charts: [],
    tables: [
      {
        key: 'deals',
        title: 'Kupci i WON prilike',
        columns: [
          { key: 'name', label: 'Kupac / prilika', align: 'left', width: 0.42 },
          { key: 'date', label: 'Datum WON', align: 'left', width: 0.15 },
          { key: 'owner', label: 'Predstavnik', align: 'left', width: 0.2 },
          { key: 'value', label: 'Vrijednost', align: 'right', width: 0.23 },
        ],
        rows,
        empty: 'U odabranom razdoblju nema WON prilika za odabrane filtre.',
      },
    ],
    notes: [...DEFAULT_NOTES, ...amountNotes(won)],
    empty: won.length === 0,
    totals: {
      revenueCents: total,
      wonCount: won.length,
      customerCount: groups.size,
      averageCents: averageCents(won),
    },
  };
}

// --------------------------------------------------- 2 · revenue by quarter ---
function quartersReport(
  ctx: CrmContext,
  scoped: readonly ClosedDeal[],
  filters: ReportFilters,
  limit: (deals: readonly ClosedDeal[]) => readonly ClosedDeal[],
): Body {
  const year = filters.year as number;
  const wonIn = (y: number, q: number) => {
    const p = quarterPeriod(y, q);
    const b = boundsOf(ctx, p.startDate, p.endDate);
    return scoped.filter((d) => {
      const t = Date.parse(d.closedAt);
      return d.status === 'won' && t >= b.from && t < b.to;
    });
  };
  const quarters = [1, 2, 3, 4].map((q) => {
    const deals = limit(wonIn(year, q));
    const previous = q === 1 ? wonIn(year - 1, 4) : null;
    return { q, deals, revenue: sum(deals), previousRevenue: previous ? sum(previous) : null };
  });
  for (const item of quarters) {
    if (item.previousRevenue === null) item.previousRevenue = quarters[item.q - 2]!.revenue;
  }
  const change = (revenue: number, previous: number) =>
    previous > 0 ? ((revenue - previous) / previous) * 100 : null;
  const shown =
    filters.quarter === 'all' ? quarters : quarters.filter((x) => x.q === filters.quarter);
  const yearDeals = quarters.flatMap((x) => x.deals);
  const yearRevenue = sum(yearDeals);
  const best = shown.reduce<(typeof shown)[number] | null>(
    (top, x) => (x.revenue > 0 && (!top || x.revenue > top.revenue) ? x : top),
    null,
  );
  const shownDeals = shown.flatMap((x) => x.deals);
  const rows: ReportRow[] = shown.map((x) => {
    const p = quarterPeriod(year, x.q);
    return {
      kind: 'row' as const,
      cells: [
        `Q${x.q}`,
        `${formatDateHr(p.startDate)} – ${formatDateHr(p.endDate)}`,
        formatCount(x.deals.length),
        formatEur(x.revenue),
        money(averageCents(x.deals)),
        formatChange(change(x.revenue, x.previousRevenue ?? 0)),
      ],
    };
  });
  if (shown.length > 1) {
    rows.push({
      kind: 'total',
      cells: [
        'Ukupno',
        `${year}.`,
        formatCount(shownDeals.length),
        formatEur(sum(shownDeals)),
        money(averageCents(shownDeals)),
        '',
      ],
    });
  }
  const summary: ReportSummaryItem[] = [
    {
      key: 'yearRevenue',
      label: `Ukupan godišnji prihod ${year}.`,
      display: formatEur(yearRevenue),
      tone: 'won',
    },
  ];
  if (filters.quarter !== 'all') {
    summary.push({
      key: 'quarterRevenue',
      label: `Prihod u Q${filters.quarter} ${year}.`,
      display: formatEur(sum(shownDeals)),
    });
  }
  summary.push(
    { key: 'won', label: 'WON prilike', display: formatCount(shownDeals.length) },
    {
      key: 'average',
      label: 'Prosječna vrijednost WON prilike',
      display: money(averageCents(shownDeals)),
    },
    {
      key: 'best',
      label: 'Kvartal s najvećim prihodom',
      display: best ? `Q${best.q} · ${formatEur(best.revenue)}` : NOT_APPLICABLE,
    },
  );
  return {
    summary,
    charts: [
      {
        key: 'quarters',
        kind: 'columns',
        title: `Prihod po kvartalima ${year}.`,
        items: quarters.map((x) => ({
          label: `Q${x.q}`,
          value: x.revenue,
          display: formatEur(x.revenue),
          tone: filters.quarter === 'all' || filters.quarter === x.q ? 'highlight' : 'neutral',
        })),
      },
    ],
    tables: [
      {
        key: 'quarters',
        title: 'Kvartalna usporedba',
        columns: [
          { key: 'quarter', label: 'Kvartal', align: 'left', width: 0.1 },
          { key: 'range', label: 'Razdoblje', align: 'left', width: 0.26 },
          { key: 'won', label: 'WON prilike', align: 'right', width: 0.13 },
          { key: 'revenue', label: 'Prihod', align: 'right', width: 0.19 },
          { key: 'average', label: 'Prosjek WON', align: 'right', width: 0.17 },
          { key: 'change', label: 'Promjena vs. preth. kvartal', align: 'right', width: 0.15 },
        ],
        rows,
        empty: 'Nema kvartala za prikaz.',
      },
    ],
    notes: [
      ...DEFAULT_NOTES,
      'Kvartali: Q1 1.1.–31.3., Q2 1.4.–30.6., Q3 1.7.–30.9., Q4 1.10.–31.12. Promjena se računa prema prethodnom kvartalu (za Q1 prema Q4 prethodne godine); kad je prethodni kvartal 0,00 € prikazuje se N/P.',
      ...amountNotes(yearDeals),
    ],
    empty: yearDeals.length === 0,
    totals: {
      yearRevenueCents: yearRevenue,
      shownRevenueCents: sum(shownDeals),
      wonCount: shownDeals.length,
      bestQuarter: best ? best.q : null,
      ...Object.fromEntries(quarters.map((x) => [`q${x.q}Cents`, x.revenue])),
      ...Object.fromEntries(quarters.map((x) => [`q${x.q}Count`, x.deals.length])),
      ...Object.fromEntries(
        quarters.map((x) => [`q${x.q}ChangePercent`, change(x.revenue, x.previousRevenue ?? 0)]),
      ),
    },
  };
}

// ------------------------------------------------------- 3 · WON / LOST ---
function wonLostReport(closed: readonly ClosedDeal[], filters: ReportFilters): Body {
  const won = closed.filter((d) => d.status === 'won');
  const lost = closed.filter((d) => d.status === 'lost');
  const rates = outcomeRates({ won: won.length, lost: lost.length });
  const listed = closed.filter((d) => filters.status === 'all' || d.status === filters.status);
  const rows: ReportRow[] = listed.map((d) => ({
    kind: 'row',
    cells: [
      formatDateHr(d.closedDate),
      d.title,
      d.customerName,
      d.ownerName,
      d.status === 'won' ? 'WON' : 'LOST',
      dealAmount(d),
    ],
  }));
  const notes = [
    ...DEFAULT_NOTES,
    'WIN RATE = WON ÷ (WON + LOST) × 100; LOSS RATE = LOST ÷ (WON + LOST) × 100. Aktivne prilike nisu uključene; bez zaključenih prilika prikazuje se N/P.',
    'Potencijalna vrijednost LOST prilika je procijenjena vrijednost izgubljenih prilika — nije ostvareni prihod.',
  ];
  if (filters.status !== 'all') {
    notes.push(
      'Pokazatelji uključuju i WON i LOST prilike; filter statusa sužava samo popis prilika.',
    );
  }
  return {
    summary: [
      { key: 'won', label: 'WON prilike', display: formatCount(won.length), tone: 'won' },
      { key: 'lost', label: 'LOST prilike', display: formatCount(lost.length), tone: 'lost' },
      { key: 'winRate', label: 'WIN RATE', display: formatPercent(rates.wonRate) },
      { key: 'lossRate', label: 'LOSS RATE', display: formatPercent(rates.lostRate) },
      {
        key: 'wonValue',
        label: 'Ostvareni prihod (WON)',
        display: formatEur(sum(won)),
        tone: 'won',
      },
      {
        key: 'lostValue',
        label: 'Potencijalna vrijednost LOST prilika',
        display: formatEur(sum(lost)),
        hint: 'Nije ostvareni prihod.',
        tone: 'lost',
      },
    ],
    charts: [
      {
        key: 'count',
        kind: 'bars',
        title: 'Broj zaključenih prilika',
        items: [
          {
            label: 'WON',
            value: won.length,
            display: `${formatCount(won.length)} · ${formatPercent(rates.wonRate)}`,
            tone: 'won',
          },
          {
            label: 'LOST',
            value: lost.length,
            display: `${formatCount(lost.length)} · ${formatPercent(rates.lostRate)}`,
            tone: 'lost',
          },
        ],
      },
      {
        key: 'value',
        kind: 'bars',
        title: 'Vrijednost (EUR)',
        items: [
          {
            label: 'Ostvareni prihod (WON)',
            value: sum(won),
            display: formatEur(sum(won)),
            tone: 'won',
          },
          {
            label: 'Potencijal LOST',
            value: sum(lost),
            display: formatEur(sum(lost)),
            tone: 'lost',
          },
        ],
      },
    ],
    tables: [
      {
        key: 'deals',
        title: 'Zaključene prilike',
        columns: [
          { key: 'date', label: 'Datum', align: 'left', width: 0.13 },
          { key: 'title', label: 'Prilika', align: 'left', width: 0.25 },
          { key: 'customer', label: 'Kupac', align: 'left', width: 0.2 },
          { key: 'owner', label: 'Predstavnik', align: 'left', width: 0.15 },
          { key: 'status', label: 'Status', align: 'left', width: 0.08 },
          { key: 'value', label: 'Vrijednost', align: 'right', width: 0.19 },
        ],
        rows,
        empty: 'U odabranom razdoblju nema zaključenih prilika za odabrane filtre.',
      },
    ],
    notes: [...notes, ...amountNotes(closed)],
    empty: closed.length === 0,
    totals: {
      wonCount: won.length,
      lostCount: lost.length,
      winRate: rates.wonRate,
      lossRate: rates.lostRate,
      wonCents: sum(won),
      lostCents: sum(lost),
      listedCount: listed.length,
    },
  };
}

// ------------------------------------------ 4 · sales representatives ---
interface RepLine {
  readonly id: string | null;
  readonly name: string;
  readonly won: number;
  readonly lost: number;
  readonly revenue: number;
  readonly winRate: number | null;
  readonly average: number | null;
}

function salesRepsReport(
  closed: readonly ClosedDeal[],
  members: readonly ReportMember[],
  filters: ReportFilters,
): Body {
  // Who is compared: members with the sales role (Korisnik) who are active,
  // and anyone who owns a deal in the report. Administrators and owners
  // without deals here are not "sales representatives".
  const ids = new Set<string>();
  for (const m of members) if (m.role === 'user' && m.status === 'active') ids.add(m.id);
  for (const d of closed) if (d.ownerId) ids.add(d.ownerId);
  if (filters.ownerId && filters.ownerId !== UNASSIGNED) {
    for (const id of [...ids]) if (id !== filters.ownerId) ids.delete(id);
    ids.add(filters.ownerId);
  }
  if (filters.ownerId === UNASSIGNED) ids.clear();

  const line = (id: string | null, name: string, deals: readonly ClosedDeal[]): RepLine => {
    const won = deals.filter((d) => d.status === 'won');
    const lost = deals.filter((d) => d.status === 'lost');
    return {
      id,
      name,
      won: won.length,
      lost: lost.length,
      revenue: sum(won),
      winRate: outcomeRates({ won: won.length, lost: lost.length }).wonRate,
      average: averageCents(won),
    };
  };
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.name ??
    closed.find((d) => d.ownerId === id)?.ownerName ??
    'Nepoznat korisnik';
  const reps = [...ids].map((id) =>
    line(
      id,
      nameOf(id),
      closed.filter((d) => d.ownerId === id),
    ),
  );
  const sortKey = filters.sort ?? 'revenue';
  const compare = (a: RepLine, b: RepLine) => {
    const by =
      sortKey === 'won'
        ? b.won - a.won
        : sortKey === 'win_rate'
          ? (b.winRate ?? -1) - (a.winRate ?? -1)
          : b.revenue - a.revenue;
    return by || b.revenue - a.revenue || hrCollator.compare(a.name, b.name);
  };
  reps.sort(compare);
  const unassignedDeals =
    filters.ownerId && filters.ownerId !== UNASSIGNED
      ? []
      : closed.filter((d) => d.ownerId === null);
  const unassigned = line(null, UNASSIGNED_LABEL, unassignedDeals);
  const showUnassigned = unassignedDeals.length > 0 || filters.ownerId === UNASSIGNED;
  const counted = closed.filter(
    (d) => (d.ownerId && ids.has(d.ownerId)) || (d.ownerId === null && showUnassigned),
  );
  const total = line(null, 'Ukupno', counted);
  const cells = (r: RepLine) => [
    r.name,
    formatCount(r.won),
    formatCount(r.lost),
    formatEur(r.revenue),
    formatPercent(r.winRate),
    money(r.average),
  ];
  const rows: ReportRow[] = reps.map((r) => ({ kind: 'row', cells: cells(r) }));
  if (showUnassigned) rows.push({ kind: 'muted', cells: cells(unassigned) });
  if (rows.length) rows.push({ kind: 'total', cells: cells(total) });
  const chartLines = [...reps, ...(showUnassigned ? [unassigned] : [])];
  return {
    summary: [
      { key: 'reps', label: 'Prodajni predstavnici', display: formatCount(reps.length) },
      {
        key: 'revenue',
        label: 'Ukupan ostvareni prihod',
        display: formatEur(total.revenue),
        tone: 'won',
      },
      {
        key: 'won',
        label: 'WON / LOST',
        display: `${formatCount(total.won)} / ${formatCount(total.lost)}`,
      },
      { key: 'winRate', label: 'WIN RATE (svi)', display: formatPercent(total.winRate) },
      {
        key: 'top',
        label: 'Najveći prihod',
        display: reps.find((r) => r.revenue > 0)
          ? `${[...reps].sort((a, b) => b.revenue - a.revenue)[0]!.name}`
          : NOT_APPLICABLE,
      },
    ],
    charts: [
      {
        key: 'revenue',
        kind: 'bars',
        title: 'Ostvareni prihod po predstavniku',
        items: chartLines.map((r) => ({
          label: r.name,
          value: r.revenue,
          display: formatEur(r.revenue),
          tone: r.id === null ? 'neutral' : 'won',
        })),
      },
    ],
    tables: [
      {
        key: 'reps',
        title: 'Usporedba prodajnih predstavnika',
        columns: [
          { key: 'name', label: 'Prodajni predstavnik', align: 'left', width: 0.3 },
          { key: 'won', label: 'WON', align: 'right', width: 0.09 },
          { key: 'lost', label: 'LOST', align: 'right', width: 0.09 },
          { key: 'revenue', label: 'Ostvareni prihod', align: 'right', width: 0.2 },
          { key: 'winRate', label: 'WIN RATE', align: 'right', width: 0.13 },
          { key: 'average', label: 'Prosjek WON', align: 'right', width: 0.19 },
        ],
        rows,
        empty: 'Nema prodajnih predstavnika za odabrane filtre.',
      },
    ],
    notes: [
      ...DEFAULT_NOTES,
      'Prihod prilike pripada samo njezinom odgovornom prodajnom predstavniku (bez raspodjele). Prilike bez predstavnika prikazane su kao NEDODIJELJENO i uključene u ukupno.',
      'Uspoređuju se aktivni korisnici s ulogom Korisnik (prodaja) i svi koji su odgovorni za zaključenu priliku u razdoblju.',
      ...amountNotes(counted),
    ],
    empty: counted.length === 0,
    totals: {
      repCount: reps.length,
      revenueCents: total.revenue,
      wonCount: total.won,
      lostCount: total.lost,
      winRate: total.winRate,
      unassignedCents: unassigned.revenue,
      unassignedCount: unassignedDeals.length,
    },
  };
}
