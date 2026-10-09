// /opportunities/new · New opportunity for an existing customer. Every active
// opportunity needs a next action: it can be created right here, and when it is
// missing the user is offered "Dodaj zadatak" (→ /tasks/new with the opportunity).
import { api, ApiError } from '../core/api.js';
import { CURRENCIES, OPPORTUNITY_STATUSES, STAGES } from '../core/constants.js';
import { hasErrors, MESSAGES, validateOpportunity } from '../core/validation.js';
import { contextCustomer } from '../features/pickers/context.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { ContactPicker } from '../features/pickers/related-picker.js';
import { ReminderControl } from '../features/reminders/reminder-control.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import {
  CustomField,
  DatePickerField,
  FormField,
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

const customer = CustomerPicker({ clearable: false });
const contact = ContactPicker();
const reminder = ReminderControl();
const form = createForm(
  [
    {
      fields: [
        FormField('title', 'Naziv prilike', { required: true, maxlength: 300 }),
        CustomField('companyId', 'Kupac', customer, {
          required: true,
          onChange: (id) => contact.setCustomer(id),
        }),
        CustomField('contactId', 'Kontakt', contact),
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
        DatePickerField('nextActionDueDate', 'Rok sljedeće akcije'),
      ],
    },
    reminder.section,
  ],
  { single: true },
);
reminder.attach(form);

try {
  const preset = await contextCustomer(params.get('companyId'));
  if (preset) {
    customer.write(preset);
    await contact.setCustomer(preset.id, params.get('contactId') ?? '');
  }
} catch {
  screen.showError(MESSAGES.unavailable);
}
screen.setContent(form.element, () => form.values());

async function save() {
  const input = form.values();
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
  const target = returnTarget(`/customers/${encodeURIComponent(opportunity.companyId)}#prilike`);
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
