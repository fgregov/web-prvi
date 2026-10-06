// "+" Quick Create menu actions (dashboard and other pages).
import { crm } from '../../core/crm.js';
import { setFlash, showToast } from '../../ui/toast.js';
import { openContactForm } from '../contacts/contact-form.js';
import { openMeetingForm } from '../meetings/meeting-form.js';
import { openNoteForm } from '../notes/note-form.js';
import { openOpportunityForm } from '../opportunities/opportunity-form.js';
import { openTaskForm } from '../tasks/task-form.js';

export function goToCustomer(customerId, message) {
  if (message) setFlash(message);
  window.location.assign(`/customers/${encodeURIComponent(customerId)}`);
}

const needsCustomer = () => {
  if (crm.listCustomers().length > 0) return false;
  showToast('Najprije kreirajte kupca.');
  return true;
};

const ACTIONS = {
  // Dedicated route-level screen (navigation push), not a drawer over the dashboard.
  customer: () => window.location.assign('/customers/new'),
  opportunity: () =>
    needsCustomer() ||
    openOpportunityForm({
      onSaved: (o) => goToCustomer(o.customerId, 'Prilika kreirana i dodana u pipeline.'),
    }),
  meeting: () =>
    needsCustomer() ||
    openMeetingForm({ onSaved: (m) => goToCustomer(m.customerId, 'Sastanak zakazan.') }),
  task: () =>
    needsCustomer() ||
    openTaskForm({ onSaved: (t) => goToCustomer(t.customerId, 'Zadatak kreiran.') }),
  contact: () =>
    needsCustomer() ||
    openContactForm({ onSaved: (c) => goToCustomer(c.customerId, 'Kontakt dodan.') }),
  activity: () =>
    needsCustomer() ||
    openNoteForm({ onSaved: (a) => goToCustomer(a.customerId, 'Bilješka dodana.') }),
};

export function runQuickCreate(action) {
  (ACTIONS[action] ?? (() => showToast('Uskoro.')))();
}
