// Renvara demo CRM · shared vocabulary and demo configuration.
import { DEMO_CONTENT } from './edition.js';

/**
 * DEVELOPMENT ONLY: prefill the "Novi kupac" form with the test company so
 * the flow can be clicked through quickly. Off in the clean-start edition.
 */
export const DEMO_PREFILL = DEMO_CONTENT;

export const DEMO_CUSTOMER = Object.freeze({
  companyName: 'TVRTKA 1 d.o.o',
  address: 'Ulica 1',
  postalCode: '51000',
  city: 'Rijeka',
  oib: '5874164198',
  email: '',
  phone: '',
  website: '',
  contactName: 'Alen Horvat',
  contactRole: 'Odgovorna osoba',
  contactEmail: '',
  contactPhone: '',
  status: 'active',
  type: 'customer',
  notes: '',
});

export const CUSTOMER_STATUSES = [
  { value: 'active', label: 'Aktivan' },
  { value: 'inactive', label: 'Neaktivan' },
];

export const CUSTOMER_TYPES = [
  { value: 'customer', label: 'Kupac' },
  { value: 'prospect', label: 'Prospect' },
];

/** Pipeline stages, in order. Labels match the dashboard's Opportunity Pipeline rows. */
export const STAGES = [
  { value: 'new', label: 'Nova prilika', short: 'Novi', probability: 10 },
  { value: 'in_progress', label: 'U obradi', short: 'U obradi', probability: 25 },
  { value: 'offer_sent', label: 'Ponuda poslana', short: 'Ponuda poslana', probability: 50 },
  { value: 'negotiation', label: 'Pregovori', short: 'Pregovori', probability: 70 },
  { value: 'closing', label: 'Zatvaranje', short: 'Zatvaranje', probability: 90 },
];

/**
 * Demo opportunities already shown on the approved dashboard (static numbers).
 * Opportunities created in the CRM are added on top of these (server: OpportunityService.pipeline).
 */
export const PIPELINE_BASELINE = Object.freeze({
  new: 42,
  in_progress: 28,
  offer_sent: 18,
  negotiation: 11,
  closing: 6,
});

export const OPPORTUNITY_STATUSES = [
  { value: 'active', label: 'Aktivna' },
  { value: 'won', label: 'Dobivena' },
  { value: 'lost', label: 'Izgubljena' },
];

export const CURRENCIES = [
  { value: 'EUR', label: 'EUR' },
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'CHF', label: 'CHF' },
];

/** Task types (DB enum public.task_type). FOLLOW_UP is a plain type; there is no follow-up engine yet. */
export const TASK_TYPES = [
  { value: 'general', label: 'Općenito', icon: 'check-square' },
  { value: 'call', label: 'Poziv', icon: 'phone' },
  { value: 'email', label: 'E-mail', icon: 'mail' },
  { value: 'meeting', label: 'Sastanak', icon: 'calendar' },
  { value: 'follow_up', label: 'Follow-up', icon: 'repeat' },
  { value: 'send_offer', label: 'Slanje ponude', icon: 'file' },
  { value: 'send_document', label: 'Slanje dokumenta', icon: 'file' },
  { value: 'other', label: 'Ostalo', icon: 'note' },
];

export const TASK_PRIORITIES = [
  { value: 'low', label: 'Nisko' },
  { value: 'normal', label: 'Normalno' },
  { value: 'high', label: 'Visoko' },
];

export const TASK_STATUSES = [
  { value: 'open', label: 'Otvoreno' },
  { value: 'completed', label: 'Dovršeno' },
  { value: 'cancelled', label: 'Otkazano' },
];

/** Lead vocabulary (DB enums public.lead_*). Stage = how far it got; status = how it ended. */
export const LEAD_STAGES = [
  { value: 'new', label: 'Novi lead' },
  { value: 'contacted', label: 'Kontaktiran' },
  { value: 'qualified', label: 'Kvalificiran' },
];

export const LEAD_STATUSES = [
  { value: 'active', label: 'Aktivan' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const LEAD_SOURCES = [
  { value: 'manual', label: 'Ručno' },
  { value: 'referral', label: 'Preporuka' },
  { value: 'web', label: 'Web' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefon' },
  { value: 'event', label: 'Događaj' },
  { value: 'social', label: 'Društvene mreže' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Ostalo' },
];

export const LEAD_LOST_REASONS = [
  { value: 'not_interested', label: 'Nije zainteresiran' },
  { value: 'no_response', label: 'Nema odgovora' },
  { value: 'competitor', label: 'Konkurencija' },
  { value: 'price', label: 'Cijena' },
  { value: 'postponed', label: 'Odgođeno' },
  { value: 'not_a_fit', label: 'Nije odgovarajući kupac' },
  { value: 'duplicate', label: 'Duplikat' },
  { value: 'other', label: 'Ostalo' },
];

/** Activity timeline types → label, icon and colour tone. */
export const ACTIVITY_META = {
  customer_created: { label: 'Kupac kreiran', icon: 'building', tone: 'red' },
  customer_updated: { label: 'Podaci kupca ažurirani', icon: 'pencil', tone: 'neutral' },
  meeting_scheduled: { label: 'Zakazan sastanak', icon: 'calendar', tone: 'green' },
  task_scheduled: { label: 'Dodano u Sales kalendar', icon: 'calendar', tone: 'green' },
  opportunity_created: { label: 'Kreirana prilika', icon: 'target', tone: 'red' },
  task_created: { label: 'Kreiran zadatak', icon: 'check-square', tone: 'neutral' },
  task_completed: { label: 'Zadatak dovršen', icon: 'check', tone: 'green' },
  task_reopened: { label: 'Zadatak ponovno otvoren', icon: 'check-square', tone: 'neutral' },
  task_cancelled: { label: 'Zadatak otkazan', icon: 'x', tone: 'neutral' },
  note_added: { label: 'Dodana bilješka', icon: 'note', tone: 'neutral' },
  contact_added: { label: 'Dodan kontakt', icon: 'user-plus', tone: 'neutral' },
  email_sent: { label: 'Poslan e-mail', icon: 'mail', tone: 'neutral' },
  lead_created: { label: 'Lead kreiran', icon: 'user-search', tone: 'red' },
  lead_stage_changed: { label: 'Faza leada promijenjena', icon: 'pencil', tone: 'neutral' },
  lead_converted: { label: 'Lead pretvoren u kupca', icon: 'check', tone: 'green' },
  lead_lost: { label: 'Lead izgubljen', icon: 'x', tone: 'neutral' },
  phone_call: { label: 'Telefonski poziv', icon: 'phone', tone: 'neutral' },
};

export const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? value;
