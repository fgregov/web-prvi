// Card sections of the customer profile: PREGLED, PRILIKE, AKTIVNOSTI, ZADACI
// and KONTAKTI are accordions, closed until the user opens them. Creating
// records stays in the customer's header actions, so the sections themselves
// carry no create buttons.
import { h } from '../../../ui/dom.js';

export { accordionSection } from '../../../ui/accordion.js';

/** What an opened section shows when it has no records (no create button). */
export function emptyState(text) {
  return h('div', { class: 'rv-empty' }, h('p', {}, text));
}
