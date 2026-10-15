// KORISNICI (ADR-0014): the rights catalog (and its copy in the database
// migration), the rules, validation, and the whole module over HTTP: 403 on
// pages and API, rights that change open sessions, deactivation that ends them,
// invitation links, password changes, the administration log.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  canSeeWidget,
  DEFAULT_USER_PERMISSIONS,
  effectivePermissions,
  PERMISSION_GROUPS,
  PERMISSIONS,
  permissionSetErrors,
  togglePermission,
} from '../public/app/js/core/permissions.js';
import { permissionForPath, startPage } from '../public/app/js/core/routes.js';
import {
  isValidOib,
  passwordErrors,
  validateUserProfile,
} from '../public/app/js/core/validation.js';
import {
  accessChangeCheck,
  changePasswordDenial,
  DENIED,
  manageDenial,
  statusChangeDenial,
} from '../src/identity/rules.ts';
import {
  cookiePair,
  get,
  login,
  PASSWORD,
  startTestServer,
  USERNAME,
  type TestServer,
} from './helpers.ts';

const here = (path: string) => new URL(path, import.meta.url);
const read = (response: Response) => response.json() as Promise<any>;
const OIB = '69435151530';

// ----------------------------------------------------------- catalog ---
describe('rights catalog', () => {
  it('the database migration seeds exactly the same rights', () => {
    const sql = readFileSync(
      here('../../../supabase/migrations/20261017120000_user_management.sql'),
      'utf8',
    );
    const rows = [
      ...sql.matchAll(
        /\('([a-z_.]+)',\s*'([a-z_]+)',\s*\d+,\s*(true|false),\s*(true|false),\s*'\{([^}]*)\}'\)/g,
      ),
    ].map(([, key = '', group, adminOnly, defaultGrant, requires]) => ({
      key,
      group,
      adminOnly: adminOnly === 'true',
      defaultGrant: defaultGrant === 'true',
      requires: (requires ?? '').split(',').filter(Boolean).sort(),
    }));
    const groupOf = (key: string) =>
      PERMISSION_GROUPS.find((g) => g.items.some((i) => i.key === key))?.key;
    expect(rows.map((r) => r.key)).toEqual(PERMISSIONS.map((p) => p.key));
    for (const row of rows) {
      const def = PERMISSIONS.find((p) => p.key === row.key) as
        { adminOnly?: boolean; requires?: string[] } | undefined;
      expect(row.group, row.key).toBe(groupOf(row.key));
      expect(row.adminOnly, row.key).toBe(def?.adminOnly === true);
      expect(row.requires, row.key).toEqual([...(def?.requires ?? [])].sort());
      expect(row.defaultGrant, row.key).toBe(DEFAULT_USER_PERMISSIONS.includes(row.key));
    }
  });

  it('defaults: the CRM for a Korisnik, no user administration; every set is consistent', () => {
    expect(DEFAULT_USER_PERMISSIONS.some((k) => k.startsWith('users.'))).toBe(false);
    expect(permissionSetErrors(DEFAULT_USER_PERMISSIONS, 'user')).toEqual({});
    expect(permissionSetErrors(ALL_PERMISSIONS, 'admin')).toEqual({});
    expect(Object.keys(permissionSetErrors(['users.view', 'users.create'], 'user'))).toEqual([
      'users.create',
    ]);
    expect(Object.keys(permissionSetErrors(['leads.create'], 'user'))).toEqual(['leads.create']);
    expect(Object.keys(permissionSetErrors(['nope.view'], 'user'))).toEqual(['nope.view']);
  });

  it('a switch brings what it requires and takes what depends on it (widgets too)', () => {
    expect(togglePermission([], 'leads.create', true)).toEqual(['leads.view', 'leads.create']);
    expect(togglePermission([], 'dashboard.won_lost', true)).toEqual([
      'opportunities.view',
      'dashboard.view',
      'dashboard.won_lost',
    ]);
    const all = [...ALL_PERMISSIONS];
    const without = togglePermission(all, 'opportunities.view', false);
    for (const key of [
      'opportunities.create',
      'opportunities.edit',
      'dashboard.won_lost',
      'dashboard.opportunity_value',
    ]) {
      expect(without).not.toContain(key);
    }
    expect(
      togglePermission(all, 'dashboard.view', false).filter((k) => k.startsWith('dashboard.')),
    ).toEqual([]);
  });

  it('effective rights: an owner all, a deactivated member none, unknown keys dropped', () => {
    expect(effectivePermissions({ role: 'owner', status: 'active', permissions: [] }).size).toBe(
      ALL_PERMISSIONS.length,
    );
    expect(effectivePermissions({ role: 'owner', status: 'inactive', permissions: [] }).size).toBe(
      0,
    );
    expect([
      ...effectivePermissions({
        role: 'user',
        status: 'active',
        permissions: ['leads.view', 'x.y'],
      }),
    ]).toEqual(['leads.view']);
    const rights = new Set(['dashboard.view', 'dashboard.leads']);
    expect(canSeeWidget(rights, 'dashboard.leads')).toBe(false); // without leads.view
    rights.add('leads.view');
    expect(canSeeWidget(rights, 'dashboard.leads')).toBe(true);
  });

  it('every page has its right; the start page is the first one allowed', () => {
    expect(permissionForPath('/users')).toBe('users.view');
    expect(permissionForPath('/users/new')).toBe('users.create');
    expect(permissionForPath('/users/abc')).toBe('users.view_details');
    expect(permissionForPath('/sales/leads/abc/convert')).toBe('leads.edit');
    expect(startPage(new Set(['dashboard.view']))).toBe('/dashboard');
    expect(startPage(new Set(['customers.view', 'leads.view']))).toBe('/sales/leads');
    expect(startPage(new Set())).toBeNull();
  });
});

