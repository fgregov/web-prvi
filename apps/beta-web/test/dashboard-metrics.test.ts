// Home KPIs (LEADS, WON, LOST, OPPORTUNITY), the pipeline overview (LEADS,
// PROSPECTS, NEGOTIATIONS, BUYERS) and the FEEDBACK OVERVIEW, on a clean start
// (no demo numbers), with records dated in Q2–Q4 2026. Each metric must use its
// own event date and never reset at a quarter boundary.
import { describe, expect, it } from 'vitest';
import { CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import type { CrmContext } from '../src/crm/types.ts';

const TZ = 'Europe/Zagreb';
const NOW = new Date('2026-10-09T10:00:00Z'); // Q4 2026 is the running quarter
const ctx: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'u-a', displayName: 'Ana' },
  timeZone: TZ,
  now: NOW,
};
const on = (iso: string): CrmContext => ({ ...ctx, now: new Date(iso) });
const Q2 = ['2026-04-01', '2026-06-30'] as const;
const Q3 = ['2026-07-01', '2026-09-30'] as const;
const Q4 = ['2026-10-01', '2026-12-31'] as const;

function setup() {
  const crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
  let n = 0;
  const customer = (name: string, at = '2026-04-02T09:00:00Z') =>
    crm.customers.createCustomer(on(at), {
      companyName: name,
      oib: String(10_000_000_000 + ++n),
      city: 'Rijeka',
      contactName: `Kontakt ${name}`,
    });
  const deal = (companyId: string, at: string, input: Record<string, unknown> = {}) =>
    crm.opportunities.createOpportunity(on(at), { companyId, title: 'Prilika', ...input })
      .opportunity;
  const summary = (s: CrmServices, [from, to]: readonly [string, string], at = ctx) =>
    s.dashboard.getPeriodSummary(at, from, to);
  return { crm, customer, deal, summary };
}

describe('KPI · LEADS', () => {
  it('counts leads by creation date: created in Q2 and converted in Q3 is a Q2 lead only', () => {
    const { crm, summary } = setup();
    const lead = crm.leads.createLead(on('2026-05-10T09:00:00Z'), { name: 'ABC d.o.o.' });
    crm.leads.convertLead(on('2026-08-10T09:00:00Z'), lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    });
    expect(summary(crm, Q2).kpis.leads.value).toBe(1);
    expect(summary(crm, Q3).kpis.leads.value).toBe(0);
    expect(crm.leads.getLead(ctx, lead.id).createdAt).toBe('2026-05-10T09:00:00.000Z');
    // A custom range counts what was created inside it.
    expect(crm.dashboard.getPeriodSummary(ctx, '2026-05-01', '2026-05-31').kpis.leads.value).toBe(
      1,
    );
  });
});

