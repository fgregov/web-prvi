// /tasks/new and /tasks/{id}/edit · New / edit task screen.
//
// A task stands on its own; customer, contact and opportunity are optional
// links. Its date is required; "Dodaj u Sales Kalendar" puts it in the
// calendar on that date (all day, a start time, or a time range), otherwise an
// optional time can go with the date. Context comes from
// the query: ?companyId= ?contactId= ?opportunityId= ?leadId= ?type= ?calendar=1 ?date= ?returnTo=
// A task opened from a lead ("Dodaj zadatak") keeps that lead as its context.
import { api, ApiError } from '../core/api.js';
import { TASK_PRIORITIES, TASK_TYPES } from '../core/constants.js';
import { nextMeetingSlot } from '../core/format.js';
import { hasErrors, MESSAGES } from '../core/validation.js';
import { CustomerPicker } from '../features/pickers/customer-picker.js';
import { ReminderControl } from '../features/reminders/reminder-control.js';
import { ContactPicker, OpportunityPicker } from '../features/pickers/related-picker.js';
import {
  formValuesFromTask,
  mapTaskErrors,
  taskInputFromForm,
} from '../features/tasks/task-input.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  CustomField,
  DatePickerField,
  FormField,
  SegmentedField,
  SelectField,
  SwitchField,
  TextAreaField,
  TimePickerField,
} from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { leaveTo, returnTarget } from '../ui/navigation.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const params = new URLSearchParams(window.location.search);
const editId = /^\/tasks\/([A-Za-z0-9_-]+)\/edit$/.exec(window.location.pathname)?.[1] ?? null;
const fallback = editId ? `/tasks/${editId}` : '/tasks';

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: editId ? 'Uredi zadatak' : 'Novi zadatak',
  submitLabel: 'Spremi zadatak',
  fallback,
  discardMessage: 'Uneseni podaci o zadatku neće biti spremljeni.',
  onSubmit: save,
});
screen.setContent(h('p', { class: 'rv-screen__loading' }, 'Učitavanje...'));

const customer = CustomerPicker({ placeholder: 'Bez kupca' });
const contact = ContactPicker();
const opportunity = OpportunityPicker();
const slot = nextMeetingSlot();

/** Read-only lead context ("Lead: Marko Horvat · ABC d.o.o."); value = lead id. */
function LeadContext() {
  let lead = null;
  const label = h('span', { class: 'rv-picker__label' });
  const element = h(
    'div',
    { class: 'rv-input rv-picker__trigger', tabindex: '-1', style: 'cursor: default' },
    icon('user-search', 'rv-icon rv-picker__icon'),
    h('span', { class: 'rv-picker__text' }, label),
  );
  return {
    element,
    read: () => lead?.id ?? '',
    write(next) {
      lead = next;
      label.textContent = next ? next.name : '';
    },
  };
}
const leadContext = LeadContext();
const reminder = ReminderControl();

const form = createForm(
  [
    {
      fields: [
        FormField('title', 'Naslov', {
          required: true,
          maxlength: 300,
          placeholder: 'npr. Poslati ponudu',
        }),
        SelectField('type', 'Vrsta', { options: TASK_TYPES, value: 'general' }),
        CustomField('leadId', 'Lead', leadContext, { hidden: true }),
        CustomField('companyId', 'Poveži s kupcem', customer, {
          hint: 'Neobavezno. Zadatak može postojati i bez kupca.',
          onChange: (id) => linkCustomer(id),
        }),
        CustomField('contactId', 'Kontakt', contact, { hidden: true }),
        CustomField('opportunityId', 'Prilika', opportunity, { hidden: true }),
      ],
    },
    {
      title: 'Datum',
      fields: [
        DatePickerField('date', 'Datum', { required: true, hint: 'Obavezno.' }),
        TimePickerField('dueTime', 'Vrijeme', { hint: 'Neobavezno.' }),
        SwitchField('inCalendar', 'Dodaj u Sales Kalendar', {
          hint: 'Zadatak se prikazuje u Sales Kalendaru na odabrani datum.',
          onChange: (on) => showCalendar(on, { prefill: true }),
        }),
        TimePickerField('startTime', 'Vrijeme početka', {
          hidden: true,
          hint: 'Bez vremena: cijeli dan.',
        }),
        TimePickerField('endTime', 'Vrijeme završetka', { hidden: true, hint: 'Neobavezno.' }),
      ],
    },
    {
      fields: [
        SegmentedField('priority', 'Prioritet', { options: TASK_PRIORITIES, value: 'normal' }),
        TextAreaField('description', 'Bilješka', {
          rows: 4,
          maxlength: 5000,
          placeholder: 'Detalji, dogovor, što pripremiti…',
        }),
      ],
    },
    reminder.section,
  ],
  { single: true },
);
reminder.attach(form);

