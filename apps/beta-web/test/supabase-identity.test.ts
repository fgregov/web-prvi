// Korisnici on a real Supabase (Auth + database): runs only when a test
// project is given, e.g. the local stack:
//   eval "$(supabase status -o env | sed 's/^/export SB_/')"
//   RENVARA_SUPABASE_TEST_URL=$SB_API_URL RENVARA_SUPABASE_TEST_ANON_KEY=$SB_ANON_KEY \
//   RENVARA_SUPABASE_TEST_SERVICE_KEY=$SB_SERVICE_ROLE_KEY pnpm --filter @renvara/beta-web test
// It creates its own organizations and accounts and deletes them afterwards.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrmForbiddenError, CrmNotFoundError } from '../src/crm/errors.ts';
import { createSupabaseClient } from '../src/identity/supabase-client.ts';
import { createSupabaseIdentityLayer } from '../src/identity/supabase.ts';
import type { ServiceActor } from '../src/identity/user-service.ts';

const URL_ = process.env.RENVARA_SUPABASE_TEST_URL;
const ANON = process.env.RENVARA_SUPABASE_TEST_ANON_KEY ?? '';
const SERVICE = process.env.RENVARA_SUPABASE_TEST_SERVICE_KEY ?? '';
const ORIGIN = 'http://127.0.0.1:3000';

