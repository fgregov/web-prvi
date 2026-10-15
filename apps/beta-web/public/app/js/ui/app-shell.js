// The web app's navigation, the same on every page (ADR-0013):
//   computers (1024 px+)  a sidebar on the left; it can be narrowed to icons
//                         (remembered in this browser)
//   tablets and phones    a top bar with the menu button; the same sidebar
//                         slides in over the page
// "Prodaja" and "Prikaz više" only open and close their lists; the pages are
// their items. "+ Novo" opens Quick Add (the five "Novi …" forms).
// Only pages the member has the right to are listed (a list without any is
// left out); the server refuses the others anyway (403).
import { resetDashboardPeriod } from '../core/dashboard-period.js';
import { initials } from '../core/format.js';
import { ROLES } from '../core/permissions.js';
import { navKeyForPath, permissionForPath } from '../core/routes.js';
import { getAccess } from '../core/session.js';
import { QUICK_ADD_ACTIONS, QuickAddSheet } from '../features/quick-add/quick-add-sheet.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { here } from './navigation.js';
import { showToast } from './toast.js';

export const NAV = [
  { key: 'home', label: 'Početna', href: '/dashboard', icon: 'home' },
  { key: 'follow-up', label: 'Follow-up engine', href: '/follow-up', icon: 'repeat' },
  {
    key: 'sales',
    label: 'Prodaja',
    icon: 'briefcase-business',
    children: [
      { key: 'leads', label: 'Leads', href: '/sales/leads', icon: 'user-search' },
      { key: 'opportunities', label: 'Prilike', href: '/sales/opportunities', icon: 'target' },
      { key: 'tasks', label: 'Zadaci', href: '/sales/tasks', icon: 'check-square' },
      { key: 'customers', label: 'Kupci', href: '/sales/customers', icon: 'building' },
    ],
  },
  {
    key: 'views',
    label: 'Prikaz više',
    icon: 'layout-grid',
    children: [
      { key: 'sales-calendar', label: 'Sales kalendar', href: '/sales-calendar', icon: 'calendar' },
      {
        key: 'opportunity-pipeline',
        label: 'Opportunity pipeline',
        href: '/opportunity-pipeline',
        icon: 'kanban',
      },
      {
        key: 'feedback-overview',
        label: 'Feedback overview',
        href: '/feedback-overview',
        icon: 'message-square',
      },
    ],
  },
  { key: 'reports', label: 'Izvještaji', href: '/reports', icon: 'chart-column' },
  { key: 'users', label: 'Korisnici', href: '/users', icon: 'users' },
];
export const SETTINGS = { key: 'settings', label: 'Postavke', href: '/settings', icon: 'settings' };

const COLLAPSED_KEY = 'renvara.sidebar.collapsed'; // this browser: narrow sidebar on computers
const OPEN_KEY = 'renvara.sidebar.open'; // this tab: which lists the user opened or closed
const DESKTOP = '(min-width: 1024px)';

