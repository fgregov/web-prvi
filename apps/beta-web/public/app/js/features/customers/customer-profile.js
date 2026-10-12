// CustomerProfile: composes the header card and the five accordion sections.
// Creating meetings, opportunities, tasks and contacts opens their dedicated
// screens with this customer preselected; they return here after saving.
import { api, ApiError } from '../../core/api.js';
import { confirmDialog } from '../../ui/confirm.js';
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
import { opportunityActions } from './profile/opportunity-actions.js';
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
  /** Deactivate / reactivate: one request at a time, then the reloaded profile. */
  let changing = false;
  async function setActive(call, done, failed) {
    if (changing) return;
    changing = true;
    try {
      await call(profile.id);
    } catch {
      changing = false;
      showToast(failed);
      return;
    }
    showToast(done);
    await reload();
    changing = false;
  }
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
    deactivate: async () => {
      const confirmed = await confirmDialog({
        title: 'Deaktivirati kupca?',
        message:
          'Kupac će biti premješten među neaktivne kupce. Svi postojeći podaci, kontakti, zadaci, ponude i prodajne prilike ostat će sačuvani.',
        cancelLabel: 'Odustani',
        confirmLabel: 'Deaktiviraj',
      });
      if (!confirmed) return;
      await setActive(
        api.deactivateCustomer,
        'Kupac je deaktiviran.',
        'Nije moguće deaktivirati kupca. Pokušajte ponovno.',
      );
    },
    activate: () =>
      setActive(
        api.activateCustomer,
        'Kupac je ponovno aktiviran.',
        'Nije moguće aktivirati kupca. Pokušajte ponovno.',
      ),
    deal: opportunityActions(async (message) => {
      showToast(message);
      await reload();
    }),
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

/**
 * Header card, then PREGLED, PRILIKE, AKTIVNOSTI, ZADACI and KONTAKTI as
 * accordions. `openSections` is the page's set of open accordions (empty on a
 * new visit), kept by the page so a refresh after an action keeps them open.
 */
export function customerProfile(profile, actions, openSections = new Set()) {
  return h(
    'div',
    { class: 'rv-profile' },
    customerHeader(profile, actions),
    h(
      'div',
      { class: 'rv-profile-sections' },
      customerOverview(profile, actions, openSections),
      customerOpportunities(profile, actions, openSections),
      customerActivities(profile, openSections),
      customerTasks(profile, actions, openSections),
      customerContacts(profile, openSections),
    ),
  );
}
