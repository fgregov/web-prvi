// /opportunities/new · New opportunity of a LEAD or of a CUSTOMER (ADR-0009):
// "Poveži priliku s" Lead | Kupac. From a lead (?leadId=) the lead is preset
// and no customer is needed; from a customer (?companyId=) as before. Every
// active opportunity needs a next action: it can be created right here, and
// when it is missing the user is offered "Dodaj zadatak" (→ /tasks/new).
import { api, ApiError } from '../core/api.js';
import { CURRENCIES, OPPORTUNITY_STATUSES, STAGES } from '../core/constants.js';
import { hasErrors, MESSAGES, validateOpportunity } from '../core/validation.js';
import { contextCustomer } from '../features/pickers/context.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { LeadPicker } from '../features/pickers/lead-picker.js';
import { ContactPicker } from '../features/pickers/related-picker.js';
import { ReminderControl } from '../features/reminders/reminder-control.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import {
  CustomField,
  DatePickerField,
  FormField,
  SegmentedField,
  SelectField,
  TextAreaField,
} from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { leaveTo, returnTarget, withParams } from '../ui/navigation.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const params = new URLSearchParams(window.location.search);
const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Nova prilika',
  submitLabel: 'Spremi priliku',
  fallback: '/opportunities',
  discardMessage: 'Uneseni podaci o prilici neće biti spremljeni.',
  onSubmit: save,
});
screen.setContent(h('p', { class: 'rv-screen__loading' }, 'Učitavanje...'));

const LINK_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'customer', label: 'Kupac' },
];
const customer = CustomerPicker({ clearable: false });
const lead = LeadPicker();
const contact = ContactPicker();
const reminder = ReminderControl();
const form = createForm(
  [
    {
      fields: [
        SegmentedField('linkTo', 'Poveži priliku s', {
          options: LINK_OPTIONS,
          value: 'customer',
          onChange: showLink,
        }),
        CustomField('leadId', 'Lead', lead, {
          required: true,
          hidden: true,
          hint: 'Kupac nije potreban: lead postaje kupac nakon osvojene prilike.',
        }),
        CustomField('companyId', 'Kupac', customer, {
          required: true,
          onChange: (id) => contact.setCustomer(id),
        }),
        CustomField('contactId', 'Kontakt', contact),
        FormField('title', 'Naziv prilike', { required: true, maxlength: 300 }),
        FormField('value', 'Vrijednost', {
          inputmode: 'decimal',
          placeholder: 'npr. 12000',
          full: false,
        }),
        SelectField('currency', 'Valuta', { options: CURRENCIES, value: 'EUR', full: false }),
        SelectField('stage', 'Faza', { options: STAGES, value: 'new' }),
        SelectField('status', 'Status', { options: OPPORTUNITY_STATUSES, value: 'active' }),
        DatePickerField('expectedCloseDate', 'Očekivani datum zatvaranja'),
        TextAreaField('notes', 'Bilješka', { rows: 3, maxlength: 5000 }),
      ],
    },
    {
      title: 'Sljedeća akcija',
      fields: [
        FormField('nextActionTitle', 'Što je sljedeći korak?', {
          placeholder: 'npr. Poslati ponudu',
          maxlength: 300,
          hint: 'Svaka aktivna prilika treba poznatu sljedeću akciju. Sprema se kao zadatak.',
        }),
        DatePickerField('nextActionDueDate', 'Datum sljedeće akcije', {
          hint: 'Obavezno uz sljedeći korak: svaki zadatak ima datum.',
        }),
      ],
    },
    reminder.section,
  ],
  { single: true },
);
reminder.attach(form);

/** Lead: the lead picker; Kupac: the customer and its contact. Never neither. */
function showLink(mode) {
  form.setVisible('leadId', mode === 'lead');
  form.setVisible('companyId', mode === 'customer');
  form.setVisible('contactId', mode === 'customer');
}

try {
  if (params.get('leadId')) {
    // Lead Detail → Kreiraj priliku: linked to this lead, no customer.
    lead.write(await api.getLead(params.get('leadId')));
    form.setValue('linkTo', 'lead');
    showLink('lead');
  } else {
    const preset = await contextCustomer(params.get('companyId'));
    if (preset) {
      customer.write(preset);
      await contact.setCustomer(preset.id, params.get('contactId') ?? '');
    }
  }
} catch {
  screen.showError(MESSAGES.unavailable);
}
screen.setContent(form.element, () => form.values());

async function save() {
  const input = form.values();
  // Only the chosen relation is sent: a lead's deal has no customer (until its conversion).
  if (input.linkTo === 'lead') {
    input.companyId = '';
    input.contactId = '';
  } else {
    input.leadId = '';
  }
  const errors = validateOpportunity(input);
  const push = reminder.read(input);
  if (hasErrors(errors) || hasErrors(push.errors)) {
    form.setErrors({ ...errors, ...push.errors });
    return;
  }
  input.reminderAt = push.reminderAt;
  screen.setSaving(true);
  let result;
  try {
    result = await api.createOpportunity(input);
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) {
      form.setErrors(error.errors);
      if (error.message === MESSAGES.unavailable) screen.showError(error.message);
    } else {
      screen.showError('Nije moguće spremiti priliku. Pokušajte ponovno.');
    }
    return;
  }

  screen.allowLeave();
  const { opportunity, nextActionMissing } = result;
  const target = returnTarget(
    opportunity.companyId
      ? `/customers/${encodeURIComponent(opportunity.companyId)}#prilike`
      : `/leads/${encodeURIComponent(opportunity.leadId)}#prilike`,
  );
  if (nextActionMissing) {
    const addTask = await confirmDialog({
      title: MESSAGES.missingNextAction,
      message: `„${opportunity.title}” je spremljena. Dodajte zadatak kako bi prilika imala poznat sljedeći korak.`,
      cancelLabel: 'Kasnije',
      confirmLabel: 'Dodaj zadatak',
    });
    if (addTask) {
      // replace(): Back from the task form does not return to this (already saved) form.
      window.location.replace(
        withParams('/tasks/new', {
          opportunityId: opportunity.id,
          leadId: opportunity.leadId,
          type: 'follow_up',
          returnTo: target,
        }),
      );
      return;
    }
    setFlash('Prilika je spremljena. Nema definiranu sljedeću akciju.');
  } else {
    setFlash('Prilika je spremljena i ima sljedeću akciju.');
  }
  leaveTo(target);
}