// -------------------------------------------------------- validation ---
describe('member data and password policy', () => {
  it('OIB with its check digit (ISO 7064 MOD 11,10)', () => {
    expect(isValidOib(OIB)).toBe(true);
    expect(isValidOib('69435151531')).toBe(false);
    expect(isValidOib('6943515153')).toBe(false);
    expect(isValidOib('6943515153a')).toBe(false);
  });

  it('every field is required; the e-mail must be free', () => {
    expect(Object.keys(validateUserProfile({}))).toEqual([
      'firstName',
      'lastName',
      'oib',
      'email',
      'phone',
    ]);
    const ok = {
      firstName: 'Ana',
      lastName: 'Horvat',
      oib: OIB,
      email: 'ana@example.com',
      phone: '+385 91 111 2222',
    };
    expect(validateUserProfile(ok)).toEqual({});
    expect(Object.keys(validateUserProfile(ok, { emailTaken: () => true }))).toEqual(['email']);
    expect(Object.keys(validateUserProfile({ ...ok, phone: '12' }))).toEqual(['phone']);
  });

  it('passwords: length, letters and digits, not the name or e-mail, confirmed', () => {
    const ctx = { email: 'ana.horvat@example.com', names: ['Ana', 'Horvat'] };
    expect(passwordErrors('Zelena-livada-2026', 'Zelena-livada-2026', ctx)).toEqual({});
    expect(passwordErrors('kratka1', 'kratka1', ctx)).toHaveProperty('password');
    expect(passwordErrors('samoslovaaaaaa', 'samoslovaaaaaa', ctx)).toHaveProperty('password');
    expect(passwordErrors('Horvat-lozinka-1', 'Horvat-lozinka-1', ctx)).toHaveProperty('password');
    expect(passwordErrors('Zelena-livada-2026', 'Zelena-livada-2027', ctx)).toHaveProperty(
      'confirm',
    );
  });
});

