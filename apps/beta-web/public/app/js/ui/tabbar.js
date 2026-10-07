// Primary bottom navigation (Home and the module shells). One definition, so
// every screen shows the same five items in the same order.
import { h } from './dom.js';
import { icon } from './icons.js';

export const TABS = [
  { key: 'home', href: '/dashboard', label: 'Početna', icon: 'home' },
  {
    key: 'follow-up',
    href: '/follow-up',
    label: 'Follow-up Engine',
    lines: ['Follow-up', 'Engine'],
    icon: 'repeat',
  },
  { key: 'leads', href: '/leads', label: 'Leads', icon: 'users' },
  { key: 'reports', href: '/reports', label: 'Izvještaji', icon: 'bars' },
  { key: 'more', href: '/more', label: 'Više', icon: 'ellipsis' },
];

export function renderTabbar(nav, active) {
  nav.setAttribute('aria-label', 'Glavna navigacija');
  nav.replaceChildren(
    ...TABS.map((tab) => {
      const isActive = tab.key === active;
      return h(
        'a',
        {
          class: `tab${isActive ? ' is-active' : ''}${tab.lines ? ' tab--two-line' : ''}`,
          href: tab.href,
          'aria-current': isActive ? 'page' : null,
          'aria-label': tab.lines ? tab.label : null,
        },
        icon(tab.icon, `icon${isActive && tab.key === 'home' ? ' icon--filled' : ''}`),
        h(
          'span',
          { class: 'tab__label' },
          tab.lines ? tab.lines.flatMap((line, i) => (i ? [h('br'), line] : [line])) : tab.label,
        ),
      );
    }),
  );
}
