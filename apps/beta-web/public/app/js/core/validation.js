// Renvara demo CRM · input validation shared by forms (UI) and the store (data integrity).

const REQUIRED = 'Obavezno polje.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Returns { field: message } for every invalid field; empty object when valid. */
export function validateCustomer(input, { existing = [], currentId = null } = {}) {
  const errors = {};
  if (!text(input.companyName)) errors.companyName = REQUIRED;
  else if (text(input.companyName).length > 200) errors.companyName = 'Najviše 200 znakova.';

  const oib = text(input.oib);
  if (!oib) errors.oib = REQUIRED;
  else if (!/^\d+$/.test(oib)) errors.oib = 'OIB smije sadržavati samo znamenke.';
  else if (oib.length > 11) errors.oib = 'OIB ima najviše 11 znamenki.';
  else if (existing.some((c) => c.oib === oib && c.id !== currentId)) {
    errors.oib = 'Kupac s ovim OIB-om već postoji.';
  }

  if (!text(input.city)) errors.city = REQUIRED;
  if (!text(input.contactName)) errors.contactName = REQUIRED;

  const postal = text(input.postalCode);
  if (postal && !/^\d{5}$/.test(postal)) errors.postalCode = 'Poštanski broj ima 5 znamenki.';
  if (text(input.email) && !EMAIL.test(text(input.email)))
    errors.email = 'Neispravna e-mail adresa.';
  return errors;
}

export function validateMeeting(input) {
  const errors = {};
  if (!text(input.customerId)) errors.customerId = REQUIRED;
  if (!text(input.title)) errors.title = REQUIRED;
  if (!DATE.test(text(input.date))) errors.date = REQUIRED;
  if (!TIME.test(text(input.time))) errors.time = REQUIRED;
  if (!(Number(input.durationMinutes) > 0)) errors.durationMinutes = REQUIRED;
  return errors;
}

export function validateOpportunity(input) {
  const errors = {};
  if (!text(input.customerId)) errors.customerId = REQUIRED;
  if (!text(input.title)) errors.title = REQUIRED;
  const value = text(String(input.value ?? ''));
  if (value && !(Number(value) >= 0)) errors.value = 'Unesite iznos u eurima (npr. 5000).';
  const probability = text(String(input.probability ?? ''));
  if (probability && !(/^\d+$/.test(probability) && Number(probability) <= 100)) {
    errors.probability = 'Unesite broj od 0 do 100.';
  }
  if (text(input.expectedCloseDate) && !DATE.test(text(input.expectedCloseDate))) {
    errors.expectedCloseDate = 'Neispravan datum.';
  }
  return errors;
}

export function validateTask(input) {
  const errors = {};
  if (!text(input.customerId)) errors.customerId = REQUIRED;
  if (!text(input.title)) errors.title = REQUIRED;
  return errors;
}

export function validateContact(input) {
  const errors = {};
  if (!text(input.fullName)) errors.fullName = REQUIRED;
  if (text(input.email) && !EMAIL.test(text(input.email)))
    errors.email = 'Neispravna e-mail adresa.';
  return errors;
}

export function validateNote(input) {
  return text(input.text) ? {} : { text: REQUIRED };
}

export function validateEmail(input) {
  const errors = {};
  if (text(input.to) && !EMAIL.test(text(input.to))) errors.to = 'Neispravna e-mail adresa.';
  if (!text(input.subject)) errors.subject = REQUIRED;
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
