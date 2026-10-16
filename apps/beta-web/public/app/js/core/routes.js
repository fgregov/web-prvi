// Every page of the web app has its own address (ADR-0013). One table for the
// BETA server (src/app.ts) and the in-browser demo (demo/runtime.js), so the
// two cannot drift apart:
//   page name = the HTML shell in public/app/pages (customers → customers.html)
//   nav key   = the sidebar item a page belongs to (ui/app-shell.js)
// Home (/dashboard) and the sign-in (/login) are served separately.

const ID = '[A-Za-z0-9_-]{1,64}';

/** Exact addresses → page. They win over the patterns ("/sales/tasks/new" is not a task id). */
export const PAGE_ROUTES = {
  '/follow-up': 'follow-up',
  '/follow-up/new': 'follow-up-new',
  '/sales/leads': 'leads',
  '/sales/leads/new': 'lead-new',
  '/sales/opportunities': 'opportunity-list',
  '/sales/opportunities/new': 'opportunity-new',
  '/sales/tasks': 'tasks',
  '/sales/tasks/new': 'task-form',
  '/sales/customers': 'customers',
  '/sales/customers/new': 'customer-new',
  '/sales/contacts/new': 'contact-new',
  '/sales-calendar': 'calendar',
  '/opportunity-pipeline': 'opportunity-pipeline',
  '/feedback-overview': 'feedback-overview',
  '/reports': 'reports',
  '/users': 'users',
  '/users/new': 'user-new',
  '/settings': 'notifications',
};

/** Record pages: [pattern, page]. */
export const PAGE_PATTERNS = [
  [new RegExp(`^/sales/leads/${ID}$`), 'lead'],
  [new RegExp(`^/sales/leads/${ID}/convert$`), 'lead-convert'],
  [new RegExp(`^/sales/opportunities/${ID}$`), 'opportunity'],
  [new RegExp(`^/sales/tasks/${ID}$`), 'task'],
  [new RegExp(`^/sales/tasks/${ID}/edit$`), 'task-form'],
  [new RegExp(`^/sales/customers/${ID}$`), 'customer'],
  [new RegExp(`^/follow-up/${ID}$`), 'follow-up-offer'],
  [new RegExp(`^/follow-up/${ID}/preview$`), 'follow-up-preview'],
  [new RegExp(`^/users/${ID}$`), 'user'],
];

/** The page at `pathname`, or null. */
export function pageForPath(pathname) {
  return (
    PAGE_ROUTES[pathname] ?? PAGE_PATTERNS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
  );
}

/**
 * Addresses from before the web navigation → where that page is now, so saved
 * links, bookmarks and notifications already delivered keep working. The
 * query and the #section stay as they were (the caller adds the query; the
 * browser keeps the fragment across a redirect). Null: not an old address.
 */
export function legacyPath(pathname) {
  if (pathname === '/opportunities') return '/opportunity-pipeline'; // it was the pipeline
  if (pathname === '/calendar') return '/sales-calendar';
  if (pathname === '/notifications') return '/settings';
  if (pathname === '/more') return '/dashboard'; // "Više" is the sidebar's "Prikaz više" now
  const old = /^\/(leads|opportunities|tasks|customers|contacts)(\/.*)?$/.exec(pathname);
  return old ? `/sales/${old[1]}${old[2] ?? ''}` : null;
}

/** The sidebar item of a page: forms and records are under their list. */
export function navKeyForPath(pathname) {
  if (pathname === '/dashboard') return 'home';
  if (pathname === '/follow-up' || pathname.startsWith('/follow-up/')) return 'follow-up';
  const sales = /^\/sales\/(leads|opportunities|tasks|customers|contacts)(?:\/|$)/.exec(pathname);
  if (sales) return sales[1] === 'contacts' ? 'customers' : sales[1];
  const top = {
    '/sales-calendar': 'sales-calendar',
    '/opportunity-pipeline': 'opportunity-pipeline',
    '/feedback-overview': 'feedback-overview',
    '/reports': 'reports',
    '/settings': 'settings',
  };
  if (pathname === '/users' || pathname.startsWith('/users/')) return 'users';
  return top[pathname] ?? null;
}

/**
 * The right a page needs (core/permissions.js). The server answers 403 without
 * it; the sidebar does not offer the page. Null: no page of the app.
 */
export function permissionForPath(pathname) {
  const exact = {
    '/dashboard': 'dashboard.view',
    '/follow-up/new': 'follow_up.create',
    '/sales/leads/new': 'leads.create',
    '/sales/opportunities/new': 'opportunities.create',
    '/sales/tasks/new': 'tasks.create',
    '/sales/customers/new': 'customers.create',
    '/sales/contacts/new': 'customers.edit',
    '/sales-calendar': 'calendar.view',
    '/opportunity-pipeline': 'pipeline.view',
    '/feedback-overview': 'feedback.view',
    '/reports': 'reports.view',
    '/users': 'users.view',
    '/users/new': 'users.create',
    '/settings': 'notifications.view',
  };
  if (exact[pathname]) return exact[pathname];
  if (/\/edit$/.test(pathname) && pathname.startsWith('/sales/tasks/')) return 'tasks.edit';
  if (/\/convert$/.test(pathname) && pathname.startsWith('/sales/leads/')) return 'leads.edit';
  if (pathname === '/follow-up' || pathname.startsWith('/follow-up/')) return 'follow_up.view';
  const sales = /^\/sales\/(leads|opportunities|tasks|customers)(?:\/|$)/.exec(pathname);
  if (sales) return `${sales[1]}.view`;
  if (pathname.startsWith('/users/')) return 'users.view_details';
  return null;
}

/** Where someone without the Dashboard starts: the first page of the sidebar they may open. */
export const START_PAGES = Object.freeze([
  ['/dashboard', 'dashboard.view'],
  ['/follow-up', 'follow_up.view'],
  ['/sales/leads', 'leads.view'],
  ['/sales/opportunities', 'opportunities.view'],
  ['/sales/tasks', 'tasks.view'],
  ['/sales/customers', 'customers.view'],
  ['/sales-calendar', 'calendar.view'],
  ['/opportunity-pipeline', 'pipeline.view'],
  ['/feedback-overview', 'feedback.view'],
  ['/reports', 'reports.view'],
  ['/users', 'users.view'],
  ['/settings', 'notifications.view'],
]);

/** The first page `permissions` (a Set) allows, or null when it allows none. */
export function startPage(permissions) {
  return START_PAGES.find(([, key]) => permissions.has(key))?.[0] ?? null;
}