describe('KPI · WON / LOST', () => {
  it('counts opportunities by the day they were won or lost, not created', () => {
    const { crm, customer, deal, summary } = setup();
    const c = customer('FERO-TERM');
    const a = deal(c.id, '2026-05-01T09:00:00Z', { value: '20000' });
    const b = deal(c.id, '2026-05-02T09:00:00Z', { value: '5000' });
    crm.opportunities.closeOpportunity(on('2026-08-15T09:00:00Z'), a.id, { outcome: 'won' });
    crm.opportunities.closeOpportunity(on('2026-10-05T09:00:00Z'), b.id, { outcome: 'lost' });
    expect(summary(crm, Q2).kpis).toMatchObject({ won: { value: 0 }, lost: { value: 0 } });
    expect(summary(crm, Q3).kpis).toMatchObject({ won: { value: 1 }, lost: { value: 0 } });
    expect(summary(crm, Q4).kpis).toMatchObject({ won: { value: 0 }, lost: { value: 1 } });
  });

  it('rates use closed opportunities only: 12 won, 6 lost → 66.7 % / 33.3 %', () => {
    const { crm, customer, deal, summary } = setup();
    const c = customer('Medico');
    for (let i = 0; i < 18; i++) {
      const o = deal(c.id, '2026-07-02T09:00:00Z');
      crm.opportunities.closeOpportunity(on('2026-08-01T09:00:00Z'), o.id, {
        outcome: i < 12 ? 'won' : 'lost',
      });
    }
    deal(c.id, '2026-07-03T09:00:00Z'); // still active: not in the denominator
    const { rates } = summary(crm, Q3).kpis;
    expect(rates.closed).toBe(18);
    expect(rates.wonRate?.toFixed(1)).toBe('66.7');
    expect(rates.lostRate?.toFixed(1)).toBe('33.3');
  });

  it('nothing closed → 0 won and an undefined rate ("—"), not 0 %', () => {
    const { crm, customer, deal, summary } = setup();
    deal(customer('X').id, '2026-07-02T09:00:00Z');
    const { kpis } = summary(crm, Q3);
    expect(kpis.won.value).toBe(0);
    expect(kpis.rates).toMatchObject({ wonRate: null, lostRate: null });
  });

  it('a lost lead is not a lost opportunity', () => {
    const { crm, summary } = setup();
    const lead = crm.leads.createLead(on('2026-07-05T09:00:00Z'), { name: 'Kafić' });
    crm.leads.markLeadLost(on('2026-07-06T09:00:00Z'), lead.id, { reason: 'price' });
    expect(summary(crm, Q3).kpis.lost.value).toBe(0);
  });

  it('only an active opportunity can be closed, and closing ends its reminders', () => {
    const { crm, customer, deal } = setup();
    const o = deal(customer('X').id, '2026-10-01T09:00:00Z');
    crm.reminders.setReminder(ctx, { kind: 'opportunity', id: o.id }, '2026-10-20T07:00:00Z');
    crm.opportunities.closeOpportunity(ctx, o.id, { outcome: 'lost', lostReason: 'Cijena' });
    expect(crm.repo.data().reminders[0]).toMatchObject({ status: 'cancelled' });
    expect(() => crm.opportunities.closeOpportunity(ctx, o.id, { outcome: 'won' })).toThrow(
      CrmValidationError,
    );
  });
});

describe('KPI · OPPORTUNITY POTENTIAL / WON', () => {
  it('potential by creation, won value by closing (example A: €20.000 in Q2, €18.000 won in Q3)', () => {
    const { crm, customer, deal, summary } = setup();
    const a = deal(customer('A').id, '2026-05-01T09:00:00Z', { value: '20000' });
    crm.opportunities.closeOpportunity(on('2026-08-15T09:00:00Z'), a.id, {
      outcome: 'won',
      wonValue: '18000',
    });
    expect(summary(crm, Q2).kpis.potential.value).toBe(20000);
    expect(summary(crm, Q3).kpis.potential.value).toBe(0);
    expect(summary(crm, Q3).kpis.wonValue.value).toBe(18000);
    expect(crm.opportunities.getOpportunity(ctx, a.id)).toMatchObject({
      value: 20000,
      wonValue: 18000,
    });
  });

  it('without a final amount the estimate is the won value', () => {
    const { crm, customer, deal, summary } = setup();
    const a = deal(customer('A').id, '2026-07-01T09:00:00Z', { value: '10000' });
    crm.opportunities.closeOpportunity(on('2026-07-10T09:00:00Z'), a.id, { outcome: 'won' });
    expect(summary(crm, Q3).kpis.wonValue.value).toBe(10000);
  });

  it('a lead with an estimated value is not opportunity potential', () => {
    const { crm, summary } = setup();
    crm.leads.createLead(on('2026-07-05T09:00:00Z'), { name: 'Hotel', estimatedValue: '90000' });
    expect(summary(crm, Q3).kpis.potential.value).toBe(0);
  });

  it('sums exactly in cents and never adds another currency to EUR', () => {
    const { crm, customer, deal, summary } = setup();
    const c = customer('A');
    for (let i = 0; i < 10; i++) deal(c.id, '2026-07-01T09:00:00Z', { value: '0,10' });
    deal(c.id, '2026-07-01T09:00:00Z', { value: '5000', currency: 'USD' });
    const { kpis } = summary(crm, Q3);
    expect(kpis.potential.value).toBe(1);
    expect(kpis.otherCurrency.potential).toBe(1);
  });
});

