// Dashboard periods (shared by Home and the server) and the period summary.
import { describe, expect, it } from 'vitest';
import {
  currentQuarterPeriod,
  customPeriod,
  isCurrentPeriod,
  parsePeriod,
  PERIOD_MESSAGES,
  periodRangeLabel,
  periodTitle,
  previousPeriod,
  quarterOf,
  quarterPeriod,
  shiftQuarter,
  validateRange,
} from '../public/app/js/core/period.js';
import { CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices } from '../src/crm/index.ts';
import { createCrmApi } from '../src/crm/dispatch.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import { seedDemoData } from '../src/crm/seed.ts';
import type { CrmContext } from '../src/crm/types.ts';

describe('quarters', () => {
  it('uses calendar quarters derived from the date, not a fixed year', () => {
    expect(quarterOf('2026-10-07')).toEqual({ year: 2026, quarter: 4 });
    expect(quarterOf('2027-02-28')).toEqual({ year: 2027, quarter: 1 });
    expect(quarterPeriod(2026, 3)).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    });
    expect(quarterPeriod(2028, 1).endDate).toBe('2028-03-31');
    expect(shiftQuarter({ year: 2026, quarter: 1 }, -1)).toEqual({ year: 2025, quarter: 4 });
  });

  it('supports another fiscal year start later without changing callers', () => {
    expect(quarterOf('2026-03-15', 4)).toEqual({ year: 2025, quarter: 4 });
    expect(quarterPeriod(2026, 1, 4)).toMatchObject({
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    });
  });

  it('labels quarters and custom periods', () => {
    const q3 = quarterPeriod(2026, 3);
    expect(periodTitle(q3)).toBe('Q3 2026');
    expect(periodRangeLabel(q3)).toBe('1.7. – 30.9.2026.');
    const custom = customPeriod('2026-03-15', '2026-05-15');
    expect(periodTitle(custom)).toBe('Prilagođeni period');
    expect(periodRangeLabel(customPeriod('2025-11-15', '2026-02-15'))).toBe(
      '15.11.2025. – 15.2.2026.',
    );
  });

  it('only the current quarter is the operational view', () => {
    expect(isCurrentPeriod(currentQuarterPeriod('2026-10-07'), '2026-10-07')).toBe(true);
    expect(isCurrentPeriod(quarterPeriod(2026, 3), '2026-10-07')).toBe(false);
    expect(isCurrentPeriod(customPeriod('2026-10-01', '2026-12-31'), '2026-10-07')).toBe(false);
  });

  it('compares with the previous quarter or an equally long range', () => {
    expect(previousPeriod(quarterPeriod(2026, 1))).toMatchObject({
      startDate: '2025-10-01',
      endDate: '2025-12-31',
    });
    expect(previousPeriod(customPeriod('2026-03-15', '2026-05-15'))).toEqual(
      customPeriod('2026-01-12', '2026-03-14'),
    );
  });

  it('validates ranges and stored periods', () => {
    expect(validateRange('2026-05-15', '2026-03-15')).toBe(PERIOD_MESSAGES.endBeforeStart);
    expect(validateRange('2026-01-01', '')).toBe(PERIOD_MESSAGES.missingDates);
    expect(validateRange('2020-01-01', '2026-01-01')).toBe(PERIOD_MESSAGES.tooLong);
    expect(validateRange('2026-03-15', '2026-03-15')).toBeNull();
    expect(
      parsePeriod({
        type: 'QUARTER',
        year: 2026,
        quarter: 3,
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      }),
    ).toEqual(quarterPeriod(2026, 3));
    expect(
      parsePeriod({
        type: 'QUARTER',
        year: 2026,
        quarter: 3,
        startDate: '2026-07-02',
        endDate: '2026-09-30',
      }),
    ).toBeNull();
    expect(
      parsePeriod({ type: 'CUSTOM', startDate: '2026-05-01', endDate: '2026-04-01' }),
    ).toBeNull();
    expect(parsePeriod('Q3')).toBeNull();
  });
});

