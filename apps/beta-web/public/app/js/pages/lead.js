// /sales/leads/{id} · Lead detail: who, how far it got (stage), how it ended
// (status), its opportunities, tasks and history.
//
// Lead-first (ADR-0009): "Kreiraj priliku" opens a deal of this lead — no
// customer needed. A won deal makes the lead WON; converting it into a
// customer is offered then ("Prilika je osvojena!") and stays available here
// as PRETVORI U KUPCA ("Čeka pretvaranje u kupca") until it is done. Lost
// leads stay as history with their reason.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { ACTIVITY_META, labelOf, LEAD_LOST_REASONS, LEAD_STAGES } from '../core/constants.js';
import { formatDateTime } from '../core/format.js';
import { MESSAGES } from '../core/validation.js';
import {
  leadConversionBadge,
  leadSource,
  leadStageBadge,
  leadStatusBadge,
  leadValue,
} from '../features/leads/lead-view.js';
import { opportunityCard } from '../features/customers/profile/customer-opportunities.js';
import { opportunityActions } from '../features/customers/profile/opportunity-actions.js';
import { conversionHref, linkToLeadCustomer } from '../features/leads/won-conversion.js';
import { activeReminder, reminderLabel } from '../features/reminders/reminder-control.js';
import { openReminderSheet } from '../features/reminders/reminder-sheet.js';
import { taskRow } from '../features/tasks/task-row.js';
import { h, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack, here, withParams } from '../ui/navigation.js';
import { MobilePageHeader } from '../ui/screen.js';
import { openSheet } from '../ui/sheet.js';
import { consumeFlash, showToast } from '../ui/toast.js';

const leadId = decodeURIComponent(window.location.pathname.split('/')[3] ?? '');
const root = document.getElementById('screen');
const header = MobilePageHeader({ title: 'Lead', onBack: () => goBack('/sales/leads') });
const body = h('main', { class: 'rv-screen__body' });
root.replaceChildren(header.element, body);

const enc = encodeURIComponent;
const row = (label, value) =>
  value ? h('div', { class: 'rv-dl__row' }, h('dt', {}, label), h('dd', {}, value)) : null;
const convertHref = (lead, params = {}) => conversionHref(lead.id, { ...params, returnTo: here() });
const newDealHref = (lead) =>
  withParams('/sales/opportunities/new', { leadId: lead.id, returnTo: here() });

/** Stage of an active lead, changed in place (Novi lead → Kontaktiran → Kvalificiran). */
function stagePicker(lead) {
  const name = uid('stage');
  return h(
    'div',
    { class: 'lead-detail__stage' },
    h('span', { class: 'rv-field__label', id: `${name}-label` }, 'Faza'),
    h(
      'div',
      { class: 'rv-segmented', role: 'radiogroup', 'aria-labelledby': `${name}-label` },
      LEAD_STAGES.map((option) =>
        h(
          'label',
          { class: 'rv-segmented__option' },
          h('input', {
            type: 'radio',
            name,
            value: option.value,
            checked: option.value === lead.stage,
            onChange: async () => {
              try {
                await api.updateLead(lead.id, { stage: option.value });
                showToast(`Faza: ${option.label}.`);
              } catch (error) {
                showToast(error instanceof ApiError ? error.message : MESSAGES.leadSaveFailed);
              }
              await load();
            },
          }),
          h('span', {}, option.label),
        ),
      ),
    ),
  );
}

