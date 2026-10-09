// Actions on one opportunity (its card on the customer profile is its detail):
// record a sent offer, record the customer's answer, close the deal as won
// (with its final amount) or lost (with a reason), and its push reminder.
import { api, ApiError } from '../../../core/api.js';
import { todayKey } from '../../../core/format.js';
import { hasErrors, validateOffer, validateOpportunityClose } from '../../../core/validation.js';
import { confirmDialog } from '../../../ui/confirm.js';
import { h } from '../../../ui/dom.js';
import { DatePickerField, FormField, TextAreaField } from '../../../ui/fields.js';
import { createForm } from '../../../ui/form.js';
import { openSheet } from '../../../ui/sheet.js';
import { openReminderSheet } from '../../reminders/reminder-sheet.js';

/** A small form in a bottom sheet: validate, save, close; errors stay on the form. */
function formSheet({ title, fields, submitLabel, validate, save }) {
  const form = createForm([{ fields }], { single: true });
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Otkaži');
  const submit = h('button', { type: 'button', class: 'rv-btn rv-btn--primary' }, submitLabel);
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
    const values = form.values();
    if (form.setErrors(validate(values))) return;
    submit.disabled = true;
    cancel.disabled = true;
    try {
      await save(values);
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) form.setErrors(failure.errors);
      error.textContent = failure instanceof ApiError ? failure.message : 'Pokušajte ponovno.';
      error.hidden = false;
      submit.disabled = false;
      cancel.disabled = false;
    }
  });
}

/**
 * @param {(message: string) => Promise<void>} done  toast + reload of the profile
 */
export function opportunityActions(done) {
  return {
    /** "Ponuda poslana": the offer starts waiting for feedback (day 1 = the sending day). */
    offerSent(o) {
      formSheet({
        title: 'Ponuda poslana',
        submitLabel: 'Spremi',
        fields: [
          FormField('title', 'Naziv ponude', { required: true, value: o.title, maxlength: 300 }),
          DatePickerField('sentDate', 'Datum slanja', {
            value: todayKey(),
            max: todayKey(),
            hint: 'Dan slanja je 1. dan čekanja na odgovor.',
          }),
        ],
        validate: (values) => validateOffer(values, { today: todayKey() }),
        save: async (values) => {
          await api.recordOffer({ opportunityId: o.id, ...values });
          await done('Ponuda je zabilježena kao poslana.');
        },
      });
    },

    /** The customer answered: the offer leaves the Feedback Overview, its dates stay. */
    async answered(offer) {
      const yes = await confirmDialog({
        title: 'Odgovor primljen?',
        message: `„${offer.title}” više neće čekati u Feedback Overviewu. Ponuda i datumi ostaju zabilježeni.`,
        cancelLabel: 'Ne',
        confirmLabel: 'Odgovor primljen',
      });
      if (!yes) return;
      try {
        await api.offerAnswered(offer.id);
        await done('Odgovor na ponudu je zabilježen.');
      } catch (failure) {
        await done(failure instanceof ApiError ? failure.message : 'Pokušajte ponovno.');
      }
    },

    won(o) {
      formSheet({
        title: 'Prilika dobivena',
        submitLabel: 'Označi kao dobiveno',
        fields: [
          FormField('wonValue', 'Konačni iznos (€)', {
            inputmode: 'decimal',
            value: o.value === null ? '' : String(o.value),
            hint: 'Ako se razlikuje od procjene. Računa se u periodu u kojem je prilika dobivena.',
          }),
        ],
        validate: (values) => validateOpportunityClose({ outcome: 'won', ...values }),
        save: async (values) => {
          await api.closeOpportunity(o.id, { outcome: 'won', ...values });
          await done('Prilika je označena kao dobivena.');
        },
      });
    },

    lost(o) {
      formSheet({
        title: 'Prilika izgubljena',
        submitLabel: 'Označi kao izgubljeno',
        fields: [TextAreaField('lostReason', 'Razlog (neobavezno)', { rows: 2, maxlength: 1000 })],
        validate: (values) => {
          const errors = validateOpportunityClose({ outcome: 'lost', ...values });
          return hasErrors(errors) ? errors : {};
        },
        save: async (values) => {
          await api.closeOpportunity(o.id, { outcome: 'lost', ...values });
          await done('Prilika je označena kao izgubljena.');
        },
      });
    },

    reminder(o) {
      openReminderSheet({
        title: 'Podsjetnik za priliku',
        reminder: o.reminder,
        save: async (reminderAt) => {
          await api.setReminder('opportunities', o.id, reminderAt);
          await done(reminderAt ? 'Podsjetnik je spremljen.' : 'Podsjetnik je uklonjen.');
        },
      });
    },
  };
}
