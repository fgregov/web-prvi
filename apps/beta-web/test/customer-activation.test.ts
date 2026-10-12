// Customer deactivation / reactivation: the same customer record moves between
// the active and inactive list, with nothing deleted or changed around it, and
// the Customers list filter Aktivni | Neaktivni | Svi.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrmNotFoundError, CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository } from '../src/crm/repository.ts';
import { seedDemoData } from '../src/crm/seed.ts';
import type { CrmContext, CrmData } from '../src/crm/types.ts';
import { MESSAGES as API_MESSAGES } from '../src/messages.ts';
import { cookiePair, login, PASSWORD, startTestServer, USERNAME } from './helpers.ts';

const TZ = 'Europe/Zagreb';
const NOW = new Date('2026-10-12T10:00:00Z');
const ctxOf = (organizationId: string, now = NOW): CrmContext => ({
  organizationId,
  user: { id: 'u-frane', displayName: 'Frane' },
  timeZone: TZ,
  now,
});
const ctx = ctxOf('org-a');
const later = ctxOf('org-a', new Date('2026-10-13T08:00:00Z'));

function setup() {
  const data = seedDemoData(ctx);
  const other = seedDemoData(ctxOf('org-b'));
  for (const key of [
    'customers',
    'contacts',
    'opportunities',
    'tasks',
    'offers',
    'activities',
    'leads',
  ] as const)
    (data[key] as unknown[]).push(...other[key]);
  const crm = createCrmServices(createMemoryRepository(data));
  const byName = (name: string, org = 'org-a') =>
    crm.repo.data().customers.find((c) => c.organizationId === org && c.companyName === name)!;
  const nova = byName('Nova d.o.o.');
  // A reminder on one of the customer's tasks, to show it is left alone too.
  const task = crm.tasks.createTask(ctx, { title: 'Nazvati Novu', companyId: nova.id });
  crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-20T08:00:00.000Z');
  return { crm, byName, nova };
}

/** Everything around a customer except the customer row and its timeline. */
function around(data: CrmData, companyId: string) {
  const deals = data.opportunities.filter((o) => o.companyId === companyId);
  const dealIds = new Set(deals.map((o) => o.id));
  const tasks = data.tasks.filter((t) => t.companyId === companyId);
  const taskIds = new Set(tasks.map((t) => t.id));
  return structuredClone({
    contacts: data.contacts.filter((c) => c.companyId === companyId),
    opportunities: deals,
    offers: data.offers.filter((o) => dealIds.has(o.opportunityId)),
    tasks,
    reminders: data.reminders.filter((r) => r.taskId && taskIds.has(r.taskId)),
    leads: data.leads,
  });
}

