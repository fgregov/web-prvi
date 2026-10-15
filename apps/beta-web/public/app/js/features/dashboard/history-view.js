// Historical dashboard: "what happened in this period?". Same cards and rhythm
// as the operational Home, read as results: completed work is ticked green,
// unfinished work is neutral (never styled as urgent), nothing invites action
// on the past except links to the full lists.
import { labelOf, TASK_TYPES } from '../../core/constants.js';
import { dayKey, parseDayKey } from '../../core/format.js';
import { h } from '../../ui/dom.js';
import { withParams } from '../../ui/navigation.js';
import { renderFeedbackOverview } from './feedback-overview.js';
import { comparisonLabel, formatEuro } from './kpi-cards.js';
import { renderPipelineOverview } from './pipeline-overview.js';
import { spriteIcon } from './sprite.js';

const HOME = '/dashboard';
const shortDate = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};
const taskHref = (task) =>
  withParams(`/sales/tasks/${encodeURIComponent(task.id)}`, { returnTo: HOME });

function moduleCard({
  id,
  title,
  titleHref = null,
  iconName,
  link,
  compact = false,
  wrapHead = false,
  children,
}) {
  return h(
    'section',
    {
      class: `card module module--history${compact ? ' module--compact' : ''}`,
      'aria-labelledby': id,
    },
    h(
      'div',
      { class: `module__head${wrapHead ? ' module__head--wrap' : ''}` },
      h('span', { class: 'module__icon' }, spriteIcon(iconName)),
      h(
        'h2',
        { class: 'module__title', id },
        titleHref ? h('a', { class: 'module__title-link', href: titleHref }, title) : title,
      ),
      link
        ? h(
            'a',
            { class: 'module__link', href: link.href },
            link.label,
            spriteIcon('chevron-right'),
          )
        : null,
    ),
    children,
  );
}

function statusMark(done) {
  return done
    ? h('span', { class: 'hist-check', 'aria-hidden': 'true' }, spriteIcon('check'))
    : h('span', { class: 'hist-open', 'aria-hidden': 'true' });
}

const statusText = (task) =>
  task.status === 'completed'
    ? 'Dovršeno'
    : task.status === 'open'
      ? 'Još otvoreno'
      : 'Nije dovršeno';

function summaryLine(parts) {
  return h(
    'p',
    { class: 'hist-summary' },
    parts.map(([done, text], i) => [
      i ? h('span', { class: 'hist-summary__sep', 'aria-hidden': 'true' }, '·') : null,
      h(
        'span',
        { class: `hist-summary__item${done ? ' is-done' : ''}` },
        done ? spriteIcon('check') : null,
        text,
      ),
    ]),
  );
}

