// /customers/{id} · Customer Detail View
import { api, ApiError, onDataChanged } from '../core/api.js';
import { customerActions, customerProfile } from '../features/customers/customer-profile.js';
import { h } from '../ui/dom.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash } from '../ui/toast.js';

const customerId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const root = document.getElementById('app');

renderShell('customers');

async function load() {
  let profile;
  try {
    profile = await api.getCustomer(customerId);
  } catch (error) {
    document.title = 'Renvara · Kupac nije pronađen';
    root.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page' },
        h('h1', {}, 'Kupac nije pronađen'),
        h('p', {}, error instanceof ApiError ? error.message : 'Pokušajte ponovno.'),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/customers' }, 'Svi kupci'),
      ),
    );
    return;
  }
  document.title = `Renvara · ${profile.companyName}`;
  const scroll = window.scrollY;
  root.replaceChildren(customerProfile(profile, customerActions(profile, load)));
  window.scrollTo({ top: scroll });
}

onDataChanged(load);
await load();
if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
consumeFlash();
