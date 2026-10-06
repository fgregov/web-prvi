// Pregled: core data + the customer's upcoming Sales Calendar entries.
import { CUSTOMER_STATUSES, CUSTOMER_TYPES, labelOf, TASK_TYPES } from '../../../core/constants.js';
import { formatDateTime, formatSchedule } from '../../../core/format.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { taskTypeIcon } from '../../tasks/task-row.js';
import { profileSection } from './section.js';

export function customerOverview(profile, actions) {
  const row = (label, value) =>
    h('div', { class: 'rv-dl__row' }, h('dt', {}, label), h('dd', {}, value || '—'));
  const upcoming = profile.tasks.filter(
    (t) =>
      t.status === 'open' &&
      t.scheduledStartAt &&
      new Date(t.scheduledEndAt ?? t.scheduledStartAt).getTime() >= Date.now() - 60 * 60 * 1000,
  );

  return profileSection({
    id: 'pregled',
    title: 'Pregled',
    iconName: 'building',
    children: [
      h(
        'dl',
        { class: 'rv-dl' },
        row('Naziv tvrtke', profile.companyName),
        row('Adresa', profile.address),
        row('Poštanski broj i grad', [profile.postalCode, profile.city].filter(Boolean).join(' ')),
        row('OIB', profile.oib),
        row('Status', labelOf(CUSTOMER_STATUSES, profile.status)),
        row('Tip', labelOf(CUSTOMER_TYPES, profile.type)),
        row('E-mail', profile.email),
        row('Telefon', profile.phone),
        row('Web stranica', profile.website),
        row('Prodajni predstavnik', profile.ownerName),
        row('Kreirano', formatDateTime(profile.createdAt)),
        profile.notes ? row('Napomena', profile.notes) : null,
      ),
      upcoming.length
        ? h(
            'div',
            { class: 'rv-upcoming' },
            h('h3', { class: 'rv-subtitle' }, 'U Sales Kalendaru'),
            upcoming.map((t) =>
              h(
                'a',
                {
                  class: 'rv-upcoming__item',
                  href: `/tasks/${encodeURIComponent(t.id)}?returnTo=${encodeURIComponent(actions.returnTo)}`,
                },
                h('span', { class: 'rv-upcoming__icon' }, icon(taskTypeIcon(t.type))),
                h(
                  'div',
                  { class: 'rv-upcoming__text' },
                  h('strong', {}, t.title),
                  h(
                    'span',
                    {},
                    [labelOf(TASK_TYPES, t.type), formatSchedule(t), t.contactName]
                      .filter(Boolean)
                      .join(' · '),
                  ),
                ),
              ),
            ),
          )
        : null,
    ],
  });
}
