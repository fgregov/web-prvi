// Helpers shared by every create/edit drawer.
import { crm } from '../core/crm.js';
import { ValidationError } from '../core/store.js';
import { hasErrors } from '../core/validation.js';
import { showToast } from '../ui/toast.js';

/** Builds the drawer submit handler: validate → mark fields → save → report. */
export function saveHandler(form, { validate, save, buildInput = (values) => values }) {
  return () => {
    const input = buildInput(form.values());
    const errors = validate(input);
    if (hasErrors(errors)) {
      form.setErrors(errors);
      return false;
    }
    try {
      save(input);
      return true;
    } catch (error) {
      if (error instanceof ValidationError) {
        form.setErrors(error.errors);
        return false;
      }
      console.error(error);
      showToast('Došlo je do pogreške. Pokušajte ponovno.');
      return false;
    }
  };
}

/** "Kupac" field: read-only when the customer is fixed, otherwise a picker (quick-create from the dashboard). */
export function customerField(customerId) {
  if (customerId) {
    return {
      name: 'customerLabel',
      label: 'Kupac',
      type: 'readonly',
      value: crm.getCustomer(customerId)?.companyName ?? '',
      full: true,
    };
  }
  const customers = crm.listCustomers();
  return {
    name: 'customerId',
    label: 'Kupac',
    type: 'select',
    required: true,
    full: true,
    value: customers[0]?.id,
    options: customers.map((c) => ({ value: c.id, label: c.companyName })),
  };
}

export const resolveCustomerId = (fixedId, values) => fixedId ?? values.customerId ?? '';
