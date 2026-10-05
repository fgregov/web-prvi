// Novi zadatak drawer.
import { TASK_PRIORITIES } from '../../core/constants.js';
import { crm } from '../../core/crm.js';
import { addDaysKey } from '../../core/format.js';
import { getCurrentUser } from '../../core/session.js';
import { validateTask } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { customerField, resolveCustomerId, saveHandler } from '../shared.js';

export async function openTaskForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const form = createForm([
    {
      fields: [
        customerField(customerId),
        {
          name: 'title',
          label: 'Zadatak',
          required: true,
          placeholder: 'npr. Poslati ponudu',
          full: true,
        },
        { name: 'dueDate', label: 'Rok', type: 'date', value: addDaysKey(1) },
        {
          name: 'priority',
          label: 'Prioritet',
          type: 'select',
          options: TASK_PRIORITIES,
          value: 'normal',
        },
        { name: 'notes', label: 'Napomena', type: 'textarea', full: true },
      ],
    },
  ]);
  openDrawer({
    title: 'Novi zadatak',
    subtitle: `Dodijeljeno: ${user.displayName}`,
    content: form.element,
    submitLabel: 'Kreiraj zadatak',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({ ...values, customerId: resolveCustomerId(customerId, values) }),
      validate: validateTask,
      save: (input) => onSaved?.(crm.createTask(input, user)),
    }),
  });
}
