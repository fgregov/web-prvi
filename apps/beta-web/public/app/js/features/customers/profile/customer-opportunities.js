// Prilike: every opportunity linked to the customer.
import { labelOf, STAGES } from '../../../core/constants.js';
import { formatDay, formatMoney } from '../../../core/format.js';
import { h } from '../../../ui/dom.js';
import { emptyState, profileSection } from './section.js';

export function customerOpportunities(profile, onCreate) {
  const total = profile.opportunities.reduce((sum, o) => sum + (o.value ?? 0), 0);
  return profileSection({
    id: 'prilike',
    title: 'Prilike',
    iconName: 'target',
    count: profile.opportunities.length,
    action: { label: 'Kreiraj priliku', onClick: onCreate },
    children: profile.opportunities.length
      ? [
          h(
            'p',
            { class: 'rv-section__summary' },
            `Ukupna procijenjena vrijednost: ${formatMoney(total)}`,
          ),
          h(
            'ul',
            { class: 'rv-opps', role: 'list' },
            profile.opportunities.map((o) =>
              h(
                'li',
                { class: 'rv-opp' },
                h(
                  'div',
                  { class: 'rv-opp__top' },
                  h('strong', { class: 'rv-opp__title' }, o.title),
                  h('span', { class: 'rv-opp__value' }, formatMoney(o.value)),
                ),
                h(
                  'div',
                  { class: 'rv-opp__meta' },
                  h('span', { class: 'rv-badge rv-badge--red' }, labelOf(STAGES, o.stage)),
                  o.probability !== null ? h('span', {}, `Vjerojatnost ${o.probability} %`) : null,
                  o.expectedCloseDate
                    ? h('span', {}, `Zatvaranje: ${formatDay(o.expectedCloseDate)}`)
                    : null,
                  o.ownerName ? h('span', {}, o.ownerName) : null,
                ),
                o.notes ? h('p', { class: 'rv-opp__notes' }, o.notes) : null,
              ),
            ),
          ),
        ]
      : emptyState('Još nema prilika za ovog kupca.', {
          label: 'Kreiraj priliku',
          onClick: onCreate,
        }),
  });
}
