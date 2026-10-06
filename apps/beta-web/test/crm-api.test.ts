// /api/* CRM endpoints over real HTTP: session required, JSON + same-origin
// writes, organization from the server, relation errors (TEST G), calendar ranges.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../public/app/js/core/validation.js';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository } from '../src/crm/repository.ts';
import { seedDemoData } from '../src/crm/seed.ts';
import type { CrmContext } from '../src/crm/types.ts';
import { MESSAGES as API_MESSAGES } from '../src/messages.ts';
import {
  cookiePair,
  login,
  PASSWORD,
  startTestServer,
  USERNAME,
  type TestServer,
} from './helpers.ts';

const NOW = new Date('2026-10-05T09:00:00Z'); // 11:00 in Zagreb
const ORG = 'org-beta';
const ctx = (organizationId: string): CrmContext => ({
  organizationId,
  user: { id: 'seed', displayName: 'Seed' },
  timeZone: 'Europe/Zagreb',
  now: NOW,
});

let server: TestServer;
let crm: CrmServices;
let cookie: string;

beforeEach(async () => {
  // Two organizations in one store: the BETA account belongs to org-beta only.
  const data = seedDemoData(ctx(ORG));
  const other = seedDemoData(ctx('org-other'));
  for (const key of ['customers', 'contacts', 'opportunities', 'tasks', 'activities'] as const) {
    (data[key] as unknown[]).push(...other[key]);
  }
  crm = createCrmServices(createMemoryRepository(data));
  server = await startTestServer(undefined, {
    crm: { services: crm, organizationId: ORG, timeZone: 'Europe/Zagreb', now: () => NOW },
  });
  cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
});
afterEach(async () => {
  await server.close();
});

function api(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return fetch(`${server.url}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Cookie: cookie,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
// Response bodies are checked field by field in the assertions.
type Body = Record<string, any>;
const json = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Body,
});
const customerId = (orgId: string, name: string) =>
  crm.repo
    .data()
    .customers.find((c) => c.organizationId === orgId && c.companyName.startsWith(name))!.id;

describe('access', () => {
  it('requires a session for every CRM endpoint', async () => {
    for (const [method, path] of [
      ['GET', '/api/tasks'],
      ['GET', '/api/calendar?date=2026-10-05'],
      ['POST', '/api/tasks'],
      ['GET', '/api/customers'],
      ['POST', '/api/demo/reset'],
    ] as const) {
      const response = await fetch(`${server.url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(response.status, path).toBe(401);
      expect(await response.json()).toEqual({
        success: false,
        message: API_MESSAGES.sessionRequired,
      });
    }
  });

  it('accepts writes only as same-origin JSON', async () => {
    expect(
      (
        await api('/api/tasks', {
          method: 'POST',
          body: { title: 'X' },
          headers: { Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('/api/tasks', {
          method: 'POST',
          body: { title: 'X' },
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    const form = await fetch(`${server.url}/api/tasks`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'title=X',
    });
    expect(form.status).toBe(415);
    const array = await fetch(`${server.url}/api/tasks`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '[]',
    });
    expect(array.status).toBe(400);
    expect((await api('/api/tasks', { method: 'DELETE' })).status).toBe(405);
  });
});

describe('tasks', () => {
  it('creates, reads, updates, completes and cancels a task', async () => {
    const created = await json(
      await api('/api/tasks', { method: 'POST', body: { title: 'Samostalni', type: 'call' } }),
    );
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({
      title: 'Samostalni',
      type: 'call',
      status: 'open',
      organizationId: ORG,
    });
    const id = created.body.task.id;

    const patched = await json(
      await api(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: { title: 'Samostalni', type: 'call', scheduledStartAt: '2026-10-05T14:00:00Z' },
      }),
    );
    expect(patched.body.task.scheduledDate).toBe('2026-10-05');
    const day = await json(await api('/api/calendar?date=2026-10-05'));
    expect(day.body.tasks.map((t: { id: string }) => t.id)).toContain(id);

    expect(
      (await json(await api(`/api/tasks/${id}/complete`, { method: 'POST', body: {} }))).body.task
        .status,
    ).toBe('completed');
    expect(
      (await json(await api(`/api/tasks/${id}/reopen`, { method: 'POST', body: {} }))).body.task
        .status,
    ).toBe('open');
    expect(
      (await json(await api(`/api/tasks/${id}/cancel`, { method: 'POST', body: {} }))).body.task
        .status,
    ).toBe('cancelled');
    expect((await json(await api(`/api/tasks/${id}`))).body.task.cancelledAt).toBe(
      NOW.toISOString(),
    );
  });

  it('TEST G · rejects inconsistent or foreign relations with 422', async () => {
    const adria = customerId(ORG, 'Adria');
    const fero = customerId(ORG, 'FERO');
    const feroContact = crm.repo.data().contacts.find((c) => c.companyId === fero)!.id;
    const foreign = customerId('org-other', 'Adria');

    const mismatch = await json(
      await api('/api/tasks', {
        method: 'POST',
        body: { title: 'X', companyId: adria, contactId: feroContact },
      }),
    );
    expect(mismatch).toMatchObject({
      status: 422,
      body: { success: false, errors: { contactId: MESSAGES.contactNotOfCustomer } },
    });

    const crossOrg = await json(
      await api('/api/tasks', { method: 'POST', body: { title: 'X', companyId: foreign } }),
    );
    expect(crossOrg).toMatchObject({
      status: 422,
      body: { message: MESSAGES.unavailable, errors: { companyId: MESSAGES.unavailable } },
    });

    const title = await json(await api('/api/tasks', { method: 'POST', body: { title: '' } }));
    expect(title.body).toMatchObject({
      message: MESSAGES.taskTitleRequired,
      errors: { title: MESSAGES.taskTitleRequired },
    });
    expect(crm.repo.data().tasks.filter((t) => t.title === 'X')).toHaveLength(0);
  });

  it('never exposes another organization’s records', async () => {
    const foreignTask = crm.repo.data().tasks.find((t) => t.organizationId === 'org-other')!.id;
    const foreignCustomer = customerId('org-other', 'Adria');
    for (const path of [`/api/tasks/${foreignTask}`, `/api/customers/${foreignCustomer}`]) {
      expect(await json(await api(path))).toEqual({
        status: 404,
        body: { success: false, message: MESSAGES.unavailable },
      });
    }
    expect(
      (await api(`/api/tasks/${foreignTask}/complete`, { method: 'POST', body: {} })).status,
    ).toBe(404);
    const all = (await json(await api('/api/tasks'))).body.tasks as Array<{
      organizationId: string;
    }>;
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => t.organizationId === ORG)).toBe(true);
    const contacts = (await json(await api(`/api/contacts?companyId=${foreignCustomer}`))).body
      .contacts;
    expect(contacts).toEqual([]);
  });

  it('serves sections, priorities and filters', async () => {
    const sections = (await json(await api('/api/tasks/sections'))).body.sections;
    expect(Object.keys(sections)).toEqual(['today', 'upcoming', 'unscheduled', 'completed']);
    const priorities = (await json(await api('/api/tasks/priorities'))).body.tasks;
    expect(priorities[0]).toMatchObject({ title: 'Poslati ponudu za Adria Tech', reason: 'high' });
    const meetings = (await json(await api('/api/tasks?type=meeting&status=open'))).body.tasks;
    expect(meetings.every((t: { type: string }) => t.type === 'meeting')).toBe(true);
  });
});

