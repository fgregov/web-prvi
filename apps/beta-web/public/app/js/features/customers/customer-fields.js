// Customer form fields, shared by the New Customer screen and the "Uredi kupca" drawer.
import { CUSTOMER_STATUSES, CUSTOMER_TYPES } from '../../core/constants.js';

export const BLANK_CUSTOMER = Object.freeze({
  companyName: '',
  oib: '',
  address: '',
  postalCode: '',
  city: '',
  email: '',
  phone: '',
  website: '',
  contactName: '',
  contactRole: 'Odgovorna osoba',
  contactEmail: '',
  contactPhone: '',
  status: 'active',
  type: 'customer',
  notes: '',
});

/** Form sections in the order of the New Customer screen. */
export function customerSections(v, { ownerName }) {
  return [
    {
      title: 'Osnovni podaci',
      fields: [
        {
          name: 'companyName',
          label: 'Naziv kupca',
          required: true,
          value: v.companyName,
          full: true,
          maxlength: 200,
          autocomplete: 'organization',
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
          name: 'email',
          label: 'E-mail',
          type: 'email',
          value: v.email,
          placeholder: 'info@tvrtka.hr',
          full: true,
          autocomplete: 'email',
        },
        {
          name: 'phone',
          label: 'Telefon',
          type: 'tel',
          value: v.phone,
          placeholder: '+385 …',
          full: true,
          autocomplete: 'tel',
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
      title: 'Kontakt osoba',
      fields: [
        {
          name: 'contactName',
          label: 'Ime i prezime',
          required: true,
          value: v.contactName,
          full: true,
        },
        {
          name: 'contactRole',
          label: 'Funkcija',
          value: v.contactRole,
          placeholder: 'npr. Direktor',
          full: true,
        },
        {
          name: 'contactEmail',
          label: 'E-mail',
          type: 'email',
          value: v.contactEmail,
          placeholder: 'ime@tvrtka.hr',
          full: true,
        },
        {
          name: 'contactPhone',
          label: 'Telefon',
          type: 'tel',
          value: v.contactPhone,
          placeholder: '+385 …',
          full: true,
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
          value: ownerName,
          full: true,
        },
      ],
    },
    {
      title: 'Bilješka',
      fields: [
        {
          name: 'notes',
          label: 'Bilješka',
          type: 'textarea',
          value: v.notes,
          rows: 4,
          full: true,
          placeholder: 'Kratka napomena o kupcu…',
        },
      ],
    },
  ];
}
