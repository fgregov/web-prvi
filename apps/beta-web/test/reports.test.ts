// IZVJEŠTAJI (ADR-0015): the report rules (one engine for all four reports),
// the status history behind them, the PDF, the e-mail service and the API with
// its rights, limits and checks.
import { describe, expect, it } from 'vitest';
import { createCrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData, normalizeData } from '../src/crm/repository.ts';
import type { CrmContext, CrmData, Opportunity } from '../src/crm/types.ts';
import { mailerFromEnv, resendMailer, type Mailer, type MailMessage } from '../src/email/mailer.ts';
import { nodePdfResources } from '../src/reports/node-pdf.ts';
import { createReportApi } from '../src/reports/report-api.ts';
import { buildReport, type ReportMember } from '../src/reports/report-engine.ts';
import { renderReportPdf } from '../src/reports/report-pdf.ts';
import { RequestLimiter } from '../src/http/request-limiter.ts';
import {
  canRunReport,
  cleanAttachmentName,
  formatEur,
  normalizeReportFilters,
  presetRange,
  validateReportEmail,
} from '../public/app/js/core/reports.js';
import { ALL_PERMISSIONS } from '../public/app/js/core/permissions.js';
import { cookiePair, login, PASSWORD, startTestServer, USERNAME } from './helpers.ts';

const ORG = 'org-a';
const NOW = new Date('2026-10-16T10:00:00Z');
const ctx = (permissions: readonly string[] = ALL_PERMISSIONS, role = 'owner'): CrmContext => ({
  organizationId: ORG,
  user: { id: 'u-ana', displayName: 'Ana Anić' },
  timeZone: 'Europe/Zagreb',
  now: NOW,
  access: { role: role as 'owner', permissions: new Set(permissions) },
});
const MEMBERS: ReportMember[] = [
  { id: 'u-ana', name: 'Ana Anić', role: 'user', status: 'active' },
  { id: 'u-bozo', name: 'Božo Božić', role: 'user', status: 'active' },
  { id: 'u-admin', name: 'Ivo Admin', role: 'admin', status: 'active' },
  { id: 'u-zero', name: 'Zrinka Bez Prilika', role: 'user', status: 'active' },
  { id: 'u-gone', name: 'Bivši Prodavač', role: 'user', status: 'inactive' },
];

let n = 0;
function deal(fields: Partial<Opportunity>): Opportunity {
  n += 1;
  return {
    id: `o${n}`,
    organizationId: ORG,
    companyId: 'c1',
    leadId: null,
    contactId: null,
    title: `Prilika ${n}`,
    value: 1000,
    currency: 'EUR',
    stage: 'negotiation',
    status: 'won',
    expectedCloseDate: null,
    ownerId: 'u-ana',
    ownerName: 'Ana Anić',
    notes: '',
    closedAt: '2026-08-10T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...fields,
  };
}
function fixture(deals: Opportunity[]): CrmData {
  const data = emptyData();
  data.customers.push(
    { id: 'c1', organizationId: ORG, companyName: 'FERO-TERM d.o.o.' } as never,
    { id: 'c2', organizationId: ORG, companyName: 'Čakovečki mlinovi d.d.' } as never,
    { id: 'cx', organizationId: 'org-b', companyName: 'Tuđi kupac' } as never,
  );
  data.opportunities.push(...deals);
  return data;
}
const report = (data: CrmData, input: Record<string, unknown>, c = ctx()) => {
  const { filters, errors } = normalizeReportFilters(input, '2026-10-16');
  if (!filters) throw new Error(JSON.stringify(errors));
  return buildReport({ data, ctx: c, members: MEMBERS }, filters as never);
};

