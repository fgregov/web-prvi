// /customers/new · NewCustomerScreen
//
// A dedicated route-level screen (not part of the dashboard). Quick Add only
// navigates here; this module owns the form, saving and the onward navigation.
import { api, ApiError } from '../core/api.js';
import { DEMO_CUSTOMER, DEMO_PREFILL } from '../core/constants.js';
import { getCurrentUser } from '../core/session.js';
import { hasErrors, validateCustomer } from '../core/validation.js';
import { BLANK_CUSTOMER, customerSections } from '../features/customers/customer-fields.js';
import { createForm } from '../ui/form.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const user = await getCurrentUser();

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'Novi kupac',
  submitLabel: 'Spremi kupca',
  fallback: '/dashboard',
  discardMessage: 'Uneseni podaci o kupcu neće biti spremljeni.',
  onSubmit: save,
});

const initial = DEMO_PREFILL ? { ...BLANK_CUSTOMER, ...DEMO_CUSTOMER } : { ...BLANK_CUSTOMER };
const form = createForm(customerSections(initial, { ownerName: user.displayName }), {
  single: true,
  notice: DEMO_PREFILL ? 'Demo: forma je unaprijed popunjena testnim podacima.' : null,
});
screen.setContent(form.element, () => form.values());

async function save() {
  const values = form.values();
  const errors = validateCustomer(values); // duplicate OIB is checked by the server
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }
  screen.setSaving(true);
  try {
    const customer = await api.createCustomer(values);
    screen.allowLeave();
    setFlash(`${customer.companyName} uspješno kreirana.`);
    // replace(): Back from the new profile returns to the previous screen, not to this form.
    window.location.replace(`/customers/${encodeURIComponent(customer.id)}`);
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) form.setErrors(error.errors);
    else screen.showError('Nije moguće spremiti kupca. Pokušajte ponovno.');
  }
}
