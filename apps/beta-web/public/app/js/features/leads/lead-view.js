// Lead badges and one-line summaries, shared by the Leads list and Lead detail.
// Stage (Novi lead → Kontaktiran → Kvalificiran) and status (Aktivan / Won /
// Lost) are separate: a lead keeps its stage after it is won or lost.
import { labelOf, LEAD_SOURCES, LEAD_STAGES } from '../../core/constants.js';
import { dayKey, formatDay, formatMoney } from '../../core/format.js';
import { h } from '../../ui/dom.js';

/** Leads list filters (Svi / Aktivni / Won / Lost) → ?status= on the API. */
export const LEAD_FILTERS = [
  { value: '', label: 'Svi' },
  { value: 'active', label: 'Aktivni' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_BADGE = {
  active: ['neutral', 'Aktivan'],
  won: ['green', 'Won'],
  lost: ['red', 'Lost'],
};

export function leadStatusBadge(lead) {
  const [tone, label] = STATUS_BADGE[lead.status] ?? STATUS_BADGE.active;
  return h('span', { class: `rv-badge rv-badge--${tone}` }, label);
}

export function leadStageBadge(lead) {
  return h('span', { class: 'rv-badge rv-badge--neutral' }, labelOf(LEAD_STAGES, lead.stage));
}

/** "12.500 €" or null. */
export const leadValue = (lead) =>
  lead.estimatedValue === null || lead.estimatedValue === undefined
    ? null
    : formatMoney(lead.estimatedValue, lead.currency ?? 'EUR');

export const leadSource = (lead) => (lead.source ? labelOf(LEAD_SOURCES, lead.source) : null);

/** "Danas" / "5. listopada 2026." for an instant. */
export const leadDay = (iso) => (iso ? formatDay(dayKey(new Date(iso))) : null);
