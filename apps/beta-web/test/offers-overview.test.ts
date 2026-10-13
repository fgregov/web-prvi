// FEEDBACK OVERVIEW / PONUDE (/feedback-overview, GET /api/offers): every offer
// CREATED in the selected period, where it stood at the end of that period (now,
// for the running one) and, while it was waiting, the days since it was SENT.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { offersOverview } from '../src/crm/offer-service.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import type { CrmContext, Offer } from '../src/crm/types.ts';
import { MESSAGES as API_MESSAGES } from '../src/messages.ts';
import { cookiePair, get, login, PASSWORD, startTestServer, USERNAME } from './helpers.ts';

const TZ = 'Europe/Zagreb';
const NOW = new Date('2026-10-12T10:00:00Z'); // Q4 2026 is the running quarter
const ctx: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'u-a', displayName: 'Ana' },
  timeZone: TZ,
  now: NOW,
};
const on = (iso: string): CrmContext => ({ ...ctx, now: new Date(iso) });
const Q3 = { startDate: '2026-07-01', endDate: '2026-09-30' };
const Q4 = { startDate: '2026-10-01', endDate: '2026-12-31' };

function setup(organizationId = 'org-a') {
  const crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
  const c = { ...ctx, organizationId };
  const at = (iso: string): CrmContext => ({ ...c, now: new Date(iso) });
  let n = 0;
  const customer = (name: string) =>
    crm.customers.createCustomer(at('2026-06-01T09:00:00Z'), {
      companyName: name,
      oib: String(20_000_000_000 + ++n),
      city: 'Rijeka',
      contactName: `Kontakt ${name}`,
    });
  const deal = (companyId: string) =>
    crm.opportunities.createOpportunity(at('2026-06-02T09:00:00Z'), { companyId, title: 'Prilika' })
      .opportunity;
  /** An offer recorded (created) at `createdIso` and sent then. */
  const sent = (opportunityId: string, createdIso: string, title = 'Ponuda') =>
    crm.offers.recordSent(at(createdIso), { opportunityId, title });
  /** An offer row as the database may hold it (draft, sent later, withdrawn …). */
  const raw = (opportunityId: string, fields: Partial<Offer>): Offer => {
    const offer: Offer = {
      id: `raw-${++n}`,
      organizationId,
      companyId: crm.repo.data().opportunities.find((o) => o.id === opportunityId)?.companyId ?? '',
      opportunityId,
      contactId: null,
      note: '',
      title: 'Ponuda',
      status: 'draft',
      sentAt: null,
      answeredAt: null,
      withdrawnAt: null,
      createdBy: 'u-a',
      createdAt: '2026-10-05T09:00:00.000Z',
      updatedAt: '2026-10-05T09:00:00.000Z',
      ...fields,
    };
    crm.repo.data().offers.push(offer);
    return offer;
  };
  const overview = (range = Q4, filter = 'all', who: CrmContext = c) =>
    crm.offers.overview(who, range.startDate, range.endDate, filter);
  return { crm, customer, deal, sent, raw, overview, ctx: c };
}

const titles = (o: { items: Array<{ title: string }> }) => o.items.map((i) => i.title);

describe('FEEDBACK OVERVIEW / PONUDE · period', () => {
  it('lists the offers created in the period (by created date), not before or after', () => {
    const { customer, deal, sent, overview } = setup();
    const o = deal(customer('Adria').id);
    sent(o.id, '2026-09-20T09:00:00Z', 'Q3');
    sent(o.id, '2026-10-02T09:00:00Z', 'Q4');
    expect(titles(overview(Q4))).toEqual(['Q4']);
    expect(titles(overview(Q3))).toEqual(['Q3']);
    expect(titles(overview({ startDate: '2026-10-03', endDate: '2026-10-31' }))).toEqual([]);
  });

  it('cuts the period at midnight in the organization timezone', () => {
    const { customer, deal, sent, overview } = setup();
    const o = deal(customer('Adria').id);
    sent(o.id, '2026-09-30T21:30:00Z', 'Zadnji dan Q3'); // 23:30 on 30.9. in Zagreb
    sent(o.id, '2026-09-30T22:30:00Z', 'Prvi dan Q4'); // 00:30 on 1.10. in Zagreb
    expect(titles(overview(Q3))).toEqual(['Zadnji dan Q3']);
    expect(titles(overview(Q4))).toEqual(['Prvi dan Q4']);
  });

  it('an empty period has no rows and zero counts', () => {
    const { overview } = setup();
    expect(overview({ startDate: '2026-01-01', endDate: '2026-03-31' })).toMatchObject({
      items: [],
      counts: { all: 0, waiting: 0, answered: 0, draft: 0 },
    });
  });

  it('rejects an invalid period or status', () => {
    const { overview, crm } = setup();
    expect(() => overview({ startDate: '2026-12-31', endDate: '2026-10-01' })).toThrow(
      CrmValidationError,
    );
    expect(() => crm.offers.overview(ctx, 'x', '2026-10-01')).toThrow(CrmValidationError);
    expect(() => overview(Q4, 'viewed')).toThrow(CrmValidationError);
  });
});