const read = (storage, key) => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};
const write = (storage, key, value) => {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* private mode: the default next time */
  }
};
const openLists = () => {
  try {
    return JSON.parse(read(sessionStorage, OPEN_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

function navLink(item, active, className = 'rv-nav__item') {
  const current = item.key === active;
  return h(
    'a',
    {
      class: `${className}${current ? ' is-active' : ''}`,
      href: item.href,
      'aria-current': current ? 'page' : null,
      title: item.label,
      dataset: { nav: item.key },
    },
    icon(item.icon, 'rv-nav__icon'),
    h('span', { class: 'rv-nav__label' }, item.label),
  );
}

/** A list that opens and closes (never a page of its own). */
function navGroup(group, active, open, onToggle) {
  const listId = `rv-nav-${group.key}`;
  const hasActive = group.children.some((child) => child.key === active);
  const toggle = h(
    'button',
    {
      type: 'button',
      class: `rv-nav__item rv-nav__toggle${hasActive ? ' has-active' : ''}`,
      'aria-expanded': String(open),
      'aria-controls': listId,
      title: group.label,
      dataset: { nav: group.key },
    },
    icon(group.icon, 'rv-nav__icon'),
    h('span', { class: 'rv-nav__label' }, group.label),
    icon('chevron-down', 'rv-nav__chevron'),
  );
  const list = h(
    'div',
    { class: 'rv-nav__sub', id: listId },
    h(
      'ul',
      { class: 'rv-nav__sublist', role: 'list', 'aria-label': group.label },
      group.children.map((child) => h('li', {}, navLink(child, active, 'rv-nav__subitem'))),
    ),
  );
  const item = h(
    'li',
    { class: `rv-nav__group${open ? ' is-open' : ''}`, dataset: { group: group.key } },
    toggle,
    list,
  );
  toggle.addEventListener('click', () => onToggle(item));
  return item;
}

/**
 * Puts the navigation on the page (once; the in-browser demo calls it on every
 * page it shows). Phones and computers get the same items in the same order.
 */
export function mountAppShell() {
  const existing = document.getElementById('rv-side');
  if (existing?.isConnected) return;

  const active = navKeyForPath(window.location.pathname);
  const desktop = window.matchMedia?.(DESKTOP) ?? { matches: true, addEventListener() {} };
  const stored = openLists();

  // ------------------------------------------------------------ sidebar ---
  const groups = [];
  const setGroup = (item, open, { remember = true } = {}) => {
    item.classList.toggle('is-open', open);
    item.querySelector('.rv-nav__toggle').setAttribute('aria-expanded', String(open));
    if (remember && !isCollapsed()) {
      const state = openLists();
      state[item.dataset.group] = open;
      write(sessionStorage, OPEN_KEY, JSON.stringify(state));
    }
  };
  const onToggle = (item) => {
    const open = !item.classList.contains('is-open');
    if (isCollapsed()) {
      // Narrow sidebar: the list is a panel beside the icon, one at a time.
      for (const other of groups) if (other !== item) setGroup(other, false, { remember: false });
      if (open) placeFlyout(item);
      setGroup(item, open, { remember: false });
      if (open) item.querySelector('.rv-nav__subitem')?.focus();
      return;
    }
    setGroup(item, open);
  };

  const nav = h(
    'nav',
    { class: 'rv-nav', 'aria-label': 'Glavna navigacija' },
    h(
      'ul',
      { class: 'rv-nav__list', role: 'list' },
      NAV.map((item) => {
        if (!item.children) return h('li', {}, navLink(item, active));
        // Open on its own pages; otherwise as the user left it in this tab.
        const hasActive = item.children.some((child) => child.key === active);
        const group = navGroup(item, active, hasActive || stored[item.key] === true, onToggle);
        groups.push(group);
        return group;
      }),
    ),
  );

  const newButton = h(
    'button',
    { type: 'button', class: 'rv-side__new', title: 'Novo' },
    icon('plus', 'rv-nav__icon'),
    h('span', { class: 'rv-nav__label' }, 'Novo'),
  );
  const collapse = h('button', { type: 'button', class: 'rv-side__collapse' });
  const close = h(
    'button',
    { type: 'button', class: 'rv-side__close', 'aria-label': 'Zatvori izbornik' },
    icon('x', 'rv-nav__icon'),
  );
  const avatar = h('span', { class: 'rv-side__avatar', 'aria-hidden': 'true' });
  const userName = h('strong', { class: 'rv-side__user-name' }, 'Prijavljeni korisnik');
  const userRole = h('span', { class: 'rv-side__user-role' }, '');
  const logout = h(
    'button',
    { type: 'button', class: 'rv-nav__item rv-side__logout', title: 'Odjava' },
    icon('log-out', 'rv-nav__icon'),
    h('span', { class: 'rv-nav__label' }, 'Odjava'),
  );

  const side = h(
    'aside',
    { class: 'rv-side', id: 'rv-side', 'aria-label': 'Renvara izbornik', dataset: { rvShell: '' } },
    h(
      'div',
      { class: 'rv-side__top' },
      h(
        'a',
        { class: 'rv-side__brand', href: '/dashboard', 'aria-label': 'Renvara · Početna' },
        h('img', { src: '/brand/renvara-logo.png', alt: '', width: 26, height: 30 }),
        h('span', { class: 'rv-side__brand-name' }, 'RENVARA'),
      ),
      collapse,
      close,
    ),
    newButton,
    nav,
    h(
      'div',
      { class: 'rv-side__bottom' },
      h(
        'div',
        { class: 'rv-side__profile', title: 'Korisnički profil' },
        avatar,
        h('span', { class: 'rv-side__user' }, userName, userRole),
      ),
      h('ul', { class: 'rv-nav__list', role: 'list' }, h('li', {}, navLink(SETTINGS, active))),
      logout,
    ),
  );

  // --------------------------------------------- top bar (tablets, phones) ---
  const menuButton = h(
    'button',
    {
      type: 'button',
      class: 'rv-mobilebar__btn',
      'aria-label': 'Otvori izbornik',
      'aria-controls': 'rv-side',
      'aria-expanded': 'false',
    },
    icon('menu', 'rv-nav__icon'),
  );
  const mobileNew = h(
    'button',
    { type: 'button', class: 'rv-mobilebar__btn rv-mobilebar__new', 'aria-label': 'Novo' },
    icon('plus', 'rv-nav__icon'),
  );
  const bar = h(
    'header',
    { class: 'rv-mobilebar', dataset: { rvShell: '' } },
    menuButton,
    h(
      'a',
      { class: 'rv-side__brand', href: '/dashboard', 'aria-label': 'Renvara · Početna' },
      h('img', { src: '/brand/renvara-logo.png', alt: '', width: 22, height: 26 }),
      h('span', { class: 'rv-side__brand-name' }, 'RENVARA'),
    ),
    mobileNew,
  );
  const backdrop = h('div', { class: 'rv-side-backdrop', hidden: true, dataset: { rvShell: '' } });
  const skip = h(
    'a',
    {
      class: 'rv-skip',
      href: '#',
      dataset: { rvShell: '' },
      onClick: (event) => {
        event.preventDefault();
        const main = document.querySelector('main');
        if (!main) return;
        main.setAttribute('tabindex', '-1');
        main.focus();
      },
    },
    'Preskoči na sadržaj',
  );
  document.body.prepend(skip, bar, backdrop, side);

  // ------------------------------------------------- narrow (computers) ---
  function isCollapsed() {
    return desktop.matches && side.hasAttribute('data-collapsed');
  }
  function setCollapsed(on, { remember = true } = {}) {
    side.toggleAttribute('data-collapsed', on);
    collapse.replaceChildren(icon(on ? 'panel-left-open' : 'panel-left-close', 'rv-nav__icon'));
    collapse.setAttribute('aria-label', on ? 'Proširi izbornik' : 'Sažmi izbornik');
    collapse.title = on ? 'Proširi izbornik' : 'Sažmi izbornik';
    collapse.setAttribute('aria-pressed', String(on));
    if (remember) write(localStorage, COLLAPSED_KEY, on ? '1' : null);
    // Narrow: lists become panels, all closed; wide again (or the drawer): as on arrival.
    const narrow = on && desktop.matches;
    for (const group of groups) {
      const hasActive = group.querySelector('[aria-current="page"]') !== null;
      setGroup(group, narrow ? false : hasActive || openLists()[group.dataset.group] === true, {
        remember: false,
      });
      group.querySelector('.rv-nav__sub').style.top = '';
    }
  }
  function placeFlyout(item) {
    const sub = item.querySelector('.rv-nav__sub');
    const top = item.getBoundingClientRect().top;
    sub.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 220))}px`;
  }
  const closeFlyouts = () => {
    if (!isCollapsed()) return false;
    const open = groups.find((group) => group.classList.contains('is-open'));
    if (open) setGroup(open, false, { remember: false });
    return open ?? false;
  };
  collapse.addEventListener('click', () => setCollapsed(!side.hasAttribute('data-collapsed')));
  setCollapsed(read(localStorage, COLLAPSED_KEY) === '1', { remember: false });

  // ---------------------------------------------- drawer (tablets, phones) ---
  let returnFocus = null;
  function setDrawer(open) {
    side.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    side.inert = !open && !desktop.matches;
    if (open) {
      side.setAttribute('role', 'dialog');
      side.setAttribute('aria-modal', 'true');
      returnFocus = document.activeElement;
      (side.querySelector('[aria-current="page"]') ?? close).focus();
    } else {
      side.removeAttribute('role');
      side.removeAttribute('aria-modal');
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    }
  }
  menuButton.addEventListener('click', () => setDrawer(true));
  close.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));
  const onMedia = () => {
    if (!side.isConnected) return desktop.removeEventListener?.('change', onMedia);
    if (desktop.matches) {
      side.classList.remove('is-open');
      backdrop.hidden = true;
      side.removeAttribute('role');
      side.removeAttribute('aria-modal');
      side.inert = false;
    } else {
      side.inert = !side.classList.contains('is-open');
    }
    setCollapsed(read(localStorage, COLLAPSED_KEY) === '1', { remember: false });
  };
  desktop.addEventListener?.('change', onMedia);
  side.inert = !desktop.matches;

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const flyout = closeFlyouts();
      if (flyout) return flyout.querySelector('.rv-nav__toggle').focus();
      if (side.classList.contains('is-open')) setDrawer(false);
      return;
    }
    // Keep Tab inside the open drawer.
    if (event.key !== 'Tab' || !side.classList.contains('is-open')) return;
    const focusable = [...side.querySelectorAll('a[href], button:not([disabled])')].filter(
      (el) => el.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (isCollapsed() && !event.target.closest?.('.rv-nav__group')) closeFlyouts();
  });

  // ----------------------------------------------------- + Novo, profile ---
  // Quick Add returns to the page it was opened from (with its filters).
  // The drawer closes first, so the sheet keeps the focus it takes.
  let granted = null; // the member's rights, once the session is read
  const allowed = (href) => {
    const needed = permissionForPath(href);
    return !needed || (granted?.has(needed) ?? false);
  };
  for (const trigger of [newButton, mobileNew]) {
    trigger.addEventListener('click', () => {
      if (side.classList.contains('is-open')) setDrawer(false);
    });
    QuickAddSheet({ trigger, returnTo: () => here(), allowed });
  }

  // Until the rights are known, the lists stay invisible (nothing appears and vanishes).
  nav.style.visibility = 'hidden';
  getAccess()
    .then(({ user, permissions }) => {
      granted = permissions;
      for (const link of side.querySelectorAll('a[data-nav]')) {
        if (!allowed(link.getAttribute('href'))) link.closest('li')?.remove();
      }
      for (const group of [...groups]) {
        if (!group.querySelector('.rv-nav__subitem')) {
          group.remove();
          groups.splice(groups.indexOf(group), 1);
        }
      }
      const canAdd = QUICK_ADD_ACTIONS.some((action) => allowed(action.href));
      newButton.hidden = !canAdd;
      mobileNew.hidden = !canAdd;
      for (const brand of document.querySelectorAll('.rv-side__brand')) {
        if (!allowed('/dashboard')) brand.setAttribute('href', firstAllowed() ?? '/dashboard');
      }
      avatar.textContent = initials(user.displayName);
      userName.textContent = user.displayName;
      userRole.textContent = ROLES.find((r) => r.value === user.role)?.label ?? '';
    })
    .catch(() => {})
    .finally(() => {
      nav.style.visibility = '';
    });
  function firstAllowed() {
    return side
      .querySelector('a.rv-nav__item[href], a.rv-nav__subitem[href]')
      ?.getAttribute('href');
  }

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      resetDashboardPeriod(); // a new session starts at the current quarter
      window.location.replace('/login');
    } catch {
      logout.disabled = false;
      showToast('Nije moguće povezati se sa serverom. Pokušajte ponovno.');
    }
  });

  // Back/forward cache: a page restored after signing out goes to the sign-in.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { authenticated: false }))
      .then((session) => {
        if (!session.authenticated) window.location.replace('/login');
      })
      .catch(() => window.location.replace('/login'));
  });
}
