// CustomerProfile: composes the header, section navigation and all sections.
import { crm } from '../../core/crm.js';
import { getCurrentUser } from '../../core/session.js';
import { h } from '../../ui/dom.js';
import { showToast } from '../../ui/toast.js';
import { openContactForm } from '../contacts/contact-form.js';
import { openEmailForm } from '../email/email-form.js';
import { openMeetingForm } from '../meetings/meeting-form.js';
import { openNoteForm } from '../notes/note-form.js';
import { openOpportunityForm } from '../opportunities/opportunity-form.js';
import { openTaskForm } from '../tasks/task-form.js';
import { openCustomerForm } from './customer-form.js';
import { customerActivities } from './profile/customer-activities.js';
import { customerContacts } from './profile/customer-contacts.js';
import { customerHeader } from './profile/customer-header.js';
import { customerOpportunities } from './profile/customer-opportunities.js';
import { customerOverview } from './profile/customer-overview.js';
import { customerTasks } from './profile/customer-tasks.js';

export function customerActions(customerId) {
  const toast = (message) => () => showToast(message);
  return {
    meeting: () =>
      openMeetingForm({ customerId, onSaved: toast('Sastanak zakazan i dodan u Sales kalendar.') }),
    opportunity: () =>
      openOpportunityForm({ customerId, onSaved: toast('Prilika kreirana i dodana u pipeline.') }),
    task: () => openTaskForm({ customerId, onSaved: toast('Zadatak kreiran.') }),
    note: () => openNoteForm({ customerId, onSaved: toast('Bilješka dodana.') }),
    contact: () => openContactForm({ customerId, onSaved: toast('Kontakt dodan.') }),
    email: () => openEmailForm({ customerId, onSaved: toast('E-mail zabilježen u aktivnostima.') }),
    edit: () => openCustomerForm({ customerId, onSaved: toast('Podaci kupca spremljeni.') }),
    toggleTask: async (taskId) => crm.toggleTask(taskId, await getCurrentUser()),
  };
}

export function customerProfile(profile, actions) {
  const open = profile.tasks.filter((t) => t.status === 'open').length;
  const nav = [
    ['pregled', 'Pregled'],
    ['prilike', `Prilike (${profile.opportunities.length})`],
    ['aktivnosti', `Aktivnosti (${profile.activities.length})`],
    ['zadaci', `Zadaci (${open})`],
    ['kontakti', `Kontakti (${profile.contacts.length})`],
  ];
  return h(
    'div',
    { class: 'rv-profile' },
    customerHeader(profile, actions),
    h(
      'nav',
      { class: 'rv-section-nav', 'aria-label': 'Sekcije kupca' },
      nav.map(([id, label]) => h('a', { href: `#${id}` }, label)),
    ),
    h(
      'div',
      { class: 'rv-profile-grid' },
      h('div', { class: 'rv-profile-grid__overview' }, customerOverview(profile)),
      h(
        'div',
        { class: 'rv-profile-grid__opps' },
        customerOpportunities(profile, actions.opportunity),
      ),
      h('div', { class: 'rv-profile-grid__activities' }, customerActivities(profile)),
      h(
        'div',
        { class: 'rv-profile-grid__tasks' },
        customerTasks(profile, { onCreate: actions.task, onToggle: actions.toggleTask }),
      ),
      h('div', { class: 'rv-profile-grid__contacts' }, customerContacts(profile, actions.contact)),
    ),
  );
}
