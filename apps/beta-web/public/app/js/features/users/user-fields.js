// OSNOVNI PODACI of a member, as form fields (NOVI KORISNIK, PREGLED KORISNIKA).
import { FormField } from '../../ui/fields.js';

export const BLANK_USER = { firstName: '', lastName: '', oib: '', email: '', phone: '' };

export const profileFields = (values) => [
  FormField('firstName', 'Ime', {
    value: values.firstName,
    required: true,
    autocomplete: 'off',
    maxlength: 100,
    full: false,
  }),
  FormField('lastName', 'Prezime', {
    value: values.lastName,
    required: true,
    autocomplete: 'off',
    maxlength: 100,
    full: false,
  }),
  FormField('oib', 'OIB', {
    value: values.oib,
    required: true,
    inputmode: 'numeric',
    maxlength: 11,
    hint: '11 znamenki; provjerava se kontrolna znamenka.',
    full: false,
  }),
  FormField('phone', 'Telefon', {
    type: 'tel',
    value: values.phone,
    required: true,
    autocomplete: 'off',
    maxlength: 25,
    placeholder: '+385 91 234 5678',
    full: false,
  }),
  FormField('email', 'E-mail', {
    type: 'email',
    value: values.email,
    required: true,
    autocomplete: 'off',
    maxlength: 254,
    hint: 'Adresa za prijavu u Renvaru; jedinstvena u organizaciji.',
  }),
];
