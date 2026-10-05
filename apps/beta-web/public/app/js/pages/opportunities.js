// /opportunities · Opportunity Pipeline (same totals as the dashboard card)
import { crm } from '../core/crm.js';
import { formatDay, formatMoney } from '../core/format.js';
import { h } from '../ui/dom.js';
import { renderShell } from '../ui/shell.js';

renderShell('opportunities');
const root = document.getElementById('app');

function render() {
  const opportunities = crm.listOpportunities().filter((o) => o.status === 'open');
  const totals = crm.pipelineTotals();
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
          `${totals.reduce((s, t) => s + t.total, 0)} otvorenih prilika`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'rv-board' },
      totals.map((stage) => {
        const items = opportunities.filter((o) => o.stage === stage.value);
        const demo = stage.total - items.length;
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
              'a',
              {
                class: 'rv-card rv-board__card',
                href: `/customers/${encodeURIComponent(o.customerId)}`,
              },
              h('strong', {}, o.title),
              h('span', { class: 'rv-board__customer' }, o.customerName),
              h(
                'span',
                { class: 'rv-board__meta' },
                [
                  formatMoney(o.value),
                  o.probability !== null ? `${o.probability} %` : null,
                  o.expectedCloseDate ? formatDay(o.expectedCloseDate) : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ),
          ),
          demo > 0 ? h('p', { class: 'rv-board__demo' }, `+ ${demo} demo prilika s početne`) : null,
        );
      }),
    ),
  );
}

crm.subscribe(render);
render();
