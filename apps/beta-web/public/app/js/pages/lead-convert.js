// /leads/{id}/convert · Pretvori lead u kupca.
//
// Into a NEW customer or an EXISTING one, optionally with a contact person and a
// sales opportunity, in one atomic step on the server. Customers that look like
// this lead are shown first ("Mogući postojeći kupac"); creating a new one
// anyway needs a confirmation. The lead itself is kept and marked WON.
import { api, ApiError } from '../core/api.js';
import { STAGES } from '../core/constants.js';
import { hasErrors, MESSAGES, validateLeadConversion } from '../core/validation.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import { CustomField, FormField, SegmentedField, SelectField, SwitchField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const leadId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const params = new URLSearchParams(window.location.search);
const leadHref = `/leads/${encodeURIComponent(leadId)}`;

const MODES = [
  { value: 'CREATE_CUSTOMER', label: 'Kreiraj novog kupca' },
  { value: 'EXISTING_CUSTOMER', label: 'Poveži s postojećim' },
];
const CUSTOMER_FIELDS = ['companyName', 'oib', 'address', 'postalCode', 'city', 'email', 'phone'];
const CONTACT_FIELDS = ['fullName', 'role', 'email', 'phone'];
const OPPORTUNITY_FIELDS = ['title', 'value', 'stage'];
const REASON_LABELS = { oib: 'isti OIB', name: 'sličan naziv', email_domain: 'ista e-mail domena' };

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Pretvori u kupca',
  submitLabel: 'Pretvori u kupca',
  fallback: leadHref,
  discardMessage: 'Lead neće biti pretvoren u kupca.',
  onSubmit: () => save(),
});
screen.setContent(h('p', { class: 'rv-screen__loading' }, 'Učitavanje...'));

const existing = CustomerPicker({ clearable: false });
const summary = h('p', { class: 'rv-notice lead-convert__lead' });
const matchesBox = h('div', { class: 'lead-matches', role: 'status', hidden: true });
let matches = [];

const form = createForm(
  [
    {
      title: 'Kupac',
      fields: [
        SegmentedField('conversionMode', 'Kupac', {
          options: MODES,
          value: 'CREATE_CUSTOMER',
          onChange: showMode,
        }),
        FormField('customer.companyName', 'Naziv kupca', {
          required: true,
          maxlength: 200,
          autocomplete: 'organization',
        }),
        FormField('customer.oib', 'OIB', {
          required: true,
          inputmode: 'numeric',
          maxlength: 11,
          hint: 'Samo znamenke.',
        }),
        FormField('customer.address', 'Adresa', { autocomplete: 'street-address' }),
        FormField('customer.postalCode', 'Poštanski broj', {
          inputmode: 'numeric',
          maxlength: 5,
          full: false,
        }),
        FormField('customer.city', 'Grad', { required: true, full: false }),
        FormField('customer.email', 'E-mail tvrtke', { type: 'email' }),
        FormField('customer.phone', 'Telefon tvrtke', { type: 'tel' }),
        CustomField('customerId', 'Postojeći kupac', existing, { required: true, hidden: true }),
      ],
    },
    {
      title: 'Kontakt osoba',
      fields: [
        SwitchField('createContact', 'Kreiraj kontakt osobu', { onChange: showContact }),
        FormField('contact.fullName', 'Ime i prezime', {
          required: true,
          hidden: true,
          maxlength: 240,
        }),
        FormField('contact.role', 'Funkcija', { hidden: true, maxlength: 200 }),
        FormField('contact.email', 'E-mail', { type: 'email', hidden: true }),
        FormField('contact.phone', 'Telefon', { type: 'tel', hidden: true, maxlength: 50 }),
      ],
    },
    {
      title: 'Prodajna prilika',
      fields: [
        SwitchField('createOpportunity', 'Kreiraj prodajnu priliku', { onChange: showOpportunity }),
        FormField('opportunity.title', 'Naziv prilike', {
          required: true,
          hidden: true,
          maxlength: 300,
          placeholder: 'npr. Grijanje poslovnog prostora',
        }),
        FormField('opportunity.value', 'Vrijednost (€)', {
          inputmode: 'decimal',
          hidden: true,
          placeholder: 'npr. 12000',
        }),
        SelectField('opportunity.stage', 'Faza (stage)', {
          options: STAGES,
          value: 'new',
          hidden: true,
        }),
      ],
    },
  ],
  { single: true },
);
form.element.prepend(summary);
form.element.querySelector('[data-field="conversionMode"]')?.after(matchesBox);

function showMode(mode) {
  const create = mode === 'CREATE_CUSTOMER';
  for (const name of CUSTOMER_FIELDS) form.setVisible(`customer.${name}`, create);
  form.setVisible('customerId', !create);
  matchesBox.hidden = !(create && matches.length);
}
function showContact(on) {
  for (const name of CONTACT_FIELDS) form.setVisible(`contact.${name}`, on);
}
function showOpportunity(on) {
  for (const name of OPPORTUNITY_FIELDS) form.setVisible(`opportunity.${name}`, on);
}

function useExisting(match) {
  form.setValue('conversionMode', 'EXISTING_CUSTOMER');
  existing.write({
    id: match.id,
    companyName: match.companyName,
    oib: match.oib,
    city: match.city,
  });
  showMode('EXISTING_CUSTOMER');
}

