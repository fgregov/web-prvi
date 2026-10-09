// KPI cards of the selected period, the same four in every view:
//   LEADS                        leads created
//   WON NUMBER  | WON RATE       opportunities won  | won ÷ (won + lost)
//   LOST NUMBER | LOST RATE      opportunities lost | lost ÷ (won + lost)
//   OPPORTUNITY Potential / Won  value of deals created / value of deals won (EUR)
// Counts compare with the period the server reports; rates without closed deals
// show "—". The # | % choice is remembered per card in this browser.
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

const percent = (value) =>
  value === null ? '—' : `${value.toLocaleString('hr-HR', { maximumFractionDigits: 1 })}%`;

function change(metric) {
  return metric.previous
    ? Math.round(((metric.value - metric.previous) / metric.previous) * 100)
    : null;
}

/** Change against the comparison period; `lowerIsBetter` (LOST) reverses the colours. */
function trend(metric, against, { lowerIsBetter = false } = {}) {
  const pct = change(metric);
  if (pct === null) return h('span', { class: 'trend trend--none' }, '—');
  const tone = lowerIsBetter
    ? pct > 0
      ? ' trend--worse'
      : ' trend--better'
    : pct < 0
      ? ' trend--down'
      : '';
  return h(
    'span',
    { class: `trend${tone}`, title: `u odnosu na ${against}` },
    spriteIcon(pct < 0 ? 'arrow-down' : 'arrow-up'),
    `${Math.abs(pct)}%`,
  );
}

const MODE_KEY = (key) => `renvara.kpi.${key}.mode`;
const readMode = (key) => {
  try {
    return window.localStorage.getItem(MODE_KEY(key)) === 'rate' ? 'rate' : 'number';
  } catch {
    return 'number';
  }
};
const saveMode = (key, mode) => {
  try {
    window.localStorage.setItem(MODE_KEY(key), mode);
  } catch {
    /* only for this visit */
  }
};

function leadsCard(kpis, against) {
  const pct = change(kpis.leads);
  return h(
    'a',
    {
      class: 'metric',
      href: '/leads',
      'aria-label': `Leads: ${kpis.leads.value}${pct === null ? '' : `, ${pct} % u odnosu na ${against}`}`,
    },
    h('span', { class: 'metric__label' }, 'Leads'),
    h(
      'span',
      { class: 'metric__row' },
      h('span', { class: 'metric__value' }, String(kpis.leads.value)),
      h('span', { class: 'metric__icon metric__icon--red' }, spriteIcon('users')),
    ),
    trend(kpis.leads, against),
  );
}

/** WON or LOST: one card, number or rate, switched with "# | %". */
function outcomeCard(
  { key, title, metric, rate, closed, iconName, tone, lowerIsBetter = false },
  against,
) {
  let mode = readMode(key);
  const card = h('div', { class: 'metric metric--outcome', dataset: { kpi: key } });
  const toggle = (value, label, text) =>
    h(
      'button',
      {
        type: 'button',
        class: 'metric__mode',
        'aria-label': label,
        onClick: (event) => {
          event.stopPropagation();
          mode = value;
          saveMode(key, value);
          render();
        },
      },
      text,
    );
  const numberButton = toggle('number', `${title}: broj`, '#');
  const rateButton = toggle('rate', `${title}: postotak`, '%');
  function render() {
    const rateMode = mode === 'rate';
    numberButton.setAttribute('aria-pressed', String(!rateMode));
    rateButton.setAttribute('aria-pressed', String(rateMode));
    card.replaceChildren(
      h('span', { class: 'metric__label' }, `${title} ${rateMode ? 'rate' : 'number'}`),
      h(
        'span',
        { class: 'metric__row' },
        h('span', { class: 'metric__value' }, rateMode ? percent(rate) : String(metric.value)),
        h('span', { class: `metric__icon metric__icon--${tone}` }, spriteIcon(iconName)),
      ),
      h(
        'span',
        { class: 'metric__foot' },
        rateMode
          ? h(
              'span',
              { class: 'metric__note' },
              closed ? `od ${closed} zatvorenih` : 'nema zatvorenih',
            )
          : trend(metric, against, { lowerIsBetter }),
        h(
          'span',
          { class: 'metric__modes', role: 'group', 'aria-label': 'Prikaz' },
          numberButton,
          rateButton,
        ),
      ),
    );
  }
  render();
  return card;
}

function opportunityCard(kpis) {
  const other = kpis.otherCurrency.potential + kpis.otherCurrency.won;
  return h(
    'a',
    {
      class: 'metric metric--money',
      href: '/opportunities',
      'aria-label': `Opportunity: potencijal ${formatEuro(kpis.potential.value)}, dobiveno ${formatEuro(kpis.wonValue.value)}`,
    },
    h('span', { class: 'metric__label' }, 'Opportunity'),
    h(
      'span',
      { class: 'metric__pair' },
      h('span', { class: 'metric__key' }, 'Potential'),
      h('span', { class: 'metric__amount' }, formatEuro(kpis.potential.value)),
    ),
    h(
      'span',
      { class: 'metric__pair metric__pair--won' },
      h('span', { class: 'metric__key' }, 'Won'),
      h('span', { class: 'metric__amount' }, formatEuro(kpis.wonValue.value)),
    ),
    other
      ? h(
          'span',
          { class: 'metric__note', title: 'Iznosi u drugim valutama nisu pretvoreni u EUR' },
          `bez ${other} u drugoj valuti`,
        )
      : null,
  );
}

export function renderKpiCards(container, summary) {
  const { kpis, period } = summary;
  const against = comparisonLabel(period, period.isCurrent);
  container.setAttribute('aria-label', period.isCurrent ? 'Pregled prodaje' : 'Rezultati perioda');
  container.replaceChildren(
    leadsCard(kpis, against),
    outcomeCard(
      {
        key: 'won',
        title: 'Won',
        metric: kpis.won,
        rate: kpis.rates.wonRate,
        closed: kpis.rates.closed,
        iconName: 'check',
        tone: 'green',
      },
      against,
    ),
    outcomeCard(
      {
        key: 'lost',
        title: 'Lost',
        metric: kpis.lost,
        rate: kpis.rates.lostRate,
        closed: kpis.rates.closed,
        iconName: 'arrow-down',
        tone: 'red',
        lowerIsBetter: true,
      },
      against,
    ),
    opportunityCard(kpis),
  );
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
