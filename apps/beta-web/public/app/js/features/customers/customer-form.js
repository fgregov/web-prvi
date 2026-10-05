// Novi kupac / Uredi kupca drawer.
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  DEMO_CUSTOMER,
  DEMO_PREFILL,
} from '../../core/constants.js';
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { contactName } from '../../core/store.js';
import { validateCustomer } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { saveHandler } from '../shared.js';

const BLANK = {
  companyName: '',
  address: '',
  postalCode: '',
  city: '',
  oib: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  status: 'active',
  type: 'customer',
  notes: '',
};

function valuesFromProfile(profile) {
  return {
    companyName: profile.companyName,
    address: profile.address,
    postalCode: profile.postalCode,
    city: profile.city,
    oib: profile.oib,
    contactName: profile.primaryContact ? contactName(profile.primaryContact) : '',
    phone: profile.primaryContact?.phone ?? '',
    email: profile.primaryContact?.email ?? '',
    website: profile.website,
    status: profile.status,
    type: profile.type,
    notes: profile.notes,
  };
}

/**
 * @param {{ customerId?: string, onSaved: (customer) => void }} options
 *   Without customerId: create. With customerId: edit that customer.
 */
export async function openCustomerForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const profile = customerId ? crm.getProfile(customerId) : null;
  const v = profile
    ? valuesFromProfile(profile)
    : DEMO_PREFILL
      ? { ...DEMO_CUSTOMER }
      : { ...BLANK };

  const form = createForm(
    [
      {
        title: 'Osnovni podaci',
        fields: [
          {
            name: 'companyName',
            label: 'Naziv tvrtke',
            required: true,
            value: v.companyName,
            full: true,
            maxlength: 200,
            autocomplete: 'organization',
          },
          {
            name: 'address',
            label: 'Adresa',
            value: v.address,
            full: true,
            autocomplete: 'street-address',
          },
          {
            name: 'postalCode',
            label: 'Poštanski broj',
            value: v.postalCode,
            inputmode: 'numeric',
            maxlength: 5,
            autocomplete: 'postal-code',
          },
          {
            name: 'city',
            label: 'Grad',
            required: true,
            value: v.city,
            autocomplete: 'address-level2',
          },
          {
            name: 'oib',
            label: 'OIB',
            required: true,
            value: v.oib,
            inputmode: 'numeric',
            maxlength: 11,
            hint: 'Samo znamenke.',
            full: true,
          },
        ],
      },
      {
        title: 'Kontakt osoba',
        fields: [
          {
            name: 'contactName',
            label: 'Odgovorna osoba',
            required: true,
            value: v.contactName,
            full: true,
            autocomplete: 'name',
          },
          {
            name: 'phone',
            label: 'Telefon',
            type: 'tel',
            value: v.phone,
            placeholder: '+385 …',
            autocomplete: 'tel',
          },
          {
            name: 'email',
            label: 'E-mail',
            type: 'email',
            value: v.email,
            placeholder: 'ime@tvrtka.hr',
            autocomplete: 'email',
          },
          {
            name: 'website',
            label: 'Web stranica',
            type: 'url',
            value: v.website,
            placeholder: 'www.tvrtka.hr',
            full: true,
            autocomplete: 'url',
          },
        ],
      },
      {
        title: 'CRM podaci',
        fields: [
          {
            name: 'status',
            label: 'Status kupca',
            type: 'select',
            value: v.status,
            options: CUSTOMER_STATUSES,
          },
          { name: 'type', label: 'Tip', type: 'segmented', value: v.type, options: CUSTOMER_TYPES },
          {
            name: 'ownerLabel',
            label: 'Odgovorni prodajni predstavnik',
            type: 'readonly',
            value: profile?.ownerName ?? user.displayName,
            full: true,
          },
          {
            name: 'notes',
            label: 'Napomena',
            type: 'textarea',
            value: v.notes,
            full: true,
            rows: 3,
          },
        ],
      },
    ],
    {
      notice:
        !profile && DEMO_PREFILL ? 'Demo: forma je unaprijed popunjena testnim podacima.' : null,
    },
  );

  openDrawer({
    title: profile ? 'Uredi kupca' : 'Novi kupac',
    subtitle: profile ? profile.companyName : 'Dodajte tvrtku u CRM.',
    content: form.element,
    submitLabel: profile ? 'Spremi promjene' : 'Kreiraj kupca',
    onSubmit: saveHandler(form, {
      validate: (input) =>
        validateCustomer(input, { existing: crm.listCustomers(), currentId: customerId }),
      save: (input) => {
        const saved = profile
          ? crm.updateCustomer(customerId, input, user)
          : crm.createCustomer(input, user);
        onSaved?.(saved);
      },
    }),
  });
}
