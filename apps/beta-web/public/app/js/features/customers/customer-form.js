// "Uredi kupca" drawer (profile). Creating a customer is a dedicated screen: /customers/new.
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { contactName } from '../../core/store.js';
import { validateCustomer } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { saveHandler } from '../shared.js';
import { customerSections } from './customer-fields.js';

function valuesFromProfile(profile) {
  const contact = profile.primaryContact;
  return {
    companyName: profile.companyName,
    oib: profile.oib,
    address: profile.address,
    postalCode: profile.postalCode,
    city: profile.city,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    website: profile.website,
    contactName: contact ? contactName(contact) : '',
    contactRole: contact?.role ?? '',
    contactEmail: contact?.email ?? '',
    contactPhone: contact?.phone ?? '',
    status: profile.status,
    type: profile.type,
    notes: profile.notes,
  };
}

export async function openCustomerForm({ customerId, onSaved }) {
  const user = await getCurrentUser();
  const profile = crm.getProfile(customerId);
  const form = createForm(
    customerSections(valuesFromProfile(profile), {
      ownerName: profile.ownerName ?? user.displayName,
    }),
  );

  openDrawer({
    title: 'Uredi kupca',
    subtitle: profile.companyName,
    content: form.element,
    submitLabel: 'Spremi promjene',
    onSubmit: saveHandler(form, {
      validate: (input) =>
        validateCustomer(input, { existing: crm.listCustomers(), currentId: customerId }),
      save: (input) => onSaved?.(crm.updateCustomer(customerId, input, user)),
    }),
  });
}
