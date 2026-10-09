// Set, move or remove the reminder of an existing lead or opportunity (their
// detail has no edit form). Same control as in the forms.
import { ApiError } from '../../core/api.js';
import { h } from '../../ui/dom.js';
import { createForm } from '../../ui/form.js';
import { openSheet } from '../../ui/sheet.js';
import { ReminderControl } from './reminder-control.js';

/**
 * @param {{ title: string, reminder: object | null, save: (reminderAt: string | null) => Promise<void> }} options
 */
export function openReminderSheet({ title, reminder, save }) {
  const control = ReminderControl({ reminder });
  const form = createForm([{ fields: control.fields }], { single: true });
  control.attach(form);
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Otkaži');
  const submit = h('button', { type: 'button', class: 'rv-btn rv-btn--primary' }, 'Spremi');
  const sheet = openSheet({
    title,
    className: 'rv-sheet--form',
    content: h(
      'div',
      { class: 'rv-sheet__body' },
      h('div', { class: 'rv-sheet__scroll' }, form.element),
      error,
      h('div', { class: 'rv-sheet__actions' }, cancel, submit),
    ),
  });
  cancel.addEventListener('click', () => sheet.close());
  submit.addEventListener('click', async () => {
    const { reminderAt, errors } = control.read(form.values());
    if (form.setErrors(errors)) return;
    submit.disabled = true;
    cancel.disabled = true;
    try {
      await save(reminderAt);
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) form.setErrors(failure.errors);
      error.textContent = failure instanceof ApiError ? failure.message : 'Pokušajte ponovno.';
      error.hidden = false;
      submit.disabled = false;
      cancel.disabled = false;
    }
  });
  return sheet;
}
