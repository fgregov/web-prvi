// Pregled: core data + upcoming meetings.
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  labelOf,
  MEETING_MODES,
} from '../../../core/constants.js';
import { formatDateTime, formatDuration } from '../../../core/format.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { profileSection } from './section.js';

export function customerOverview(profile) {
  const row = (label, value) =>
    h('div', { class: 'rv-dl__row' }, h('dt', {}, label), h('dd', {}, value || '—'));
  const upcoming = profile.meetings.filter(
    (m) => new Date(m.startsAt).getTime() >= Date.now() - 60 * 60 * 1000,
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
            h('h3', { class: 'rv-subtitle' }, 'Nadolazeći sastanci'),
            upcoming.map((m) =>
              h(
                'div',
                { class: 'rv-upcoming__item' },
                h(
                  'span',
                  { class: 'rv-upcoming__icon' },
                  icon(m.mode === 'online' ? 'video' : 'calendar'),
                ),
                h(
                  'div',
                  { class: 'rv-upcoming__text' },
                  h('strong', {}, m.title),
                  h(
                    'span',
                    {},
                    `${formatDateTime(m.startsAt)} · ${formatDuration(m.durationMinutes)} · ${labelOf(MEETING_MODES, m.mode)}${m.location ? ` · ${m.location}` : ''}`,
                  ),
                ),
              ),
            ),
          )
        : null,
    ],
  });
}
