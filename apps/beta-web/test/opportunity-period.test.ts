// Opportunity Pipeline period (UPDATE 04): open opportunities created in the
// selected period, in their current stage; the demo's static totals only in
// the current quarter; invalid ranges refused; reading never writes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERIOD_MESSAGES } from '../public/app/js/core/period.js';
import { CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import { seedDemoData } from '../src/crm/seed.ts';
import { zonedDateTime } from '../src/crm/time.ts';
import type { CrmContext } from '../src/crm/types.ts';
import { cookiePair, login, PASSWORD, startTestServer, USERNAME } from './helpers.ts';

const TZ = 'Europe/Zagreb';
const NOW = new Date('2026-10-05T09:00:00Z'); // Monday 5 Oct 2026, 11:00 in Zagreb: Q4 2026
const ctx: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'user-a', displayName: 'Ana A.' },
  timeZone: TZ,
  now: NOW,
};
const other: CrmContext = { ...ctx, organizationId: 'org-b' };
/** The context at a wall-clock time in Zagreb: records created then. */
const on = (day: string, time = '10:00', base = ctx): CrmContext => ({
  ...base,
  now: zonedDateTime(day, time, TZ),
});
const Q3 = { from: '2026-07-01', to: '2026-09-30' };
const Q4 = { from: '2026-10-01', to: '2026-12-31' };
const titles = (list: Array<{ title: string }>) => list.map((o) => o.title).sort();
const totals = (stages: Array<{ total: number }>) => stages.map((s) => s.total);

let crm: CrmServices;
let companyId: string;

function create(at: CrmContext, title: string, stage = 'new') {
  return crm.opportunities.createOpportunity(at, { companyId, title, stage }).opportunity;
}

beforeEach(() => {
  crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
  companyId = crm.customers.createCustomer(on('2026-06-01'), {
    companyName: 'FERO-TERM d.o.o.',
    oib: '60417283915',
    city: 'Osijek',
    contactName: 'Marko Lukač',
  }).id;
  create(on('2026-05-20'), 'Q2 nova');
  create(on('2026-08-10'), 'Q3 u obradi', 'in_progress');
  create(on('2026-09-30', '23:30'), 'Q3 zadnja minuta', 'negotiation'); // 21:30 UTC
  create(on('2026-10-01', '00:10'), 'Q4 prva minuta'); // 30 Sep 22:10 UTC
  create(on('2026-10-04'), 'Q4 ponuda', 'offer_sent');
  const won = create(on('2026-08-20'), 'Q3 dobivena', 'negotiation');
  crm.opportunities.closeOpportunity(on('2026-09-10'), won.id, { outcome: 'won' });
  // Another organization's record in the same period is never counted.
  const otherCompany = crm.customers.createCustomer(on('2026-06-01', '10:00', other), {
    companyName: 'Drugi d.o.o.',
    oib: '11122233344',
    city: 'Rijeka',
    contactName: 'Iva',
  }).id;
  crm.opportunities.createOpportunity(on('2026-08-11', '10:00', other), {
    companyId: otherCompany,
    title: 'Druga organizacija',
  });
});

