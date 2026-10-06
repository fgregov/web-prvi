// Customer profile header: identity + CRM actions (primary actions visually dominant).
import { CUSTOMER_STATUSES, CUSTOMER_TYPES, labelOf } from '../../../core/constants.js';
import { initials } from '../../../core/format.js';
import { contactName } from '../../../core/names.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';

export function customerHeader(profile, actions) {
  const addressLine = [
    profile.address,
    [profile.postalCode, profile.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const statusTone = profile.status === 'active' ? 'green' : 'neutral';

  const actionButton = (label, iconName, variant, handler, extra = '') =>
    h(
      'button',
      { type: 'button', class: `rv-btn rv-btn--${variant} ${extra}`.trim(), onClick: handler },
      icon(iconName),
      label,
    );

  return h(
    'section',
    { class: 'rv-card rv-profile-header', 'aria-labelledby': 'customer-name' },
    h(
      'div',
      { class: 'rv-profile-header__identity' },
      h(
        'div',
        { class: 'rv-company-avatar', 'aria-hidden': 'true' },
        initials(profile.companyName),
      ),
      h(
        'div',
        { class: 'rv-profile-header__text' },
        h(
          'div',
          { class: 'rv-profile-header__title-row' },
          h('h1', { class: 'rv-profile-header__name', id: 'customer-name' }, profile.companyName),
          h(
            'span',
            { class: `rv-badge rv-badge--${statusTone}` },
            labelOf(CUSTOMER_STATUSES, profile.status),
          ),
          h('span', { class: 'rv-badge rv-badge--neutral' }, labelOf(CUSTOMER_TYPES, profile.type)),
        ),
        addressLine
          ? h(
              'p',
              { class: 'rv-profile-header__address' },
              icon('map-pin', 'rv-icon rv-icon--sm'),
              addressLine,
            )
          : null,
        h(
          'dl',
          { class: 'rv-profile-header__meta' },
          h('div', {}, h('dt', {}, 'OIB:'), h('dd', {}, profile.oib)),
          profile.primaryContact
            ? h(
                'div',
                {},
                h('dt', {}, 'Odgovorna osoba:'),
                h('dd', {}, contactName(profile.primaryContact)),
              )
            : null,
          profile.ownerName
            ? h('div', {}, h('dt', {}, 'Prodajni predstavnik:'), h('dd', {}, profile.ownerName))
            : null,
        ),
      ),
    ),
    h(
      'div',
      { class: 'rv-profile-actions' },
      h(
        'div',
        { class: 'rv-profile-actions__primary' },
        actionButton('Zakaži sastanak', 'calendar', 'primary', actions.meeting, 'rv-btn--lg'),
        actionButton('Kreiraj priliku', 'target', 'dark', actions.opportunity, 'rv-btn--lg'),
        actionButton('Novi zadatak', 'check-square', 'secondary', actions.task, 'rv-btn--lg'),
      ),
      h(
        'div',
        { class: 'rv-profile-actions__secondary', role: 'group', 'aria-label': 'Ostale akcije' },
        actionButton('Dodaj bilješku', 'note', 'soft', actions.note),
        actionButton('Dodaj kontakt', 'user-plus', 'soft', actions.contact),
        actionButton('Pošalji e-mail', 'mail', 'soft', actions.email),
        actionButton('Uredi kupca', 'pencil', 'soft', actions.edit),
      ),
    ),
  );
}
