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

/** ?offer={id} (from Feedback overview): the offer row to mark and show. */
const focusOffer = new URLSearchParams(window.location.search).get('offer');
function markOffer() {
  if (!focusOffer) return null;
  const row = [...document.querySelectorAll('.rv-offer[data-offer-id]')].find(
    (el) => el.dataset.offerId === focusOffer,
  );
  row?.classList.add('is-focused');
  return row ?? null;
}

onDataChanged(async () => {
  await load();
  markOffer();
});
await load();
const offerRow = markOffer();
if (offerRow) offerRow.scrollIntoView({ block: 'center' });
else if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
consumeFlash();
