// Renvara CRM · input validation shared by the browser forms and the server services
// (apps/beta-web/src/crm). Pure functions, no DOM: the server imports this exact file,
// so a rule enforced in the form is the same rule enforced by the API.
import {
  CURRENCIES,
  OPPORTUNITY_STATUSES,
  STAGES,
  TASK_PRIORITIES,
  TASK_TYPES,
} from './constants.js';

const REQUIRED = 'Obavezno polje.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Messages the product specification fixes word for word. */
export const MESSAGES = Object.freeze({
  taskTitleRequired: 'Unesite naziv zadatka.',
  endBeforeStart: 'Vrijeme završetka ne može biti prije vremena početka.',
  unavailable: 'Odabrani podatak nije dostupan.',
  taskSaveFailed: 'Nije moguće spremiti zadatak. Pokušajte ponovno.',
  customerRequired: 'Odaberite kupca.',
  contactNotOfCustomer: 'Odabrani kontakt ne pripada odabranom kupcu.',
  opportunityNotOfCustomer: 'Odabrana prilika ne pripada odabranom kupcu.',
  missingNextAction: 'Prilika nema definiranu sljedeću akciju.',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const allowed = (list, value) => list.some((item) => item.value === value);
const blank = (value) => value === null || value === undefined || value === '';

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isInstant = (value) =>
  typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value));

/** Optional reference to another record: null/empty, or a well-formed id. */
const badId = (value) => !blank(value) && (typeof value !== 'string' || !ID.test(value));

function maxLength(errors, input, name, limit) {
  if (!errors[name] && text(input[name]).length > limit) errors[name] = `Najviše ${limit} znakova.`;
}

/**
 * Returns { field: message } for every invalid field; empty object when valid.
 * @param {Record<string, unknown>} input
 * @param {{ existing?: Array<{ id: string, oib: string }>, currentId?: string | null }} [options]
 * @returns {Record<string, string>}
 */
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
  if (text(input.contactEmail) && !EMAIL.test(text(input.contactEmail)))
    errors.contactEmail = 'Neispravna e-mail adresa.';
  for (const [name, limit] of [
    ['address', 300],
    ['city', 120],
    ['phone', 50],
    ['website', 300],
    ['contactName', 240],
    ['contactRole', 200],
    ['contactPhone', 50],
    ['notes', 5000],
  ]) {
    maxLength(errors, input, name, limit);
  }
  return errors;
}

/** New contact (always belongs to a customer). */
export function validateContact(input) {
  const errors = {};
  if (blank(input.companyId)) errors.companyId = MESSAGES.customerRequired;
  else if (badId(input.companyId)) errors.companyId = MESSAGES.unavailable;
  if (!text(input.fullName)) errors.fullName = REQUIRED;
  if (text(input.email) && !EMAIL.test(text(input.email)))
    errors.email = 'Neispravna e-mail adresa.';
  for (const [name, limit] of [
    ['fullName', 240],
    ['role', 200],
    ['email', 254],
    ['phone', 50],
    ['notes', 5000],
  ]) {
    maxLength(errors, input, name, limit);
  }
  return errors;
}

/**
 * New opportunity. `nextActionTitle` / `nextActionDueDate` optionally create the
 * first open task in the same request, so the opportunity starts with a next action.
 */
