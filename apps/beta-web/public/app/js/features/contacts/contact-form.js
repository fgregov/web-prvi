// Dodaj kontakt drawer.
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { validateContact } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { customerField, resolveCustomerId, saveHandler } from '../shared.js';

export async function openContactForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const form = createForm([
    {
      fields: [
        customerField(customerId),
        {
          name: 'fullName',
          label: 'Ime i prezime',
          required: true,
          full: true,
          autocomplete: 'name',
        },
        { name: 'role', label: 'Uloga', placeholder: 'npr. Nabava', full: true },
        { name: 'phone', label: 'Telefon', type: 'tel', autocomplete: 'tel' },
        { name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email' },
      ],
    },
  ]);
  openDrawer({
    title: 'Dodaj kontakt',
    content: form.element,
    submitLabel: 'Dodaj kontakt',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({ ...values, customerId: resolveCustomerId(customerId, values) }),
      validate: validateContact,
      save: (input) => onSaved?.(crm.addContact(input.customerId, input, user)),
    }),
  });
}
