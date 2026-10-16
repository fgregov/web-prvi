// /sales/leads/{id}/convert · PRETVORI LEAD U KUPCA (ADR-0009), for a WON lead.
//
// Into a NEW customer (created ACTIVE) or an EXISTING one (an inactive one only
// after confirming its reactivation), optionally with a contact person, in one
// atomic step on the server. The won deal (?opportunityId=, else the lead's
// first won one) gets the customer; no deal is created or replaced. Customers
// that look like this lead are shown first ("Mogući postojeći kupac");
// creating a new one anyway needs a confirmation. The lead stays, WON, and
// records what it became. ?mode=existing opens "Poveži s postojećim".
import { api, ApiError } from '../core/api.js';
import { hasErrors, MESSAGES, validateLeadConversion } from '../core/validation.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import { CustomField, FormField, SegmentedField, SwitchField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const leadId = decodeURIComponent(window.location.pathname.split('/')[3] ?? '');
const params = new URLSearchParams(window.location.search);
const leadHref = `/sales/leads/${encodeURIComponent(leadId)}`;

const MODES = [
  { value: 'CREATE_CUSTOMER', label: 'Kreiraj novog kupca' },
  { value: 'EXISTING_CUSTOMER', label: 'Poveži s postojećim' },
];
const CUSTOMER_FIELDS = ['companyName', 'oib', 'address', 'postalCode', 'city', 'email', 'phone'];
const CONTACT_FIELDS = ['fullName', 'role', 'email', 'phone'];
const startMode = params.get('mode') === 'existing' ? 'EXISTING_CUSTOMER' : 'CREATE_CUSTOMER';
let wonDeal = null; // the won deal the conversion comes from
const REASON_LABELS = { oib: 'isti OIB', name: 'sličan naziv', email_domain: 'ista e-mail domena' };

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Pretvori lead u kupca',
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
          value: startMode,
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
  const won = (lead.opportunities ?? [])
    .filter((o) => o.status === 'won')
    .sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''));
  wonDeal =
    won.find((o) => o.id === params.get('opportunityId')) ??
    won.find((o) => !o.companyId) ??
    won[0] ??
    null;
  summary.replaceChildren(
    icon('user-search'),
    h(
      'span',
      {},
      'Lead: ',
      h('strong', {}, [lead.name, lead.companyName].filter(Boolean).join(' · ')),
      wonDeal
        ? h('span', { class: 'lead-convert__deal' }, ` · Osvojena prilika: ${wonDeal.title}`)
        : null,
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
  showMode(startMode);
}

try {
  const lead = await api.getLead(leadId);
  // Only a WON lead not yet linked to a customer is converted (ADR-0009).
  if (lead.status !== 'won' || !lead.conversionPending) {
    const converted = lead.status === 'won' && lead.convertedCustomerId;
    screen.setContent(
      h(
        'div',
        { class: 'rv-card rv-empty' },
        h(
          'p',
          {},
          lead.status === 'won'
            ? MESSAGES.leadAlreadyConverted
            : lead.status === 'lost'
              ? MESSAGES.leadClosed
              : MESSAGES.leadNotWon,
        ),
        converted
          ? h(
              'a',
              {
                class: 'rv-btn rv-btn--primary',
                href: `/sales/customers/${encodeURIComponent(lead.convertedCustomerId)}`,
              },
              'Otvori kupca',
            )
          : null,
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
function conversionInput(v, { ignoreMatches, reactivate }) {
  const pick = (prefix, names) =>
    Object.fromEntries(names.map((name) => [name, v[`${prefix}.${name}`]]));
  const create = v.conversionMode === 'CREATE_CUSTOMER';
  return {
    conversionMode: v.conversionMode,
    ...(create ? { customer: pick('customer', CUSTOMER_FIELDS) } : { customerId: v.customerId }),
    createContact: v.createContact,
    ...(v.createContact ? { contact: pick('contact', CONTACT_FIELDS) } : {}),
    ...(wonDeal ? { opportunityId: wonDeal.id } : {}),
    ...(ignoreMatches ? { ignoreMatches: true } : {}),
    ...(reactivate ? { reactivate: true } : {}),
  };
}

async function save({ ignoreMatches = false, reactivate = false } = {}) {
  const input = conversionInput(form.values(), { ignoreMatches, reactivate });
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
    if (error instanceof ApiError && error.status === 409 && error.details.customerInactive) {
      // Never reactivated silently: the user confirms it (the existing reactivation).
      const yes = await confirmDialog({
        title: 'Kupac je neaktivan',
        message: `${error.details.customerName ?? 'Odabrani kupac'} je neaktivan. Ponovno ga aktivirati i povezati s ovim leadom?`,
        cancelLabel: 'Natrag',
        confirmLabel: 'Aktiviraj i poveži',
      });
      if (yes) await save({ ignoreMatches, reactivate: true });
    } else if (error instanceof ApiError && error.status === 409) {
      matches = error.details.matches ?? [];
      renderMatches();
      const createAnyway = await confirmDialog({
        title: MESSAGES.possibleExistingCustomer,
        message: `Sličan kupac već postoji (${matches.map((m) => m.companyName).join(', ')}). Povežite lead s postojećim kupcem ili ipak kreirajte novog.`,
        cancelLabel: 'Natrag',
        confirmLabel: 'Ipak kreiraj novog',
      });
      if (createAnyway) await save({ ignoreMatches: true, reactivate });
      else matchesBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (error instanceof ApiError && error.status === 422) {
      form.setErrors(error.errors);
      if (
        [
          MESSAGES.unavailable,
          MESSAGES.leadClosed,
          MESSAGES.leadNotWon,
          MESSAGES.leadAlreadyConverted,
        ].includes(error.message)
      )
        screen.showError(error.message);
    } else {
      screen.showError('Nije moguće pretvoriti lead. Pokušajte ponovno.');
    }
    return;
  }
  screen.allowLeave();
  setFlash(
    result.alreadyConverted
      ? 'Lead je već bio pretvoren u ovog kupca.'
      : 'Lead je pretvoren u aktivnog kupca.',
  );
  // replace(): Back from the customer returns to the lead, not to this form.
  window.location.replace(`/sales/customers/${encodeURIComponent(result.customerId)}`);
}
