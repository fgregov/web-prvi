// DashboardService: what happened in a period (Home KPI cards and the
// historical dashboard). A period is only a filter over existing records —
// nothing is reset or archived when a quarter ends.
//
// Definitions (records of the caller's organization, period in the org timezone,
// start inclusive, end exclusive). Each count uses its own event date:
//   LEADS          leads created in the period (created_at)
//   PROSPECTS      leads that became prospects (= reached stage qualified) in the period (qualified_at)
//   WON / LOST     opportunities won / lost in the period (closed_at with status)
//   WON / LOST RATE  won ÷ (won + lost) / lost ÷ (won + lost); "—" when nothing closed
//   OPPORTUNITY POTENTIAL  estimated value of opportunities created in the period (EUR)
//   OPPORTUNITY WON        final value of opportunities won in the period (EUR; won_value, else the estimate)
//   NEGOTIATIONS   distinct opportunities with a negotiation event in the period: created,
//                  offer sent, offer answered, or a task of that opportunity completed
//   BUYERS         distinct customers with a won opportunity in the calendar year of the
//                  period's end, up to the end of the period (annual, as of)
//   lead won/lost  leads converted (converted_at) / closed as lost (lost_at) in the period
//   sastanci       meetings scheduled in the period (not cancelled)
//   zadaci         tasks dated in the period (calendar slot or deadline)
// Money is summed in integer cents; other currencies are counted apart, never converted.
import { STAGES } from '../../public/app/js/core/constants.js';
import {
  addDays,
  daysInclusive,
  isDateKey,
  previousPeriod,
  quarterOf,
  quarterPeriod,
  samePeriod,
  shiftQuarter,
  validateRange,
} from '../../public/app/js/core/period.js';
import { leadOutcomeMetrics, outcomeRates, sumMoney } from '@renvara/domain';
import {
  DEMO_CURRENT_TO_DATE_PREVIOUS,
  DEMO_QUARTERS,
  ZERO_METRICS,
  type PeriodMetrics,
} from './demo-metrics.ts';
import { CrmValidationError } from './errors.ts';
import { feedbackItems } from './offer-service.ts';
import type { CrmRepository } from './repository.ts';
import { inOrg } from './scope.ts';
import { effectiveTime, type TaskService, type TaskView } from './task-service.ts';
import { calendarDateInZone, startOfDayInZone } from './time.ts';
import type { CrmContext, Task } from './types.ts';

const TASK_ITEMS = 5;
const CALENDAR_ITEMS = 4;
const STAGE_ORDER = STAGES.map((s: { value: string }) => s.value);

type Range = { startDate: string; endDate: string };
type Metric = { value: number; previous: number };

const add = (a: PeriodMetrics, b: PeriodMetrics): PeriodMetrics =>
  Object.fromEntries(
    Object.keys(a).map((k) => [k, a[k as keyof PeriodMetrics] + b[k as keyof PeriodMetrics]]),
  ) as unknown as PeriodMetrics;

const scale = (m: PeriodMetrics, f: number): PeriodMetrics =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v * f])) as unknown as PeriodMetrics;

const round = (m: PeriodMetrics): PeriodMetrics =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, Math.round(v)]),
  ) as unknown as PeriodMetrics;

/** Overlap of two inclusive date ranges, in days. */
function overlapDays(a: Range, b: Range): number {
  const start = a.startDate > b.startDate ? a.startDate : b.startDate;
  const end = a.endDate < b.endDate ? a.endDate : b.endDate;
  return end < start ? 0 : daysInclusive(start, end);
}

/**
 * DEMO baseline for a range: each overlapping quarter contributes its share by
 * days. The current quarter's numbers cover only the days up to today.
 */