/** How the lead ended: WON (and its conversion into a customer) or LOST. */
function outcome(lead) {
  if (lead.status === 'won') {
    const firstWin = (lead.opportunities ?? [])
      .filter((o) => o.status === 'won')
      .sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''))[0];
    return h(
      'section',
      { class: 'lead-outcome lead-outcome--won', 'aria-label': 'Osvojen' },
      h(
        'p',
        { class: 'lead-outcome__title' },
        icon('check', 'rv-icon rv-icon--sm'),
        lead.wonBasis === 'conversion'
          ? `Osvojen · ${formatDateTime(lead.wonAt ?? lead.convertedAt)}`
          : `Osvojen · ${formatDateTime(lead.wonAt)}`,
      ),
      h(
        'dl',
        { class: 'rv-dl' },
        row(
          'Osvojena prilika',
          firstWin
            ? firstWin.title
            : lead.wonBasis === 'conversion'
              ? 'Zabilježen pretvaranjem u kupca'
              : null,
        ),
        row(
          'Kupac',
          lead.conversionPending
            ? 'Čeka pretvaranje u kupca'
            : lead.convertedCustomerId && lead.convertedCustomerName
              ? h(
                  'a',
                  { href: `/sales/customers/${enc(lead.convertedCustomerId)}` },
                  lead.convertedCustomerName,
                )
              : 'Kupac više nije dostupan',
        ),
        row('Pretvoren u kupca', lead.convertedAt ? formatDateTime(lead.convertedAt) : null),
        row('Kontakt', lead.convertedContactName),
      ),
    );
  }
  if (lead.status === 'lost') {
    return h(
      'section',
      { class: 'lead-outcome lead-outcome--lost', 'aria-label': 'Izgubljen' },
      h(
        'p',
        { class: 'lead-outcome__title' },
        icon('circle-x', 'rv-icon rv-icon--sm'),
        `Izgubljen · ${formatDateTime(lead.lostAt)}`,
      ),
      h(
        'dl',
        { class: 'rv-dl' },
        row(
          'Razlog',
          lead.lostReason ? labelOf(LEAD_LOST_REASONS, lead.lostReason) : 'Nije naveden',
        ),
        row('Bilješka', lead.lostNote),
      ),
    );
  }
  return null;
}

/** WON without a customer: the conversion waits here until it is done. */
function conversionPending(lead) {
  if (!lead.conversionPending) return null;
  return h(
    'section',
    { class: 'rv-card lead-convert-pending', 'aria-labelledby': 'lead-convert-title' },
    h(
      'p',
      { class: 'lead-convert-pending__title', id: 'lead-convert-title' },
      icon('user-check', 'rv-icon rv-icon--sm'),
      'Čeka pretvaranje u kupca',
    ),
    h(
      'p',
      { class: 'lead-convert-pending__text' },
      'Lead je osvojen. Kada želite, pretvorite ga u novog kupca ili ga povežite s postojećim. Lead i njegove prilike ostaju sačuvani.',
    ),
    h('a', { class: 'rv-btn rv-btn--primary', href: convertHref(lead) }, 'Pretvori u kupca'),
  );
}

function actions(lead) {
  const taskHref = withParams('/sales/tasks/new', {
    leadId: lead.id,
    companyId: lead.status === 'won' ? lead.convertedCustomerId : null,
    type: 'follow_up',
    returnTo: here(),
  });
  if (lead.status === 'lost') return null;
  if (lead.status === 'won') {
    return h(
      'div',
      { class: 'rv-screen__actions rv-screen__actions--stack' },
      lead.convertedCustomerId
        ? h(
            'a',
            {
              class: 'rv-btn rv-btn--primary',
              href: `/sales/customers/${enc(lead.convertedCustomerId)}`,
            },
            'Otvori kupca',
          )
        : null,
      h(
        'a',
        {
          class: 'rv-btn rv-btn--secondary',
          // A converted lead's next deals are its customer's (Path B); before that, the lead's.
          href: lead.convertedCustomerId
            ? withParams('/sales/opportunities/new', {
                companyId: lead.convertedCustomerId,
                contactId: lead.convertedContactId,
                returnTo: here(),
              })
            : newDealHref(lead),
        },
        'Kreiraj priliku',
      ),
      h('a', { class: 'rv-btn rv-btn--secondary', href: taskHref }, 'Dodaj zadatak'),
    );
  }

  const lost = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--ghost' },
    'Označi kao izgubljen',
  );
  lost.addEventListener('click', () => lostSheet(lead));
  const reminder = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--secondary' },
    activeReminder(lead.reminder) ? 'Promijeni podsjetnik' : 'Postavi podsjetnik',
  );
  reminder.addEventListener('click', () =>
    openReminderSheet({
      title: 'Podsjetnik za lead',
      reminder: lead.reminder,
      save: async (reminderAt) => {
        await api.setReminder('leads', lead.id, reminderAt);
        showToast(reminderAt ? 'Podsjetnik je spremljen.' : 'Podsjetnik je uklonjen.');
        await load();
      },
    }),
  );
  return h(
    'div',
    { class: 'rv-screen__actions rv-screen__actions--stack' },
    h('a', { class: 'rv-btn rv-btn--primary', href: newDealHref(lead) }, 'Kreiraj priliku'),
    h('a', { class: 'rv-btn rv-btn--secondary', href: taskHref }, 'Dodaj zadatak'),
    reminder,
    lost,
  );
}

