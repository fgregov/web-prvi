// FEEDBACK OVERVIEW (Home): sent offers still waiting for the customer, most
// urgent first, with the wait as a day badge: 1–4D yellow, 5–9D red, 10D+ black.
// A row opens the offer's opportunity (on its customer's profile).
import { h } from '../../ui/dom.js';
import { spriteIcon } from './sprite.js';

const BAND_LABEL = { yellow: 'čeka', red: 'potreban follow-up', black: 'hitan follow-up' };

function row(item) {
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: 'waiting waiting--offer',
        href: `/customers/${encodeURIComponent(item.companyId)}#prilike`,
        'aria-label': `${item.customerName}, ${item.title}: ${item.waitingDays} dana, ${BAND_LABEL[item.band]}`,
        dataset: { offerId: item.offerId, band: item.band },
      },
      h('span', { class: 'waiting__icon' }, spriteIcon('building')),
      h(
        'span',
        { class: 'waiting__text' },
        h('span', { class: 'waiting__name' }, item.customerName),
        h('span', { class: 'waiting__sub' }, item.title),
      ),
      h(
        'span',
        { class: `rv-wait rv-wait--${item.band}`, 'aria-hidden': 'true' },
        `${item.waitingDays}D`,
      ),
      spriteIcon('chevron-right', 'icon chevron'),
    ),
  );
}

/** Fills the widget's list: up to `limit` rows, then how many more are waiting. */
export function renderFeedbackOverview(list, items, { limit = 5 } = {}) {
  if (!items.length) {
    list.replaceChildren(
      h('li', { class: 'empty-row' }, 'Nema poslanih ponuda koje čekaju odgovor.'),
    );
    return;
  }
  const more = items.length - limit;
  const rows = items.slice(0, limit).map(row);
  if (more > 0) {
    rows.push(h('li', { class: 'empty-row waiting__more' }, `+ još ${more} ponuda čeka odgovor`));
  }
  list.replaceChildren(...rows);
}
