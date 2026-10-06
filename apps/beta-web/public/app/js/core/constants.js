// Renvara demo CRM · shared vocabulary and demo configuration.

/** localStorage key for the demo CRM database (one JSON document). */
export const STORAGE_KEY = 'renvara.crm.v1';

/**
 * DEVELOPMENT ONLY: prefill the "Novi kupac" form with the test company so
 * the flow can be clicked through quickly. Set to false to remove the prefill.
 */
export const DEMO_PREFILL = true;

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
 * New opportunities are added on top of these so every screen shows the same totals.
 */
export const PIPELINE_BASELINE = Object.freeze({
  new: 42,
  in_progress: 28,
  offer_sent: 18,
  negotiation: 11,
  closing: 6,
});

export const MEETING_DURATIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 h' },
  { value: '90', label: '1 h 30 min' },
  { value: '120', label: '2 h' },
];

export const MEETING_MODES = [
  { value: 'in_person', label: 'Uživo' },
  { value: 'online', label: 'Online' },
];

export const TASK_PRIORITIES = [
  { value: 'low', label: 'Nizak' },
  { value: 'normal', label: 'Normalan' },
  { value: 'high', label: 'Visok' },
];

/** Activity timeline types → label, icon and colour tone. */
export const ACTIVITY_META = {
  customer_created: { label: 'Kupac kreiran', icon: 'building', tone: 'red' },
  customer_updated: { label: 'Podaci kupca ažurirani', icon: 'pencil', tone: 'neutral' },
  meeting_scheduled: { label: 'Zakazan sastanak', icon: 'calendar', tone: 'green' },
  opportunity_created: { label: 'Kreirana prilika', icon: 'target', tone: 'red' },
  task_created: { label: 'Kreiran zadatak', icon: 'check-square', tone: 'neutral' },
  task_completed: { label: 'Zadatak završen', icon: 'check', tone: 'green' },
  note_added: { label: 'Dodana bilješka', icon: 'note', tone: 'neutral' },
  contact_added: { label: 'Dodan kontakt', icon: 'user-plus', tone: 'neutral' },
  email_sent: { label: 'Poslan e-mail', icon: 'mail', tone: 'neutral' },
  phone_call: { label: 'Telefonski poziv', icon: 'phone', tone: 'neutral' },
};

export const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? value;

/** Today's static demo events from the dashboard's "Danas" card, shown in the Sales kalendar too. */
export const DEMO_TODAY_EVENTS = [
  { time: '09:00', title: 'Sastanak s Adria Tech', subtitle: 'Demo proizvoda' },
  { time: '11:00', title: 'Poziv – Marko Horvat (Initium)', subtitle: 'Praćenje ponude' },
  { time: '14:00', title: 'Sastanak s Nova d.o.o.', subtitle: 'Pregled potreba' },
  { time: '16:00', title: 'Interni sync', subtitle: 'Tjedni pregled' },
];
