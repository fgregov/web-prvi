// Dodaj bilješku drawer.
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { validateNote } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { customerField, resolveCustomerId, saveHandler } from '../shared.js';

export async function openNoteForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const form = createForm([
    {
      fields: [
        customerField(customerId),
        {
          name: 'text',
          label: 'Bilješka',
          type: 'textarea',
          required: true,
          rows: 6,
          placeholder: 'Što je dogovoreno, što treba zapamtiti…',
          full: true,
        },
      ],
    },
  ]);
  openDrawer({
    title: 'Dodaj bilješku',
    content: form.element,
    submitLabel: 'Spremi bilješku',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({ ...values, customerId: resolveCustomerId(customerId, values) }),
      validate: validateNote,
      save: (input) => onSaved?.(crm.addNote(input, user)),
    }),
  });
}