function demoBaseline(today: string, range: Range): PeriodMetrics {
  const current = quarterOf(today);
  let total = ZERO_METRICS;
  let q = quarterOf(range.startDate);
  const last = quarterOf(range.endDate);
  const index = (x: { year: number; quarter: number }) => x.year * 4 + x.quarter;
  for (; index(q) <= index(last); q = shiftQuarter(q, 1)) {
    const offset = index(q) - index(current);
    const metrics = DEMO_QUARTERS[offset];
    if (!metrics || offset > 0) continue;
    const qp = quarterPeriod(q.year, q.quarter);
    const covered = { startDate: qp.startDate, endDate: offset === 0 ? today : qp.endDate };
    const share = overlapDays(range, covered) / daysInclusive(covered.startDate, covered.endDate);
    if (share > 0) total = add(total, scale(metrics, share));
  }
  return round(total);
}

export function createDashboardService(
  repo: CrmRepository,
  tasks: TaskService,
  { demoContent = true } = {},
) {
  /** Demo numbers are added only in the presentation demo; a clean start counts records only. */
  const baseline = (today: string, range: Range) =>
    demoContent ? demoBaseline(today, range) : ZERO_METRICS;

  function bounds(ctx: CrmContext, range: Range) {
    return {
      from: startOfDayInZone(range.startDate, ctx.timeZone).getTime(),
      to: startOfDayInZone(addDays(range.endDate, 1), ctx.timeZone).getTime(),
    };
  }

  /** Real records of the organization that fall in the range. */
  function realRecords(ctx: CrmContext, range: Range) {
    const { from, to } = bounds(ctx, range);
    const inside = (iso: string | null | undefined) => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return t >= from && t < to;
    };
    const data = repo.data();
    const leads = inOrg(data.leads, ctx);
    const opportunities = inOrg(data.opportunities, ctx);
    const created = opportunities.filter((o) => inside(o.createdAt));
    const reached = (stage: number) =>
      created.filter((o) => o.status !== 'active' || STAGE_ORDER.indexOf(o.stage) >= stage).length;
    const won = opportunities.filter((o) => o.status === 'won' && inside(o.closedAt));
    const lost = opportunities.filter((o) => o.status === 'lost' && inside(o.closedAt));
    const wonMoney = sumMoney(
      won.map((o) => ({ amount: o.wonValue ?? o.value, currency: o.currency })),
    );
    const potentialMoney = sumMoney(
      created.map((o) => ({ amount: o.value, currency: o.currency })),
    );

    // Negotiations: one count per opportunity, whatever the number of events in the period.
    const negotiating = new Set<string>(created.map((o) => o.id));
    for (const offer of inOrg(data.offers ?? [], ctx)) {
      if (inside(offer.sentAt) || inside(offer.answeredAt)) negotiating.add(offer.opportunityId);
    }

    const allTasks = inOrg(data.tasks, ctx);
    for (const t of allTasks) {
      if (t.opportunityId && t.status === 'completed' && inside(t.completedAt)) {
        negotiating.add(t.opportunityId);
      }
    }
    const opportunityIds = new Set(opportunities.map((o) => o.id));
    const dated = (t: Task) => {
      const at = effectiveTime(t, ctx.timeZone);
      return at === null ? inside(t.completedAt) : at >= from && at < to;
    };
    const periodTasks = allTasks.filter(dated);
    const followUps = periodTasks.filter((t) => t.type === 'follow_up');
    const scheduled = allTasks.filter(
      (t) => t.status !== 'cancelled' && inside(t.scheduledStartAt),
    );

    const metrics: PeriodMetrics = {
      // Lead lifecycle, each by its own date: created, qualified, converted (won), lost.
      newLeads: leads.filter((l) => inside(l.createdAt)).length,
      qualified: leads.filter((l) => inside(l.qualifiedAt)).length,
      leadsWon: leads.filter((l) => l.status === 'won' && inside(l.convertedAt)).length,
      leadsLost: leads.filter((l) => l.status === 'lost' && inside(l.lostAt)).length,
      meetings: scheduled.filter((t) => t.type === 'meeting').length,
      won: won.length,
      lost: lost.length,
      revenue: wonMoney.cents,
      potential: potentialMoney.cents,
      wonOtherCurrency: wonMoney.excluded,
      potentialOtherCurrency: potentialMoney.excluded,
      negotiations: [...negotiating].filter((id) => opportunityIds.has(id)).length,
      tasksDone: periodTasks.filter((t) => t.status === 'completed').length,
      tasksNotDone: periodTasks.filter((t) => t.status !== 'completed').length,
      followUpsDone: followUps.filter((t) => t.status === 'completed').length,
      followUpsNoAnswer: followUps.filter((t) => t.status === 'cancelled').length,
      followUpsOpen: followUps.filter((t) => t.status === 'open').length,
      stageNew: created.length,
      stageInProgress: reached(1),
      stageOfferSent: reached(2),
      stageNegotiation: reached(3),
    };
    return { metrics, periodTasks, scheduled };
  }

  /**
   * BUYERS: distinct customers with at least one won opportunity in the
   * calendar year of the period's end, counted up to the end of the period
   * (or now, if earlier). Annual context, whatever quarter is selected.
   */
  function buyers(ctx: CrmContext, range: Range) {
    const year = Number(range.endDate.slice(0, 4));
    const from = startOfDayInZone(`${year}-01-01`, ctx.timeZone).getTime();
    const to = Math.min(bounds(ctx, range).to, ctx.now.getTime() + 1);
    const companies = new Set(
      inOrg(repo.data().opportunities, ctx)
        .filter((o) => {
          if (o.status !== 'won' || !o.closedAt) return false;
          const at = Date.parse(o.closedAt);
          return at >= from && at < to;
        })
        .map((o) => o.companyId),
    );
    return { count: companies.size, year, asOf: new Date(to - 1).toISOString() };
  }

  return {
    /**
     * Summary of [startDate, endDate] (calendar dates, inclusive, org timezone)
     * with the comparison period: the previous quarter, the same days of the
     * previous quarter while the current one is running, or the equally long
     * range before a custom period.
     */
    getPeriodSummary(ctx: CrmContext, startDate: unknown, endDate: unknown) {
      const problem = validateRange(String(startDate ?? ''), String(endDate ?? ''));
      if (problem || !isDateKey(startDate) || !isDateKey(endDate)) {
        throw new CrmValidationError({ range: problem ?? 'Neispravan period.' });
      }
      const today = calendarDateInZone(ctx.now, ctx.timeZone);
      const range: Range = { startDate: startDate as string, endDate: endDate as string };
      const q = quarterOf(range.startDate);
      const asQuarter = quarterPeriod(q.year, q.quarter);
      const period = samePeriod(asQuarter, { ...range, type: 'QUARTER' })
        ? asQuarter
        : { type: 'CUSTOM' as const, ...range };
      const current = quarterOf(today);
      const isCurrent =
        period.type === 'QUARTER' &&
        period.year === current.year &&
        period.quarter === current.quarter;

      const real = realRecords(ctx, range);
      const metrics = add(baseline(today, range), real.metrics);

      let previousRange: Range;
      let previousMetrics: PeriodMetrics;
      if (isCurrent) {
        const prevQ = previousPeriod(period);
        const elapsed = daysInclusive(period.startDate, today);
        previousRange = {
          startDate: prevQ.startDate,
          endDate: addDays(prevQ.startDate, elapsed - 1),
        };
        previousMetrics = add(
          demoContent ? DEMO_CURRENT_TO_DATE_PREVIOUS : ZERO_METRICS,
          realRecords(ctx, previousRange).metrics,
        );
      } else {
        const prev = previousPeriod(period);
        previousRange = { startDate: prev.startDate, endDate: prev.endDate };
        previousMetrics = add(
          baseline(today, previousRange),
          realRecords(ctx, previousRange).metrics,
        );
      }
      const metric = (key: keyof PeriodMetrics): Metric => ({
        value: metrics[key],
        previous: previousMetrics[key],
      });

      const view = (t: Task): TaskView => tasks.view(ctx, t);
      const byTime = (a: Task, b: Task) =>
        (effectiveTime(a, ctx.timeZone) ?? 0) - (effectiveTime(b, ctx.timeZone) ?? 0);
      const taskItems = [
        ...real.periodTasks
          .filter((t) => t.status === 'completed')
          .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
        ...real.periodTasks.filter((t) => t.status !== 'completed').sort(byTime),
      ]
        .slice(0, TASK_ITEMS)
        .map(view);
      const calendarItems = [...real.scheduled]
        .sort(
          (a, b) =>
            Number(b.status === 'completed') - Number(a.status === 'completed') || byTime(a, b),
        )
        .slice(0, CALENDAR_ITEMS)
        .sort(byTime)
        .map(view);
      const realCalendarDone = real.scheduled.filter((t) => t.status === 'completed').length;

      const euros = (key: 'revenue' | 'potential'): Metric => ({
        value: metrics[key] / 100,
        previous: previousMetrics[key] / 100,
      });
      const annual = buyers(ctx, range);
      // Feedback as of the end of the period (now for the running one): a past
      // period is rebuilt from the recorded dates, never from today's waiting state.
      const asOf = new Date(Math.min(bounds(ctx, range).to - 1, ctx.now.getTime()));

      const hasData = Object.values(metrics).some((v) => v > 0);
      return {
        period: { ...period, isCurrent },
        previous: previousRange,
        kpis: {
          leads: metric('newLeads'),
          newLeads: metric('newLeads'),
          qualified: metric('qualified'),
          meetings: metric('meetings'),
          won: metric('won'),
          lost: metric('lost'),
          /** WON RATE / LOST RATE: closed opportunities of the period only. */
          rates: outcomeRates({ won: metrics.won, lost: metrics.lost }),
          previousRates: outcomeRates({ won: previousMetrics.won, lost: previousMetrics.lost }),
          potential: euros('potential'),
          wonValue: euros('revenue'),
          revenue: euros('revenue'),
          /** Opportunities in another currency, left out of the EUR amounts. */
          otherCurrency: {
            potential: metrics.potentialOtherCurrency,
            won: metrics.wonOtherCurrency,
          },
          avgWonValue: metrics.won ? Math.round(metrics.revenue / 100 / metrics.won) : null,
        },
        pipelineOverview: {
          leads: metrics.newLeads,
          prospects: metrics.qualified,
          negotiations: metrics.negotiations,
          buyers: annual.count,
          buyersYear: annual.year,
          buyersAsOf: annual.asOf,
        },
        feedback: { asOf: asOf.toISOString(), items: feedbackItems(repo.data(), ctx, asOf) },
        tasks: { done: metrics.tasksDone, notDone: metrics.tasksNotDone, items: taskItems },
        calendar: {
          // Demo meetings of past days count as held.
          total: real.scheduled.length + (metrics.meetings - real.metrics.meetings),
          done: realCalendarDone + (metrics.meetings - real.metrics.meetings),
          items: calendarItems,
        },
        pipeline: [
          { key: 'new', label: 'Novi', count: metrics.stageNew },
          { key: 'in_progress', label: 'U obradi', count: metrics.stageInProgress },
          { key: 'offer_sent', label: 'Ponuda poslana', count: metrics.stageOfferSent },
          { key: 'negotiation', label: 'Pregovori', count: metrics.stageNegotiation },
          { key: 'won', label: 'Dobiveno', count: metrics.won },
        ],
        // Lead outcomes (not opportunity W/L): win rate and W/L count closed leads only.
        leads: leadOutcomeMetrics({
          created: metrics.newLeads,
          won: metrics.leadsWon,
          lost: metrics.leadsLost,
        }),
        followUps: {
          done: metrics.followUpsDone,
          noAnswer: metrics.followUpsNoAnswer,
          open: metrics.followUpsOpen,
          total: metrics.followUpsDone + metrics.followUpsNoAnswer + metrics.followUpsOpen,
        },
        hasData,
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