describe('Pipeline overview', () => {
  it('LEADS matches the LEADS KPI', () => {
    const { crm, summary } = setup();
    crm.leads.createLead(on('2026-10-02T09:00:00Z'), { name: 'A' });
    crm.leads.createLead(on('2026-10-03T09:00:00Z'), { name: 'B' });
    const s = summary(crm, Q4);
    expect(s.pipelineOverview.leads).toBe(2);
    expect(s.pipelineOverview.leads).toBe(s.kpis.leads.value);
  });

  it('PROSPECTS counts the first promotion once, in its own period', () => {
    const { crm, summary } = setup();
    const lead = crm.leads.createLead(on('2026-06-10T09:00:00Z'), { name: 'Termotechnik' });
    const at = (iso: string, stage: string) => crm.leads.updateLead(on(iso), lead.id, { stage });
    at('2026-08-01T09:00:00Z', 'qualified');
    at('2026-08-02T09:00:00Z', 'new');
    at('2026-08-03T09:00:00Z', 'qualified'); // re-saved as prospect: not a second promotion
    expect(summary(crm, Q2).pipelineOverview).toMatchObject({ leads: 1, prospects: 0 });
    expect(summary(crm, Q3).pipelineOverview).toMatchObject({ leads: 0, prospects: 1 });
  });

  it('a lead can be created directly as a Prospect', () => {
    const { crm, summary } = setup();
    const lead = crm.leads.createLead(ctx, { name: 'ABC', prospect: true });
    expect(lead).toMatchObject({ stage: 'qualified', isProspect: true });
    expect(summary(crm, Q4).pipelineOverview.prospects).toBe(1);
    expect(crm.repo.data().leads).toHaveLength(1);
  });

  it('NEGOTIATIONS: real opportunity events only, one per opportunity', () => {
    const { crm, customer, deal, summary } = setup();
    const c = customer('FERO-TERM');
    const o = deal(c.id, '2026-06-01T09:00:00Z'); // created in Q2
    // A generic task completed in Q3 is not a negotiation.
    const general = crm.tasks.createTask(on('2026-07-01T09:00:00Z'), {
      title: 'Pripremiti prezentaciju',
    });
    crm.tasks.completeTask(on('2026-07-02T09:00:00Z'), general.id);
    expect(summary(crm, Q3).pipelineOverview.negotiations).toBe(0);
    // Several Q3 events of one opportunity: one negotiation.
    for (const day of ['03', '04', '05']) {
      const t = crm.tasks.createTask(on(`2026-07-${day}T08:00:00Z`), {
        title: 'Follow-up ponude FERO-TERM',
        type: 'follow_up',
        opportunityId: o.id,
      });
      crm.tasks.completeTask(on(`2026-07-${day}T09:00:00Z`), t.id);
    }
    crm.offers.recordSent(on('2026-07-06T09:00:00Z'), { opportunityId: o.id, title: 'Ponuda' });
    expect(summary(crm, Q3).pipelineOverview.negotiations).toBe(1);
    expect(summary(crm, Q2).pipelineOverview.negotiations).toBe(1); // created in Q2
  });

  it('BUYERS: distinct customers with a won deal this year, as of the period end', () => {
    const { crm, customer, deal, summary } = setup();
    const win = (companyId: string, closedOn: string) => {
      const o = deal(companyId, '2026-01-05T09:00:00Z');
      crm.opportunities.closeOpportunity(on(closedOn), o.id, { outcome: 'won' });
    };
    const fero = customer('FERO-TERM', '2026-01-02T09:00:00Z');
    const bmw = customer('BMW', '2026-01-02T09:00:00Z');
    const medico = customer('Medico', '2026-01-02T09:00:00Z');
    win(fero.id, '2026-02-01T09:00:00Z');
    win(fero.id, '2026-08-01T09:00:00Z');
    win(bmw.id, '2026-05-01T09:00:00Z');
    win(medico.id, '2026-07-01T09:00:00Z');
    win(medico.id, '2026-07-02T09:00:00Z');
    win(medico.id, '2026-10-02T09:00:00Z');
    expect(summary(crm, Q4).pipelineOverview).toMatchObject({ buyers: 3, buyersYear: 2026 });
    // Q2 view: only wins up to 30.6. (FERO-TERM in Feb, BMW in May).
    expect(summary(crm, Q2).pipelineOverview.buyers).toBe(2);
    expect(summary(crm, ['2025-10-01', '2025-12-31']).pipelineOverview).toMatchObject({
      buyers: 0,
      buyersYear: 2025,
    });
  });

  it('a converted lead is a customer, not a buyer', () => {
    const { crm, summary } = setup();
    const lead = crm.leads.createLead(ctx, { name: 'ABC' });
    crm.leads.convertLead(ctx, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    });
    expect(summary(crm, Q4).pipelineOverview.buyers).toBe(0);
  });
});

