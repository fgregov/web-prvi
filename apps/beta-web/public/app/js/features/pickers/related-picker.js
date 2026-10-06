// ContactPicker / OpportunityPicker: selects that list the chosen customer's
// contacts or active opportunities. Disabled until a customer is chosen.
import { api } from '../../core/api.js';
import { contactName } from '../../core/names.js';
import { h } from '../../ui/dom.js';

function RelatedPicker({ emptyLabel, noCustomerLabel, load, label: toLabel }) {
  const select = h('select', { class: 'rv-input', disabled: true });
  let pending = '';
  let ticket = 0;

  function fill(options, selectedId) {
    select.replaceChildren(
      h('option', { value: '' }, emptyLabel),
      ...options.map((o) =>
        h('option', { value: o.id, selected: o.id === selectedId }, toLabel(o)),
      ),
    );
  }
  fill([], '');
  select.options[0].textContent = noCustomerLabel;

  return {
    element: select,
    focusTarget: select,
    read: () => select.value,
    write(id) {
      pending = id ?? '';
      if ([...select.options].some((o) => o.value === pending)) select.value = pending;
    },
    /** (Re)loads the options for a customer; keeps `selectedId` when it belongs to it. */
    async setCustomer(companyId, selectedId = pending) {
      const mine = ++ticket;
      if (!companyId) {
        fill([], '');
        select.options[0].textContent = noCustomerLabel;
        select.disabled = true;
        return;
      }
      select.disabled = true;
      const options = await load(companyId).catch(() => []);
      if (mine !== ticket) return;
      fill(options, selectedId);
      select.disabled = false;
      pending = '';
    },
  };
}

export const ContactPicker = () =>
  RelatedPicker({
    emptyLabel: 'Bez kontakta',
    noCustomerLabel: 'Najprije odaberite kupca',
    load: (companyId) => api.listContacts(companyId),
    label: (c) => [contactName(c), c.role].filter(Boolean).join(' · '),
  });

export const OpportunityPicker = () =>
  RelatedPicker({
    emptyLabel: 'Bez prilike',
    noCustomerLabel: 'Najprije odaberite kupca',
    load: (companyId) => api.listOpportunities({ companyId, status: 'active' }),
    label: (o) => o.title,
  });