describe.skipIf(!URL_)('Korisnici on Supabase (Auth + admin_* functions)', () => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${run}@renvara.test`;
  const anaEmail = `ana-${run}@renvara.test`;
  const OWNER_PW = 'Vlasnik-lozinka-2026';
  const ANA_PW = 'Zelena-livada-2026';
  const orgA = randomUUID();
  const orgB = randomUUID();
  const created: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'renvara-sb-'));
  const client = createSupabaseClient({ url: URL_ ?? '', anonKey: ANON, serviceRoleKey: SERVICE });
  const layer = (organizationId: string) =>
    createSupabaseIdentityLayer({
      config: { url: URL_ ?? '', anonKey: ANON, serviceRoleKey: SERVICE, organizationId },
      sessionsFile: join(dir, `${organizationId}.json`),
    });
  const A = layer(orgA);
  const B = layer(orgB);
  let ownerId = '';
  let bobId = '';
  let anaId = '';

  async function account(email: string, password: string, name: string) {
    const user = await client.auth<{ id: string }>('/admin/users', {
      method: 'POST',
      body: { email, password, email_confirm: true, user_metadata: { full_name: name } },
      key: 'service',
    });
    created.push(user.id);
    return user.id;
  }
  async function actor(org: string, id: string, users = A.users): Promise<ServiceActor> {
    const access = await users.access(org, id);
    if (!access) throw new Error('not a member');
    return { id, organizationId: org, ...access.access };
  }
  /** What clicking the e-mailed link gives the set-password page: a session token. */
  async function linkToken(email: string): Promise<string> {
    const link = await client.auth<{ action_link: string }>('/admin/generate_link', {
      method: 'POST',
      body: { type: 'recovery', email },
      key: 'service',
    });
    const response = await fetch(link.action_link, { redirect: 'manual' });
    const location = response.headers.get('location') ?? '';
    const token = new URLSearchParams(location.split('#')[1] ?? '').get('access_token');
    if (!token) throw new Error('no session in the link redirect');
    return token;
  }

  beforeAll(async () => {
    ownerId = await account(ownerEmail, OWNER_PW, 'Olga Vlasnik');
    bobId = await account(`bob-${run}@renvara.test`, OWNER_PW, 'Bob Drugi');
    await client.rest('organizations', 'POST', [
      { id: orgA, name: `Renvara test A ${run}`, timezone: 'Europe/Zagreb' },
      { id: orgB, name: `Renvara test B ${run}`, timezone: 'Europe/Zagreb' },
    ]);
    await client.rest('organization_members', 'POST', [
      { organization_id: orgA, user_id: ownerId, role: 'owner' },
      { organization_id: orgB, user_id: bobId, role: 'owner' },
    ]);
  });

  afterAll(async () => {
    await client.rest(`organizations?id=in.(${orgA},${orgB})`, 'DELETE').catch(() => {});
    for (const id of created) {
      await client.auth(`/admin/users/${id}`, { method: 'DELETE', key: 'service' }).catch(() => {});
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('signs the owner in through Supabase Auth; an owner holds every right', async () => {
    const signedIn = await A.authenticate(ownerEmail, OWNER_PW);
    expect(signedIn?.user.id).toBe(ownerId);
    expect(await A.authenticate(ownerEmail, 'Kriva-lozinka-2026')).toBeNull();
    const owner = await actor(orgA, ownerId);
    expect(owner.role).toBe('owner');
    expect(owner.permissions.has('users.manage_permissions')).toBe(true);
  });

  it('creates a member: Auth invitation by e-mail, profile, chosen rights, log', async () => {
    const owner = await actor(orgA, ownerId);
    const { user, link } = await A.users.create(
      owner,
      {
        firstName: 'Ana',
        lastName: 'Horvat',
        oib: '69435151530',
        email: anaEmail.toUpperCase(),
        phone: '+385 91 111 2222',
        permissions: ['leads.view', 'leads.create', 'dashboard.view', 'dashboard.leads'],
      },
      ORIGIN,
    );
    anaId = user.id;
    created.push(anaId);
    expect(link).toEqual({ delivery: 'email' });
    expect(user).toMatchObject({ email: anaEmail, role: 'user', status: 'active' });
    expect([...user.permissions].sort()).toEqual(
      ['dashboard.leads', 'dashboard.view', 'leads.create', 'leads.view'].sort(),
    );
    // Before setting a password the member cannot sign in.
    expect(await A.authenticate(anaEmail, ANA_PW)).toBeNull();
    expect((await A.users.get(owner, anaId)).passwordState).toBe('pending');
  });

  it('the link sets the password once; the member signs in with only her rights', async () => {
    const token = await linkToken(anaEmail);
    await expect(
      A.users.completeLink(orgA, token, { password: 'kratka1', confirm: 'kratka1' }),
    ).rejects.toMatchObject({ errors: { password: expect.any(String) } });
    await A.users.completeLink(orgA, token, { password: ANA_PW, confirm: ANA_PW });
    expect((await A.authenticate(anaEmail, ANA_PW))?.user.id).toBe(anaId);
    const ana = await actor(orgA, anaId);
    expect(ana.role).toBe('user');
    expect([...ana.permissions].sort()).toEqual(
      ['dashboard.leads', 'dashboard.view', 'leads.create', 'leads.view'].sort(),
    );
    await expect(
      A.users.setAccess(ana, anaId, { role: 'user', permissions: ['users.view'] }),
    ).rejects.toBeInstanceOf(CrmForbiddenError);
    await expect(A.users.list(ana, new URLSearchParams())).rejects.toBeInstanceOf(
      CrmForbiddenError,
    );
  });

  it('lists, searches and sorts members of the organization only', async () => {
    const owner = await actor(orgA, ownerId);
    const all = await A.users.list(owner, new URLSearchParams('status=all&sort=email'));
    expect(all.total).toBe(2);
    expect(all.users.map((u) => u.email)).toEqual([anaEmail, ownerEmail].sort());
    const found = await A.users.list(owner, new URLSearchParams('q=horvat'));
    expect(found.users.map((u) => u.id)).toEqual([anaId]);
    expect(found.users[0]).not.toHaveProperty('oib');
    const bob = await actor(orgB, bobId, B.users);
    await expect(B.users.get(bob, anaId)).rejects.toBeInstanceOf(CrmNotFoundError);
    expect((await B.users.list(bob, new URLSearchParams('status=all'))).total).toBe(1);
  });

  it('rights change at once; deactivation blocks sign-in at Auth too; activation restores it', async () => {
    const owner = await actor(orgA, ownerId);
    await A.users.setAccess(owner, anaId, {
      role: 'user',
      permissions: ['leads.view', 'customers.view'],
    });
    expect([...(await actor(orgA, anaId)).permissions].sort()).toEqual([
      'customers.view',
      'leads.view',
    ]);
    await A.users.setStatus(owner, anaId, 'inactive');
    expect(await A.users.access(orgA, anaId)).toBeNull();
    expect(await A.authenticate(anaEmail, ANA_PW)).toBeNull();
    expect(A.validAfter(anaId)).toBeGreaterThan(0);
    await A.users.setStatus(owner, anaId, 'active');
    expect((await A.authenticate(anaEmail, ANA_PW))?.user.id).toBe(anaId);
    await expect(A.users.setStatus(owner, ownerId, 'inactive')).rejects.toBeInstanceOf(
      CrmForbiddenError,
    );
  });

  it('an administrator changes a password after confirming their own; e-mail changes in Auth', async () => {
    const owner = await actor(orgA, ownerId);
    await expect(
      A.users.changePassword(owner, anaId, {
        currentPassword: 'Kriva-lozinka-2026',
        password: 'Plava-rijeka-2027',
        confirm: 'Plava-rijeka-2027',
      }),
    ).rejects.toMatchObject({ errors: { currentPassword: expect.any(String) } });
    await A.users.changePassword(owner, anaId, {
      currentPassword: OWNER_PW,
      password: 'Plava-rijeka-2027',
      confirm: 'Plava-rijeka-2027',
    });
    expect(await A.authenticate(anaEmail, ANA_PW)).toBeNull();
    const signedIn = await A.authenticate(anaEmail, 'Plava-rijeka-2027');
    expect(signedIn?.notice).toMatchObject({ passwordChangedAt: expect.any(String) });

    const newEmail = `ana.nova-${run}@renvara.test`;
    await A.users.update(owner, anaId, {
      firstName: 'Ana',
      lastName: 'Horvat',
      oib: '69435151530',
      email: newEmail,
      phone: '+385 91 111 2222',
    });
    expect((await A.authenticate(newEmail, 'Plava-rijeka-2027'))?.user.id).toBe(anaId);
  });

  it('logs every administration step without secrets', async () => {
    const owner = await actor(orgA, ownerId);
    const entries = await A.users.audit(owner, anaId);
    const actions = entries.map((e) => `${e.action}:${e.result}`);
    for (const expected of [
      'user.create:success',
      'user.access:success',
      'user.deactivate:success',
      'user.activate:success',
      'user.password_change:success',
      'user.password_change:denied',
      'user.update:success',
    ]) {
      expect(actions).toContain(expected);
    }
    const text = JSON.stringify(entries);
    for (const secret of [ANA_PW, OWNER_PW, 'Plava-rijeka-2027', '69435151530']) {
      expect(text).not.toContain(secret);
    }
  });
});
