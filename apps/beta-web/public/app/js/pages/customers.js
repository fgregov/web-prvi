// /customers · customer list with search (name or OIB)
import { api, onDataChanged } from '../core/api.js';
import { CUSTOMER_STATUSES, labelOf } from '../core/constants.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash, showToast } from '../ui/toast.js';

renderShell('customers');
const root = document.getElementById('app');
let confirmReset = false;
let query = '';

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
    h('div', { class: 'rv-page-head__actions' }, resetButton, newCustomerLink()),
  ),
  search,
  list,
);

async function load() {
  const customers = await api.searchCustomers(query);
  count.textContent = query ? `${customers.length} rezultata` : `${customers.length} u CRM-u`;
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
          h('p', {}, query ? 'Nema kupaca za ovu pretragu.' : 'Još nema kupaca.'),
          query ? null : newCustomerLink(),
        ),
  );
}

onDataChanged(load);
await load();
consumeFlash();
