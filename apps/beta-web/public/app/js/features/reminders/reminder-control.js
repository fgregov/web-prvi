// "OBAVIJEST" — the optional push reminder of a task, lead or opportunity:
// a switch, an exact date and time (native pickers), quick presets, and an
// honest note about whether this device will actually receive it. Used in the
// create/edit forms and in the reminder sheet (lead detail, opportunity card).
import { addDaysKey, dayKey, timeKey, toInstant } from '../../core/format.js';
import { reminderError } from '../../core/validation.js';
import { h } from '../../ui/dom.js';
import { CustomField, DatePickerField, SwitchField, TimePickerField } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { enablePush, PUSH_UNAVAILABLE } from './push.js';

const pad = (n) => String(n).padStart(2, '0');

/** "Za 1 sat" (rounded up to 5 minutes), "Sutra" / "Za 3 dana" / "Za 7 dana" at 09:00. */
const PRESETS = [
  {
    label: 'Za 1 sat',
    at: () => {
      const d = new Date(Date.now() + 60 * 60 * 1000);
      d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
      return { date: dayKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
    },
  },
  { label: 'Sutra', at: () => ({ date: addDaysKey(1), time: '09:00' }) },
  { label: 'Za 3 dana', at: () => ({ date: addDaysKey(3), time: '09:00' }) },
  { label: 'Za 7 dana', at: () => ({ date: addDaysKey(7), time: '09:00' }) },
];

/** A reminder that has not fired yet (a failed one is shown, but is no longer "on"). */
export const activeReminder = (reminder) =>
  reminder && reminder.status !== 'failed' ? reminder : null;

/**
 * @param {{ reminder?: { remindAt: string, status?: string } | null }} [options]  the record's current reminder
 */
export function ReminderControl({ reminder: shown = null } = {}) {
  const reminder = activeReminder(shown);
  let form = null;
  const note = h('p', { class: 'rv-reminder__note', role: 'status', hidden: true });
  const presets = h(
    'div',
    { class: 'rv-reminder__presets' },
    PRESETS.map((preset) =>
      h(
        'button',
        {
          type: 'button',
          class: 'rv-btn rv-btn--sm rv-btn--secondary',
          onClick: () => {
            const { date, time } = preset.at();
            form?.setValue('reminderDate', date);
            form?.setValue('reminderTime', time);
          },
        },
        preset.label,
      ),
    ),
  );
  const presetControl = { element: presets, focusTarget: presets, read: () => '', write() {} };

  function showNote(result) {
    note.hidden = false;
    note.classList.toggle('is-warning', !result.ok);
    note.replaceChildren(
      icon(result.ok ? 'check' : 'info', 'rv-icon rv-icon--sm'),
      h(
        'span',
        {},
        result.ok ? 'Obavijest će stići na ovaj uređaj.' : PUSH_UNAVAILABLE[result.reason],
      ),
    );
  }

  /** Turning a reminder on is the moment to ask for notification permission. */
  async function toggled(on) {
    for (const name of ['reminderDate', 'reminderTime', 'reminderPresets'])
      form?.setVisible(name, on);
    if (!on) {
      note.hidden = true;
      return;
    }
    const values = form?.values() ?? {};
    if (!values.reminderDate) {
      const { date, time } = PRESETS[1].at();
      form?.setValue('reminderDate', date);
      form?.setValue('reminderTime', time);
    }
    showNote(await enablePush());
  }

  const fields = [
    SwitchField('reminderOn', 'Uključi podsjetnik', {
      value: Boolean(reminder),
      onChange: toggled,
    }),
    CustomField('reminderPresets', 'Brzi odabir', presetControl, { hidden: !reminder }),
    DatePickerField('reminderDate', 'Datum podsjetnika', {
      hidden: !reminder,
      value: reminder ? dayKey(new Date(reminder.remindAt)) : '',
    }),
    TimePickerField('reminderTime', 'Vrijeme podsjetnika', {
      hidden: !reminder,
      value: reminder ? timeKey(reminder.remindAt) : '',
    }),
    CustomField(
      'reminderNote',
      '',
      { element: note, read: () => '', write() {} },
      { hidden: false },
    ),
  ];

  return {
    /** A form section, as createForm() expects. */
    section: { title: 'Obavijest', fields },
    fields,
    /** Call once the form exists. */
    attach(next) {
      form = next;
    },
    /** Shows a saved reminder (edit forms load the record after building the form). */
    write(record) {
      const saved = activeReminder(record);
      form?.setValue('reminderOn', Boolean(saved));
      for (const name of ['reminderDate', 'reminderTime', 'reminderPresets']) {
        form?.setVisible(name, Boolean(saved));
      }
      if (!saved) return;
      form?.setValue('reminderDate', dayKey(new Date(saved.remindAt)));
      form?.setValue('reminderTime', timeKey(saved.remindAt));
    },
    /**
     * The reminder to save: an ISO instant, or null (none / removed).
     * @returns {{ reminderAt: string | null, errors: Record<string, string> }}
     */
    read(values) {
      if (!values.reminderOn) return { reminderAt: null, errors: {} };
      if (!values.reminderDate || !values.reminderTime) {
        return {
          reminderAt: null,
          errors: values.reminderDate
            ? { reminderTime: 'Odaberite vrijeme.' }
            : { reminderDate: 'Odaberite datum.' },
        };
      }
      const reminderAt = toInstant(values.reminderDate, values.reminderTime);
      const error = reminderError(reminderAt, new Date());
      return { reminderAt, errors: error ? { reminderTime: error } : {} };
    },
  };
}

/** Why the server could not deliver a reminder, in words. */
const NOT_DELIVERED = {
  push_not_configured: 'obavijesti nisu uključene na poslužitelju',
  no_device: 'nijedan uređaj nema uključene obavijesti',
  target_missing: 'zapis više ne postoji',
};

/**
 * "14. listopada 2026. u 14:00" for a record's detail; a reminder the server
 * could not deliver says so, and why.
 */
export function reminderLabel(reminder) {
  if (!reminder) return null;
  const at = new Date(reminder.remindAt);
  const date = new Intl.DateTimeFormat('hr-HR', { day: 'numeric', month: 'long', year: 'numeric' });
  const when = `${date.format(at)} u ${timeKey(reminder.remindAt)}`;
  if (reminder.status !== 'failed') return when;
  const why = NOT_DELIVERED[reminder.lastError] ?? 'servis za obavijesti ga nije prihvatio';
  return `${when} · nije isporučen (${why})`;
}
