// Zakaži sastanak drawer.
import { MEETING_DURATIONS, MEETING_MODES } from '../../core/constants.js';
import { crm } from '../../core/crm.js';
import { nextMeetingSlot } from '../../core/format.js';
import { getCurrentUser } from '../../core/session.js';
import { contactName } from '../../core/store.js';
import { validateMeeting } from '../../core/validation.js';
import { openDrawer } from '../../ui/drawer.js';
import { createForm } from '../../ui/form.js';
import { customerField, resolveCustomerId, saveHandler } from '../shared.js';

const contactOptions = (customerId) => {
  const profile = customerId ? crm.getProfile(customerId) : null;
  return {
    options: [
      { value: '', label: '— Bez kontakta —' },
      ...(profile?.contacts ?? []).map((c) => ({ value: c.id, label: contactName(c) })),
    ],
    selected: profile?.primaryContact?.id ?? '',
    address: profile
      ? [profile.address, [profile.postalCode, profile.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
      : '',
    name: profile?.companyName ?? '',
  };
};

export async function openMeetingForm({ customerId = null, onSaved }) {
  const user = await getCurrentUser();
  const initialId = customerId ?? crm.listCustomers()[0]?.id ?? '';
  const initial = contactOptions(initialId);
  const slot = nextMeetingSlot();

  const form = createForm([
    {
      fields: [
        customerField(customerId),
        {
          name: 'contactId',
          label: 'Kontakt',
          type: 'select',
          options: initial.options,
          value: initial.selected,
          full: true,
        },
        {
          name: 'title',
          label: 'Naziv sastanka',
          required: true,
          value: `Sastanak s ${initial.name}`.trim(),
          full: true,
        },
        { name: 'date', label: 'Datum', type: 'date', required: true, value: slot.date },
        {
          name: 'time',
          label: 'Vrijeme',
          type: 'time',
          required: true,
          value: slot.time,
          step: 300,
        },
        {
          name: 'durationMinutes',
          label: 'Trajanje',
          type: 'select',
          options: MEETING_DURATIONS,
          value: '60',
        },
        {
          name: 'mode',
          label: 'Lokacija / Online',
          type: 'segmented',
          options: MEETING_MODES,
          value: 'in_person',
        },
        {
          name: 'location',
          label: 'Mjesto ili poveznica',
          value: initial.address,
          placeholder: 'Adresa ili link za sastanak',
          full: true,
        },
        { name: 'notes', label: 'Napomena', type: 'textarea', full: true },
      ],
    },
  ]);

  // Picking another customer (quick-create) refreshes contact, title and location.
  form.control('customerId')?.addEventListener('change', (event) => {
    const next = contactOptions(event.target.value);
    form.setOptions('contactId', next.options, next.selected);
    form.setValue('title', `Sastanak s ${next.name}`);
    form.setValue('location', next.address);
  });
  form.control('mode').addEventListener('change', (event) => {
    const online = event.target.value === 'online';
    const location = form.control('location');
    location.placeholder = online ? 'https://meet…' : 'Adresa ili link za sastanak';
    if (
      online &&
      location.value === contactOptions(resolveCustomerId(customerId, form.values())).address
    )
      location.value = '';
  });

  openDrawer({
    title: 'Zakaži sastanak',
    subtitle: 'Sastanak se dodaje u aktivnosti kupca i u Sales kalendar.',
    content: form.element,
    submitLabel: 'Zakaži sastanak',
    onSubmit: saveHandler(form, {
      buildInput: (values) => ({ ...values, customerId: resolveCustomerId(customerId, values) }),
      validate: validateMeeting,
      save: (input) => onSaved?.(crm.scheduleMeeting(input, user)),
    }),
  });
}
