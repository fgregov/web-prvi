// KPI cards of the selected period. Current quarter: action metrics
// (leads, qualified, meetings, revenue). Past periods: results
// (leads, qualified, won, revenue). Each value is compared with the
// comparison period the server reports.
import { periodTitle, quarterPeriod, shiftQuarter } from '../../core/period.js';
import { h } from '../../ui/dom.js';
import { spriteIcon } from './sprite.js';

/** "€18.400" (cards stay narrow, so millions are shortened). */
export function formatEuro(value) {
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  return `€${Math.round(value).toLocaleString('hr-HR')}`;
}

/** What the trend compares with, in words. */
export function comparisonLabel(period, isCurrent) {
  if (period.type !== 'QUARTER') return 'prethodni period iste duljine';
  const prev = shiftQuarter(period, -1);
  const title = periodTitle(quarterPeriod(prev.year, prev.quarter));
  return isCurrent ? `isto razdoblje ${title}` : title;
}

function trend(metric, against) {
  if (!metric.previous) return h('span', { class: 'trend trend--none' }, '—');
  const change = Math.round(((metric.value - metric.previous) / metric.previous) * 100);
  const down = change < 0;
  return h(
    'span',
    { class: `trend${down ? ' trend--down' : ''}`, title: `u odnosu na ${against}` },
    spriteIcon(down ? 'arrow-down' : 'arrow-up'),
    `${Math.abs(change)}%`,
  );
}

function card({ label, metric, iconName, tone, href, money = false }, against) {
  const value = money ? formatEuro(metric.value) : String(metric.value);
  const change = metric.previous
    ? `${Math.round(((metric.value - metric.previous) / metric.previous) * 100)} % u odnosu na ${against}`
    : 'nema podataka za usporedbu';
  return h(
    'a',
    { class: 'metric', href, 'aria-label': `${label}: ${value}, ${change}` },
    h('span', { class: 'metric__label' }, label),
    h(
      'span',
      { class: 'metric__row' },
      h('span', { class: 'metric__value' }, value),
      h('span', { class: `metric__icon metric__icon--${tone}` }, spriteIcon(iconName)),
    ),
    trend(metric, against),
  );
}

export function renderKpiCards(container, summary) {
  const { kpis, period } = summary;
  const against = comparisonLabel(period, period.isCurrent);
  const cards = period.isCurrent
    ? [
        {
          label: 'Novi leadovi',
          metric: kpis.newLeads,
          iconName: 'users',
          tone: 'red',
          href: '/leads',
        },
        {
          label: 'Kvalificirani',
          metric: kpis.qualified,
          iconName: 'funnel',
          tone: 'green',
          href: '/opportunities',
        },
        {
          label: 'Sastanci',
          metric: kpis.meetings,
          iconName: 'calendar-check',
          tone: 'red',
          href: '/calendar',
        },
        {
          label: 'Prihod',
          metric: kpis.revenue,
          iconName: 'bars',
          tone: 'plain',
          href: '/reports',
          money: true,
        },
      ]
    : [
        {
          label: 'Novi leadovi',
          metric: kpis.newLeads,
          iconName: 'users',
          tone: 'red',
          href: '/leads',
        },
        {
          label: 'Kvalificirani',
          metric: kpis.qualified,
          iconName: 'funnel',
          tone: 'green',
          href: '/opportunities',
        },
        {
          label: 'Dobivene',
          metric: kpis.won,
          iconName: 'check',
          tone: 'green',
          href: '/opportunities',
        },
        {
          label: 'Prihod',
          metric: kpis.revenue,
          iconName: 'bars',
          tone: 'plain',
          href: '/reports',
          money: true,
        },
      ];
  container.setAttribute('aria-label', period.isCurrent ? 'Pregled prodaje' : 'Rezultati perioda');
  container.replaceChildren(...cards.map((c) => card(c, against)));
}

export function renderKpiSkeleton(container) {
  container.replaceChildren(
    ...Array.from({ length: 4 }, () =>
      h(
        'span',
        { class: 'metric is-skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'skeleton skeleton--label' }),
        h('span', { class: 'skeleton skeleton--value' }),
        h('span', { class: 'skeleton skeleton--label' }),
      ),
    ),
  );
}
