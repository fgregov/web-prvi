// /opportunities · Opportunity Pipeline (same totals as the dashboard card) with next actions.
import { api, onDataChanged } from '../core/api.js';
import { formatDay, formatMoney } from '../core/format.js';
import { nextActionLine } from '../features/customers/profile/customer-opportunities.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash } from '../ui/toast.js';

renderShell('opportunities');
const root = document.getElementById('app');

async function load() {
  const [opportunities, totals] = await Promise.all([
    api.listOpportunities({ status: 'active' }),
    api.pipeline(),
  ]);
  const missing = opportunities.filter((o) => o.needsNextAction).length;
  root.replaceChildren(
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, 'Opportunity Pipeline'),
        h(
          'p',
          { class: 'rv-muted' },
          `${totals.reduce((s, t) => s + t.total, 0)} otvorenih prilika` +
            (missing ? ` · ${missing} bez sljedeće akcije` : ''),
        ),
      ),
      h(
        'a',
        { class: 'rv-btn rv-btn--primary', href: '/opportunities/new?returnTo=/opportunities' },
        icon('plus'),
        'Nova prilika',
      ),
    ),
    h(
      'div',
      { class: 'rv-board' },
      totals.map((stage) => {
        const items = opportunities.filter((o) => o.stage === stage.value);
        const demo = stage.total - stage.created;
        return h(
          'section',
          { class: 'rv-board__col', 'aria-label': stage.label },
          h(
            'header',
            { class: 'rv-board__head' },
            h('h2', {}, stage.label),
            h('span', { class: 'rv-board__count' }, String(stage.total)),
          ),
          items.map((o) =>
            h(
              'div',
              { class: 'rv-card rv-board__card' },
              h(
                'a',
                {
                  class: 'rv-board__link',
                  href: `/customers/${encodeURIComponent(o.companyId)}#prilike`,
                },
                h('strong', {}, o.title),
                h('span', { class: 'rv-board__customer' }, o.customerName),
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
                withParams('/tasks/new', {
                  opportunityId: o.id,
                  type: 'follow_up',
                  returnTo: '/opportunities',
                }),
              ),
            ),
          ),
          demo > 0 ? h('p', { class: 'rv-board__demo' }, `+ ${demo} demo prilika s početne`) : null,
        );
      }),
    ),
  );
}

onDataChanged(load);
await load();
consumeFlash();
