// /contacts/new · New contact. A contact always belongs to a customer
// (searchable by name or OIB; preselected from ?companyId=).
import { api, ApiError } from '../core/api.js';
import { hasErrors, MESSAGES, validateContact } from '../core/validation.js';
import { contextCustomer } from '../features/pickers/context.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { h } from '../ui/dom.js';
import { CustomField, FormField, TextAreaField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { leaveTo, returnTarget } from '../ui/navigation.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const params = new URLSearchParams(window.location.search);
const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Novi kontakt',
  submitLabel: 'Spremi kontakt',
  fallback: '/customers',
  discardMessage: 'Uneseni podaci o kontaktu neće biti spremljeni.',
  onSubmit: save,
});
screen.setContent(h('p', { class: 'rv-screen__loading' }, 'Učitavanje...'));

const customer = CustomerPicker({ clearable: false });
const form = createForm(
  [
    {
      fields: [
        CustomField('companyId', 'Kupac', customer, { required: true }),
        FormField('fullName', 'Ime i prezime', {
          required: true,
          maxlength: 240,
          autocomplete: 'name',
        }),
        FormField('role', 'Funkcija', { placeholder: 'npr. Voditelj nabave', maxlength: 200 }),
        FormField('email', 'E-mail', {
          type: 'email',
          placeholder: 'ime@tvrtka.hr',
          autocomplete: 'email',
        }),
        FormField('phone', 'Telefon', { type: 'tel', placeholder: '+385 …', autocomplete: 'tel' }),
        TextAreaField('notes', 'Bilješka', { rows: 4, maxlength: 5000 }),
      ],
    },
  ],
  { single: true },
);

try {
  customer.write(await contextCustomer(params.get('companyId')));
} catch {
  screen.showError(MESSAGES.unavailable);
}
screen.setContent(form.element, () => form.values());

async function save() {
  const input = form.values();
  const errors = validateContact(input);
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }
  screen.setSaving(true);
  try {
    const contact = await api.createContact(input);
    screen.allowLeave();
    setFlash('Kontakt je spremljen.');
    leaveTo(returnTarget(`/customers/${encodeURIComponent(contact.companyId)}#kontakti`));
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) {
      form.setErrors(error.errors);
      if (error.message === MESSAGES.unavailable) screen.showError(error.message);
    } else {
      screen.showError('Nije moguće spremiti kontakt. Pokušajte ponovno.');
    }
  }
}
