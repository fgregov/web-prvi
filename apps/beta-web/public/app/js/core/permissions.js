// Renvara access rights (ADR-0014): one catalog for the browser (navigation,
// forms) and the server (the authority: every page and API call is checked
// there). The same keys are stored in Supabase (public.permission_definitions,
// supabase/migrations/20261017120000_user_management.sql; a test compares them).
//
// A key is "<module>.<action>". Roles:
//   owner  everything, always (cannot be restricted); at least one stays active
//   admin  the rights given to it; the only role that may hold user administration
//   user   the rights given to it

export const ROLES = Object.freeze([
  { value: 'owner', label: 'Vlasnik' },
  { value: 'admin', label: 'Administrator' },
  { value: 'user', label: 'Korisnik' },
]);

const view = (module, label, extra = {}) => ({ key: `${module}.view`, label, ...extra });

/**
 * Groups as the administration screen shows them. `requires`: rights a right
 * needs to make sense (creating leads needs seeing leads; a Dashboard widget
 * needs the Dashboard and the data right it shows); `adminOnly`: only an
 * administrator (or the owner) may hold it; `needs`: for a Dashboard widget,
 * the data right it shows (a widget never shows data its user may not see).
 */
export const PERMISSION_GROUPS = Object.freeze([
  {
    key: 'sales',
    title: 'Prodaja',
    items: [
      view('leads', 'Leads — pregled'),
      { key: 'leads.create', label: 'Leads — kreiranje', requires: ['leads.view'] },
      { key: 'leads.edit', label: 'Leads — uređivanje', requires: ['leads.view'] },
      view('opportunities', 'Prilike — pregled'),
      {
        key: 'opportunities.create',
        label: 'Prilike — kreiranje',
        requires: ['opportunities.view'],
      },
      {
        key: 'opportunities.edit',
        label: 'Prilike — uređivanje',
        requires: ['opportunities.view'],
      },
      view('tasks', 'Zadaci — pregled'),
      { key: 'tasks.create', label: 'Zadaci — kreiranje', requires: ['tasks.view'] },
      { key: 'tasks.edit', label: 'Zadaci — uređivanje', requires: ['tasks.view'] },
      view('customers', 'Kupci — pregled'),
      { key: 'customers.create', label: 'Kupci — kreiranje', requires: ['customers.view'] },
      {
        key: 'customers.edit',
        label: 'Kupci — uređivanje (i kontakti)',
        requires: ['customers.view'],
      },
    ],
  },
  {
    key: 'modules',
    title: 'Dodatne funkcije',
    items: [
      view('follow_up', 'Follow-up engine — pregled'),
      {
        key: 'follow_up.create',
        label: 'Follow-up engine — nove ponude i PDF',
        requires: ['follow_up.view'],
      },
      {
        key: 'follow_up.edit',
        label: 'Follow-up engine — uređivanje ponuda',
        requires: ['follow_up.view'],
      },
      view('calendar', 'Sales kalendar'),
      view('pipeline', 'Opportunity pipeline'),
      view('feedback', 'Feedback overview'),
      view('reports', 'Izvještaji'),
    ],
  },
  {
    key: 'dashboard',
    title: 'Dashboard — prava pregleda',
    master: 'dashboard.view',
    items: [
      { key: 'dashboard.view', label: 'Dozvoli pristup Dashboardu' },
      {
        key: 'dashboard.leads',
        label: 'Leads KPI',
        requires: ['dashboard.view', 'leads.view'],
        needs: 'leads.view',
      },
      {
        key: 'dashboard.won_lost',
        label: 'WON / LOST KPI',
        requires: ['dashboard.view', 'opportunities.view'],
        needs: 'opportunities.view',
      },
      {
        key: 'dashboard.opportunity_value',
        label: 'Opportunity KPI (potencijal / dobiveno)',
        requires: ['dashboard.view', 'opportunities.view'],
        needs: 'opportunities.view',
      },
      {
        key: 'dashboard.pipeline',
        label: 'Opportunity pipeline',
        requires: ['dashboard.view', 'pipeline.view'],
        needs: 'pipeline.view',
      },
      {
        key: 'dashboard.calendar',
        label: 'Sales kalendar',
        requires: ['dashboard.view', 'calendar.view'],
        needs: 'calendar.view',
      },
      {
        key: 'dashboard.priority_tasks',
        label: 'Prioritetni zadaci',
        requires: ['dashboard.view', 'tasks.view'],
        needs: 'tasks.view',
      },
      {
        key: 'dashboard.feedback',
        label: 'Feedback overview',
        requires: ['dashboard.view', 'feedback.view'],
        needs: 'feedback.view',
      },
      {
        key: 'dashboard.waiting_response',
        label: 'Čekaš odgovor (follow-upi bez odgovora, prošli periodi)',
        requires: ['dashboard.view', 'follow_up.view'],
        needs: 'follow_up.view',
      },
      {
        key: 'dashboard.notifications',
        label: 'Obavijesti',
        requires: ['dashboard.view', 'notifications.view'],
        needs: 'notifications.view',
      },
    ],
  },
  {
    key: 'users',
    title: 'Upravljanje korisnicima',
    items: [
      { key: 'users.view', label: 'Pregled liste korisnika' },
      {
        key: 'users.create',
        label: 'Kreiranje novih korisnika',
        requires: ['users.view'],
        adminOnly: true,
      },
      { key: 'users.view_details', label: 'Pregled detalja korisnika', requires: ['users.view'] },
      {
        key: 'users.edit',
        label: 'Uređivanje korisničkih podataka',
        requires: ['users.view_details'],
        adminOnly: true,
      },
      {
        key: 'users.deactivate',
        label: 'Deaktivacija / aktivacija korisnika',
        requires: ['users.view'],
        adminOnly: true,
      },
      {
        key: 'users.change_password',
        label: 'Promjena lozinke drugog korisnika',
        requires: ['users.view_details'],
        adminOnly: true,
      },
      {
        key: 'users.manage_permissions',
        label: 'Upravljanje pravima pristupa',
        requires: ['users.view_details'],
        adminOnly: true,
      },
    ],
  },
  {
    key: 'notifications',
    title: 'Obavijesti',
    items: [
      { key: 'notifications.view', label: 'Omogući pristup obavijestima' },
      {
        key: 'notifications.web_push',
        label: 'Omogući web push obavijesti',
        requires: ['notifications.view'],
      },
    ],
  },
]);

