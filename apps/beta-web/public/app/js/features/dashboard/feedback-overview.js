// FEEDBACK OVERVIEW (Home): sent offers still waiting for the customer, most
// urgent first, with the wait as a day badge: 1–4D yellow, 5–9D red, 10D+ black.
// A row opens the offer (Follow-up Engine, when it has a PDF) or its opportunity; "Svi" opens
// every offer of the period (/feedback-overview).
import { h } from '../../ui/dom.js';
import { spriteIcon } from './sprite.js';

const BAND_LABEL = { yellow: 'čeka', red: 'potreban follow-up', black: 'hitan follow-up' };

/**
 * Where an offer opens: its page in the Follow-up Engine when it has a PDF
 * (link, views, history); otherwise its opportunity on the customer's profile,
 * with the offer marked.
 */
export function offerHref(item) {
  if (item.hasDocument) return `/follow-up/${encodeURIComponent(item.offerId)}`;
  // An offer within a lead's deal before the lead is a customer (ADR-0009): on the lead.
  if (!item.companyId && item.leadId) return `/leads/${encodeURIComponent(item.leadId)}#prilike`;
  return `/customers/${encodeURIComponent(item.companyId)}?offer=${encodeURIComponent(item.offerId)}#prilike`;
}

/** Who the offer is for: the customer, else the lead of its deal ("Lead · Hotel Lavanda"). */
export const offerParty = (item) =>
  item.customerName || (item.leadName ? `Lead · ${item.leadName}` : 'Kupac nije dostupan');

function row(item) {
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: 'waiting waiting--offer',
        href: offerHref(item),
        'aria-label': `${offerParty(item)}, ${item.title}: ${item.waitingDays} dana, ${BAND_LABEL[item.band]}`,
        dataset: { offerId: item.offerId, band: item.band },
      },
      h('span', { class: 'waiting__icon' }, spriteIcon('building')),
      h(
        'span',
        { class: 'waiting__text' },
        h('span', { class: 'waiting__name' }, offerParty(item)),
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