/** The lead's deals (no customer needed), each with its own status and actions. */
function opportunitiesSection(lead) {
  const deals = lead.opportunities ?? [];
  const cardActions = {
    nextActionFor: (opportunityId) =>
      withParams('/sales/tasks/new', {
        opportunityId,
        leadId: lead.id,
        type: 'follow_up',
        returnTo: here(),
      }),
    deal: opportunityActions(
      async (message) => {
        showToast(message);
        await load();
      },
      { returnTo: here() },
    ),
    linkCustomer: async (o) => {
      if (await linkToLeadCustomer(o)) {
        showToast(`Prilika je povezana s kupcem ${o.leadCustomerName}.`);
        await load();
      }
    },
  };
  const active = deals.filter((o) => o.status === 'active').length;
  return h(
    'section',
    { class: 'rv-card lead-section', id: 'prilike', 'aria-labelledby': 'lead-deals' },
    h(
      'h2',
      { class: 'lead-section__title', id: 'lead-deals' },
      'Prilike',
      h('span', { class: 'lead-section__count' }, `${active} aktivnih`),
    ),
    deals.length
      ? h(
          'ul',
          { class: 'rv-opps', role: 'list' },
          deals.map((o) => opportunityCard(o, cardActions, { customer: true, link: true })),
        )
      : h(
          'p',
          { class: 'lead-section__empty' },
          lead.status === 'lost'
            ? 'Lead nema prilika.'
            : 'Nema prilika. Kreirajte priliku za ovaj lead — kupac nije potreban.',
        ),
  );
}

/** Confirmation sheet with an optional reason and note. */
function lostSheet(lead) {
  const name = uid('reason');
  const reasons = h(
    'div',
    { class: 'lead-reasons', role: 'radiogroup', 'aria-label': 'Razlog' },
    [{ value: '', label: 'Bez navedenog razloga' }, ...LEAD_LOST_REASONS].map((option) =>
      h(
        'label',
        { class: 'lead-reasons__option' },
        h('input', { type: 'radio', name, value: option.value, checked: option.value === '' }),
        h('span', {}, option.label),
      ),
    ),
  );
  const note = h('textarea', {
    class: 'rv-input',
    rows: 2,
    maxlength: 1000,
    placeholder: 'Bilješka (neobavezno)',
    'aria-label': 'Bilješka',
  });
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Otkaži');
  const confirm = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--primary' },
    'Označi kao izgubljen',
  );
  const sheet = openSheet({
    title: 'Označiti lead kao izgubljen?',
    className: 'rv-sheet--lead-lost',
    content: h(
      'div',
      { class: 'rv-sheet__body' },
      h(
        'p',
        { class: 'lead-sheet__text' },
        'Lead ostaje u povijesti i broji se kao izgubljen u periodu u kojem ga zatvorite.',
      ),
      h('div', { class: 'rv-sheet__scroll' }, reasons),
      note,
      error,
      h('div', { class: 'lead-sheet__actions' }, cancel, confirm),
    ),
  });
  cancel.addEventListener('click', () => sheet.close());
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      const reason = reasons.querySelector('input:checked')?.value || null;
      await api.markLeadLost(lead.id, { reason, note: note.value });
      sheet.close();
      showToast('Lead je označen kao izgubljen.');
      await load();
    } catch (failure) {
      error.textContent = failure instanceof ApiError ? failure.message : MESSAGES.leadSaveFailed;
      error.hidden = false;
      confirm.disabled = false;
      cancel.disabled = false;
    }
  });
}

