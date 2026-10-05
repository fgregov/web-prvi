// Pošalji e-mail drawer. Demo: the e-mail is recorded in the timeline, not sent.
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { validateEmail } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { saveHandler } from '../shared.js';

export async function openEmailForm({ customerId, onSaved }) {
  const user = await getCurrentUser();
  const profile = crm.getProfile(customerId);
  const form = createForm(
    [
      {
        fields: [
          {
            name: 'customerLabel',
            label: 'Kupac',
            type: 'readonly',
            value: profile.companyName,
            full: true,
          },
          {
            name: 'to',
            label: 'Prima',
            type: 'email',
            value: profile.primaryContact?.email ?? '',
            placeholder: 'ime@tvrtka.hr',
            full: true,
          },
          { name: 'subject', label: 'Predmet', required: true, full: true },
          { name: 'body', label: 'Poruka', type: 'textarea', rows: 6, full: true },
        ],
      },
    ],
    { notice: 'Demo: e-mail se ne šalje, nego se bilježi u aktivnostima kupca.' },
  );
  openDrawer({
    title: 'Pošalji e-mail',
    content: form.element,
    submitLabel: 'Zabilježi e-mail',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({ ...values, customerId }),
      validate: validateEmail,
      save: (input) => onSaved?.(crm.logEmail(input, user)),
    }),
  });
}
