// /opportunities · Opportunity Pipeline (same totals as the dashboard card) with
// next actions. Each stage is an accordion (the Customer Detail principle):
// closed on a new visit, as it was when coming Back, several open at once.
import { api, onDataChanged } from '../core/api.js';
import { formatDay, formatMoney } from '../core/format.js';
import { nextActionLine } from '../features/customers/profile/customer-opportunities.js';
import { accordionSection, openSectionsState } from '../ui/accordion.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash } from '../ui/toast.js';

renderShell('opportunities');
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
      { class: 'rv-accordion-list' },
      totals.map((stage) => {
        const items = opportunities.filter((o) => o.stage === stage.value);
        const demo = stage.total - stage.created;
        return accordionSection({
          id: sectionId(stage.value),
          title: stage.label,
          iconName: STAGE_ICON[stage.value] ?? 'target',
          count: stage.total,
          open: openSections,
          children: [
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
                )
              : demo > 0
                ? null
                : h('p', { class: 'rv-muted rv-pipeline-empty' }, 'Nema prilika u ovoj fazi.'),
            demo > 0
              ? h('p', { class: 'rv-board__demo' }, `+ ${demo} demo prilika s početne`)
              : null,
          ],
        });
      }),
    ),
  );
}

onDataChanged(load);
await load();
if (window.location.hash && openSections.size) {
  document.getElementById(openSections.first())?.scrollIntoView();
}
consumeFlash();
