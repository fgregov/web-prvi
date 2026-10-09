// Task form values (local date and time fields) ⇄ API wire format (UTC instants).
import { dayKey, timeKey, toInstant } from '../../core/format.js';
import { validateTask } from '../../core/validation.js';

/** API field → form field, for showing server/shared validation errors next to the input. */
const FIELD_OF = {
  scheduledEndAt: 'endTime',
  dueAt: 'dueDate',
  description: 'description',
};

/**
 * @returns {{ input: object, errors: Record<string, string> }} errors keyed by form field name
 */
export function taskInputFromForm(v) {
  const errors = {};
  const input = {
    title: v.title,
    type: v.type,
    priority: v.priority,
    description: v.description,
    companyId: v.companyId || null,
    contactId: (v.companyId && v.contactId) || null,
    opportunityId: (v.companyId && v.opportunityId) || null,
    leadId: v.leadId || null,
    allDay: false,
    scheduledDate: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    dueDate: null,
    dueAt: null,
  };

  if (v.inCalendar) {
    if (!v.date) errors.date = 'Odaberite datum.';
    else if (!v.startTime) {
      if (v.endTime) errors.startTime = 'Unesite vrijeme početka.';
      else {
        input.allDay = true; // date only
        input.scheduledDate = v.date;
      }
    } else {
      input.scheduledStartAt = toInstant(v.date, v.startTime);
      if (v.endTime) input.scheduledEndAt = toInstant(v.date, v.endTime);
    }
  }

  if (v.dueDate) {
    if (v.dueTime) input.dueAt = toInstant(v.dueDate, v.dueTime);
    else input.dueDate = v.dueDate;
  } else if (v.dueTime) {
    errors.dueDate = 'Odaberite datum roka.';
  }

  return { input, errors: { ...mapTaskErrors(validateTask(input), input), ...errors } };
}

/** Maps API/shared validation errors onto the form's field names. */
export function mapTaskErrors(errors, input = {}) {
  const out = {};
  for (const [name, message] of Object.entries(errors ?? {})) {
    const field =
      name === 'scheduledStartAt'
        ? input.allDay || !input.scheduledStartAt
          ? 'date'
          : 'startTime'
        : (FIELD_OF[name] ?? name);
    out[field] ??= message;
  }
  return out;
}

/** Form values for editing an existing task. */
export function formValuesFromTask(task) {
  const start = task.scheduledStartAt;
  return {
    title: task.title,
    type: task.type,
    priority: task.priority,
    description: task.description ?? '',
    inCalendar: Boolean(start),
    date: start ? (task.allDay ? task.scheduledDate : dayKey(new Date(start))) : '',
    startTime: start && !task.allDay ? timeKey(start) : '',
    endTime: task.scheduledEndAt ? timeKey(task.scheduledEndAt) : '',
    dueDate: task.dueDate ?? (task.dueAt ? dayKey(new Date(task.dueAt)) : ''),
    dueTime: task.dueAt ? timeKey(task.dueAt) : '',
  };
}
