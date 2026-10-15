// /sales/opportunities · Prilike (Prodaja → Prilike): every opportunity of the
// organization, newest first, Aktivne | Dobivene | Izgubljene | Sve (default
// Aktivne), searchable by title, customer or lead. Filter and search are kept
// in the URL (?status=&q=), so Back from an opportunity returns to the same list.
// The pipeline by stage is its own page (/opportunity-pipeline).
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, OPPORTUNITY_STATUSES, STAGES } from '../core/constants.js';
import { formatDay, formatMoney } from '../core/format.js';
import { mountAppShell } from '../ui/app-shell.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { here, withParams } from '../ui/navigation.js';
import { consumeFlash } from '../ui/toast.js';

mountAppShell();
const root = document.getElementById('app');

const FILTERS = [
  { value: 'active', label: 'Aktivne' },
  { value: 'won', label: 'Dobivene' },
  { value: 'lost', label: 'Izgubljene' },
  { value: 'all', label: 'Sve' },
];
const params = new URLSearchParams(window.location.search);
let status = FILTERS.some((f) => f.value === params.get('status'))
  ? params.get('status')
  : 'active';
let query = (params.get('q') ?? '').slice(0, 100);

const EMPTY = {
  active: 'Nema aktivnih prilika.',
  won: 'Nema dobivenih prilika.',
  lost: 'Nema izgubljenih prilika.',
  all: 'Još nema prilika.',
};
const COUNT = {
  active: (n) => `Aktivne: ${n}`,
  won: (n) => `Dobivene: ${n}`,
  lost: (n) => `Izgubljene: ${n}`,
  all: (n) => `${n} u CRM-u`,
};

/** This list's address with its filter and search (default filter left out). */
const listUrl = () =>
  withParams('/sales/opportunities', { status: status === 'active' ? '' : status, q: query });
const keepInUrl = () => window.history.replaceState(window.history.state, '', listUrl());

const newLink = () =>
  h(
    'a',
    {
      class: 'rv-btn rv-btn--primary',
      href: withParams('/sales/opportunities/new', { returnTo: here() }),
    },
    icon('plus'),
    'Nova prilika',
  );

const search = h('input', {
  class: 'rv-input rv-search',
  type: 'search',
  placeholder: 'Pretraži po nazivu, kupcu ili leadu',
  'aria-label': 'Pretraži prilike',
  autocomplete: 'off',
  maxlength: '100',
  value: query,
});
let timer;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    query = search.value.trim();
    keepInUrl();
    render();
  }, 180);
});

const filters = h(
  'div',
  { class: 'rv-segmented rv-customer-filter', role: 'radiogroup', 'aria-label': 'Prikaži prilike' },
  FILTERS.map((option) =>
    h(
      'label',
      { class: 'rv-segmented__option' },
      h('input', {
        type: 'radio',
        name: 'opportunity-status',
        value: option.value,
        checked: option.value === status,
        onChange: () => {
          status = option.value;
          keepInUrl();
          load();
        },
      }),
      h('span', {}, option.label),
    ),
  ),
);

const count = h('p', { class: 'rv-muted' }, ' ');
const list = h(
  'div',
  { 'aria-live': 'polite' },
  h('p', { class: 'rv-card rv-empty' }, 'Učitavanje…'),
);
root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h('div', {}, h('h1', { class: 'rv-page-title' }, 'Prilike'), count),
    h(
      'div',
      { class: 'rv-page-head__actions' },
      h(
        'a',
        { class: 'rv-btn rv-btn--secondary', href: '/opportunity-pipeline' },
        icon('bars'),
        'Pipeline po fazama',
      ),
      newLink(),
    ),
  ),
  filters,
  search,
  list,
);

const fold = (text) => (text ?? '').toLocaleLowerCase('hr').normalize('NFD').replace(/[̀-ͯ]/g, '');
const owner = (o) => o.customerName || (o.leadName ? `Lead · ${o.leadName}` : '');

function row(o) {
  const amount = formatMoney(o.status === 'won' ? (o.wonValue ?? o.value) : o.value, o.currency);
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: 'rv-list__row',
        href: `/sales/opportunities/${encodeURIComponent(o.id)}`,
        dataset: { opportunityId: o.id },
      },
      h('span', { class: 'rv-list__icon' }, icon('target')),
      h(
        'span',
        { class: 'rv-list__main' },
        h('strong', {}, o.title),
        h('span', {}, [owner(o), labelOf(STAGES, o.stage), amount].filter(Boolean).join(' · ')),
        o.needsNextAction
          ? h(
              'span',
              { class: 'rv-list__warn' },
              icon('alert', 'rv-icon rv-icon--sm'),
              'Bez sljedeće akcije',
            )
          : null,
      ),
      h(
        'span',
        { class: 'rv-list__date' },
        o.expectedCloseDate ? `Zatvaranje: ${formatDay(o.expectedCloseDate)}` : '',
      ),
      h(
        'span',
        {
          class: `rv-badge rv-badge--${o.status === 'won' ? 'green' : o.status === 'lost' ? 'neutral' : 'red'}`,
        },
        labelOf(OPPORTUNITY_STATUSES, o.status),
      ),
      icon('chevron-right', 'rv-icon rv-list__chevron'),
    ),
  );
}

let opportunities = [];
function render() {
  const needle = fold(query);
  const shown = needle
    ? opportunities.filter((o) =>
        [o.title, o.customerName, o.leadName].some((text) => fold(text).includes(needle)),
      )
    : opportunities;
  count.textContent = query ? `${shown.length} rezultata` : COUNT[status](shown.length);
  list.replaceChildren(
    shown.length
      ? h('ul', { class: 'rv-card rv-list', role: 'list' }, shown.map(row))
      : h(
          'div',
          { class: 'rv-card rv-empty rv-empty--page' },
          h('p', {}, query ? 'Nema prilika za ovu pretragu.' : EMPTY[status]),
          query || status !== 'active' ? null : newLink(),
        ),
  );
}

let ticket = 0;
async function load() {
  const mine = ++ticket;
  list.setAttribute('aria-busy', 'true');
  try {
    const result = await api.listOpportunities({ status: status === 'all' ? '' : status });
    if (mine !== ticket) return; // a newer filter is already loading
    opportunities = result;
  } catch (error) {
    if (mine !== ticket) return;
    list.removeAttribute('aria-busy');
    count.textContent = ' ';
    list.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page', role: 'alert' },
        h(
          'p',
          {},
          error instanceof ApiError ? error.message : 'Prilike se nisu učitale. Pokušajte ponovno.',
        ),
        h(
          'button',
          { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: () => load() },
          'Pokušaj ponovno',
        ),
      ),
    );
    return;
  }
  list.removeAttribute('aria-busy');
  render();
}

onDataChanged(load);
await load();
consumeFlash();