describe('Opportunity Pipeline · period filter (created in the period)', () => {
  it('lists the open opportunities created in the period, by the org timezone day', () => {
    expect(titles(crm.opportunities.listOpportunities(ctx, { status: 'active', ...Q3 }))).toEqual([
      'Q3 u obradi',
      'Q3 zadnja minuta',
    ]);
    expect(titles(crm.opportunities.listOpportunities(ctx, { status: 'active', ...Q4 }))).toEqual([
      'Q4 ponuda',
      'Q4 prva minuta',
    ]);
    // A custom range: 1.3. – 30.6.2026.
    expect(
      titles(
        crm.opportunities.listOpportunities(ctx, {
          status: 'active',
          from: '2026-03-01',
          to: '2026-06-30',
        }),
      ),
    ).toEqual(['Q2 nova']);
    // Closed ones keep their creation date; the pipeline asks for active ones only.
    expect(titles(crm.opportunities.listOpportunities(ctx, Q3))).toEqual([
      'Q3 dobivena',
      'Q3 u obradi',
      'Q3 zadnja minuta',
    ]);
  });

  it('without a period behaves as before: every opportunity', () => {
    expect(crm.opportunities.listOpportunities(ctx, { status: 'active' })).toHaveLength(5);
    expect(totals(crm.opportunities.pipeline(ctx))).toEqual([2, 1, 1, 1, 0]);
  });

  it('stage totals of a period: its open opportunities in their current stage', () => {
    expect(totals(crm.opportunities.pipeline(ctx, Q3))).toEqual([0, 1, 0, 1, 0]);
    expect(totals(crm.opportunities.pipeline(ctx, Q4))).toEqual([1, 0, 1, 0, 0]);
    expect(
      totals(crm.opportunities.pipeline(ctx, { from: '2025-01-01', to: '2025-12-31' })),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it('refuses an invalid range before reading any record', () => {
    const refused = (period: { from?: unknown; to?: unknown }, message: string) => {
      for (const call of [
        () => crm.opportunities.listOpportunities(ctx, period),
        () => crm.opportunities.pipeline(ctx, period),
      ]) {
        try {
          call();
          throw new Error('expected a validation error');
        } catch (error) {
          expect(error).toBeInstanceOf(CrmValidationError);
          expect((error as CrmValidationError).errors).toEqual({ range: message });
        }
      }
    };
    refused({ from: '2026-09-30', to: '2026-07-01' }, PERIOD_MESSAGES.endBeforeStart);
    refused({ from: '2026-07-01' }, PERIOD_MESSAGES.missingDates);
    refused({ from: '2026-02-30', to: '2026-03-31' }, PERIOD_MESSAGES.missingDates);
    refused({ from: 'abc', to: '2026-03-31' }, PERIOD_MESSAGES.missingDates);
    expect(PERIOD_MESSAGES.endBeforeStart).toBe(
      'Završni datum ne može biti prije početnog datuma.',
    );
  });

  it('reading a period never changes a record', () => {
    const before = JSON.stringify(crm.repo.data());
    crm.opportunities.listOpportunities(ctx, Q3);
    crm.opportunities.pipeline(ctx, { from: '2025-01-01', to: '2025-03-31' });
    crm.opportunities.pipeline(ctx, Q4);
    expect(JSON.stringify(crm.repo.data())).toBe(before);
  });

  it('a new opportunity gets its real creation date whatever period is viewed', () => {
    const created = create(ctx, 'Nova danas');
    expect(created.createdAt).toBe(NOW.toISOString());
    expect(titles(crm.opportunities.listOpportunities(ctx, Q4))).toContain('Nova danas');
    expect(titles(crm.opportunities.listOpportunities(ctx, Q3))).not.toContain('Nova danas');
  });
});

describe('Opportunity Pipeline · demo totals', () => {
  it('the static demo totals belong to the current quarter only', () => {
    const seeded = createCrmServices(createMemoryRepository(seedDemoData(ctx)), {
      demoContent: true,
    });
    // Current quarter (and no period, as before): the approved 42 / 28 / 18 / 11 / 6.
    expect(totals(seeded.opportunities.pipeline(ctx))).toEqual([42, 28, 18, 11, 6]);
    expect(totals(seeded.opportunities.pipeline(ctx, Q4))).toEqual([42, 28, 18, 11, 6]);
    // A past quarter: only real records, in their current stage (seeded ones included).
    const q3 = seeded.opportunities.pipeline(ctx, Q3);
    const q3Open = seeded.opportunities.listOpportunities(ctx, { status: 'active', ...Q3 });
    expect(q3.map((s) => s.total)).toEqual(
      q3.map((s) => q3Open.filter((o) => o.stage === s.value).length),
    );
    expect(q3.every((s) => s.total === s.created)).toBe(true); // no demo line
    expect(q3Open.length).toBeGreaterThan(0);
  });
});

describe('GET /api/opportunities and /api/pipeline with a period', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let cookie: string;
  beforeEach(async () => {
    server = await startTestServer(undefined, {
      crm: { services: crm, organizationId: 'org-a', timeZone: TZ, now: () => NOW },
    });
    cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
  });
  afterEach(async () => {
    await server.close();
  });
  const get = async (path: string) => {
    const res = await fetch(`${server.url}${path}`, { headers: { Cookie: cookie } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('filters by the period and keeps the organization scope', async () => {
    const list = await get('/api/opportunities?status=active&from=2026-07-01&to=2026-09-30');
    expect(list.status).toBe(200);
    expect(titles(list.body.opportunities as Array<{ title: string }>)).toEqual([
      'Q3 u obradi',
      'Q3 zadnja minuta',
    ]);
    const stages = await get('/api/pipeline?from=2026-07-01&to=2026-09-30');
    expect(totals(stages.body.stages as Array<{ total: number }>)).toEqual([0, 1, 0, 1, 0]);
  });

  it('answers 422 for an invalid range', async () => {
    for (const path of [
      '/api/opportunities?from=2026-09-30&to=2026-07-01',
      '/api/pipeline?from=2026-09-30&to=2026-07-01',
    ]) {
      const res = await get(path);
      expect(res.status).toBe(422);
      expect(res.body.errors).toEqual({ range: PERIOD_MESSAGES.endBeforeStart });
    }
  });
});