function renderMatches() {
  matchesBox.replaceChildren(
    h(
      'p',
      { class: 'lead-matches__title' },
      icon('alert', 'rv-icon rv-icon--sm'),
      MESSAGES.possibleExistingCustomer,
    ),
    h(
      'ul',
      { class: 'lead-matches__list', role: 'list' },
      matches.map((match) =>
        h(
          'li',
          { class: 'lead-matches__item' },
          h(
            'span',
            { class: 'lead-matches__text' },
            h('strong', {}, match.companyName),
            h(
              'span',
              {},
              [
                match.oib && `OIB ${match.oib}`,
                match.city,
                match.reasons.map((r) => REASON_LABELS[r]).join(', '),
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'rv-btn rv-btn--secondary rv-btn--sm',
              onClick: () => useExisting(match),
            },
            'Poveži',
          ),
        ),
      ),
    ),
  );
  matchesBox.hidden = !(form.values().conversionMode === 'CREATE_CUSTOMER' && matches.length);
}

/** Prefill from the lead: a company-only lead becomes the customer, a person its contact. */
function prefill(lead) {
  summary.replaceChildren(
    icon('user-search'),
    h(
      'span',
      {},
      'Lead: ',
      h('strong', {}, [lead.name, lead.companyName].filter(Boolean).join(' · ')),
    ),
  );
  form.setValue('customer.companyName', lead.companyName || lead.name);
  if (!lead.companyName) {
    form.setValue('customer.email', lead.email);
    form.setValue('customer.phone', lead.phone);
  }
  const person = Boolean(lead.companyName);
  form.setValue('createContact', person);
  form.setValue('contact.fullName', person ? lead.name : '');
  form.setValue('contact.role', lead.jobTitle);
  form.setValue('contact.email', lead.email);
  form.setValue('contact.phone', lead.phone);
  showContact(person);
  const withOpportunity = params.get('opportunity') === '1';
  form.setValue('createOpportunity', withOpportunity);
  if (lead.estimatedValue !== null) form.setValue('opportunity.value', String(lead.estimatedValue));
  showOpportunity(withOpportunity);
}

try {
  const lead = await api.getLead(leadId);
  if (lead.status !== 'active') {
    screen.setContent(
      h(
        'div',
        { class: 'rv-card rv-empty' },
        h('p', {}, MESSAGES.leadClosed),
        h('a', { class: 'rv-btn rv-btn--secondary', href: leadHref }, 'Natrag na lead'),
      ),
    );
    screen.actions.save.disabled = true;
  } else {
    prefill(lead);
    matches = await api.leadMatches(leadId).catch(() => []);
    renderMatches();
    screen.setContent(form.element, () => form.values());
  }
} catch (error) {
  screen.setContent(
    h(
      'p',
      { class: 'rv-screen__loading' },
      error instanceof ApiError ? error.message : MESSAGES.unavailable,
    ),
  );
  screen.actions.save.disabled = true;
}

/** Form values → POST /api/leads/{id}/convert body. */
function conversionInput(v, ignoreMatches) {
  const pick = (prefix, names) =>
    Object.fromEntries(names.map((name) => [name, v[`${prefix}.${name}`]]));
  const create = v.conversionMode === 'CREATE_CUSTOMER';
  return {
    conversionMode: v.conversionMode,
    ...(create ? { customer: pick('customer', CUSTOMER_FIELDS) } : { customerId: v.customerId }),
    createContact: v.createContact,
    ...(v.createContact ? { contact: pick('contact', CONTACT_FIELDS) } : {}),
    createOpportunity: v.createOpportunity,
    ...(v.createOpportunity ? { opportunity: pick('opportunity', OPPORTUNITY_FIELDS) } : {}),
    ...(ignoreMatches ? { ignoreMatches: true } : {}),
  };
}

async function save({ ignoreMatches = false } = {}) {
  const input = conversionInput(form.values(), ignoreMatches);
  const errors = validateLeadConversion(input); // duplicate OIB is checked by the server
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }
  screen.setSaving(true);
  let result;
  try {
    result = await api.convertLead(leadId, input);
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 409) {
      matches = error.details.matches ?? [];
      renderMatches();
      const createAnyway = await confirmDialog({
        title: MESSAGES.possibleExistingCustomer,
        message: `Sličan kupac već postoji (${matches.map((m) => m.companyName).join(', ')}). Povežite lead s postojećim kupcem ili ipak kreirajte novog.`,
        cancelLabel: 'Natrag',
        confirmLabel: 'Ipak kreiraj novog',
      });
      if (createAnyway) await save({ ignoreMatches: true });
      else matchesBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (error instanceof ApiError && error.status === 422) {
      form.setErrors(error.errors);
      if (error.message === MESSAGES.unavailable || error.message === MESSAGES.leadClosed)
        screen.showError(error.message);
    } else {
      screen.showError('Nije moguće pretvoriti lead. Pokušajte ponovno.');
    }
    return;
  }
  screen.allowLeave();
  setFlash(
    result.opportunityId
      ? 'Lead je pretvoren u kupca i prilika je kreirana.'
      : 'Lead je pretvoren u kupca.',
  );
  // replace(): Back from the customer returns to the lead, not to this form.
  window.location.replace(`/customers/${encodeURIComponent(result.customerId)}`);
}
