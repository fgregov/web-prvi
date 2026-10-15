// /sales/opportunities/{id} · One opportunity on its own page: the same card
// and actions as on its customer or lead (customer-opportunities.js,
// opportunity-actions.js), with the way to the customer or the lead it
// belongs to. Nothing here changes how an opportunity is saved.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { opportunityCard } from '../features/customers/profile/customer-opportunities.js';
import { opportunityActions } from '../features/customers/profile/opportunity-actions.js';
import { linkToLeadCustomer } from '../features/leads/won-conversion.js';
import { mountAppShell } from '../ui/app-shell.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack, here, withParams } from '../ui/navigation.js';
import { consumeFlash, showToast } from '../ui/toast.js';

mountAppShell();
const opportunityId = decodeURIComponent(window.location.pathname.split('/')[3] ?? '');
const root = document.getElementById('app');
const enc = encodeURIComponent;

const back = h(
  'button',
  {
    type: 'button',
    class: 'rv-backlink',
    onClick: () => goBack('/sales/opportunities'),
  },
  icon('arrow-left'),
  'Prilike',
);
root.replaceChildren(back, h('p', { class: 'rv-card rv-empty' }, 'Učitavanje…'));

const actions = {
  nextActionFor: (id, o) =>
    withParams('/sales/tasks/new', {
      opportunityId: id,
      leadId: o?.companyId ? null : o?.leadId,
      type: 'follow_up',
      returnTo: here(),
    }),
  deal: opportunityActions(
    async (message) => {
      showToast(message);
      await load();
    },
    { returnTo: here() },
  ),
  linkCustomer: async (o) => {
    if (await linkToLeadCustomer(o)) {
      showToast(`Prilika je povezana s kupcem ${o.leadCustomerName}.`);
      await load();
    }
  },
};

/** Kupac (or the lead, before it is a customer) with a link to its page. */
function belongsTo(o) {
  if (o.companyId) {
    return h(
      'a',
      { class: 'rv-btn rv-btn--secondary', href: `/sales/customers/${enc(o.companyId)}#prilike` },
      icon('building'),
      `Kupac: ${o.customerName}`,
    );
  }
  if (o.leadId) {
    return h(
      'a',
      { class: 'rv-btn rv-btn--secondary', href: `/sales/leads/${enc(o.leadId)}#prilike` },
      icon('user-search'),
      `Lead: ${o.leadName ?? ''}`,
    );
  }
  return null;
}

async function load() {
  let o;
  try {
    o = await api.getOpportunity(opportunityId);
  } catch (error) {
    document.title = 'Renvara · Prilika nije pronađena';
    root.replaceChildren(
      back,
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page', role: 'alert' },
        h('h1', {}, 'Prilika nije pronađena'),
        h('p', {}, error instanceof ApiError ? error.message : 'Pokušajte ponovno.'),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/sales/opportunities' }, 'Sve prilike'),
      ),
    );
    return;
  }
  document.title = `Renvara · ${o.title}`;
  const card = {
    ...actions,
    nextActionFor: (id) => actions.nextActionFor(id, o),
  };
  root.replaceChildren(
    back,
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, o.title),
        h('p', { class: 'rv-muted' }, o.customerName || (o.leadName ? `Lead · ${o.leadName}` : '')),
      ),
      h('div', { class: 'rv-page-head__actions' }, belongsTo(o)),
    ),
    h(
      'ul',
      { class: 'rv-opps rv-opp-page', role: 'list' },
      opportunityCard(o, card, { lead: Boolean(o.companyId), customer: !o.companyId }),
    ),
  );
}

onDataChanged(load);
await load();
consumeFlash();