export function validateOpportunity(input) {
  const errors = {};
  if (!text(input.title)) errors.title = REQUIRED;
  maxLength(errors, input, 'title', 300);
  if (blank(input.companyId)) errors.companyId = MESSAGES.customerRequired;
  else if (badId(input.companyId)) errors.companyId = MESSAGES.unavailable;
  if (badId(input.contactId)) errors.contactId = MESSAGES.unavailable;

  const value = text(String(input.value ?? ''));
  if (value && !(/^\d+([.,]\d{1,2})?$/.test(value) && Number(value.replace(',', '.')) >= 0)) {
    errors.value = 'Unesite iznos (npr. 5000 ili 5000,50).';
  }
  if (!blank(input.currency) && !allowed(CURRENCIES, input.currency))
    errors.currency = 'Odaberite valutu.';
  if (!blank(input.stage) && !allowed(STAGES, input.stage)) errors.stage = 'Odaberite fazu.';
  if (!blank(input.status) && !allowed(OPPORTUNITY_STATUSES, input.status))
    errors.status = 'Odaberite status.';
  if (!blank(input.expectedCloseDate) && !isCalendarDate(input.expectedCloseDate)) {
    errors.expectedCloseDate = 'Neispravan datum.';
  }
  maxLength(errors, input, 'notes', 5000);

  if (!blank(input.nextActionDueDate)) {
    if (!isCalendarDate(input.nextActionDueDate)) errors.nextActionDueDate = 'Neispravan datum.';
    else if (!text(input.nextActionTitle))
      errors.nextActionTitle = 'Unesite naziv sljedeće akcije.';
  }
  maxLength(errors, input, 'nextActionTitle', 300);
  return errors;
}

/**
 * Task in API (wire) format. Instants are UTC ISO strings; dates are YYYY-MM-DD.
 *   scheduledStartAt / scheduledEndAt / allDay → the Sales Calendar ("Zakazano")
 *   dueDate xor dueAt                          → the deadline ("Rok")
 */
export function validateTask(input) {
  const errors = {};
  if (!text(input.title)) errors.title = MESSAGES.taskTitleRequired;
  maxLength(errors, input, 'title', 300);
  maxLength(errors, input, 'description', 5000);
  maxLength(errors, input, 'location', 300);
  if (!blank(input.type) && !allowed(TASK_TYPES, input.type))
    errors.type = 'Odaberite vrstu zadatka.';
  if (!blank(input.priority) && !allowed(TASK_PRIORITIES, input.priority))
    errors.priority = 'Odaberite prioritet.';

  for (const name of ['companyId', 'contactId', 'opportunityId']) {
    if (badId(input[name])) errors[name] = MESSAGES.unavailable;
  }

  // Calendar: a date only (allDay + scheduledDate, interpreted in the organization's
  // timezone), or a start instant with an optional end instant.
  const start = input.scheduledStartAt;
  const end = input.scheduledEndAt;
  if (input.allDay === true) {
    if (!isCalendarDate(input.scheduledDate)) errors.scheduledStartAt = 'Odaberite datum.';
    if (!blank(end)) errors.scheduledEndAt = 'Bez vremena početka nema vremena završetka.';
  } else {
    if (!blank(start) && !isInstant(start))
      errors.scheduledStartAt = 'Neispravan datum ili vrijeme.';
    if (!blank(end)) {
      if (!isInstant(end)) errors.scheduledEndAt = 'Neispravno vrijeme završetka.';
      else if (blank(start)) errors.scheduledStartAt = 'Unesite vrijeme početka.';
      else if (!errors.scheduledStartAt && Date.parse(end) < Date.parse(start))
        errors.scheduledEndAt = MESSAGES.endBeforeStart;
    }
  }

  if (!blank(input.dueDate) && !blank(input.dueAt)) {
    errors.dueDate = 'Rok je datum ili točno vrijeme, ne oboje.';
  } else if (!blank(input.dueDate) && !isCalendarDate(input.dueDate)) {
    errors.dueDate = 'Neispravan datum.';
  } else if (!blank(input.dueAt) && !isInstant(input.dueAt)) {
    errors.dueDate = 'Neispravan datum ili vrijeme.';
  }
  return errors;
}

export function validateNote(input) {
  const errors = text(input.text) ? {} : { text: REQUIRED };
  maxLength(errors, input, 'text', 5000);
  return errors;
}

export function validateEmail(input) {
  const errors = {};
  if (text(input.to) && !EMAIL.test(text(input.to))) errors.to = 'Neispravna e-mail adresa.';
  if (!text(input.subject)) errors.subject = REQUIRED;
  maxLength(errors, input, 'subject', 300);
  maxLength(errors, input, 'body', 10000);
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
