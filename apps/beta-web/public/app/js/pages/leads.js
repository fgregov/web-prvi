// /leads · Leads (bottom navigation). Every lead of the organization, newest
// first, filtered Svi / Aktivni / Won / Lost. Won and lost leads stay here as
// history; nothing is ever deleted.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, LEAD_STAGES } from '../core/constants.js';
import { initials } from '../core/format.js';
import { MESSAGES } from '../core/validation.js';
import { LEAD_FILTERS, leadDay, leadStatusBadge, leadValue } from '../features/leads/lead-view.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { renderTabbar } from '../ui/tabbar.js';
import { consumeFlash } from '../ui/toast.js';

renderTabbar(document.getElementById('tabbar'), 'leads');
const root = document.getElementById('leads');

const EMPTY = {
  '': 'Još nema leadova. Dodajte prvi preko „Novi lead”.',
  active: 'Nema aktivnih leadova.',
  won: 'Još nijedan lead nije pretvoren u kupca.',
  lost: 'Nema izgubljenih leadova.',
};

const params = new URLSearchParams(window.location.search);
let filter = LEAD_FILTERS.some((f) => f.value === params.get('status')) ? params.get('status') : '';
let leads = [];

function setFilter(value) {
  filter = value;
  // Keep the filter in the URL, so Back from a lead returns to the same list.
  window.history.replaceState(null, '', withParams('/leads', { status: filter }));
  render();
}

function row(lead) {
  const value = leadValue(lead);
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: 'lead-row',
        href: withParams(`/leads/${encodeURIComponent(lead.id)}`, {
          returnTo: withParams('/leads', { status: filter }),
        }),
        dataset: { status: lead.status },
      },
      h('span', { class: 'lead-row__avatar', 'aria-hidden': 'true' }, initials(lead.name)),
      h(
        'span',
        { class: 'lead-row__text' },
        h('span', { class: 'lead-row__name' }, lead.name),
        lead.companyName ? h('span', { class: 'lead-row__company' }, lead.companyName) : null,
        h(
          'span',
          { class: 'lead-row__meta' },
          [labelOf(LEAD_STAGES, lead.stage), leadDay(lead.createdAt), lead.ownerName]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
      h(
        'span',
        { class: 'lead-row__side' },
        leadStatusBadge(lead),
        value ? h('span', { class: 'lead-row__value' }, value) : null,
      ),
      icon('chevron-right', 'icon chevron'),
    ),
  );
}

function render() {
  const count = (value) => (value ? leads.filter((l) => l.status === value).length : leads.length);
  const shown = filter ? leads.filter((l) => l.status === filter) : leads;
  const name = 'lead-filter';
  root.replaceChildren(
    h(
      'section',
      { class: 'card module leads', 'aria-labelledby': 'leads-title' },
      h(
        'div',
        { class: 'module__head' },
        h('span', { class: 'module__icon' }, icon('users', 'icon')),
        h('h1', { class: 'module__title', id: 'leads-title' }, 'Leads'),
        h(
          'a',
          { class: 'module__link', href: '/leads/new?returnTo=/leads' },
          icon('plus', 'icon'),
          'Novi lead',
        ),
      ),
      h(
        'div',
        { class: 'leads__filters' },
        h(
          'div',
          { class: 'rv-segmented', role: 'radiogroup', 'aria-label': 'Prikaži leadove' },
          LEAD_FILTERS.map((option) =>
            h(
              'label',
              { class: 'rv-segmented__option' },
              h('input', {
                type: 'radio',
                name,
                value: option.value,
                checked: option.value === filter,
                onChange: () => setFilter(option.value),
              }),
              h(
                'span',
                {},
                option.label,
                h('small', { class: 'leads__count' }, String(count(option.value))),
              ),
            ),
          ),
        ),
      ),
      shown.length
        ? h('ul', { class: 'list leads__list', role: 'list' }, shown.map(row))
        : h('p', { class: 'leads__empty' }, EMPTY[filter]),
    ),
  );
}

async function load() {
  try {
    leads = await api.listLeads();
    render();
  } catch (error) {
    root.replaceChildren(
      h(
        'section',
        { class: 'card module leads' },
        h(
          'p',
          { class: 'leads__empty' },
          error instanceof ApiError ? error.message : MESSAGES.unavailable,
        ),
      ),
    );
  }
}

onDataChanged(load);
await load();
consumeFlash();