describe('deactivate / reactivate (service)', () => {
  it('deactivates: inactive, stamped with when and who, logged on the timeline', () => {
    const { crm, nova } = setup();
    const result = crm.customers.setActive(ctx, nova.id, false);
    expect(result).toMatchObject({
      id: nova.id,
      status: 'inactive',
      deactivatedAt: NOW.toISOString(),
      deactivatedBy: 'u-frane',
      type: 'customer', // the commercial type is a separate thing
    });
    const entry = crm.customers.getProfile(ctx, nova.id).activities[0]!;
    expect(entry).toMatchObject({ type: 'customer_deactivated', title: 'Kupac deaktiviran' });
  });

  it('keeps contacts, opportunities, offers, tasks, reminders and leads exactly as they were', () => {
    const { crm, nova } = setup();
    const before = around(crm.repo.data(), nova.id);
    expect(before.contacts.length).toBeGreaterThan(0);
    expect(before.opportunities.length).toBeGreaterThan(0);
    expect(before.offers.length).toBeGreaterThan(0);
    expect(before.tasks.length).toBeGreaterThan(0);
    expect(before.reminders).toHaveLength(1);
    crm.customers.setActive(ctx, nova.id, false);
    expect(around(crm.repo.data(), nova.id)).toEqual(before);
    crm.customers.setActive(later, nova.id, true);
    expect(around(crm.repo.data(), nova.id)).toEqual(before);
  });

  it('reactivates the same record: same id, no duplicate, stamps cleared, logged', () => {
    const { crm, nova } = setup();
    const count = crm.repo.data().customers.length;
    crm.customers.setActive(ctx, nova.id, false);
    const back = crm.customers.setActive(later, nova.id, true);
    expect(back).toMatchObject({
      id: nova.id,
      status: 'active',
      deactivatedAt: null,
      deactivatedBy: null,
    });
    expect(crm.repo.data().customers).toHaveLength(count);
    expect(crm.customers.getProfile(ctx, nova.id).activities[0]).toMatchObject({
      type: 'customer_reactivated',
      title: 'Kupac ponovno aktiviran',
    });
  });

  it('repeating an action changes nothing and logs nothing', () => {
    const { crm, nova } = setup();
    crm.customers.setActive(ctx, nova.id, false);
    const entries = crm.repo.data().activities.length;
    crm.customers.setActive(later, nova.id, false);
    expect(crm.repo.data().activities).toHaveLength(entries);
    expect(crm.customers.getCustomer(ctx, nova.id).deactivatedAt).toBe(NOW.toISOString());
  });

  it('cannot reach a customer of another organization', () => {
    const { crm, byName } = setup();
    const foreign = byName('Nova d.o.o.', 'org-b');
    expect(() => crm.customers.setActive(ctx, foreign.id, false)).toThrow(CrmNotFoundError);
    expect(foreign.status).toBe('active');
    expect(() => crm.customers.setActive(ctx, 'missing', false)).toThrow(CrmNotFoundError);
  });

  it('leaves reports unchanged (KPIs, pipeline, feedback overview, offers overview)', () => {
    const { crm, nova } = setup();
    const report = () => {
      const s = crm.dashboard.getPeriodSummary(ctx, '2026-10-01', '2026-12-31');
      const offers = crm.offers.overview(ctx, '2026-10-01', '2026-12-31');
      return {
        kpis: s.kpis,
        pipeline: s.pipelineOverview,
        feedback: s.feedback,
        offers: offers.items.map(({ customerActive: _, ...item }) => item),
      };
    };
    const before = report();
    crm.customers.setActive(ctx, nova.id, false);
    expect(report()).toEqual(before);
    // The offers overview says plainly the customer is inactive.
    const novaOffers = crm.offers
      .overview(ctx, '2026-10-01', '2026-12-31')
      .items.filter((i) => i.companyId === nova.id);
    expect(novaOffers.length).toBeGreaterThan(0);
    expect(novaOffers.every((i) => i.customerActive === false)).toBe(true);
  });

  it('the edit form status and a customer created as inactive get the same stamps', () => {
    const { crm, nova } = setup();
    const profile = crm.customers.getProfile(ctx, nova.id);
    crm.customers.updateCustomer(ctx, nova.id, {
      ...profile,
      status: 'inactive',
      contactName: 'Petra Novak',
    });
    expect(crm.customers.getCustomer(ctx, nova.id)).toMatchObject({
      status: 'inactive',
      deactivatedAt: NOW.toISOString(),
    });
    expect(
      crm.customers
        .getProfile(ctx, nova.id)
        .activities.map((a) => a.type)
        .slice(0, 2),
    ).toEqual(['customer_updated', 'customer_deactivated']);
    const created = crm.customers.createCustomer(ctx, {
      companyName: 'Stari kupac d.o.o.',
      oib: '12345678903',
      city: 'Split',
      contactName: 'Ivo Ivić',
      status: 'inactive',
    });
    expect(created).toMatchObject({ status: 'inactive', deactivatedBy: 'u-frane' });
    // An update that does not mention the status leaves the activation alone.
    const { status: _, ...withoutStatus } = crm.customers.getProfile(ctx, nova.id);
    crm.customers.updateCustomer(later, nova.id, { ...withoutStatus, contactName: 'Petra Novak' });
    expect(crm.customers.getCustomer(ctx, nova.id).status).toBe('inactive');
  });

  it('an older inactive record without stamps is listed as inactive and can be reactivated', () => {
    const { crm, nova } = setup();
    const row = crm.repo.data().customers.find((c) => c.id === nova.id)!;
    row.status = 'inactive';
    delete row.deactivatedAt;
    delete row.deactivatedBy;
    expect(crm.customers.listCustomers(ctx, { status: 'inactive' }).map((c) => c.id)).toEqual([
      nova.id,
    ]);
    expect(crm.customers.setActive(ctx, nova.id, true)).toMatchObject({ status: 'active' });
  });
});

