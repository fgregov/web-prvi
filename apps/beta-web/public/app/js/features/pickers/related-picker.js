// ContactPicker / OpportunityPicker: selects that list the chosen customer's
// contacts or active opportunities — or, for the OpportunityPicker, a lead's
// active opportunities (ADR-0009). Disabled until a customer or lead is chosen.
import { api } from '../../core/api.js';
import { contactName } from '../../core/names.js';
import { h } from '../../ui/dom.js';

function RelatedPicker({ emptyLabel, noCustomerLabel, load, loadLead, label: toLabel }) {
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
    setCustomer(companyId, selectedId = pending) {
      return this.setScope(companyId ? () => load(companyId) : null, selectedId);
    },
    /** The same for a lead (OpportunityPicker: the lead's own deals). */
    setLead(leadId, selectedId = pending) {
      return this.setScope(leadId && loadLead ? () => loadLead(leadId) : null, selectedId);
    },
    async setScope(loader, selectedId = pending) {
      const mine = ++ticket;
      if (!loader) {
        fill([], '');
        select.options[0].textContent = noCustomerLabel;
        select.disabled = true;
        return;
      }
      select.disabled = true;
      const options = await loader().catch(() => []);
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

export const OpportunityPicker = ({ emptyLabel = 'Bez prilike', noCustomerLabel } = {}) =>
  RelatedPicker({
    emptyLabel,
    noCustomerLabel: noCustomerLabel ?? 'Najprije odaberite kupca',
    load: (companyId) => api.listOpportunities({ companyId, status: 'active' }),
    loadLead: (leadId) => api.listOpportunities({ leadId, status: 'active' }),
    label: (o) => o.title,
  });
