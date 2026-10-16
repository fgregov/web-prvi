// Pošalji e-mail drawer. Demo: the e-mail is recorded in the timeline, not sent.
import { api } from '../../core/api.js';
import { validateEmail } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { saveHandler } from '../shared.js';

export function openEmailForm({ profile, onSaved }) {
  const form = createForm(
    [
      {
        fields: [
          {
            name: 'to',
            label: 'Prima',
            type: 'email',
            value: profile.primaryContact?.email ?? '',
            placeholder: 'ime@tvrtka.hr',
            full: true,
          },
          { name: 'subject', label: 'Predmet', required: true, full: true, maxlength: 300 },
          { name: 'body', label: 'Poruka', type: 'textarea', rows: 6, full: true },
        ],
      },
    ],
    { notice: 'Demo: e-mail se ne šalje, nego se bilježi u aktivnostima kupca.' },
  );
  openDrawer({
    title: 'Pošalji e-mail',
    subtitle: profile.companyName,
    content: form.element,
    submitLabel: 'Zabilježi e-mail',
    onSubmit: saveHandler(form, {
      validate: validateEmail,
      save: async (input) => onSaved?.(await api.logEmail(profile.id, input)),
    }),
  });
}
