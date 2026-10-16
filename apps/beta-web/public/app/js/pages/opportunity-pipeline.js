// /opportunity-pipeline · Opportunity Pipeline: the open opportunities created in the
// selected period (the Home dashboard's period, shared), in the stage they are
// in today, with next actions. Each stage is an accordion (the Customer Detail
// principle): closed on a new visit, as it was when coming Back, several open
// at once. The period selector sits next to "Nova prilika".
import { api, ApiError, onDataChanged } from '../core/api.js';
import {
  describePeriod,
  getDashboardPeriod,
  onDashboardPeriodChange,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { formatDay, formatMoney } from '../core/format.js';
import { nextActionLine } from '../features/customers/profile/customer-opportunities.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import { accordionSection, openSectionsState } from '../ui/accordion.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { mountAppShell } from '../ui/app-shell.js';
import { consumeFlash } from '../ui/toast.js';

mountAppShell();
const root = document.getElementById('app');

/** Stage → its accordion's icon. */
const STAGE_ICON = {
  new: 'target',
  in_progress: 'clock',
  offer_sent: 'file',
  negotiation: 'users',
  closing: 'check',
};
const sectionId = (stage) => `faza-${stage.replace(/_/g, '-')}`;
const openSections = openSectionsState(
  Object.keys(STAGE_ICON).map(sectionId),
  window.location.hash.slice(1),
);

/** Plural of "otvorena prilika" (1 otvorena prilika, 2 otvorene prilike, 5 otvorenih prilika). */
function openCount(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} otvorena prilika`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} otvorene prilike`;
  return `${n} otvorenih prilika`;
}

// Header: title and summary, then the period and "Nova prilika" side by side.
const summary = h('p', { class: 'rv-muted' }, '\u00a0');
const periodSlot = h('div', { class: 'rv-period-slot' });
const caption = h('p', { class: 'rv-period-caption' });
const body = h('div', { class: 'rv-period-body', 'aria-live': 'polite' });
root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h('div', {}, h('h1', { class: 'rv-page-title' }, 'Opportunity Pipeline'), summary),
    h(
      'div',
      { class: 'rv-page-head__actions rv-pipeline-actions' },
      periodSlot,
      h(
        'a',
        {
          class: 'rv-btn rv-btn--primary',
          href: '/sales/opportunities/new?returnTo=/opportunity-pipeline',
        },
        icon('plus'),
        'Nova prilika',
      ),
    ),
  ),
  caption,
  body,
);
const selector = PeriodSelector({
  container: periodSlot,
  getPeriod: getDashboardPeriod,
  onSelect: setDashboardPeriod,
  compact: true,
});

/** Stage cards: the opportunities of one stage, or what the stage holds otherwise. */
function stageContent(items, demo) {
  return [
    items.length
      ? h(
          'ul',
          { class: 'rv-pipeline-list', role: 'list' },
          items.map((o) =>
            h(
              'li',
              { class: 'rv-board__card' },
              h(
                'a',
                {
                  class: 'rv-board__link',
                  // Its own page (Prodaja → Prilike), with the customer or the lead.
                  href: `/sales/opportunities/${encodeURIComponent(o.id)}`,
                },
                h('strong', {}, o.title),
                h(
                  'span',
                  { class: 'rv-board__customer' },
                  o.customerName || (o.leadName ? `Lead · ${o.leadName}` : ''),
                ),
                h(
                  'span',
                  { class: 'rv-board__meta' },
                  [
                    formatMoney(o.value, o.currency),
                    o.expectedCloseDate ? formatDay(o.expectedCloseDate) : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              nextActionLine(
                o,
                withParams('/sales/tasks/new', {
                  opportunityId: o.id,
                  leadId: o.companyId ? null : o.leadId,
                  type: 'follow_up',
                  returnTo: '/opportunity-pipeline',
                }),
              ),
            ),
          ),
        )
      : demo > 0
        ? null
        : h('p', { class: 'rv-muted rv-pipeline-empty' }, 'Nema prilika u ovoj fazi.'),
    demo > 0 ? h('p', { class: 'rv-board__demo' }, `+ ${demo} demo prilika s početne`) : null,
  ];
}

let ticket = 0;
async function load() {
  const mine = ++ticket;
  const period = getDashboardPeriod();
  const info = describePeriod(period);
  const range = { from: period.startDate, to: period.endDate };
  selector.render();
  // Until the period's records arrive, the previous ones are dimmed and out of reach.
  body.setAttribute('aria-busy', 'true');
  body.classList.add('is-loading');
  let opportunities;
  let totals;
  try {
    [opportunities, totals] = await Promise.all([
      api.listOpportunities({ status: 'active', ...range }),
      api.pipeline(range),
    ]);
  } catch (error) {
    if (mine !== ticket) return;
    body.removeAttribute('aria-busy');
    body.classList.remove('is-loading');
    body.replaceChildren(
      h(
        'p',
        { class: 'rv-card rv-empty' },
        error instanceof ApiError ? error.message : 'Prilike se nisu učitale. Pokušajte ponovno.',
      ),
    );
    return;
  }
  if (mine !== ticket) return; // a newer period was chosen meanwhile
  body.removeAttribute('aria-busy');
  body.classList.remove('is-loading');

  const total = totals.reduce((s, t) => s + t.total, 0);
  const missing = opportunities.filter((o) => o.needsNextAction).length;
  summary.textContent = openCount(total) + (missing ? ` · ${missing} bez sljedeće akcije` : '');
  // Opportunities are filtered by creation date; their stage history is not recorded.
  caption.textContent = info.isCurrent
    ? `Prilike kreirane u razdoblju ${info.range}`
    : `Prilike kreirane u razdoblju ${info.range} Prikazana je današnja faza; faza na kraju perioda se ne bilježi.`;

  if (total === 0) {
    body.replaceChildren(
      h('p', { class: 'rv-card rv-empty' }, 'Nema evidentiranih prilika za odabrani period.'),
    );
    return;
  }
  body.replaceChildren(
    h(
      'div',
      { class: 'rv-accordion-list' },
      totals.map((stage) =>
        accordionSection({
          id: sectionId(stage.value),
          title: stage.label,
          iconName: STAGE_ICON[stage.value] ?? 'target',
          count: stage.total,
          open: openSections,
          children: stageContent(
            opportunities.filter((o) => o.stage === stage.value),
            stage.total - stage.created,
          ),
        }),
      ),
    ),
  );
}

onDashboardPeriodChange(() => load());
onDataChanged(load);
await load();
if (window.location.hash && openSections.size) {
  document.getElementById(openSections.first())?.scrollIntoView();
}
consumeFlash();
