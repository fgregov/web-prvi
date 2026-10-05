// Kontakti: primary contact first.
import { initials } from '../../../core/format.js';
import { contactName } from '../../../core/store.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { profileSection } from './section.js';

export function customerContacts(profile, onCreate) {
  const contacts = [...profile.contacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return profileSection({
    id: 'kontakti',
    title: 'Kontakti',
    iconName: 'user',
    count: contacts.length,
    action: { label: 'Dodaj kontakt', onClick: onCreate },
    children: h(
      'ul',
      { class: 'rv-contacts', role: 'list' },
      contacts.map((c) =>
        h(
          'li',
          { class: 'rv-contact' },
          h(
            'span',
            { class: 'rv-contact__avatar', 'aria-hidden': 'true' },
            initials(contactName(c)),
          ),
          h(
            'div',
            { class: 'rv-contact__text' },
            h(
              'strong',
              {},
              contactName(c),
              c.isPrimary
                ? h(
                    'span',
                    { class: 'rv-badge rv-badge--red rv-badge--inline' },
                    'Primarni kontakt',
                  )
                : null,
            ),
            c.role ? h('span', { class: 'rv-contact__role' }, c.role) : null,
            h(
              'span',
              { class: 'rv-contact__channels' },
              h('span', {}, icon('phone', 'rv-icon rv-icon--sm'), c.phone || '—'),
              h('span', {}, icon('mail', 'rv-icon rv-icon--sm'), c.email || '—'),
            ),
          ),
        ),
      ),
    ),
  });
}