function tasksSection(lead) {
  const open = lead.tasks.filter((t) => t.status === 'open').length;
  return h(
    'section',
    { class: 'rv-card lead-section', 'aria-labelledby': 'lead-tasks' },
    h(
      'h2',
      { class: 'lead-section__title', id: 'lead-tasks' },
      'Zadaci',
      h('span', { class: 'lead-section__count' }, `${open} otvorenih`),
    ),
    lead.tasks.length
      ? h(
          'ul',
          { class: 'rv-tasks', role: 'list' },
          lead.tasks.map((task) =>
            taskRow(task, {
              withCustomer: false,
              returnTo: here(),
              onToggle: async (t) => {
                try {
                  if (t.status === 'completed') await api.reopenTask(t.id);
                  else await api.completeTask(t.id);
                  showToast(
                    t.status === 'completed'
                      ? 'Zadatak je ponovno otvoren.'
                      : 'Zadatak je dovršen.',
                  );
                } catch (error) {
                  showToast(error instanceof ApiError ? error.message : MESSAGES.taskSaveFailed);
                }
                await load();
              },
            }),
          ),
        )
      : h(
          'p',
          { class: 'lead-section__empty' },
          'Nema zadataka. Dodajte follow-up kako lead ne bi čekao.',
        ),
  );
}

function historySection(lead) {
  return h(
    'section',
    { class: 'rv-card lead-section', 'aria-labelledby': 'lead-history' },
    h('h2', { class: 'lead-section__title', id: 'lead-history' }, 'Povijest'),
    h(
      'ol',
      { class: 'rv-timeline', 'aria-label': 'Povijest leada, najnovije prvo' },
      lead.activities.map((activity) => {
        const meta = ACTIVITY_META[activity.type] ?? { icon: 'info', tone: 'neutral' };
        return h(
          'li',
          { class: 'rv-timeline__item' },
          h(
            'span',
            { class: `rv-timeline__icon rv-timeline__icon--${meta.tone}` },
            icon(meta.icon),
          ),
          h(
            'div',
            { class: 'rv-timeline__body' },
            h('p', { class: 'rv-timeline__title' }, activity.title),
            activity.description
              ? h('p', { class: 'rv-timeline__desc' }, activity.description)
              : null,
            h(
              'p',
              { class: 'rv-timeline__time' },
              h('time', { datetime: activity.occurredAt }, formatDateTime(activity.occurredAt)),
              activity.actorName ? ` · ${activity.actorName}` : '',
            ),
          ),
        );
      }),
    ),
  );
}

function render(lead) {
  document.title = `Renvara · ${lead.name}`;
  const value = leadValue(lead);
  // replaceChildren() would print a missing section (null) as the text "null".
  const sections = [
    h(
      'article',
      { class: 'rv-card rv-task-detail lead-detail', dataset: { status: lead.status } },
      h(
        'div',
        { class: 'rv-task-detail__badges' },
        leadStatusBadge(lead),
        leadStageBadge(lead),
        leadConversionBadge(lead),
      ),
      h('h2', { class: 'rv-task-detail__title' }, lead.name),
      lead.companyName ? h('p', { class: 'lead-detail__company' }, lead.companyName) : null,
      lead.status === 'active' ? stagePicker(lead) : null,
      h(
        'dl',
        { class: 'rv-dl' },
        row('Funkcija', lead.jobTitle),
        row('E-mail', lead.email ? h('a', { href: `mailto:${lead.email}` }, lead.email) : null),
        row(
          'Telefon',
          lead.phone ? h('a', { href: `tel:${lead.phone.replace(/\s+/g, '')}` }, lead.phone) : null,
        ),
        row('Izvor', leadSource(lead)),
        row('Procjena vrijednosti', value),
        row('Kreirano', formatDateTime(lead.createdAt)),
        row('Vlasnik', lead.ownerName),
        row('Prospect od', lead.qualifiedAt ? formatDateTime(lead.qualifiedAt) : null),
        row('Podsjetnik', reminderLabel(lead.reminder)),
        row('Bilješka', lead.notes),
      ),
      outcome(lead),
    ),
    conversionPending(lead),
    actions(lead),
    opportunitiesSection(lead),
    tasksSection(lead),
    historySection(lead),
  ];
  body.replaceChildren(...sections.filter(Boolean));
}

async function load() {
  try {
    render(await api.getLead(leadId));
  } catch (error) {
    body.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page' },
        h('h2', {}, error instanceof ApiError ? error.message : MESSAGES.unavailable),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/sales/leads' }, 'Svi leadovi'),
      ),
    );
  }
}

onDataChanged(load);
await load();
consumeFlash();