function calendarCard(summary, period) {
  const { calendar } = summary;
  const monday = (() => {
    const d = parseDayKey(period.startDate);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayKey(d);
  })();
  return moduleCard({
    id: 'hist-calendar-title',
    title: 'Sales Kalendar',
    iconName: 'calendar',
    link: { label: 'Pogledaj kalendar', href: `/sales-calendar?week=${monday}` },
    children: [
      summaryLine([
        [false, `${calendar.total} zakazanih aktivnosti`],
        [true, `${calendar.done} dovršeno`],
      ]),
      calendar.items.length
        ? h(
            'ul',
            { class: 'list', role: 'list' },
            calendar.items.map((task) => {
              const done = task.status === 'completed';
              return h(
                'li',
                {},
                h(
                  'a',
                  {
                    class: `event event--history${done ? ' event--done' : ''}`,
                    href: taskHref(task),
                  },
                  h(
                    'time',
                    { class: 'event__time', datetime: task.scheduledStartAt },
                    shortDate(task.scheduledStartAt),
                  ),
                  done
                    ? h(
                        'span',
                        { class: 'event__done', 'aria-label': 'Dovršeno' },
                        spriteIcon('check'),
                      )
                    : h('span', { class: 'dot dot--gray', 'aria-label': statusText(task) }),
                  h(
                    'span',
                    { class: 'event__text' },
                    h('span', { class: 'event__title' }, task.title),
                    h(
                      'span',
                      { class: 'event__sub' },
                      [
                        labelOf(TASK_TYPES, task.type),
                        task.customerName ?? (task.leadName ? `Lead: ${task.leadName}` : null),
                        statusText(task),
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                  spriteIcon('chevron-right', 'icon chevron'),
                ),
              );
            }),
          )
        : null,
    ],
  });
}

function tasksCard(summary) {
  const { tasks } = summary;
  return moduleCard({
    id: 'hist-tasks-title',
    title: 'Prioritetni zadaci',
    iconName: 'square-check',
    link: { label: 'Pogledaj sve zadatke', href: '/sales/tasks' },
    wrapHead: true,
    children: [
      summaryLine([
        [true, `${tasks.done} dovršeno`],
        [false, `${tasks.notDone} nije dovršeno`],
      ]),
      tasks.items.length
        ? h(
            'ul',
            { class: 'list', role: 'list' },
            tasks.items.map((task) => {
              const done = task.status === 'completed';
              return h(
                'li',
                {},
                h(
                  'a',
                  { class: `hist-task${done ? ' is-done' : ''}`, href: taskHref(task) },
                  statusMark(done),
                  h('span', { class: 'hist-task__title' }, task.title),
                  h(
                    'span',
                    { class: `pill ${done ? 'pill--green' : 'pill--muted'}` },
                    statusText(task),
                  ),
                ),
              );
            }),
          )
        : null,
    ],
  });
}

const ratioFmt = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 2 });

/** "Win rate 64 % · W/L 1,75": closed leads only (won ÷ won + lost, won ÷ lost). */
function leadRatios(leads) {
  if (!leads.closed) return null;
  return h(
    'p',
    { class: 'hist-caption hist-leads__ratios' },
    [
      `Win rate ${Math.round(leads.winRate * 100)} %`,
      leads.wlRatio === null ? null : `W/L ${ratioFmt.format(leads.wlRatio)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

function leadsCard(summary, period) {
  const { kpis, leads } = summary;
  const total = Math.max(kpis.newLeads.value, 1);
  const bar = (label, value, tone) =>
    h(
      'li',
      { class: 'hist-bar' },
      h('span', { class: 'hist-bar__label' }, label),
      h(
        'span',
        { class: 'hist-bar__track' },
        h('span', {
          class: `hist-bar__fill hist-bar__fill--${tone}`,
          style: `--fill: ${Math.min(100, Math.round((value / total) * 100))}%`,
        }),
      ),
      h('span', { class: 'hist-bar__value' }, String(value)),
    );
  const revenue = kpis.revenue;
  const change = revenue.previous
    ? Math.round(((revenue.value - revenue.previous) / revenue.previous) * 100)
    : null;
  return moduleCard({
    id: 'hist-leads-title',
    title: 'Leadovi',
    iconName: 'users',
    link: { label: 'Pogledaj', href: '/sales/leads' },
    children: [
      h(
        'div',
        { class: 'hist-leads' },
        h(
          'p',
          { class: 'hist-big' },
          h('strong', {}, String(kpis.newLeads.value)),
          ' novih leadova',
        ),
        h(
          'ul',
          { class: 'hist-bars', role: 'list' },
          bar('Kvalificirano', kpis.qualified.value, 'red'),
          // WON = a deal of the lead won; becoming a customer is a later step (ADR-0009).
          bar('Osvojeno', leads.won, 'green'),
          bar('Pretvoreno u kupca', leads.converted ?? leads.won, 'green'),
          bar('Izgubljeno', leads.lost, 'gray'),
        ),
        leadRatios(leads),
        leads.conversionPending
          ? h(
              'p',
              { class: 'hist-caption' },
              `Čeka pretvaranje u kupca: ${leads.conversionPending}`,
            )
          : null,
      ),
      h(
        'a',
        { class: 'hist-revenue', href: '/reports' },
        h(
          'span',
          { class: 'hist-revenue__main' },
          h('span', { class: 'hist-revenue__label' }, 'Prihod'),
          h('strong', { class: 'hist-revenue__value' }, formatEuro(revenue.value)),
          change === null
            ? null
            : h(
                'span',
                { class: `hist-revenue__change${change < 0 ? ' is-down' : ''}` },
                `${change >= 0 ? '+' : '−'}${Math.abs(change)}% vs ${comparisonLabel(period, false)}`,
              ),
        ),
        kpis.avgWonValue
          ? h(
              'span',
              { class: 'hist-revenue__avg' },
              h('span', {}, 'Prosječna dobivena prilika'),
              h('strong', {}, formatEuro(kpis.avgWonValue)),
            )
          : null,
      ),
    ],
  });
}

/** LEADS, PROSPECTS, NEGOTIATIONS of the period; BUYERS of its year up to its end. */
function pipelineCard(summary, title) {
  const list = h('ul', { class: 'pipeline', role: 'list' });
  renderPipelineOverview(list, summary.pipelineOverview);
  return moduleCard({
    id: 'hist-pipeline-title',
    title: 'Opportunity Pipeline',
    titleHref: '/opportunity-pipeline',
    iconName: 'bars',
    compact: true,
    link: { label: 'Full dashboard', href: '/opportunity-pipeline' },
    children: [h('p', { class: 'hist-caption' }, title), list],
  });
}

/** Offers that were waiting for an answer at the end of the period (not today). */
function feedbackCard(summary) {
  const list = h('ul', { class: 'list', role: 'list' });
  renderFeedbackOverview(list, summary.feedback.items);
  return moduleCard({
    id: 'hist-feedback-title',
    title: 'Feedback overview',
    titleHref: '/feedback-overview',
    iconName: 'clock',
    link: { label: 'Svi', href: '/feedback-overview' },
    children: [
      h('p', { class: 'hist-caption' }, `Stanje na ${shortDate(summary.feedback.asOf)}`),
      list,
    ],
  });
}

function followUpCard(summary) {
  const { followUps } = summary;
  const row = (done, value, label, tone) =>
    h(
      'li',
      { class: `hist-follow${tone ? ` hist-follow--${tone}` : ''}` },
      statusMark(done),
      h('span', { class: 'hist-follow__value' }, String(value)),
      h('span', { class: 'hist-follow__label' }, label),
    );
  return moduleCard({
    id: 'hist-follow-title',
    title: 'Follow-up',
    iconName: 'repeat',
    compact: true,
    link: { label: 'Engine', href: '/follow-up' },
    children: [
      h('p', { class: 'hist-caption' }, `${followUps.total} follow-upa`),
      h(
        'ul',
        { class: 'list hist-follow-list', role: 'list' },
        row(true, followUps.done, 'izvršeno'),
        row(false, followUps.noAnswer, 'bez odgovora'),
        row(false, followUps.open, 'još aktivno'),
      ),
    ],
  });
}

export function renderHistory(container, summary, info, { onBackToCurrent }) {
  if (!summary.hasData) {
    container.replaceChildren(
      h(
        'section',
        { class: 'card hist-empty' },
        h('span', { class: 'module__icon' }, spriteIcon('calendar')),
        h('p', { class: 'hist-empty__text' }, 'Nema evidentiranih podataka za odabrani period.'),
        h('p', { class: 'hist-empty__range' }, `${info.title} · ${info.range}`),
        h(
          'button',
          { type: 'button', class: 'hist-empty__back', onClick: onBackToCurrent },
          'Vrati na aktualni kvartal',
        ),
      ),
    );
    return;
  }
  const title = info.period.type === 'QUARTER' ? info.title : info.range;
  container.replaceChildren(
    calendarCard(summary, info.period),
    tasksCard(summary),
    leadsCard(summary, info.period),
    h('div', { class: 'split' }, pipelineCard(summary, title), followUpCard(summary)),
    feedbackCard(summary),
  );
}

export function renderHistorySkeleton(container) {
  container.replaceChildren(
    ...[132, 168, 150].map((height) =>
      h('div', {
        class: 'card skeleton-card',
        style: `height: ${height}px`,
        'aria-hidden': 'true',
      }),
    ),
  );
}
