// /customers/{id} · Customer Detail View
import { crm } from '../core/crm.js';
import { customerActions, customerProfile } from '../features/customers/customer-profile.js';
import { h } from '../ui/dom.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash } from '../ui/toast.js';

const customerId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const root = document.getElementById('app');
const actions = customerActions(customerId);

renderShell('customers');

function render() {
  const profile = crm.getProfile(customerId);
  if (!profile) {
    document.title = 'Renvara · Kupac nije pronađen';
    root.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page' },
        h('h1', {}, 'Kupac nije pronađen'),
        h('p', {}, 'Ovaj kupac ne postoji u demo podacima ovog preglednika.'),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/customers' }, 'Svi kupci'),
      ),
    );
    return;
  }
  document.title = `Renvara · ${profile.companyName}`;
  root.replaceChildren(customerProfile(profile, actions));
}

crm.subscribe(render);
render();
consumeFlash();
