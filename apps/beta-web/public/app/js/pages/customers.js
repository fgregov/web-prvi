// /customers · customer list
import { CUSTOMER_STATUSES, labelOf } from '../core/constants.js';
import { crm } from '../core/crm.js';
import { formatDateTime } from '../core/format.js';
import { contactName } from '../core/store.js';
import { goToCustomer } from '../features/quick-create/quick-create.js';
import { openCustomerForm } from '../features/customers/customer-form.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash, showToast } from '../ui/toast.js';

renderShell('customers');
const root = document.getElementById('app');
let confirmReset = false;

const createCustomer = () =>
  openCustomerForm({ onSaved: (c) => goToCustomer(c.id, `${c.companyName} uspješno kreirana.`) });

function render() {
  const customers = crm.listCustomers();
  const resetButton = h(
    'button',
    {
      type: 'button',
      class: `rv-btn rv-btn--sm ${confirmReset ? 'rv-btn--primary' : 'rv-btn--ghost'}`,
      onClick: () => {
        if (!confirmReset) {
          confirmReset = true;
          render();
          return;
        }
        confirmReset = false;
        crm.reset();
        showToast('Demo podaci obrisani.');
      },
    },
    confirmReset ? 'Potvrdi brisanje svih demo podataka' : 'Obriši demo podatke',
  );

  root.replaceChildren(
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, 'Kupci'),
        h('p', { class: 'rv-muted' }, `${customers.length} u CRM-u`),
      ),
      h(
        'div',
        { class: 'rv-page-head__actions' },
        customers.length ? resetButton : null,
        h(
          'button',
          { type: 'button', class: 'rv-btn rv-btn--primary', onClick: createCustomer },
          icon('plus'),
          'Novi kupac',
        ),
      ),
    ),
    customers.length
      ? h(
          'ul',
          { class: 'rv-card rv-list', role: 'list' },
          customers.map((c) => {
            const profile = crm.getProfile(c.id);
            return h(
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
                    [
                      c.city,
                      `OIB ${c.oib}`,
                      profile.primaryContact ? contactName(profile.primaryContact) : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  ),
                ),
                h(
                  'span',
                  { class: `rv-badge rv-badge--${c.status === 'active' ? 'green' : 'neutral'}` },
                  labelOf(CUSTOMER_STATUSES, c.status),
                ),
                h('span', { class: 'rv-list__date' }, formatDateTime(c.createdAt)),
                icon('chevron-right', 'rv-icon rv-list__chevron'),
              ),
            );
          }),
        )
      : h(
          'div',
          { class: 'rv-card rv-empty rv-empty--page' },
          h('p', {}, 'Još nema kupaca.'),
          h(
            'button',
            { type: 'button', class: 'rv-btn rv-btn--primary', onClick: createCustomer },
            'Novi kupac',
          ),
        ),
  );
}

crm.subscribe(render);
render();
consumeFlash();
