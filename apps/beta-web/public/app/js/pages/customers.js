// /customers · customer list: Aktivni | Neaktivni | Svi (default Aktivni) and
// search by name or OIB within that filter. The filter is kept in the URL
// (?status=), so Back from a customer returns to the same list.
import { api, onDataChanged } from '../core/api.js';
import { CUSTOMER_STATUSES, labelOf } from '../core/constants.js';
import { DEMO_CONTENT } from '../core/edition.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash, showToast } from '../ui/toast.js';

renderShell('customers');
const root = document.getElementById('app');
let confirmReset = false;
let query = '';

const FILTERS = [
  { value: 'active', label: 'Aktivni' },
  { value: 'inactive', label: 'Neaktivni' },
  { value: 'all', label: 'Svi' },
];
const requested = new URLSearchParams(window.location.search).get('status');
let status = FILTERS.some((f) => f.value === requested) ? requested : 'active';

const newCustomerLink = () =>
  h(
    'a',
    { class: 'rv-btn rv-btn--primary', href: '/customers/new?returnTo=/customers' },
    icon('plus'),
    'Novi kupac',
  );

const search = h('input', {
  class: 'rv-input rv-search',
  type: 'search',
  placeholder: 'Pretraži po nazivu ili OIB-u',
  'aria-label': 'Pretraži kupce',
  autocomplete: 'off',
});
let timer;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    query = search.value.trim();
    load();
  }, 180);
});

const filters = h(
  'div',
  { class: 'rv-segmented rv-customer-filter', role: 'radiogroup', 'aria-label': 'Prikaži kupce' },
  FILTERS.map((option) =>
    h(
      'label',
      { class: 'rv-segmented__option' },
      h('input', {
        type: 'radio',
        name: 'customer-status',
        value: option.value,
        checked: option.value === status,
        onChange: () => {
          status = option.value;
          window.history.replaceState(
            null,
            '',
            withParams('/customers', { status: status === 'active' ? '' : status }),
          );
          load();
        },
      }),
      h('span', {}, option.label),
    ),
  ),
);

const list = h('div');
const count = h('p', { class: 'rv-muted' });
const resetButton = h('button', { type: 'button', class: 'rv-btn rv-btn--sm rv-btn--ghost' });
function renderReset() {
  resetButton.className = `rv-btn rv-btn--sm ${confirmReset ? 'rv-btn--primary' : 'rv-btn--ghost'}`;
  resetButton.textContent = confirmReset ? 'Potvrdi: vrati demo podatke' : 'Vrati demo podatke';
}
resetButton.addEventListener('click', async () => {
  if (!confirmReset) {
    confirmReset = true;
    return renderReset();
  }
  confirmReset = false;
  renderReset();
  await api.resetDemo();
  showToast('Demo podaci su vraćeni na početno stanje.');
  load();
});
renderReset();

root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h('div', {}, h('h1', { class: 'rv-page-title' }, 'Kupci'), count),
    // Clean start: there is no demo data to restore.
    h(
      'div',
      { class: 'rv-page-head__actions' },
      DEMO_CONTENT ? resetButton : null,
      newCustomerLink(),
    ),
  ),
  filters,
  search,
  list,
);

const EMPTY = {
  active: 'Nema aktivnih kupaca.',
  inactive: 'Nema neaktivnih kupaca.',
  all: 'Još nema kupaca.',
};
const SEARCH_EMPTY = {
  active: 'Nema aktivnih kupaca za ovu pretragu.',
  inactive: 'Nema neaktivnih kupaca za ovu pretragu.',
  all: 'Nema kupaca za ovu pretragu.',
};
const COUNT = {
  active: (n) => `Aktivni: ${n}`,
  inactive: (n) => `Neaktivni: ${n}`,
  all: (n) => `${n} u CRM-u`,
};

let ticket = 0;
async function load() {
  const mine = ++ticket;
  const customers = await api.searchCustomers(query, status);
  if (mine !== ticket) return; // a newer filter or search is already loading
  count.textContent = query ? `${customers.length} rezultata` : COUNT[status](customers.length);
  list.replaceChildren(
    customers.length
      ? h(
          'ul',
          { class: 'rv-card rv-list', role: 'list' },
          customers.map((c) =>
            h(
              'li',
              {},
              h(
                'a',
                { class: 'rv-list__row', href: `/customers/${encodeURIComponent(c.id)}` },
                h('span', { class: 'rv-list__icon' }, icon('building')),
                h(
                  'span',
                  { class: 'rv-list__main' },
                  h('strong', {}, c.companyName),
                  h(
                    'span',
                    {},
                    [c.city, `OIB ${c.oib}`, c.primaryContactName].filter(Boolean).join(' · '),
                  ),
                ),
                h(
                  'span',
                  { class: `rv-badge rv-badge--${c.status === 'active' ? 'green' : 'neutral'}` },
                  labelOf(CUSTOMER_STATUSES, c.status),
                ),
                icon('chevron-right', 'rv-icon rv-list__chevron'),
              ),
            ),
          ),
        )
      : h(
          'div',
          { class: 'rv-card rv-empty rv-empty--page' },
          h('p', {}, query ? SEARCH_EMPTY[status] : EMPTY[status]),
          query || status === 'inactive' ? null : newCustomerLink(),
        ),
  );
}

onDataChanged(load);
await load();
consumeFlash();