// ------------------------------------------------------------- rules ---
describe('who may do what to whom (rules.ts)', () => {
  const all = new Set(ALL_PERMISSIONS);
  const owner = { id: 'o', role: 'owner' as const, permissions: all };
  const admin = { id: 'a', role: 'admin' as const, permissions: all };
  const plain = { id: 'u', role: 'user' as const, permissions: new Set(['users.view']) };
  const member = (id: string, role: 'owner' | 'admin' | 'user') => ({
    id,
    role,
    status: 'active' as const,
  });

  it('seeing the list does not allow changing anyone', () => {
    expect(manageDenial(plain, member('x', 'user'), 'edit')).toBe(DENIED.forbidden);
    expect(manageDenial(plain, member('x', 'user'), 'deactivate')).toBe(DENIED.forbidden);
  });

  it('administrators and owners are changed only by an owner', () => {
    expect(manageDenial(admin, member('x', 'user'), 'deactivate')).toBeNull();
    expect(manageDenial(admin, member('y', 'admin'), 'deactivate')).toBe(DENIED.ownerOnly);
    expect(manageDenial(admin, member('o', 'owner'), 'edit')).toBe(DENIED.ownerOnly);
    expect(manageDenial(owner, member('y', 'admin'), 'deactivate')).toBeNull();
  });

  it('nobody deactivates themselves or changes their own rights; the last owner stays', () => {
    expect(statusChangeDenial(owner, member('o', 'owner'), 'inactive', 0)).toBe(
      DENIED.selfDeactivate,
    );
    expect(statusChangeDenial(owner, member('o2', 'owner'), 'inactive', 0)).toBe(DENIED.lastOwner);
    expect(statusChangeDenial(owner, member('o2', 'owner'), 'inactive', 1)).toBeNull();
    const self = accessChangeCheck(
      admin,
      member('a', 'admin'),
      { role: 'admin', permissions: [] },
      { role: 'admin', permissions: ['users.view'] },
      1,
    );
    expect(self.denial).toBe(DENIED.selfAccess);
  });

  it('only an owner changes roles; nobody gives or takes a right they lack', () => {
    const target = member('x', 'user');
    const now = { role: 'user' as const, permissions: ['leads.view'] };
    expect(
      accessChangeCheck(admin, target, now, { role: 'admin', permissions: ['leads.view'] }, 1)
        .denial,
    ).toBe(DENIED.roleOwnerOnly);
    const limited = {
      id: 'a2',
      role: 'admin' as const,
      permissions: new Set([
        'users.view',
        'users.view_details',
        'users.manage_permissions',
        'leads.view',
      ]),
    };
    const beyond = accessChangeCheck(
      limited,
      target,
      now,
      { role: 'user', permissions: ['leads.view', 'customers.view'] },
      1,
    );
    expect(beyond.denial).toMatch(/sami nemate/);
    const fine = accessChangeCheck(
      admin,
      target,
      now,
      { role: 'user', permissions: ['customers.view'] },
      1,
    );
    expect(fine).toMatchObject({
      denial: null,
      granted: ['customers.view'],
      revoked: ['leads.view'],
    });
  });

  it('own password: always; someone else’s: the special right', () => {
    expect(changePasswordDenial(plain, member('u', 'user'))).toBeNull();
    expect(changePasswordDenial(plain, member('x', 'user'))).toBe(DENIED.passwordOthers);
    expect(changePasswordDenial(admin, member('x', 'user'))).toBeNull();
  });
});

