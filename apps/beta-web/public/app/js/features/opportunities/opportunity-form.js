// Kreiraj priliku drawer.
import { STAGES } from '../../core/constants.js';
import { crm } from '../../core/crm.js';
import { addDaysKey } from '../../core/format.js';
import { getCurrentUser } from '../../core/session.js';
import { validateOpportunity } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { customerField, resolveCustomerId, saveHandler } from '../shared.js';

export async function openOpportunityForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const form = createForm([
    {
      fields: [
        customerField(customerId),
        {
          name: 'title',
          label: 'Naziv prilike',
          required: true,
          placeholder: 'npr. Opremanje ureda',
          full: true,
        },
        {
          name: 'value',
          label: 'Procijenjena vrijednost (€)',
          type: 'number',
          inputmode: 'decimal',
          min: 0,
          step: 100,
          placeholder: '0',
        },
        { name: 'stage', label: 'Faza pipelinea', type: 'select', options: STAGES, value: 'new' },
        {
          name: 'probability',
          label: 'Vjerojatnost (%)',
          type: 'number',
          inputmode: 'numeric',
          min: 0,
          max: 100,
          step: 5,
          value: String(STAGES[0].probability),
        },
        {
          name: 'expectedCloseDate',
          label: 'Očekivani datum zatvaranja',
          type: 'date',
          value: addDaysKey(30),
        },
        {
          name: 'ownerId',
          label: 'Odgovorna osoba',
          type: 'select',
          options: [{ value: user.id, label: user.displayName }],
          value: user.id,
          full: true,
        },
        { name: 'notes', label: 'Napomena', type: 'textarea', full: true },
      ],
    },
  ]);

  // Probability follows the stage until the user types their own value.
  const probability = form.control('probability');
  let probabilityTouched = false;
  probability.addEventListener('input', () => (probabilityTouched = true));
  form.control('stage').addEventListener('change', (event) => {
    if (!probabilityTouched)
      probability.value = String(
        STAGES.find((s) => s.value === event.target.value)?.probability ?? '',
      );
  });

  openDrawer({
    title: 'Kreiraj priliku',
    subtitle: 'Prilika se povezuje s kupcem i ulazi u Opportunity Pipeline.',
    content: form.element,
    submitLabel: 'Kreiraj priliku',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({
        ...values,
        customerId: resolveCustomerId(customerId, values),
        ownerName: values.ownerId === user.id ? user.displayName : '',
      }),
      validate: validateOpportunity,
      save: (input) => onSaved?.(crm.createOpportunity(input, user)),
    }),
  });
}