describe('FEEDBACK OVERVIEW / PONUDE · waiting days', () => {
  it('counts calendar days from sending, the sending day being 1D, with unchanged bands', () => {
    const { customer, deal, sent, overview } = setup();
    const o = deal(customer('Adria').id);
    for (const day of ['2026-10-12', '2026-10-09', '2026-10-08', '2026-10-04', '2026-10-03'])
      sent(o.id, `${day}T07:00:00Z`, day);
    expect(overview().items.map((i) => `${i.waitingDays}D ${i.band}`)).toEqual([
      '10D black',
      '9D red',
      '5D red',
      '4D yellow',
      '1D yellow',
    ]);
  });

  it('gives no timer to drafts, withdrawn, answered or closed offers', () => {
    const { crm, customer, deal, sent, raw, overview } = setup();
    const c = customer('FERO-TERM');
    const [a, b, d] = [deal(c.id), deal(c.id), deal(c.id)];
    raw(a.id, { title: 'Nacrt' });
    raw(a.id, {
      title: 'Povučena',
      status: 'withdrawn',
      sentAt: '2026-10-05T09:00:00.000Z',
      withdrawnAt: '2026-10-06T09:00:00.000Z',
    });
    const answered = sent(b.id, '2026-10-05T09:00:00Z', 'Odgovorena');
    crm.offers.markAnswered(on('2026-10-07T09:00:00Z'), answered.id);
    sent(d.id, '2026-10-05T09:00:00Z', 'Prilika dobivena');
    crm.opportunities.closeOpportunity(on('2026-10-08T09:00:00Z'), d.id, { outcome: 'won' });
    const items = overview().items;
    expect(items.map((i) => [i.title, i.standing, i.waitingDays, i.band])).toEqual([
      ['Nacrt', 'draft', null, null],
      ['Odgovorena', 'answered', null, null],
      ['Prilika dobivena', 'closed', null, null],
      ['Povučena', 'withdrawn', null, null],
    ]);
    // Answered offers stay listed with their dates.
    expect(items[1]).toMatchObject({ sentAt: expect.any(String), answeredAt: expect.any(String) });
  });

  it('a past period shows where the offer stood at its end (as-of the period end)', () => {
    const { crm, customer, deal, sent, raw, overview } = setup();
    const o = deal(customer('BMW').id);
    // Created in Q3, sent on 2.10.: not waiting in Q3, waiting today.
    raw(o.id, {
      title: 'Poslana u Q4',
      status: 'sent',
      createdAt: '2026-09-20T09:00:00.000Z',
      sentAt: '2026-10-02T09:00:00.000Z',
    });
    // Sent 25.9., answered 3.10.: in Q3 it was waiting 6 days.
    const answered = sent(o.id, '2026-09-25T09:00:00Z', 'Odgovor u Q4');
    crm.offers.markAnswered(on('2026-10-03T09:00:00Z'), answered.id);
    const q3 = overview(Q3);
    expect(q3.period).toMatchObject({ isCurrent: false, asOf: '2026-09-30T21:59:59.999Z' });
    expect(q3.items.map((i) => [i.title, i.standing, i.waitingDays, i.standingNow])).toEqual([
      ['Odgovor u Q4', 'waiting', 6, 'answered'],
      ['Poslana u Q4', 'draft', null, 'waiting'],
    ]);
    // Neither was created in Q4.
    expect(overview(Q4).items).toEqual([]);
    expect(overview(Q4).period.isCurrent).toBe(true);
  });

  it('sorts waiting offers by urgency first (black, red, yellow), then the rest', () => {
    const { customer, deal, sent, raw, overview } = setup();
    const o = deal(customer('Initium').id);
    raw(o.id, { title: 'Nacrt', createdAt: '2026-10-11T09:00:00.000Z' });
    sent(o.id, '2026-10-11T09:00:00Z', 'Žuta');
    sent(o.id, '2026-10-01T09:00:00Z', 'Crna');
    sent(o.id, '2026-10-06T09:00:00Z', 'Crvena');
    expect(titles(overview())).toEqual(['Crna', 'Crvena', 'Žuta', 'Nacrt']);
  });
});