describe('calendar', () => {
  it('takes explicit UTC ranges and rejects bad ones', async () => {
    const week = await json(
      await api('/api/calendar?from=2026-10-04T22:00:00Z&to=2026-10-11T22:00:00Z'),
    );
    expect(week.status).toBe(200);
    expect(week.body.tasks.length).toBeGreaterThanOrEqual(5);
    expect((await api('/api/calendar?from=2026-10-05T00:00:00Z')).status).toBe(422);
    expect(
      (await api('/api/calendar?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z')).status,
    ).toBe(422);
    expect((await api('/api/calendar?date=2026-02-31')).status).toBe(422);
  });
});

describe('contacts, opportunities, demo reset', () => {
  it('creates a contact and an opportunity that reports its missing next action', async () => {
    const fero = customerId(ORG, 'FERO');
    const contact = await json(
      await api('/api/contacts', {
        method: 'POST',
        body: { companyId: fero, fullName: 'Ana Babić', role: 'Komercijalistica' },
      }),
    );
    expect(contact.status).toBe(201);
    const opp = await json(
      await api('/api/opportunities', {
        method: 'POST',
        body: { companyId: fero, title: 'Grijanje hale', value: '25000' },
      }),
    );
    expect(opp).toMatchObject({
      status: 201,
      body: { nextActionMissing: true, opportunity: { needsNextAction: true } },
    });
    const foreign = await json(
      await api('/api/contacts', {
        method: 'POST',
        body: { companyId: customerId('org-other', 'FERO'), fullName: 'X' },
      }),
    );
    expect(foreign).toMatchObject({ status: 422, body: { message: MESSAGES.unavailable } });
  });

  it('resets only the caller’s organization', async () => {
    await api('/api/tasks', { method: 'POST', body: { title: 'Privremeno' } });
    const otherBefore = crm.repo
      .data()
      .tasks.filter((t) => t.organizationId === 'org-other').length;
    expect((await api('/api/demo/reset', { method: 'POST', body: {} })).status).toBe(200);
    expect(crm.repo.data().tasks.some((t) => t.title === 'Privremeno')).toBe(false);
    expect(crm.repo.data().tasks.filter((t) => t.organizationId === 'org-other')).toHaveLength(
      otherBefore,
    );
  });
});