describe('Feedback overview', () => {
  const sentDaysAgo = (crm: CrmServices, opportunityId: string, days: number, title = `${days}D`) =>
    crm.offers.recordSent(ctx, {
      opportunityId,
      title,
      sentDate: new Date(Date.UTC(2026, 9, 9 - days)).toISOString().slice(0, 10),
    });

  it('day bands: 1–4 yellow, 5–9 red, 10+ black; most urgent first', () => {
    const { crm, customer, deal } = setup();
    const c = customer('Adria Tech');
    for (const days of [0, 3, 4, 8, 9, 11])
      sentDaysAgo(crm, deal(c.id, '2026-09-01T09:00:00Z').id, days);
    const items = crm.offers.feedback(ctx);
    expect(items.map((i) => `${i.waitingDays}D ${i.band}`)).toEqual([
      '12D black',
      '10D black',
      '9D red',
      '5D red',
      '4D yellow',
      '1D yellow',
    ]);
    expect(items[0]).toMatchObject({ customerName: 'Adria Tech', contactPhone: null });
  });

  it('only sent, unanswered offers of open deals wait', () => {
    const { crm, customer, deal } = setup();
    const c = customer('FERO-TERM');
    const o1 = deal(c.id, '2026-09-01T09:00:00Z');
    const o2 = deal(c.id, '2026-09-01T09:00:00Z');
    const o3 = deal(c.id, '2026-09-01T09:00:00Z');
    const answered = sentDaysAgo(crm, o1.id, 2, 'Odgovoreno');
    sentDaysAgo(crm, o2.id, 2, 'Prilika dobivena');
    sentDaysAgo(crm, o3.id, 2, 'Čeka 1');
    sentDaysAgo(crm, o3.id, 6, 'Čeka 2'); // a second offer of the same deal waits on its own
    // A draft (prepared, not sent) never waits.
    crm.repo.data().offers.push({
      ...crm.repo.data().offers[0]!,
      id: 'draft-1',
      title: 'Nacrt',
      status: 'draft',
      sentAt: null,
    });
    crm.offers.markAnswered(ctx, answered.id);
    crm.opportunities.closeOpportunity(ctx, o2.id, { outcome: 'won' });
    expect(crm.offers.feedback(ctx).map((i) => i.title)).toEqual(['Čeka 2', 'Čeka 1']);
    // The answered offer is kept with both dates.
    expect(crm.repo.data().offers.find((o) => o.id === answered.id)).toMatchObject({
      status: 'answered',
      sentAt: expect.any(String),
      answeredAt: NOW.toISOString(),
    });
    expect(() => crm.offers.markAnswered(ctx, answered.id)).toThrow(CrmValidationError);
  });

  it('a past period shows the waits of its own end, not of today', () => {
    const { crm, customer, deal, summary } = setup();
    const o = deal(customer('BMW').id, '2026-09-01T09:00:00Z');
    const offer = crm.offers.recordSent(on('2026-09-25T09:00:00Z'), {
      opportunityId: o.id,
      title: 'Oprema',
    });
    crm.offers.markAnswered(on('2026-10-03T09:00:00Z'), offer.id);
    const q3 = summary(crm, Q3).feedback;
    expect(q3.items).toEqual([
      expect.objectContaining({ title: 'Oprema', waitingDays: 6, band: 'red' }),
    ]);
    expect(summary(crm, Q4).feedback.items).toEqual([]);
  });

  it('cannot be sent in the future or for a closed deal', () => {
    const { crm, customer, deal } = setup();
    const o = deal(customer('X').id, '2026-09-01T09:00:00Z');
    expect(() =>
      crm.offers.recordSent(ctx, { opportunityId: o.id, title: 'X', sentDate: '2026-10-10' }),
    ).toThrow(CrmValidationError);
    crm.opportunities.closeOpportunity(ctx, o.id, { outcome: 'lost' });
    expect(() => crm.offers.recordSent(ctx, { opportunityId: o.id, title: 'X' })).toThrow(
      CrmValidationError,
    );
  });

  it('is scoped to the organization', () => {
    const { crm, customer, deal } = setup();
    sentDaysAgo(crm, deal(customer('A').id, '2026-09-01T09:00:00Z').id, 1);
    expect(crm.offers.feedback({ ...ctx, organizationId: 'org-b' })).toEqual([]);
  });
});