describe('FEEDBACK OVERVIEW / PONUDE · filters and scope', () => {
  it('filters Sve / Čeka odgovor / Odgovoreno / Nacrt, with counts for each', () => {
    const { crm, customer, deal, sent, raw, overview } = setup();
    const o = deal(customer('Nova').id);
    sent(o.id, '2026-10-06T09:00:00Z', 'Čeka');
    const a = sent(o.id, '2026-10-06T09:00:00Z', 'Odgovorena');
    crm.offers.markAnswered(on('2026-10-08T09:00:00Z'), a.id);
    raw(o.id, { title: 'Nacrt' });
    expect(overview().counts).toEqual({ all: 3, waiting: 1, answered: 1, draft: 1 });
    expect(titles(overview(Q4, 'waiting'))).toEqual(['Čeka']);
    expect(titles(overview(Q4, 'answered'))).toEqual(['Odgovorena']);
    expect(titles(overview(Q4, 'draft'))).toEqual(['Nacrt']);
    expect(overview(Q4, 'all').items).toHaveLength(3);
  });

  it('opens the offer in its context: customer, opportunity and offer ids', () => {
    const { customer, deal, sent, overview } = setup();
    const c = customer('Adria');
    const o = deal(c.id);
    const offer = sent(o.id, '2026-10-06T09:00:00Z');
    expect(overview().items[0]).toMatchObject({
      offerId: offer.id,
      opportunityId: o.id,
      opportunityTitle: 'Prilika',
      companyId: c.id,
      customerName: 'Adria',
      customerActive: true,
    });
  });

  it('is scoped to the organization', () => {
    const { customer, deal, sent, overview, crm } = setup();
    sent(deal(customer('A').id).id, '2026-10-06T09:00:00Z');
    expect(overview(Q4, 'all', { ...ctx, organizationId: 'org-b' }).items).toEqual([]);
    // Built from one pass over the data (no lookup per offer): the pure function agrees.
    expect(offersOverview(crm.repo.data(), ctx, Q4).items).toHaveLength(1);
  });
});

describe('GET /api/offers and /feedback-overview over HTTP', () => {
  let close: () => Promise<void>;
  let url: string;
  let cookie: string;
  let crm: CrmServices;

  beforeEach(async () => {
    const a = setup('org-beta');
    const b = setup('org-other');
    crm = a.crm;
    const o = a.deal(a.customer('Adria').id);
    a.sent(o.id, '2026-10-02T09:00:00Z', 'Naša ponuda');
    const other = b.deal(b.customer('Tuđi kupac').id);
    b.sent(other.id, '2026-10-02T09:00:00Z', 'Tuđa ponuda');
    for (const key of ['customers', 'contacts', 'opportunities', 'offers', 'activities'] as const)
      (crm.repo.data()[key] as unknown[]).push(...b.crm.repo.data()[key]);
    const server = await startTestServer(undefined, {
      crm: { services: crm, organizationId: 'org-beta', timeZone: TZ, now: () => NOW },
    });
    close = server.close;
    url = server.url;
    cookie = cookiePair(await login(url, USERNAME, PASSWORD));
  });
  afterEach(() => close());

  it('needs a session', async () => {
    const response = await fetch(`${url}/api/offers?from=2026-10-01&to=2026-12-31`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: API_MESSAGES.sessionRequired,
    });
    const page = await get(url, '/feedback-overview');
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/login');
  });

  it('returns only the session organization’s offers; ignores a client organization id', async () => {
    const response = await get(
      url,
      '/api/offers?from=2026-10-01&to=2026-12-31&status=all&organizationId=org-other',
      cookie,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      overview: { items: Array<{ title: string; waitingDays: number | null }> };
    };
    expect(body.overview.items.map((i) => i.title)).toEqual(['Naša ponuda']);
    expect(body.overview.items[0]).toMatchObject({ waitingDays: 11, band: 'black' });
  });

  it('rejects a bad status or period with 422', async () => {
    expect(
      (await get(url, '/api/offers?from=2026-10-01&to=2026-12-31&status=x', cookie)).status,
    ).toBe(422);
    expect((await get(url, '/api/offers?from=2026-12-31&to=2026-10-01', cookie)).status).toBe(422);
  });

  it('serves the dedicated page in the app', async () => {
    const page = await get(url, '/feedback-overview', cookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/app/js/pages/feedback-overview.js');
    expect(html).toContain('Feedback overview / Ponude');
  });
});
