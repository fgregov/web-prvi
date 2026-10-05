// Top bar shared by the CRM pages (customers, profile, pipeline, calendar).
import { initials } from '../core/format.js';
import { getCurrentUser } from '../core/session.js';
import { h } from './dom.js';
import { icon } from './icons.js';

const NAV = [
  { href: '/customers', label: 'Kupci', key: 'customers' },
  { href: '/opportunities', label: 'Prilike', key: 'opportunities' },
  { href: '/calendar', label: 'Kalendar', key: 'calendar' },
];

export function renderShell(active) {
  const user = h('span', { class: 'rv-topbar__user', 'aria-hidden': 'true' });
  const bar = h(
    'header',
    { class: 'rv-topbar' },
    h(
      'div',
      { class: 'rv-topbar__inner' },
      h(
        'a',
        { class: 'rv-topbar__back', href: '/dashboard' },
        icon('arrow-left'),
        h('span', {}, 'Početna'),
      ),
      h(
        'a',
        { class: 'rv-brand', href: '/dashboard', 'aria-label': 'Renvara početna' },
        h('img', { src: '/brand/renvara-logo.png', alt: '', width: 26, height: 30 }),
        h('span', {}, 'RENVARA'),
      ),
      h(
        'nav',
        { class: 'rv-topbar__nav', 'aria-label': 'CRM' },
        NAV.map((item) =>
          h(
            'a',
            { href: item.href, 'aria-current': item.key === active ? 'page' : null },
            item.label,
          ),
        ),
      ),
      user,
    ),
  );
  document.getElementById('shell').replaceChildren(bar);
  getCurrentUser()
    .then((u) => {
      user.textContent = initials(u.displayName);
      user.title = u.displayName;
    })
    .catch(() => {});
}
