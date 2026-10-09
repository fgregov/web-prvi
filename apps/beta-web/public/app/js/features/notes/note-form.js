// Dodaj bilješku drawer (customer profile).
import { api } from '../../core/api.js';
import { validateNote } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { saveHandler } from '../shared.js';

export function openNoteForm({ profile, onSaved }) {
  const form = createForm([
    {
      fields: [
        {
          name: 'text',
          label: 'Bilješka',
          type: 'textarea',
          required: true,
          rows: 6,
          maxlength: 5000,
          placeholder: 'Što je dogovoreno, što treba zapamtiti…',
          full: true,
        },
      ],
    },
  ]);
  openDrawer({
    title: 'Dodaj bilješku',
    subtitle: profile.companyName,
    content: form.element,
    submitLabel: 'Spremi bilješku',
    onSubmit: saveHandler(form, {
      validate: validateNote,
      save: async (input) => onSaved?.(await api.addNote(profile.id, input)),
    }),
  });
}