/** In the calendar: start and end time; otherwise one optional time for the date. */
function showCalendar(on, { prefill = false } = {}) {
  for (const name of ['startTime', 'endTime']) form.setVisible(name, on);
  form.setVisible('dueTime', !on);
  if (!on || !prefill) return;
  const v = form.values();
  if (!v.date) form.setValue('date', slot.date);
  if (v.dueTime && !v.startTime) form.setValue('startTime', v.dueTime);
  if (v.type === 'meeting' && !v.startTime) {
    form.setValue('startTime', slot.time);
    const [hh, mm] = slot.time.split(':').map(Number);
    if (hh < 23)
      form.setValue('endTime', `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
}

/**
 * The customer's contacts and deals; without a customer, a lead's own deals
 * (ADR-0009: a task of a lead's deal needs no customer).
 */
async function linkCustomer(companyId, { contactId = '', opportunityId = '' } = {}) {
  const leadId = leadContext.read();
  form.setVisible('contactId', Boolean(companyId));
  form.setVisible('opportunityId', Boolean(companyId) || Boolean(leadId));
  await Promise.all([
    contact.setCustomer(companyId, contactId),
    companyId
      ? opportunity.setCustomer(companyId, opportunityId)
      : opportunity.setLead(leadId, opportunityId),
  ]);
}

function showLead(id, name) {
  leadContext.write(id ? { id, name } : null);
  form.setVisible('leadId', Boolean(id));
}

async function customerById(id) {
  const profile = await api.getCustomer(id);
  return { id: profile.id, companyName: profile.companyName, oib: profile.oib, city: profile.city };
}

/** Fills the form from the task being edited, or from the query context. */
let editing = null; // the task as loaded, when editing

async function prefill() {
  if (editId) {
    const task = await api.getTask(editId);
    editing = task;
    const values = formValuesFromTask(task);
    for (const [name, value] of Object.entries(values)) form.setValue(name, value);
    showCalendar(values.inCalendar);
    reminder.write(task.reminder);
    if (task.leadId) showLead(task.leadId, task.leadName ?? 'Lead');
    if (task.companyId) {
      customer.write(await customerById(task.companyId).catch(() => null));
    }
    if (task.companyId || task.leadId) {
      await linkCustomer(task.companyId ?? '', {
        contactId: task.contactId ?? '',
        opportunityId: task.opportunityId ?? '',
      });
    }
    return;
  }

  const type = params.get('type');
  if (TASK_TYPES.some((t) => t.value === type)) form.setValue('type', type);
  if (params.get('calendar') === '1' || params.get('date')) {
    form.setValue('inCalendar', true);
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? ''))
      form.setValue('date', params.get('date'));
    showCalendar(true, { prefill: true });
  }

  let companyId = params.get('companyId');
  const opportunityId = params.get('opportunityId');
  const contactId = params.get('contactId');
  let leadId = params.get('leadId');
  try {
    if (opportunityId) {
      const opp = await api.getOpportunity(opportunityId);
      if (companyId && companyId !== opp.companyId) throw new ApiError(422, MESSAGES.unavailable);
      companyId = opp.companyId;
      // A lead's deal: the task concerns its lead (and no customer until the lead's conversion).
      if (opp.leadId) {
        if (leadId && leadId !== opp.leadId) throw new ApiError(422, MESSAGES.unavailable);
        leadId = opp.leadId;
      }
    }
    if (leadId) {
      const lead = await api.getLead(leadId);
      showLead(lead.id, [lead.name, lead.companyName].filter(Boolean).join(' · '));
    }
    if (companyId) customer.write(await customerById(companyId));
    if (companyId || leadId) {
      await linkCustomer(companyId ?? '', {
        contactId: contactId ?? '',
        opportunityId: opportunityId ?? '',
      });
    }
  } catch {
    screen.showError(MESSAGES.unavailable);
  }
}

try {
  await prefill();
  screen.setContent(form.element, () => form.values());
  if (!editId) form.control('title')?.focus({ preventScroll: true });
} catch (error) {
  screen.setContent(
    h(
      'p',
      { class: 'rv-screen__loading' },
      error instanceof ApiError ? error.message : MESSAGES.unavailable,
    ),
  );
  screen.actions.save.disabled = true;
}

async function save() {
  const values = form.values();
  const { input, errors } = taskInputFromForm(values);
  // The reminder is separate from the calendar slot and the deadline: none is changed by it.
  const push = reminder.read(values);
  if (hasErrors(errors) || hasErrors(push.errors)) {
    form.setErrors({ ...errors, ...push.errors });
    return;
  }
  input.reminderAt = push.reminderAt;
  // An older task with a calendar slot and a separate deadline keeps that deadline.
  if (editing && (input.allDay || input.scheduledStartAt) && (editing.dueDate || editing.dueAt)) {
    input.dueDate = editing.dueDate ?? null;
    input.dueAt = editing.dueAt ?? null;
  }
  screen.setSaving(true);
  try {
    const task = editId ? await api.updateTask(editId, input) : await api.createTask(input);
    screen.allowLeave();
    setFlash(
      editId
        ? 'Zadatak je ažuriran.'
        : task.scheduledStartAt
          ? 'Zadatak je spremljen i dodan u Sales Kalendar.'
          : 'Zadatak je spremljen.',
    );
    leaveTo(returnTarget(editId ? `/tasks/${editId}` : '/tasks'));
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) {
      form.setErrors(mapTaskErrors(error.errors, input));
      if (error.message === MESSAGES.unavailable) screen.showError(MESSAGES.unavailable);
    } else if (error instanceof ApiError && error.status === 404) {
      screen.showError(MESSAGES.unavailable);
    } else {
      screen.showError(MESSAGES.taskSaveFailed);
    }
  }
}