export const PERMISSIONS = Object.freeze(PERMISSION_GROUPS.flatMap((group) => group.items));
export const PERMISSION_KEYS = Object.freeze(PERMISSIONS.map((p) => p.key));
const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

export const permissionLabel = (key) => BY_KEY.get(key)?.label ?? key;
export const isAdminOnly = (key) => BY_KEY.get(key)?.adminOnly === true;

/** A new user's rights unless the administrator chooses others: the CRM, no administration. */
export const DEFAULT_USER_PERMISSIONS = Object.freeze(
  PERMISSION_KEYS.filter((key) => !key.startsWith('users.')),
);

/** Everything an owner has (owners are never restricted). */
export const ALL_PERMISSIONS = PERMISSION_KEYS;

/**
 * The rights a member actually has: an owner all of them, others the stored
 * ones that exist in the catalog. Inactive members have none.
 */
export function effectivePermissions({ role, status, permissions }) {
  if (status !== 'active') return new Set();
  if (role === 'owner') return new Set(ALL_PERMISSIONS);
  return new Set((permissions ?? []).filter((key) => BY_KEY.has(key)));
}

/**
 * Problems of a set of rights for a role, by key: unknown keys, a right
 * without the rights it requires, administration rights for a non-administrator.
 */
export function permissionSetErrors(keys, role) {
  const set = new Set(keys);
  const errors = {};
  for (const key of set) {
    const def = BY_KEY.get(key);
    if (!def) {
      errors[key] = 'Nepoznato pravo.';
      continue;
    }
    const missing = (def.requires ?? []).filter((r) => !set.has(r));
    if (missing.length) {
      errors[key] = `Zahtijeva i pravo: ${missing.map(permissionLabel).join(', ')}.`;
    } else if (def.adminOnly && role !== 'admin' && role !== 'owner') {
      errors[key] = 'Ovo pravo može imati samo administrator.';
    }
  }
  return errors;
}

/** Turning a right on turns on what it requires; turning it off turns off what needs it. */
export function togglePermission(keys, key, on) {
  const set = new Set(keys);
  if (on) {
    const add = (k) => {
      if (set.has(k)) return;
      set.add(k);
      for (const r of BY_KEY.get(k)?.requires ?? []) add(r);
    };
    add(key);
  } else {
    const remove = (k) => {
      set.delete(k);
      for (const p of PERMISSIONS) if (set.has(p.key) && p.requires?.includes(k)) remove(p.key);
    };
    remove(key);
  }
  return [...set].sort((a, b) => PERMISSION_KEYS.indexOf(a) - PERMISSION_KEYS.indexOf(b));
}

/** A Dashboard widget is shown with its own right and the data right it needs. */
export function canSeeWidget(permissions, widgetKey) {
  const def = BY_KEY.get(widgetKey);
  return (
    permissions.has('dashboard.view') &&
    permissions.has(widgetKey) &&
    (!def?.needs || permissions.has(def.needs))
  );
}