// ------------------------------------------------------------- the rules ---
describe('report rules (one engine, the same numbers everywhere)', () => {
  const data = fixture([
    deal({ value: 1000, wonValue: 1200, closedAt: '2026-08-10T10:00:00.000Z' }), // Q3, final amount
    deal({ value: 2500, closedAt: '2026-09-30T22:30:00.000Z', companyId: 'c2' }), // 1.10. in Zagreb → Q4
    deal({ status: 'lost', value: 4000, closedAt: '2026-09-15T08:00:00.000Z', ownerId: 'u-bozo' }),
    deal({ status: 'active', value: 9000, closedAt: null }), // never in reports
    deal({ value: null, closedAt: '2026-10-02T08:00:00.000Z', ownerId: null, ownerName: null }), // 0 €, unassigned
    deal({ value: 700, currency: 'USD', closedAt: '2026-10-03T08:00:00.000Z' }), // counted, not summed
    deal({ value: 5000, closedAt: '2025-12-20T10:00:00.000Z', ownerId: 'u-bozo' }), // Q4 2025
    { ...deal({ value: 99999 }), organizationId: 'org-b', companyId: 'cx' }, // another organization
  ]);

  it('revenue: WON only, final amount first, EUR in cents, by its closing day in Zagreb', () => {
    const q3 = report(data, {
      type: 'revenue',
      preset: 'custom',
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(q3.totals).toMatchObject({ revenueCents: 120000, wonCount: 1 });
    const oct = report(data, {
      type: 'revenue',
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(oct.totals).toMatchObject({ revenueCents: 250000, wonCount: 3, customerCount: 2 });
    expect(oct.notes.join(' ')).toMatch(/u drugoj valuti/);
    expect(oct.notes.join(' ')).toMatch(/nema upisanu vrijednost/);
    const rows = oct.tables[0]!.rows.map((r) => r.cells.join(' | '));
    expect(rows).toContain('Ukupno |  | 3 WON | 2.500,00 €');
    expect(rows.some((r) => r.includes('700,00 USD (nije uračunato)'))).toBe(true);
    expect(
      rows.some((r) => r.includes('NEDODIJELJENO') && r.includes('0,00 € (bez vrijednosti)')),
    ).toBe(true);
  });

  it('revenue: a customer and one of its deals; another organization is never seen', () => {
    const c2 = report(data, { type: 'revenue', preset: 'current_year', customerId: 'c2' });
    expect(c2.totals.revenueCents).toBe(250000);
    expect(() =>
      report(data, { type: 'revenue', preset: 'current_year', customerId: 'cx' }),
    ).toThrow('Odabrani kupac nije dostupan.');
    expect(() =>
      report(data, {
        type: 'revenue',
        preset: 'current_year',
        customerId: 'c2',
        opportunityId: 'o1',
      }),
    ).toThrow('ne pripada odabranom kupcu');
    const one = report(data, { type: 'revenue', preset: 'current_year', opportunityId: 'o1' });
    expect(one.totals).toMatchObject({ revenueCents: 120000, wonCount: 1 });
  });

  it('quarters: Q1–Q4 by the closing day, average, change, N/P after 0 €, Q1 vs the last Q4', () => {
    const r = report(data, { type: 'quarters', year: '2026' });
    expect(r.totals).toMatchObject({
      q1Cents: 0,
      q2Cents: 0,
      q3Cents: 120000,
      q4Cents: 250000,
      q4Count: 3,
      yearRevenueCents: 370000,
      bestQuarter: 4,
      q1ChangePercent: -100, // Q4 2025 had 5.000 €
      q2ChangePercent: null, // 0 € before: N/P, no division by zero
      q3ChangePercent: null,
    });
    expect(r.totals.q4ChangePercent).toBeCloseTo(108.333, 2);
    const q4 = r.tables[0]!.rows.find((row) => row.cells[0] === 'Q4')!.cells;
    expect(q4.slice(2)).toEqual(['3', '2.500,00 €', '1.250,00 €', '+108,3 %']);
    const only = report(data, { type: 'quarters', year: '2026', quarter: '3' });
    expect(only.tables[0]!.rows).toHaveLength(1);
    expect(only.charts[0]!.items).toHaveLength(4); // the chart keeps the year's comparison
    expect(
      report(data, { type: 'quarters', year: '2024' }).summary.find((s) => s.key === 'best')!
        .display,
    ).toBe('N/P');
  });

  it('WON / LOST: rates of closed deals only; potential is not revenue; N/P without any', () => {
    const r = report(data, { type: 'won_lost', preset: 'current_year' });
    expect(r.totals).toMatchObject({
      wonCount: 4,
      lostCount: 1,
      wonCents: 370000,
      lostCents: 400000,
    });
    expect(r.totals.winRate).toBe(80);
    expect(r.summary.find((s) => s.key === 'lostValue')).toMatchObject({
      hint: 'Nije ostvareni prihod.',
    });
    const lostOnly = report(data, { type: 'won_lost', preset: 'current_year', status: 'lost' });
    expect(lostOnly.totals).toMatchObject({ wonCount: 4, lostCount: 1, listedCount: 1 });
    const none = report(fixture([]), { type: 'won_lost', preset: 'current_year' });
    expect(none.empty).toBe(true);
    expect(none.summary.find((s) => s.key === 'winRate')!.display).toBe('N/P');
    expect(none.totals.winRate).toBeNull();
  });

  it('representatives: sales members and owners of deals, NEDODIJELJENO kept, sortable', () => {
    const r = report(data, { type: 'sales_reps', preset: 'current_year' });
    const names = r.tables[0]!.rows.map((row) => row.cells[0]);
    expect(names).toEqual([
      'Ana Anić',
      'Božo Božić',
      'Zrinka Bez Prilika',
      'NEDODIJELJENO',
      'Ukupno',
    ]);
    expect(names).not.toContain('Ivo Admin'); // no sales role, no deals
    expect(names).not.toContain('Bivši Prodavač'); // inactive, no deals here
    expect(r.totals).toMatchObject({
      revenueCents: 370000,
      wonCount: 4,
      lostCount: 1,
      unassignedCount: 1,
    });
    const ana = r.tables[0]!.rows[0]!.cells;
    expect(ana).toEqual(['Ana Anić', '3', '0', '3.700,00 €', '100,0 %', '1.850,00 €']);
    const byRate = report(data, { type: 'sales_reps', preset: 'current_year', sort: 'win_rate' });
    expect(byRate.tables[0]!.rows.map((row) => row.cells[0]).slice(0, 3)).toEqual([
      'Ana Anić',
      'Božo Božić',
      'Zrinka Bez Prilika',
    ]);
    const bozo = report(data, { type: 'sales_reps', preset: 'current_year', ownerId: 'u-bozo' });
    expect(bozo.tables[0]!.rows.map((row) => row.cells[0])).toEqual(['Božo Božić', 'Ukupno']);
    const none = report(data, { type: 'sales_reps', preset: 'current_year', ownerId: '__none' });
    expect(none.totals).toMatchObject({ repCount: 0, wonCount: 1, unassignedCount: 1 });
  });

  it('the same WON numbers as the Dashboard for the same period', () => {
    const services = createCrmServices(createMemoryRepository(data), { demoContent: false });
    const summary = services.dashboard.getPeriodSummary(ctx(), '2026-07-01', '2026-09-30') as {
      kpis: { won: { value: number }; revenue: { value: number } };
    };
    const r = report(data, {
      type: 'won_lost',
      preset: 'custom',
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(r.totals.wonCount).toBe(summary.kpis.won.value);
    expect((r.totals.wonCents as number) / 100).toBe(summary.kpis.revenue.value);
  });

  it('refuses a report bigger than the limit (narrow the filters)', () => {
    const many = fixture(Array.from({ length: 5001 }, () => deal({})));
    expect(() => report(many, { type: 'revenue', preset: 'current_year' })).toThrow(
      /više od 5.000/,
    );
  });
});

describe('filters (checked the same way on the page and the server)', () => {
  it('periods in the organization calendar', () => {
    expect(presetRange('previous_month', '2026-01-16')).toEqual({
      startDate: '2025-12-01',
      endDate: '2025-12-31',
    });
    expect(presetRange('current_quarter', '2026-10-16')).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-12-31',
    });
    expect(presetRange('previous_quarter', '2026-01-16')).toMatchObject({
      startDate: '2025-10-01',
      endDate: '2025-12-31',
    });
    expect(presetRange('current_year', '2026-10-16')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(presetRange('quarter', '2026-10-16', { year: 2025, quarter: 2 })).toMatchObject({
      startDate: '2025-04-01',
      endDate: '2025-06-30',
    });
  });

  it('only the filters of the report, each checked', () => {
    const { filters } = normalizeReportFilters(
      { type: 'revenue', preset: 'current_month', ownerId: 'u-ana', status: 'won', sort: 'x' },
      '2026-10-16',
    );
    expect(filters).toEqual({
      type: 'revenue',
      preset: 'current_month',
      from: '2026-10-01',
      to: '2026-10-31',
      customerId: null,
      opportunityId: null,
    });
    for (const bad of [
      { type: 'nope' },
      { type: 'revenue', preset: 'custom', from: '2026-10-10', to: '2026-10-01' },
      { type: 'revenue', preset: 'custom', from: '2020-01-01', to: '2026-01-01' },
      { type: 'revenue', preset: 'quarter', year: '1999', quarter: '1' },
      { type: 'quarters', quarter: '5' },
      { type: 'won_lost', status: 'maybe' },
      { type: 'revenue', customerId: '<script>' },
    ]) {
      expect(normalizeReportFilters(bad, '2026-10-16').filters, JSON.stringify(bad)).toBeNull();
    }
  });

  it('rights per report', () => {
    const base = new Set(['reports.view', 'opportunities.view']);
    expect(canRunReport(base, 'revenue')).toBe(true);
    expect(canRunReport(base, 'sales_reps')).toBe(false);
    expect(canRunReport(new Set([...base, 'reports.sales_reps']), 'sales_reps')).toBe(true);
    expect(canRunReport(new Set(['reports.view']), 'revenue')).toBe(false);
  });

  it('e-mail form and attachment name', () => {
    expect(validateReportEmail({ to: 'a@b.hr', subject: 'S' })).toEqual({});
    expect(Object.keys(validateReportEmail({ to: 'nope', subject: '' }))).toEqual([
      'to',
      'subject',
    ]);
    expect(Object.keys(validateReportEmail({ to: 'a@b.hr', subject: 'a\r\nBcc: x@y.hr' }))).toEqual(
      ['subject'],
    );
    expect(cleanAttachmentName('Izvještaj čćžšđ Q3!.pdf', 'x.pdf')).toBe('Izvjestaj_cczsd_Q3.pdf');
    expect(cleanAttachmentName('../../etc/passwd', 'x.pdf')).toBe('etc_passwd.pdf');
    expect(cleanAttachmentName('', 'zadano.pdf')).toBe('zadano.pdf');
    expect(formatEur(1250000)).toBe('12.500,00 €');
  });
});

// ------------------------------------------------------ status history ---
describe('opportunity status history and reopening', () => {
  it('records create, win, reopen and loss; the reports follow the current status', () => {
    const services = createCrmServices(createMemoryRepository(fixture([])), { demoContent: false });
    const c = { ...ctx(), now: new Date('2026-10-16T09:00:00Z') };
    const { opportunity } = services.opportunities.createOpportunity(c, {
      companyId: 'c1',
      title: 'Održavanje',
      value: '2500',
    });
    services.opportunities.closeOpportunity(c, opportunity.id, { outcome: 'won' });
    const data = services.repo.data();
    expect(report(data, { type: 'revenue', preset: 'current_month' }).totals.revenueCents).toBe(
      250000,
    );
    expect(() => services.opportunities.reopenOpportunity(c, 'missing')).toThrow();
    services.opportunities.reopenOpportunity(c, opportunity.id);
    expect(report(data, { type: 'revenue', preset: 'current_month' }).totals.revenueCents).toBe(0);
    expect(() => services.opportunities.reopenOpportunity(c, opportunity.id)).toThrow(
      'Prilika je već otvorena.',
    );
    services.opportunities.closeOpportunity(c, opportunity.id, { outcome: 'lost' });
    const wl = report(data, { type: 'won_lost', preset: 'current_month' });
    expect(wl.totals).toMatchObject({
      wonCount: 0,
      lostCount: 1,
      lostCents: 250000,
      lossRate: 100,
    });
    expect(
      services.opportunities
        .statusHistory(c, opportunity.id)
        .map((h) => [h.fromStatus, h.toStatus, h.amount]),
    ).toEqual([
      [null, 'active', 2500],
      ['active', 'won', 2500],
      ['won', 'active', 2500],
      ['active', 'lost', 2500],
    ]);
    const reopened = services.opportunities.getOpportunity(c, opportunity.id);
    expect(reopened.closedAt).not.toBeNull(); // closed again, as LOST
  });

  it('older data: history rebuilt from createdAt/closedAt; report rights follow reports.view', () => {
    const old = fixture([
      deal({ id: 'old-won', closedAt: '2026-05-01T10:00:00.000Z' }),
    ]) as Partial<CrmData>;
    delete old.opportunityStatusChanges;
    delete old.reportEmails;
    old.users = [
      { id: 'u-adm', organizationId: ORG, role: 'admin' } as never,
      { id: 'u-sales', organizationId: ORG, role: 'user' } as never,
    ];
    old.userPermissions = [
      { organizationId: ORG, userId: 'u-adm', key: 'reports.view', allowed: true } as never,
      { organizationId: ORG, userId: 'u-sales', key: 'reports.view', allowed: true } as never,
    ];
    const data = normalizeData(old);
    expect(
      data.opportunityStatusChanges.map((h) => [h.fromStatus, h.toStatus, h.changedAt, h.source]),
    ).toEqual([
      [null, 'active', '2026-01-05T10:00:00.000Z', 'backfill'],
      ['active', 'won', '2026-05-01T10:00:00.000Z', 'backfill'],
    ]);
    const keys = (id: string) =>
      data.userPermissions
        .filter((p) => p.userId === id)
        .map((p) => p.key)
        .sort();
    expect(keys('u-adm')).toEqual(['reports.email', 'reports.sales_reps', 'reports.view']);
    expect(keys('u-sales')).toEqual(['reports.email', 'reports.view']);
  });
});

// ------------------------------------------------------------------ PDF ---
async function pdfText(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes.slice(0) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const page = await doc.getPage(1);
  return { pages, numPages: doc.numPages, size: page.view };
}

describe('PDF', () => {
  it('A4, Croatian letters as text, header, filters, footer with page numbers', async () => {
    const data = fixture([deal({ title: 'Isporuka — čćžšđ ČĆŽŠĐ', value: 2500, companyId: 'c2' })]);
    const r = report(data, { type: 'revenue', preset: 'current_year' });
    const bytes = await renderReportPdf(r, await nodePdfResources());
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
    const { pages, numPages, size } = await pdfText(bytes);
    expect(numPages).toBe(1);
    expect(size.map(Math.round)).toEqual([0, 0, 595, 842]);
    const text = pages[0]!;
    for (const expected of [
      'RENVARA',
      'UKUPNI PRIHOD ZA RAZDOBLJE',
      'Razdoblje: 2026.',
      'Čakovečki mlinovi d.d.',
      'Isporuka — čćžšđ ČĆŽŠĐ',
      '2.500,00',
      'Stranica 1 od 1',
      'RENVARA CRM',
      'Svi kupci',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('long tables continue on the next pages with their header; nothing is lost', async () => {
    const data = fixture(
      Array.from({ length: 400 }, (_, i) =>
        deal({
          title: `Prilika ${i} s dugim nazivom koji se mora prelomiti unutar stupca tablice`,
          value: 10,
          closedAt: '2026-03-10T10:00:00.000Z',
        }),
      ),
    );
    const r = report(data, { type: 'won_lost', preset: 'current_year' });
    const bytes = await renderReportPdf(r, await nodePdfResources());
    const { pages, numPages } = await pdfText(bytes);
    expect(numPages).toBeGreaterThan(5);
    expect(pages.at(-1)).toContain(`Stranica ${numPages} od ${numPages}`);
    expect(pages[1]).toContain('Zaključene prilike (nastavak)');
    const all = pages.join(' ');
    for (const i of [0, 199, 399]) expect(all).toContain(`Prilika ${i} s dugim`);
  });

  it('charts are part of the PDF itself (drawn shapes, not only the page)', async () => {
    const data = fixture([deal({ value: 3000 })]);
    const r = report(data, { type: 'quarters', year: '2026' });
    const bytes = await renderReportPdf(r, await nodePdfResources());
    const { pages } = await pdfText(bytes);
    expect(pages[0]).toContain('Prihod po kvartalima 2026.');
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) expect(pages[0]).toContain(q);
  });
});

// --------------------------------------------------------------- e-mail ---
describe('e-mail service', () => {
  it('is not configured without a key and a sender (and says why)', () => {
    expect(mailerFromEnv({}).configured).toBe(false);
    expect(mailerFromEnv({ RESEND_API_KEY: 're_x' }).problem).toMatch('RENVARA_EMAIL_FROM');
    expect(
      mailerFromEnv({ RESEND_API_KEY: 're_x', RENVARA_EMAIL_FROM: 'nije adresa' }).configured,
    ).toBe(false);
    expect(
      mailerFromEnv({
        RENVARA_EMAIL_PROVIDER: 'smtp',
        RESEND_API_KEY: 'x',
        RENVARA_EMAIL_FROM: 'a@b.hr',
      }).configured,
    ).toBe(false);
    expect(
      mailerFromEnv({
        RESEND_API_KEY: 'x',
        RENVARA_EMAIL_FROM: 'a@b.hr',
        RENVARA_RESEND_API_URL: 'http://evil.example/emails',
      }).configured,
    ).toBe(false);
    const ok = mailerFromEnv({
      RESEND_API_KEY: 're_x',
      RENVARA_EMAIL_FROM: 'RENVARA CRM <izvjestaji@firma.hr>',
    });
    expect(ok).toMatchObject({
      configured: true,
      provider: 'resend',
      from: 'RENVARA CRM <izvjestaji@firma.hr>',
    });
  });

  it('Resend: the key in the header only, the PDF as a base64 attachment, the idempotency key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mailer = resendMailer({
      apiKey: 're_secret',
      from: 'izvjestaji@firma.hr',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await mailer.send({
      to: 'kupac@example.com',
      subject: 'S',
      text: 'T',
      attachments: [
        {
          filename: 'a.pdf',
          content: new TextEncoder().encode('%PDF-1.7'),
          contentType: 'application/pdf',
        },
      ],
      idempotencyKey: 'k-1',
    });
    expect(result).toEqual({ ok: true, id: 'msg_1' });
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_secret');
    expect(headers['Idempotency-Key']).toBe('k-1');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: 'izvjestaji@firma.hr',
      to: ['kupac@example.com'],
      subject: 'S',
      text: 'T',
    });
    expect(Buffer.from(body.attachments[0].content, 'base64').toString()).toBe('%PDF-1.7');
    expect(String(init.body)).not.toContain('re_secret');
  });

  it('Resend errors: status codes kept, the service text dropped, network errors retryable', async () => {
    const failing = (status: number) =>
      resendMailer({
        apiKey: 'k',
        from: 'a@b.hr',
        fetch: (async () =>
          new Response('{"message":"to: kupac@example.com invalid"}', { status })) as never,
      });
    const msg: MailMessage = {
      to: 'x@y.hr',
      subject: 's',
      text: 't',
      attachments: [],
      idempotencyKey: 'k',
    };
    expect(await failing(422).send(msg)).toEqual({
      ok: false,
      error: 'http_422',
      retryable: false,
    });
    expect(await failing(503).send(msg)).toEqual({ ok: false, error: 'http_503', retryable: true });
    const offline = resendMailer({
      apiKey: 'k',
      from: 'a@b.hr',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as never,
    });
    expect(await offline.send(msg)).toEqual({ ok: false, error: 'network', retryable: true });
  });
});

// ------------------------------------------------------------------ API ---
function fakeMailer(result: 'ok' | 'fail' = 'ok') {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    configured: true,
    provider: 'test',
    problem: null,
    from: 'izvjestaji@firma.hr',
    async send(message) {
      sent.push(message);
      await new Promise((r) => setTimeout(r, 20));
      return result === 'ok'
        ? { ok: true, id: `m${sent.length}` }
        : { ok: false, error: 'http_500', retryable: true };
    },
  };
  return { mailer, sent };
}
function apiWith(
  data: CrmData,
  mailer: Mailer,
  extra: Partial<Parameters<typeof createReportApi>[0]> = {},
) {
  const crm = createCrmServices(createMemoryRepository(data), { demoContent: false });
  const logs: Array<[string, Record<string, unknown>]> = [];
  const api = createReportApi({
    crm,
    members: async () => MEMBERS,
    pdf: nodePdfResources,
    mailer,
    log: (event, fields) => logs.push([event, fields]),
    ...extra,
  });
  return { api, crm, logs };
}
const run = (
  api: ReturnType<typeof createReportApi>,
  path: string,
  body: Record<string, unknown>,
  c = ctx(),
  method = 'POST',
) => api.run(method, path, c, body, new URLSearchParams());

describe('reports API', () => {
  const sendBody = (requestId: string) => ({
    filters: { type: 'revenue', preset: 'current_year' },
    to: 'uprava@example.com',
    subject: 'RENVARA CRM — Ukupni prihod — 2026.',
    message: 'Poštovani, …',
    fileName: 'Izvještaj.pdf',
    requestId,
  });

  it('rights: every report, PDF and e-mail checked on the server', async () => {
    const { api } = apiWith(fixture([deal({})]), fakeMailer().mailer);
    const viewer = ctx(['reports.view', 'opportunities.view'], 'user');
    expect((await run(api, '/api/reports/generate', { type: 'revenue' }, viewer)).status).toBe(200);
    expect((await run(api, '/api/reports/generate', { type: 'sales_reps' }, viewer)).status).toBe(
      403,
    );
    expect((await run(api, '/api/reports/pdf', { type: 'sales_reps' }, viewer)).status).toBe(403);
    expect((await run(api, '/api/reports/email', sendBody('req-viewer-1'), viewer)).status).toBe(
      403,
    );
    const noOpps = ctx(['reports.view', 'reports.email'], 'user');
    expect((await run(api, '/api/reports/generate', { type: 'revenue' }, noOpps)).status).toBe(403);
    expect((await run(api, '/api/reports/options', {}, noOpps, 'GET')).status).toBe(403);
  });

  it('e-mail: sends once per request, logs the send without the message text', async () => {
    const { mailer, sent } = fakeMailer();
    const { api, crm, logs } = apiWith(fixture([deal({ value: 2500 })]), mailer);
    const [a, b] = await Promise.all([
      run(api, '/api/reports/email', sendBody('req-same-0001')),
      run(api, '/api/reports/email', sendBody('req-same-0001')),
    ]);
    expect(a.status).toBe(201);
    expect(b).toBe(a);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments[0]!.filename).toBe('Izvjestaj.pdf');
    expect(new TextDecoder().decode(sent[0]!.attachments[0]!.content.subarray(0, 5))).toBe('%PDF-');
    expect(sent[0]!.idempotencyKey).toBe(`renvara-report-${ORG}-req-same-0001`);
    const entry = crm.repo.data().reportEmails[0]!;
    expect(entry).toMatchObject({
      status: 'sent',
      recipient: 'uprava@example.com',
      reportType: 'revenue',
      periodFrom: '2026-01-01',
      periodTo: '2026-12-31',
      sentBy: 'u-ana',
    });
    expect(JSON.stringify(entry)).not.toContain('Poštovani');
    expect(JSON.stringify(logs)).not.toContain('uprava@example.com');
  });

  it('e-mail: a failure is reported as a failure and logged; not configured is 503', async () => {
    const { api, crm } = apiWith(fixture([]), fakeMailer('fail').mailer);
    const failed = await run(api, '/api/reports/email', sendBody('req-fail-0001'));
    expect(failed.status).toBe(502);
    expect('json' in failed && failed.json.success).toBe(false);
    expect(crm.repo.data().reportEmails[0]).toMatchObject({ status: 'failed', error: 'http_500' });
    const { api: off } = apiWith(fixture([]), mailerFromEnv({}));
    const refused = await run(off, '/api/reports/email', sendBody('req-off-00001'));
    expect(refused.status).toBe(503);
    expect('json' in refused && refused.json.code).toBe('email_not_configured');
  });

  it('e-mail: checks the address, the request id and the limits', async () => {
    const { api } = apiWith(fixture([]), fakeMailer().mailer, {
      limits: { emailPerUser: new RequestLimiter(2, 60_000) },
    });
    expect(
      (await run(api, '/api/reports/email', { ...sendBody('req-bad-00001'), to: 'nije' })).status,
    ).toBe(422);
    expect(
      (await run(api, '/api/reports/email', { ...sendBody('x'), requestId: 'x' })).status,
    ).toBe(422);
    expect((await run(api, '/api/reports/email', sendBody('req-lim-00001'))).status).toBe(201);
    expect((await run(api, '/api/reports/email', sendBody('req-lim-00002'))).status).toBe(201);
    const third = await run(api, '/api/reports/email', sendBody('req-lim-00003'));
    expect(third.status).toBe(429);
  });

  it('a failing directory (e.g. Supabase) is a server error without details', async () => {
    const { api, logs } = apiWith(fixture([]), fakeMailer().mailer, {
      members: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
      },
    });
    const r = await run(api, '/api/reports/generate', { type: 'revenue' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(logs)).not.toContain('secret');
  });
});

describe('reports over HTTP', () => {
  it('session, same origin and JSON required; the PDF is not cached and cannot run code', async () => {
    const { mailer } = fakeMailer();
    const server = await startTestServer(undefined, { mailer });
    try {
      const anonymous = await fetch(`${server.url}/api/reports/options`);
      expect(anonymous.status).toBe(401);
      const cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${server.url}${path}`, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: server.url,
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
        });
      expect(
        (
          await post(
            '/api/reports/generate',
            { type: 'revenue' },
            { Origin: 'https://evil.example' },
          )
        ).status,
      ).toBe(403);
      expect(
        (await post('/api/reports/generate', { type: 'revenue' }, { 'Content-Type': 'text/plain' }))
          .status,
      ).toBe(415);
      const ok = await post('/api/reports/generate', { type: 'revenue', preset: 'current_year' });
      expect(ok.status).toBe(200);
      const pdf = await post('/api/reports/pdf?download=1', {
        type: 'won_lost',
        preset: 'current_year',
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
      expect(pdf.headers.get('cache-control')).toContain('no-store');
      expect(pdf.headers.get('content-security-policy')).toContain('sandbox');
      expect(pdf.headers.get('content-disposition')).toMatch(
        /^attachment; filename="RENVARA_WON_LOST_analiza_/,
      );
      const page = await fetch(`${server.url}/reports`, { headers: { Cookie: cookie } });
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("worker-src 'self'");
      expect(
        (await fetch(`${server.url}/api/reports/generate`, { headers: { Cookie: cookie } })).status,
      ).toBe(405);
    } finally {
      await server.close();
    }
  });
});