// -------------------------------------------------------------- HTTP ---
describe('Korisnici over HTTP (local identity)', () => {
  let server: TestServer;
  let owner = '';
  const json = (cookie: string, method: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
  const signIn = async (user: string, password: string) => {
    const response = await login(server.url, user, password);
    return response.ok ? cookiePair(response) : null;
  };
  const tokenOf = (url: string) => new URL(url).hash.replace(/^#token=/, '');
  const ANA = {
    firstName: 'Ana',
    lastName: 'Horvat',
    oib: OIB,
    email: 'ana@example.com',
    phone: '+385 91 111 2222',
  };
  let anaId = '';
  let ana = '';

  beforeAll(async () => {
    server = await startTestServer();
    owner = (await signIn(USERNAME, PASSWORD)) as string;
  });
  afterAll(() => server.close());

  it('the first owner signs in with the server account; the session lists every right', async () => {
    const session = await read(await get(server.url, '/api/auth/session', owner));
    expect(session.user).toMatchObject({ role: 'owner' });
    expect(session.permissions).toHaveLength(ALL_PERMISSIONS.length);
    const list = await read(await json(owner, 'GET', '/api/users'));
    expect(list.users).toHaveLength(1);
    expect(list.users[0]).not.toHaveProperty('oib');
    expect(JSON.stringify(list)).not.toContain(PASSWORD);
  });

  it('creates a member without a password: a one-time link, rights as chosen', async () => {
    const invalid = await json(owner, 'POST', '/api/users', { ...ANA, oib: '12345678901' });
    expect(invalid.status).toBe(422);
    const response = await json(owner, 'POST', '/api/users', {
      ...ANA,
      permissions: ['leads.view', 'leads.create'],
    });
    expect(response.status).toBe(201);
    const body = await read(response);
    anaId = body.user.id;
    expect(body.user.permissions).toEqual(['leads.view', 'leads.create']);
    expect(body.link.delivery).toBe('link');
    expect(body.link.url).toMatch(/\/set-password#token=[A-Za-z0-9_-]{30,}$/);
    expect((await json(owner, 'POST', '/api/users', ANA)).status).toBe(422); // e-mail taken
    // No password yet: no sign-in.
    expect(await signIn(ANA.email, 'Zelena-livada-2026')).toBeNull();

    const token = tokenOf(body.link.url);
    const weak = await fetch(`${server.url}/api/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'kratka1', confirm: 'kratka1' }),
    });
    expect(weak.status).toBe(422);
    const set = await fetch(`${server.url}/api/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        password: 'Zelena-livada-2026',
        confirm: 'Zelena-livada-2026',
      }),
    });
    expect(set.status).toBe(200);
    const again = await fetch(`${server.url}/api/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        password: 'Druga-lozinka-2026',
        confirm: 'Druga-lozinka-2026',
      }),
    });
    expect(again.status).toBe(409);
  });

  it('a member with only Leads: start page, 403 for the rest (page and API), no self-escalation', async () => {
    const response = await login(server.url, 'ANA@example.com', 'Zelena-livada-2026');
    expect(response.status).toBe(200);
    expect((await read(response)).redirectTo).toBe('/sales/leads');
    ana = cookiePair(response);
    expect((await get(server.url, '/dashboard', ana)).headers.get('location')).toBe('/sales/leads');
    for (const path of [
      '/sales/customers',
      '/users',
      '/users/new',
      `/users/${anaId}`,
      '/settings',
    ]) {
      const page = await get(server.url, path, ana);
      expect(page.status, path).toBe(403);
      expect(await page.text(), path).toContain('/app/js/pages/forbidden.js');
    }
    expect((await get(server.url, '/sales/leads', ana)).status).toBe(200);
    for (const [method, path] of [
      ['GET', '/api/customers'],
      ['GET', '/api/tasks'],
      ['GET', '/api/users'],
      ['GET', `/api/users/${anaId}`],
      ['POST', '/api/opportunities'],
      ['GET', '/api/dashboard/summary?from=2026-10-01&to=2026-12-31'],
    ] as const) {
      expect((await json(ana, method, path, method === 'GET' ? undefined : {})).status, path).toBe(
        403,
      );
    }
    expect((await json(ana, 'GET', '/api/leads')).status).toBe(200);
    const escalate = await json(ana, 'PUT', `/api/users/${anaId}/access`, {
      role: 'admin',
      permissions: ALL_PERMISSIONS,
    });
    expect(escalate.status).toBe(403);
  });

  it('rights change for the open session at once', async () => {
    const put = await json(owner, 'PUT', `/api/users/${anaId}/access`, {
      role: 'user',
      permissions: ['leads.view', 'leads.create', 'customers.view'],
    });
    expect(put.status).toBe(200);
    expect((await json(ana, 'GET', '/api/customers')).status).toBe(200);
    expect((await get(server.url, '/sales/customers', ana)).status).toBe(200);
    // Inconsistent or administration rights for a Korisnik are refused.
    expect(
      (
        await json(owner, 'PUT', `/api/users/${anaId}/access`, {
          role: 'user',
          permissions: ['customers.edit'],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await json(owner, 'PUT', `/api/users/${anaId}/access`, {
          role: 'user',
          permissions: ['users.view', 'users.create'],
        })
      ).status,
    ).toBe(422);
    await json(owner, 'PUT', `/api/users/${anaId}/access`, {
      role: 'user',
      permissions: ['leads.view'],
    });
    expect((await json(ana, 'GET', '/api/customers')).status).toBe(403);
  });

  it('deactivation ends the member’s sessions and sign-in, keeps the data; activation restores', async () => {
    expect((await json(owner, 'POST', `/api/users/beta-${USERNAME}/deactivate`, {})).status).toBe(
      403,
    );
    const off = await json(owner, 'POST', `/api/users/${anaId}/deactivate`, {});
    expect(off.status).toBe(200);
    expect((await read(off)).user).toMatchObject({
      status: 'inactive',
      deactivatedBy: `beta-${USERNAME}`,
    });
    expect((await json(ana, 'GET', '/api/leads')).status).toBe(401);
    expect(await signIn(ANA.email, 'Zelena-livada-2026')).toBeNull();
    const inactive = await read(await json(owner, 'GET', '/api/users?status=inactive'));
    expect(inactive.users.map((u: { id: string }) => u.id)).toEqual([anaId]);
    expect((await json(owner, 'POST', `/api/users/${anaId}/deactivate`, {})).status).toBe(409);
    expect((await json(owner, 'POST', `/api/users/${anaId}/activate`, {})).status).toBe(200);
    ana = (await signIn(ANA.email, 'Zelena-livada-2026')) as string;
    expect(ana).toBeTruthy();
  });

  it('password change by the administrator: own password first, sessions end, the member is told', async () => {
    // The first owner confirms with the password from the server settings; theirs cannot be changed here.
    expect(
      (
        await json(owner, 'POST', `/api/users/${anaId}/password`, {
          currentPassword: 'x',
          password: 'Plava-rijeka-2027',
          confirm: 'Plava-rijeka-2027',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await json(owner, 'POST', `/api/users/beta-${USERNAME}/password`, {
          currentPassword: PASSWORD,
          password: 'Plava-rijeka-2027',
          confirm: 'Plava-rijeka-2027',
        })
      ).status,
    ).toBe(409);
    // A second administrator (with a password of their own) changes it.
    const created = await read(
      await json(owner, 'POST', '/api/users', {
        firstName: 'Ivo',
        lastName: 'Admin',
        oib: '33392005961',
        email: 'ivo@example.com',
        phone: '+385 91 222 3333',
        role: 'admin',
        permissions: ALL_PERMISSIONS,
      }),
    );
    await fetch(`${server.url}/api/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: tokenOf(created.link.url),
        password: 'Crveni-most-2026',
        confirm: 'Crveni-most-2026',
      }),
    });
    const ivo = (await signIn('ivo@example.com', 'Crveni-most-2026')) as string;
    const wrong = await json(ivo, 'POST', `/api/users/${anaId}/password`, {
      currentPassword: 'Kriva-2026-xx',
      password: 'Plava-rijeka-2027',
      confirm: 'Plava-rijeka-2027',
    });
    expect(wrong.status).toBe(422);
    const ok = await json(ivo, 'POST', `/api/users/${anaId}/password`, {
      currentPassword: 'Crveni-most-2026',
      password: 'Plava-rijeka-2027',
      confirm: 'Plava-rijeka-2027',
    });
    expect(ok.status).toBe(200);
    expect((await json(ana, 'GET', '/api/leads')).status).toBe(401);
    expect(await signIn(ANA.email, 'Zelena-livada-2026')).toBeNull();
    const again = await login(server.url, ANA.email, 'Plava-rijeka-2027');
    expect((await read(again)).notice).toMatchObject({ passwordChangedAt: expect.any(String) });
    // An administrator cannot change the owner's password, nor deactivate the owner.
    expect((await json(ivo, 'POST', `/api/users/beta-${USERNAME}/deactivate`, {})).status).toBe(
      403,
    );
    // Own password: the session is renewed, others end.
    const self = await json(ivo, 'POST', `/api/users/${created.user.id}/password`, {
      currentPassword: 'Crveni-most-2026',
      password: 'Zuti-cvijet-2027',
      confirm: 'Zuti-cvijet-2027',
    });
    expect(self.status).toBe(200);
    expect((await json(ivo, 'GET', '/api/leads')).status).toBe(401);
    expect((await json(cookiePair(self), 'GET', '/api/leads')).status).toBe(200);
  });

  it('the log names what changed, never passwords, tokens or personal data values', async () => {
    const audit = await read(await json(owner, 'GET', `/api/users/${anaId}/audit`));
    const actions = audit.entries.map(
      (e: { action: string; result: string }) => `${e.action}:${e.result}`,
    );
    for (const expected of [
      'user.create:success',
      'user.access:success',
      'user.deactivate:success',
      'user.activate:success',
      'user.password_change:success',
      'user.password_change:denied',
    ]) {
      expect(actions).toContain(expected);
    }
    const text = JSON.stringify(audit) + server.logs.join('\n');
    for (const secret of [
      'Zelena-livada-2026',
      'Plava-rijeka-2027',
      'Crveni-most-2026',
      OIB,
      PASSWORD,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
