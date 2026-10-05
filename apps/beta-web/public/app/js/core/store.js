// Renvara demo CRM · data layer.
//
// One JSON document in localStorage, organised like the Supabase schema in
// supabase/migrations (customers ≈ companies, contacts, opportunities,
// meetings, tasks, activities), with every record linked by customerId.
// Pages read assembled view models (getProfile) and never touch storage directly.

import { ACTIVITY_META, labelOf, STAGES, STORAGE_KEY, PIPELINE_BASELINE } from './constants.js';
import { formatDateTime, formatMoney } from './format.js';
import {
  hasErrors,
  validateContact,
  validateCustomer,
  validateEmail,
  validateMeeting,
  validateNote,
  validateOpportunity,
  validateTask,
} from './validation.js';

const SCHEMA_VERSION = 1;
const empty = () => ({
  version: SCHEMA_VERSION,
  seq: 0,
  customers: [],
  contacts: [],
  opportunities: [],
  meetings: [],
  tasks: [],
  activities: [],
});

export class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function splitName(fullName) {
  const parts = clean(fullName).split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export const contactName = (contact) =>
  [contact.firstName, contact.lastName].filter(Boolean).join(' ');

/**
 * @param {{
 *   storage?: { getItem(key: string): string | null, setItem(key: string, value: string): void } | null,
 *   now?: () => Date,
 *   uuid?: () => string,
 *   key?: string,
 * }} [options]
 */
export function createCrmStore({
  storage,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
  key = STORAGE_KEY,
} = {}) {
  let data = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return empty();
      const parsed = JSON.parse(raw);
      return parsed?.version === SCHEMA_VERSION ? { ...empty(), ...parsed } : empty();
    } catch {
      return empty();
    }
  }

  function commit() {
    try {
      storage?.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or blocked: the data stays in memory for this page.
    }
    listeners.forEach((listener) => listener());
  }

  const stamp = () => now().toISOString();
  const nextSeq = () => (data.seq += 1);

  function requireCustomer(customerId) {
    const customer = data.customers.find((c) => c.id === customerId);
    if (!customer) throw new ValidationError({ customerId: 'Kupac ne postoji.' });
    return customer;
  }

  function touch(customer) {
    customer.updatedAt = stamp();
  }

  function addActivity(customerId, type, description, actor, relatedId = null) {
    const activity = {
      id: uuid(),
      customerId,
      type,
      title: ACTIVITY_META[type]?.label ?? type,
      description,
      relatedId,
      actorId: actor?.id ?? null,
      actorName: actor?.displayName ?? null,
      occurredAt: stamp(),
      seq: nextSeq(),
    };
    data.activities.push(activity);
    return activity;
  }

  const byNewest = (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.seq - a.seq;

  return {
    // ------------------------------------------------------------- reads ---
    listCustomers() {
      return clone([...data.customers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },

    getCustomer(id) {
      return clone(data.customers.find((c) => c.id === id) ?? null);
    },

    /** Customer with its related records nested, ready to render. */
    getProfile(id) {
      const customer = data.customers.find((c) => c.id === id);
      if (!customer) return null;
      const contacts = data.contacts.filter((c) => c.customerId === id);
      return clone({
        ...customer,
        primaryContact:
          contacts.find((c) => c.id === customer.primaryContactId) ?? contacts[0] ?? null,
        contacts,
        opportunities: data.opportunities
          .filter((o) => o.customerId === id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        meetings: data.meetings
          .filter((m) => m.customerId === id)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
        tasks: data.tasks
          .filter((t) => t.customerId === id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        activities: data.activities.filter((a) => a.customerId === id).sort(byNewest),
      });
    },

    listOpportunities() {
      return clone(
        data.opportunities
          .map((o) => ({
            ...o,
            customerName: data.customers.find((c) => c.id === o.customerId)?.companyName ?? '',
          }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },

    listMeetings() {
      return clone(
        data.meetings
          .map((m) => ({
            ...m,
            customerName: data.customers.find((c) => c.id === m.customerId)?.companyName ?? '',
          }))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },

    /** Dashboard demo totals plus every open opportunity created in the CRM. */
    pipelineTotals() {
      return STAGES.map((stage) => {
        const created = data.opportunities.filter(
          (o) => o.status === 'open' && o.stage === stage.value,
        ).length;
        return { ...stage, created, total: (PIPELINE_BASELINE[stage.value] ?? 0) + created };
      });
    },

    // ------------------------------------------------------------ writes ---
    createCustomer(input, actor) {
      const errors = validateCustomer(input, { existing: data.customers });
      if (hasErrors(errors)) throw new ValidationError(errors);

      const id = uuid();
      const contactId = uuid();
      const createdAt = stamp();
      const customer = {
        id,
        companyName: clean(input.companyName),
        oib: clean(input.oib),
        address: clean(input.address),
        postalCode: clean(input.postalCode),
        city: clean(input.city),
        website: clean(input.website),
        status: input.status === 'inactive' ? 'inactive' : 'active',
        type: input.type === 'prospect' ? 'prospect' : 'customer',
        ownerId: actor?.id ?? null,
        ownerName: actor?.displayName ?? null,
        notes: clean(input.notes),
        primaryContactId: contactId,
        createdAt,
        updatedAt: createdAt,
      };
      data.customers.push(customer);
      data.contacts.push({
        id: contactId,
        customerId: id,
        ...splitName(input.contactName),
        role: 'Odgovorna osoba',
        phone: clean(input.phone),
        email: clean(input.email),
        isPrimary: true,
        createdAt,
      });
      addActivity(id, 'customer_created', `${customer.companyName} dodana u CRM.`, actor, id);
      commit();
      return clone(customer);
    },

    updateCustomer(id, input, actor) {
      const customer = requireCustomer(id);
      const errors = validateCustomer(input, { existing: data.customers, currentId: id });
      if (hasErrors(errors)) throw new ValidationError(errors);

      Object.assign(customer, {
        companyName: clean(input.companyName),
        oib: clean(input.oib),
        address: clean(input.address),
        postalCode: clean(input.postalCode),
        city: clean(input.city),
        website: clean(input.website),
        status: input.status === 'inactive' ? 'inactive' : 'active',
        type: input.type === 'prospect' ? 'prospect' : 'customer',
        notes: clean(input.notes),
      });
      const primary = data.contacts.find((c) => c.id === customer.primaryContactId);
      if (primary) {
        Object.assign(primary, splitName(input.contactName), {
          phone: clean(input.phone),
          email: clean(input.email),
        });
      }
      touch(customer);
      addActivity(id, 'customer_updated', 'Osnovni podaci kupca su ažurirani.', actor, id);
      commit();
      return clone(customer);
    },

    addContact(customerId, input, actor) {
      const customer = requireCustomer(customerId);
      const errors = validateContact(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const contact = {
        id: uuid(),
        customerId,
        ...splitName(input.fullName),
        role: clean(input.role),
        phone: clean(input.phone),
        email: clean(input.email),
        isPrimary: false,
        createdAt: stamp(),
      };
      data.contacts.push(contact);
      touch(customer);
      addActivity(
        customerId,
        'contact_added',
        [contactName(contact), contact.role].filter(Boolean).join(' · '),
        actor,
        contact.id,
      );
      commit();
      return clone(contact);
    },

    scheduleMeeting(input, actor) {
      const errors = validateMeeting(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const customer = requireCustomer(input.customerId);
      const startsAt = new Date(`${input.date}T${input.time}`).toISOString();
      const meeting = {
        id: uuid(),
        customerId: customer.id,
        contactId: clean(input.contactId) || null,
        title: clean(input.title),
        startsAt,
        durationMinutes: Number(input.durationMinutes),
        mode: input.mode === 'online' ? 'online' : 'in_person',
        location: clean(input.location),
        notes: clean(input.notes),
        ownerId: actor?.id ?? null,
        createdAt: stamp(),
      };
      data.meetings.push(meeting);
      touch(customer);
      addActivity(
        customer.id,
        'meeting_scheduled',
        `${meeting.title} · ${formatDateTime(startsAt, now())}`,
        actor,
        meeting.id,
      );
      commit();
      return clone(meeting);
    },

    createOpportunity(input, actor) {
      const errors = validateOpportunity(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const customer = requireCustomer(input.customerId);
      const stage = STAGES.some((s) => s.value === input.stage) ? input.stage : 'new';
      const value = clean(String(input.value ?? ''));
      const probability = clean(String(input.probability ?? ''));
      const opportunity = {
        id: uuid(),
        customerId: customer.id,
        title: clean(input.title),
        value: value === '' ? null : Number(value),
        currency: 'EUR',
        stage,
        status: 'open',
        probability: probability === '' ? null : Number(probability),
        expectedCloseDate: clean(input.expectedCloseDate) || null,
        ownerId: clean(input.ownerId) || actor?.id || null,
        ownerName: clean(input.ownerName) || actor?.displayName || null,
        notes: clean(input.notes),
        createdAt: stamp(),
      };
      data.opportunities.push(opportunity);
      touch(customer);
      addActivity(
        customer.id,
        'opportunity_created',
        `${opportunity.title} · ${formatMoney(opportunity.value)} · ${labelOf(STAGES, stage)}`,
        actor,
        opportunity.id,
      );
      commit();
      return clone(opportunity);
    },

    createTask(input, actor) {
      const errors = validateTask(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const customer = requireCustomer(input.customerId);
      const task = {
        id: uuid(),
        customerId: customer.id,
        title: clean(input.title),
        dueDate: clean(input.dueDate) || null,
        priority: ['low', 'high'].includes(input.priority) ? input.priority : 'normal',
        notes: clean(input.notes),
        status: 'open',
        assigneeId: actor?.id ?? null,
        createdAt: stamp(),
        completedAt: null,
      };
      data.tasks.push(task);
      touch(customer);
      addActivity(customer.id, 'task_created', task.title, actor, task.id);
      commit();
      return clone(task);
    },

    toggleTask(taskId, actor) {
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) return null;
      const completing = task.status === 'open';
      task.status = completing ? 'completed' : 'open';
      task.completedAt = completing ? stamp() : null;
      if (completing) addActivity(task.customerId, 'task_completed', task.title, actor, task.id);
      commit();
      return clone(task);
    },

    addNote(input, actor) {
      const errors = validateNote(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const customer = requireCustomer(input.customerId);
      touch(customer);
      const activity = addActivity(customer.id, 'note_added', clean(input.text), actor);
      commit();
      return clone(activity);
    },

    /** Demo: records an e-mail in the timeline; nothing is actually sent. */
    logEmail(input, actor) {
      const errors = validateEmail(input);
      if (hasErrors(errors)) throw new ValidationError(errors);
      const customer = requireCustomer(input.customerId);
      touch(customer);
      const description = [clean(input.subject), clean(input.to)].filter(Boolean).join(' · ');
      const activity = addActivity(customer.id, 'email_sent', description, actor);
      commit();
      return clone(activity);
    },

    reset() {
      data = empty();
      commit();
    },

    /** Re-read storage (another tab changed it) and notify listeners. */
    reload() {
      data = load();
      listeners.forEach((listener) => listener());
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