describe('Customers list filter (service)', () => {
  it('Aktivni | Neaktivni | Svi; without a filter every customer (pickers, duplicate checks)', () => {
    const { crm, nova } = setup();
    crm.customers.setActive(ctx, nova.id, false);
    const names = (status?: string) =>
      crm.customers.listCustomers(ctx, status ? { status } : {}).map((c) => c.companyName);
    expect(names('active')).not.toContain('Nova d.o.o.');
    expect(names('inactive')).toEqual(['Nova d.o.o.']);
    expect(names('all')).toContain('Nova d.o.o.');
    expect(names('all')).toHaveLength(names('active').length + 1);
    expect(names()).toEqual(names('all'));
  });

  it('search stays within the filter', () => {
    const { crm, nova } = setup();
    crm.customers.setActive(ctx, nova.id, false);
    expect(crm.customers.listCustomers(ctx, { q: 'nova', status: 'active' })).toEqual([]);
    expect(
      crm.customers.listCustomers(ctx, { q: 'nova', status: 'inactive' }).map((c) => c.id),
    ).toEqual([nova.id]);
    expect(
      crm.customers.listCustomers(ctx, { q: nova.oib.slice(0, 5), status: 'all' }).map((c) => c.id),
    ).toEqual([nova.id]);
  });

  it('rejects an unknown filter', () => {
    const { crm } = setup();
    expect(() => crm.customers.listCustomers(ctx, { status: 'archived' })).toThrow(
      CrmValidationError,
    );
  });
});

describe('POST /api/customers/{id}/deactivate|activate over HTTP', () => {
  let close: () => Promise<void>;
  let url: string;
  let cookie: string;
  let crm: CrmServices;
  let novaId: string;
  let foreignId: string;

  beforeEach(async () => {
    const data = seedDemoData(ctxOf('org-beta'));
    const other = seedDemoData(ctxOf('org-other'));
    for (const key of [
      'customers',
      'contacts',
      'opportunities',
      'tasks',
      'offers',
      'activities',
    ] as const)
      (data[key] as unknown[]).push(...other[key]);
    crm = createCrmServices(createMemoryRepository(data));
    const find = (org: string) =>
      data.customers.find((c) => c.organizationId === org && c.companyName === 'Nova d.o.o.')!.id;
    novaId = find('org-beta');
    foreignId = find('org-other');
    const server = await startTestServer(undefined, {
      crm: { services: crm, organizationId: 'org-beta', timeZone: TZ, now: () => NOW },
    });
    close = server.close;
    url = server.url;
    cookie = cookiePair(await login(url, USERNAME, PASSWORD));
  });
  afterEach(() => close());

  const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const list = async (status: string) =>
    (
      (await (
        await fetch(`${url}/api/customers?status=${status}`, { headers: { Cookie: cookie } })
      ).json()) as { customers: Array<{ id: string }> }
    ).customers.map((c) => c.id);

  it('deactivates and reactivates; the list filter follows', async () => {
    const off = await post(`/api/customers/${novaId}/deactivate`);
    expect(off.status).toBe(200);
    expect(((await off.json()) as { customer: unknown }).customer).toMatchObject({
      id: novaId,
      status: 'inactive',
    });
    expect(await list('inactive')).toEqual([novaId]);
    expect(await list('active')).not.toContain(novaId);
    const on = await post(`/api/customers/${novaId}/activate`);
    expect(on.status).toBe(200);
    expect(((await on.json()) as { customer: unknown }).customer).toMatchObject({
      id: novaId,
      status: 'active',
    });
    expect(await list('inactive')).toEqual([]);
  });

  it('takes the organization from the session, never from the request', async () => {
    const response = await post(
      `/api/customers/${foreignId}/deactivate`,
      {},
      { organizationId: 'org-other' },
    );
    expect(response.status).toBe(404);
    expect(crm.repo.data().customers.find((c) => c.id === foreignId)!.status).toBe('active');
  });

  it('needs a session and a same-origin JSON request', async () => {
    const anonymous = await fetch(`${url}/api/customers/${novaId}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      success: false,
      message: API_MESSAGES.sessionRequired,
    });
    expect(
      (await post(`/api/customers/${novaId}/deactivate`, { Origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(crm.repo.data().customers.find((c) => c.id === novaId)!.status).toBe('active');
  });

  it('rejects an unknown list filter with 422', async () => {
    const response = await fetch(`${url}/api/customers?status=deleted`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(422);
  });
});
