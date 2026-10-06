// CustomerProfile: composes the header, section navigation and all sections.
// Creating meetings, opportunities, tasks and contacts opens their dedicated
// screens with this customer preselected; they return here after saving.
import { api, ApiError } from '../../core/api.js';
import { h } from '../../ui/dom.js';
import { withParams } from '../../ui/navigation.js';
import { showToast } from '../../ui/toast.js';
import { openEmailForm } from '../email/email-form.js';
import { openNoteForm } from '../notes/note-form.js';
import { openCustomerForm } from './customer-form.js';
import { customerActivities } from './profile/customer-activities.js';
import { customerContacts } from './profile/customer-contacts.js';
import { customerHeader } from './profile/customer-header.js';
import { customerOpportunities } from './profile/customer-opportunities.js';
import { customerOverview } from './profile/customer-overview.js';
import { customerTasks } from './profile/customer-tasks.js';

export function customerActions(profile, reload) {
  const here = `/customers/${encodeURIComponent(profile.id)}`;
  const go = (path, params) =>
    window.location.assign(withParams(path, { companyId: profile.id, ...params, returnTo: here }));
  const after = (message) => async () => {
    showToast(message);
    await reload();
  };
  return {
    meeting: () => go('/tasks/new', { type: 'meeting', calendar: '1' }),
    opportunity: () => go('/opportunities/new'),
    task: () => go('/tasks/new'),
    contact: () => go('/contacts/new'),
    nextActionFor: (opportunityId) =>
      withParams('/tasks/new', { opportunityId, type: 'follow_up', returnTo: here }),
    note: () => openNoteForm({ profile, onSaved: after('Bilješka dodana.') }),
    email: () => openEmailForm({ profile, onSaved: after('E-mail zabilježen u aktivnostima.') }),
    edit: () => openCustomerForm({ profile, onSaved: after('Podaci kupca spremljeni.') }),
    toggleTask: async (task) => {
      try {
        if (task.status === 'completed') await api.reopenTask(task.id);
        else await api.completeTask(task.id);
        showToast(
          task.status === 'completed' ? 'Zadatak je ponovno otvoren.' : 'Zadatak je dovršen.',
        );
      } catch (error) {
        showToast(error instanceof ApiError ? error.message : 'Pokušajte ponovno.');
      }
      await reload();
    },
    returnTo: here,
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
      h('div', { class: 'rv-profile-grid__overview' }, customerOverview(profile, actions)),
      h('div', { class: 'rv-profile-grid__opps' }, customerOpportunities(profile, actions)),
      h('div', { class: 'rv-profile-grid__activities' }, customerActivities(profile)),
      h('div', { class: 'rv-profile-grid__tasks' }, customerTasks(profile, actions)),
      h('div', { class: 'rv-profile-grid__contacts' }, customerContacts(profile, actions.contact)),
    ),
  );
}
