import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { addDays, todayLocal } from '../lib/time.js';
import { parse, zIsoDate } from '../lib/validate.js';
import { dashboard } from '../modules/dashboard/service.js';
import {
  byCategory,
  byMachine,
  comparePeriods,
  hasAnySales,
  leastSold,
  summary,
  timeseries,
  topProducts,
  transactionsList,
  type SalesFilters,
} from '../modules/sales/analytics.js';

export const salesFilterQuery = z.object({
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
  machineId: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export function filtersFrom(q: z.infer<typeof salesFilterQuery>, defaultDays = 30): SalesFilters {
  const to = q.to ?? todayLocal();
  const from = q.from ?? addDays(to, -(defaultDays - 1));
  if (from > to) throw badRequest('Datum „od” mora biti prije datuma „do”.');
  return { from, to, machineId: q.machineId, productId: q.productId, categoryId: q.categoryId };
}

export function registerSalesRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/dashboard', async (req) => {
    const q = parse(salesFilterQuery, req.query);
    const f = filtersFrom(q);
    return dashboard(ctx, { from: f.from, to: f.to });
  });

  app.get('/api/analytics/report', async (req) => {
    const f = filtersFrom(parse(salesFilterQuery, req.query));
    if (!hasAnySales(ctx.db)) return { hasAnySales: false, filters: f };
    const granularity = f.to.slice(0, 7) === f.from.slice(0, 7) || (new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000 <= 92 ? 'day' : 'month';
    return {
      hasAnySales: true,
      filters: f,
      summary: summary(ctx.db, f),
      topByQty: topProducts(ctx.db, f, 'qty', 20),
      topByRevenue: topProducts(ctx.db, f, 'revenue', 20),
      byMachine: byMachine(ctx.db, f),
      byCategory: byCategory(ctx.db, f),
      daily: timeseries(ctx.db, f, 'day'),
      monthly: timeseries(ctx.db, f, 'month'),
      leastSold: leastSold(ctx.db, f, 20),
      granularity,
    };
  });

  app.get('/api/analytics/compare', async (req) => {
    const q = parse(
      salesFilterQuery.extend({ fromA: zIsoDate, toA: zIsoDate, fromB: zIsoDate, toB: zIsoDate }),
      req.query,
    );
    const common = { machineId: q.machineId, productId: q.productId, categoryId: q.categoryId };
    if (q.fromA > q.toA || q.fromB > q.toB) throw badRequest('Neispravno razdoblje usporedbe.');
    return comparePeriods(ctx.db, { from: q.fromA, to: q.toA, ...common }, { from: q.fromB, to: q.toB, ...common });
  });

  app.get('/api/sales/transactions', async (req) => {
    const q = parse(salesFilterQuery.extend({ limit: z.coerce.number().int().min(1).max(50000).optional() }), req.query);
    return transactionsList(ctx.db, filtersFrom(q, 7), q.limit ?? 5000);
  });
}
