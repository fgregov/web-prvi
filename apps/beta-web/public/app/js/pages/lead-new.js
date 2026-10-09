// /leads/new · NewLeadScreen (Quick Add → "Novi lead", or "+ Novi lead" on Leads).
//
// A lead is not a customer: only the name is required, so it can be captured in
// seconds. Organization, owner and status ACTIVE are set by the server. After
// saving, the Lead Detail screen opens.
import { api, ApiError } from '../core/api.js';
import { LEAD_SOURCES, LEAD_STAGES } from '../core/constants.js';
import { hasErrors, MESSAGES, validateLead } from '../core/validation.js';
import { ReminderControl } from '../features/reminders/reminder-control.js';
import {
  FormField,
  SegmentedField,
  SelectField,
  SwitchField,
  TextAreaField,
} from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Novi lead',
  submitLabel: 'Spremi lead',
  fallback: '/leads',
  discardMessage: 'Uneseni podaci o leadu neće biti spremljeni.',
  onSubmit: save,
});

const reminder = ReminderControl();
const form = createForm(
  [
    {
      fields: [
        FormField('name', 'Naziv / ime leada', {
          required: true,
          maxlength: 240,
          placeholder: 'npr. Marko Horvat ili ABC d.o.o.',
          autocomplete: 'name',
        }),
        FormField('companyName', 'Tvrtka', { maxlength: 300, autocomplete: 'organization' }),
        FormField('email', 'E-mail', {
          type: 'email',
          maxlength: 254,
          autocomplete: 'email',
          placeholder: 'ime@tvrtka.hr',
        }),
        FormField('phone', 'Telefon', {
          type: 'tel',
          maxlength: 50,
          autocomplete: 'tel',
          placeholder: '+385 91 234 5678',
        }),
        FormField('jobTitle', 'Funkcija', {
          maxlength: 200,
          autocomplete: 'organization-title',
          placeholder: 'npr. Direktor nabave',
        }),
        SelectField('source', 'Izvor leada', { options: LEAD_SOURCES, value: 'manual' }),
        FormField('estimatedValue', 'Procjena vrijednosti (€)', {
          inputmode: 'decimal',
          placeholder: 'npr. 5000',
          hint: 'Neobavezno.',
        }),
        SegmentedField('stage', 'Status / faza', {
          options: LEAD_STAGES,
          value: 'new',
          onChange: (stage) => form.setValue('prospect', stage === 'qualified'),
        }),
        // A Prospect is a qualified lead: one state, shown in both controls.
        SwitchField('prospect', 'Označi kao Prospect', {
          hint: 'Lead s potvrđenim poslovnim potencijalom (faza: Kvalificiran).',
          onChange: (on) => {
            if (on) form.setValue('stage', 'qualified');
            else if (form.values().stage === 'qualified') form.setValue('stage', 'new');
          },
        }),
        TextAreaField('notes', 'Bilješka', {
          rows: 4,
          maxlength: 5000,
          placeholder: 'Kako ste došli do leada, što ga zanima…',
        }),
      ],
    },
    reminder.section,
  ],
  { single: true },
);
reminder.attach(form);
screen.setContent(form.element, () => form.values());
form.control('name')?.focus({ preventScroll: true });

async function save() {
  const values = form.values();
  const errors = validateLead(values);
  const push = reminder.read(values);
  if (hasErrors(errors) || hasErrors(push.errors)) {
    form.setErrors({ ...errors, ...push.errors });
    return;
  }
  screen.setSaving(true);
  try {
    const lead = await api.createLead({ ...values, reminderAt: push.reminderAt });
    screen.allowLeave();
    setFlash('Lead je uspješno kreiran.');
    // replace(): Back from the lead returns to where "Novi lead" was opened, not to this form.
    window.location.replace(`/leads/${encodeURIComponent(lead.id)}`);
  } catch (error) {
    // The entered values stay in the form.
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) form.setErrors(error.errors);
    else screen.showError(MESSAGES.leadSaveFailed);
  }
}
