// OPPORTUNITY PIPELINE (Home): four business indicators of the selected period.
// They are separate counts, not an additive funnel:
//   LEADS         leads created in the period
//   PROSPECTS     leads that became prospects in the period
//   NEGOTIATIONS  opportunities with a negotiation event in the period
//   BUYERS        customers with a won deal in the period's year, up to its end
// Every row opens Prilike: the Opportunity Pipeline, as from Više → Prilike.
import { h } from '../../ui/dom.js';

const PIPELINE_HREF = '/opportunities';

export function pipelineRows(overview) {
  return [
    { key: 'leads', label: 'Leads', count: overview.leads },
    { key: 'prospects', label: 'Prospects', count: overview.prospects },
    { key: 'negotiations', label: 'Negotiations', count: overview.negotiations },
    {
      key: 'buyers',
      label: `Buyers ${overview.buyersYear}`,
      count: overview.buyers,
      title: `Kupci s dobivenom prilikom u ${overview.buyersYear}. (do kraja perioda)`,
    },
  ];
}

/** Fills a `.pipeline` list with the four rows, each a link to the Opportunity Pipeline. */
export function renderPipelineOverview(list, overview) {
  list.classList.add('pipeline--overview');
  list.replaceChildren(
    ...pipelineRows(overview).map((row) =>
      h(
        'li',
        {},
        h(
          'a',
          {
            class: 'stage stage--metric',
            href: PIPELINE_HREF,
            title: row.title,
            dataset: { key: row.key },
          },
          h('span', { class: 'stage__label' }, row.label),
          h('span', { class: 'stage__count' }, String(row.count)),
        ),
      ),
    ),
  );
}
