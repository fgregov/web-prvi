// /follow-up/new · "Attach new document": the offer PDF (uploaded at once,
// privately), what it is called and whose it is. "Spremi i generiraj link"
// creates the offer (a draft until marked as sent), its document and a secret
// link in one step, then opens the offer with the link ready to copy.
// Nothing is e-mailed: the salesperson sends the link themselves.
// "Povezano s" Kupac | Lead: an offer within a lead's deal needs no customer
// (ADR-0009); it gets the customer when the lead is converted.
import { api, ApiError } from '../core/api.js';
import { hasErrors, MESSAGES, validateFollowUpOffer } from '../core/validation.js';
import { DocumentPicker } from '../features/follow-up/document-picker.js';
import { contextCustomer } from '../features/pickers/context.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { LeadPicker } from '../features/pickers/lead-picker.js';
import { ContactPicker, OpportunityPicker } from '../features/pickers/related-picker.js';
import { h } from '../ui/dom.js';
import { CustomField, FormField, SegmentedField, TextAreaField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { createFormScreen } from '../ui/screen.js';

const params = new URLSearchParams(window.location.search);
const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Nova ponuda',
  submitLabel: 'Spremi i generiraj link',
  fallback: '/follow-up',
  discardMessage: 'Odabrani dokument i uneseni podaci neće biti spremljeni.',
  onSubmit: save,
});
screen.setContent(h('p', { class: 'rv-screen__loading' }, 'Učitavanje...'));

/** "Ponuda_FERO-TERM_vending.pdf" → "Ponuda FERO-TERM vending" */
const titleFromFile = (name) =>
  String(name ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

// The title follows the picked file until the user writes their own.
let autoTitle = '';
const picker = DocumentPicker({
  onPicked: (file) => {
    const current = form.values().title.trim();
    if (current && current !== autoTitle) return;
    autoTitle = titleFromFile(file.name);
    form.setValue('title', autoTitle);
  },
  onError: (message) => form.setErrors({ document: message }),
});
const customer = CustomerPicker({ clearable: false });
const lead = LeadPicker();
const opportunity = OpportunityPicker({ noCustomerLabel: 'Najprije odaberite kupca ili lead' });
const contact = ContactPicker();
const form = createForm(
  [
    {
      fields: [
        CustomField('document', 'Dokument', picker, {
          required: true,
          hint: 'Ponuda iz ERP-a ili Worda, spremljena kao PDF. Pohranjuje se privatno; kupac je vidi samo putem poveznice.',
        }),
        FormField('title', 'Naziv ponude', {
          required: true,
          maxlength: 300,
          placeholder: 'npr. Vending — poslovna ponuda',
        }),
        SegmentedField('linkTo', 'Povezano s', {
          options: [
            { value: 'customer', label: 'Kupac' },
            { value: 'lead', label: 'Lead' },
          ],
          value: 'customer',
          onChange: showLink,
        }),
        CustomField('companyId', 'Kupac', customer, {
          required: true,
          onChange: (id) => {
            opportunity.setCustomer(id);
            contact.setCustomer(id);
          },
        }),
        CustomField('leadId', 'Lead', lead, {
          required: true,
          hidden: true,
          onChange: (id) => opportunity.setLead(id),
        }),
        CustomField('opportunityId', 'Prilika', opportunity, {
          hint: 'Kupac: neobavezno. Lead: obavezno — ponuda pripada prilici leada.',
        }),
        CustomField('contactId', 'Kontakt', contact, { hint: 'Neobavezno.' }),
        TextAreaField('note', 'Bilješka', {
          rows: 3,
          maxlength: 5000,
          hint: 'Interna bilješka. Kupac je nikada ne vidi.',
        }),
      ],
    },
  ],
  {
    single: true,
    notice:
      'Renvara ne šalje e-poštu. Nakon spremanja kopirajte poveznicu i pošaljite je kupcu svojim e-mailom.',
  },
);

/** Kupac: customer, its deals and contacts · Lead: the lead and its deals (no customer). */
function showLink(mode) {
  const toLead = mode === 'lead';
  form.setVisible('companyId', !toLead);
  form.setVisible('contactId', !toLead);
  form.setVisible('leadId', toLead);
  if (toLead) opportunity.setLead(lead.read());
  else opportunity.setCustomer(customer.read());
}

try {
  // From an opportunity (?opportunityId=) or a customer (?companyId=): preselected.
  let companyId = params.get('companyId');
  let opportunityId = '';
  if (params.get('opportunityId')) {
    const deal = await api.getOpportunity(params.get('opportunityId'));
    companyId = deal.companyId;
    opportunityId = deal.id;
    if (!deal.companyId && deal.leadId) {
      // A lead's deal (Lead Detail → Priloži PDF ponude): the lead, no customer.
      lead.write(await api.getLead(deal.leadId));
      form.setValue('linkTo', 'lead');
      showLink('lead');
      await opportunity.setLead(deal.leadId, deal.id);
    }
  }
  const preset = await contextCustomer(companyId);
  if (preset) {
    customer.write(preset);
    await Promise.all([
      opportunity.setCustomer(preset.id, opportunityId),
      contact.setCustomer(preset.id, params.get('contactId') ?? ''),
    ]);
  }
} catch {
  screen.showError(MESSAGES.unavailable);
}
screen.setContent(form.element, () => form.values());

async function save() {
  if (picker.uploading()) {
    screen.setSaving(true);
    await picker.settled();
    screen.setSaving(false);
  }
  const values = form.values();
  const toLead = values.linkTo === 'lead';
  const input = {
    uploadId: values.document,
    title: values.title.trim(),
    linkTo: values.linkTo,
    companyId: toLead ? null : values.companyId,
    leadId: toLead ? values.leadId : null,
    opportunityId: values.opportunityId || null,
    contactId: toLead ? null : values.contactId || null,
    note: values.note,
  };
  const errors = validateFollowUpOffer(input);
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }
  screen.setSaving(true);
  let offer;
  try {
    offer = await api.createFollowUpOffer(input);
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) {
      const { link, ...fields } = error.errors;
      if (fields.document) picker.failed();
      form.setErrors(fields);
      if (link) screen.showError(MESSAGES.linkFailed);
      else if (error.message === MESSAGES.unavailable) screen.showError(error.message);
    } else {
      // Nothing was created: the offer, its file and its link are saved together or not at all.
      screen.showError(
        error instanceof ApiError && error.status === 0
          ? error.message
          : 'Ponudu nije moguće spremiti. Pokušajte ponovno.',
      );
    }
    return;
  }
  screen.allowLeave();
  // replace(): Back from the offer goes to the list, not to this (saved) form.
  window.location.replace(`/follow-up/${encodeURIComponent(offer.offerId)}?new=1`);
}
