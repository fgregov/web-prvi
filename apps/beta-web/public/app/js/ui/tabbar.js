// Primary bottom navigation (Home and the module shells). One definition, so
// every screen shows the same five items in the same order. Izvještaji live
// under Više; "Obavijesti" is the short label of MOBILNE OBAVIJESTI.
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
  {
    key: 'notifications',
    href: '/notifications',
    label: 'Obavijesti',
    title: 'Mobilne obavijesti',
    icon: 'bell',
  },
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
          'aria-label': tab.lines ? tab.label : (tab.title ?? null),
        },
        icon(tab.icon, `icon${isActive && tab.key === 'home' ? ' icon--filled' : ''}`),
        h(
          'span',
          { class: 'tab__label' },
          // The space keeps "Follow-up Engine" readable where the break is hidden (web sidebar).
          tab.lines
            ? tab.lines.flatMap((line, i) => (i ? [h('br'), ` ${line}`] : [line]))
            : tab.label,
        ),
      );
    }),
  );
}

/** Which item a page belongs to: Kupci, Prilike, Zadaci and Kalendar live under Više. */
export function tabForPath(pathname) {
  if (pathname.startsWith('/leads')) return 'leads';
  if (pathname.startsWith('/follow-up')) return 'follow-up';
  if (pathname.startsWith('/notifications')) return 'notifications';
  if (pathname === '/dashboard' || pathname.startsWith('/feedback-overview')) return 'home';
  return 'more';
}

/**
 * Pages without the bottom navigation (CRM pages, forms) show the same items as
 * a rail on tablets and computers (app/css/web.css). Phones get nothing added;
 * a window that grows to 768 px gets the rail then (until the page is left).
 */
export function mountWebNav() {
  const wide = window.matchMedia?.('(min-width: 768px)');
  if (!wide) return;
  // The in-browser demo swaps pages inside #rv-root; this page's element tells when it is gone.
  const page = document.getElementById('rv-root')?.firstElementChild ?? document.body;
  const mount = () => {
    if (!page.isConnected) return wide.removeEventListener('change', mount);
    if (!wide.matches || document.querySelector('.tabbar')) return;
    const nav = h('nav', { class: 'tabbar tabbar--web' });
    renderTabbar(nav, tabForPath(window.location.pathname));
    document.body.append(nav);
  };
  mount();
  wide.addEventListener('change', mount);
}