describe('DashboardService · period summary', () => {
  const ctx: CrmContext = {
    organizationId: 'org-a',
    user: { id: 'u', displayName: 'U' },
    timeZone: 'Europe/Zagreb',
    now: new Date('2026-10-07T09:00:00Z'),
  };
  const crm = () => createCrmServices(createMemoryRepository(seedDemoData(ctx)));

  it('filters real records by period and adds the demo baseline', () => {
    const services = crm();
    const q3 = services.dashboard.getPeriodSummary(ctx, '2026-07-01', '2026-09-30');
    expect(q3.period).toMatchObject({ type: 'QUARTER', year: 2026, quarter: 3, isCurrent: false });
    expect(q3.previous).toEqual({ startDate: '2026-04-01', endDate: '2026-06-30' });
    // Baseline 9 won / €31.800 + the seeded "Servisni ugovor 2026" won in Q3 (€8.400).
    expect(q3.kpis.won.value).toBe(10);
    expect(q3.kpis.revenue.value).toBe(40200);
    expect(q3.tasks.items.map((t) => t.title)).toContain('Sastanak s Adria Tech');
    expect(q3.tasks.items.find((t) => t.title === 'Kontaktirati Initium – reference')?.status).toBe(
      'cancelled',
    );
    expect(q3.calendar.items.every((t) => t.status === 'completed')).toBe(true);
    expect(q3.hasData).toBe(true);
  });

  it('a new record counts in the period it was created in', () => {
    const services = crm();
    const before = services.dashboard.getPeriodSummary(ctx, '2026-10-01', '2026-12-31');
    services.leads.createLead(ctx, { name: 'Nova tvrtka' });
    const after = services.dashboard.getPeriodSummary(ctx, '2026-10-01', '2026-12-31');
    expect(after.period.isCurrent).toBe(true);
    expect(after.kpis.newLeads.value).toBe(before.kpis.newLeads.value + 1);
    expect(after.leads.created).toBe(before.leads.created + 1);
    expect(
      services.dashboard.getPeriodSummary(ctx, '2026-07-01', '2026-09-30').kpis.newLeads.value,
    ).toBe(
      services.dashboard.getPeriodSummary(ctx, '2026-07-01', '2026-09-30').kpis.newLeads.value,
    );
  });

  it('reading a period never changes records', () => {
    const services = crm();
    const snapshot = JSON.stringify(services.repo.data());
    services.dashboard.getPeriodSummary(ctx, '2026-07-01', '2026-09-30');
    services.dashboard.getPeriodSummary(ctx, '2026-03-15', '2026-05-15');
    expect(JSON.stringify(services.repo.data())).toBe(snapshot);
  });

  it('reports an empty old period and rejects invalid ranges', () => {
    const services = crm();
    const empty = services.dashboard.getPeriodSummary(ctx, '2024-01-01', '2024-03-31');
    expect(empty.hasData).toBe(false);
    expect(empty.kpis.newLeads).toEqual({ value: 0, previous: 0 });
    expect(() => services.dashboard.getPeriodSummary(ctx, '2026-05-15', '2026-03-15')).toThrow(
      CrmValidationError,
    );
    expect(() => services.dashboard.getPeriodSummary(ctx, 'x', '2026-03-15')).toThrow(
      CrmValidationError,
    );
  });

  it('is scoped to the organization', () => {
    const services = crm();
    const other = { ...ctx, organizationId: 'org-b' };
    const q3 = services.dashboard.getPeriodSummary(other, '2026-07-01', '2026-09-30');
    expect(q3.tasks.items).toEqual([]);
    expect(q3.kpis.won.value).toBe(9); // demo baseline only
  });
});

describe('Clean start (no demo content)', () => {
  const ctx: CrmContext = {
    organizationId: 'org-a',
    user: { id: 'u', displayName: 'U' },
    timeZone: 'Europe/Zagreb',
    now: new Date('2026-10-07T09:00:00Z'),
  };
  const clean = () =>
    createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });

  it('shows zeros everywhere until the user enters something', () => {
    const services = clean();
    for (const [from, to] of [
      ['2026-10-01', '2026-12-31'],
      ['2026-07-01', '2026-09-30'],
    ]) {
      const summary = services.dashboard.getPeriodSummary(ctx, from, to);
      expect(summary.hasData).toBe(false);
      const { kpis } = summary;
      for (const metric of [kpis.leads, kpis.won, kpis.lost, kpis.potential, kpis.wonValue]) {
        expect(metric).toEqual({ value: 0, previous: 0 });
      }
      expect(kpis.rates).toMatchObject({ wonRate: null, lostRate: null });
      expect(summary.pipelineOverview).toMatchObject({
        leads: 0,
        prospects: 0,
        negotiations: 0,
        buyers: 0,
      });
      expect(summary.feedback.items).toEqual([]);
      expect(summary.pipeline.every((stage) => stage.count === 0)).toBe(true);
      expect(summary.leads).toMatchObject({ created: 0, won: 0, lost: 0, winRate: null });
      expect(summary.calendar).toMatchObject({ total: 0, done: 0 });
    }
    expect(services.opportunities.pipeline(ctx).every((stage) => stage.total === 0)).toBe(true);
  });

  it('counts exactly what was entered', () => {
    const services = clean();
    services.leads.createLead(ctx, { name: 'Marko Horvat' });
    const customer = services.customers.createCustomer(ctx, {
      companyName: 'ABC d.o.o.',
      oib: '12345678903',
      city: 'Zagreb',
      contactName: 'Marko',
    });
    services.opportunities.createOpportunity(ctx, {
      companyId: customer.id,
      title: 'Prva prilika',
    });
    const q4 = services.dashboard.getPeriodSummary(ctx, '2026-10-01', '2026-12-31');
    expect(q4.kpis.newLeads.value).toBe(1);
    expect(q4.pipeline[0]).toMatchObject({ key: 'new', count: 1 });
    expect(services.opportunities.pipeline(ctx)[0]).toMatchObject({ created: 1, total: 1 });
  });

  it('has no demo reset to restore demo data', () => {
    const api = createCrmApi(clean());
    expect(api.match('POST', '/api/demo/reset').kind).toBe('none');
    expect(createCrmApi(crmWithDemo()).match('POST', '/api/demo/reset').kind).toBe('ok');
  });
});

function crmWithDemo() {
  return createCrmServices(createMemoryRepository(emptyData()));
}
