import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../lib/errors.js';
import { todayLocal } from '../lib/time.js';
import { parse, zIdParams, zIsoDate, zOptText } from '../lib/validate.js';
import { actorOf, adminOnly, editors } from '../http/helpers.js';
import { verifyLedgerIntegrity, reverseMovement, type MovementType } from '../modules/inventory/ledger.js';
import {
  cancelInventoryCount,
  correctMovement,
  createInventoryCount,
  createIssue,
  createOpening,
  createReceipt,
  createReservation,
  createTransfer,
  getInventoryCount,
  listInventoryCounts,
  listReservations,
  postInventoryCount,
  releaseReservation,
  updateInventoryCountLines,
  updateMovementMeta,
} from '../modules/inventory/operations.js';
import { movementDetail, movementsList, stockBalances, stockHistory, stockOverview, stockValue } from '../modules/inventory/queries.js';
import { bookRefill, ignoreRefill, listRefills, reconcileRefill, suggestRefillMatches } from '../televend/refills.js';
import { postSalesToMachineStock, unpostedSalesCount } from '../televend/salesPosting.js';

const qty = z.number().finite().positive().max(1e9);
const price = z.number().finite().min(0).max(1e7).nullable().optional();

export const receiptSchema = z.object({
  docDate: zIsoDate,
  supplierId: z.number().int().positive().nullable().optional(),
  documentRef: zOptText(100),
  note: zOptText(1000),
  lines: z.array(z.object({ productId: z.number().int().positive(), qty, unitPrice: price })).min(1).max(200),
});
export const issueSchema = z.object({
  docDate: zIsoDate,
  destinationType: z.enum(['vehicle', 'machine', 'other']),
  destinationLocationId: z.number().int().positive().nullable().optional(),
  note: zOptText(1000),
  lines: z.array(z.object({ productId: z.number().int().positive(), qty })).min(1).max(200),
});
export const transferSchema = z.object({
  docDate: zIsoDate,
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  note: zOptText(1000),
  lines: z.array(z.object({ productId: z.number().int().positive(), qty })).min(1).max(200),
});
const openingSchema = z.object({
  docDate: zIsoDate,
  locationId: z.number().int().positive(),
  note: zOptText(1000),
  lines: z.array(z.object({ productId: z.number().int().positive(), qty, unitCost: price })).min(1).max(1000),
});
const MOVEMENT_TYPES = ['opening', 'receipt', 'issue', 'transfer', 'adjustment', 'sale', 'reversal'] as const;
export const historyQuery = z.object({
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
  productId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});

export function registerInventoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/stock/overview', async () => ({ products: stockOverview(ctx.db), value: stockValue(ctx.db), unposted: unpostedSalesCount(ctx.db) }));
  app.get('/api/stock/balances', async (req) => {
    const q = parse(z.object({ locationId: z.coerce.number().int().positive().optional(), includeZero: z.enum(['0', '1']).optional() }), req.query);
    return stockBalances(ctx.db, { locationId: q.locationId, includeZero: q.includeZero === '1' });
  });
  app.get('/api/stock/history', async (req) => stockHistory(ctx.db, parse(historyQuery, req.query)));
  app.get('/api/stock/movements', async (req) => {
    const q = parse(z.object({ type: z.enum(MOVEMENT_TYPES).optional(), from: zIsoDate.optional(), to: zIsoDate.optional(), limit: z.coerce.number().int().min(1).max(5000).optional() }), req.query);
    return movementsList(ctx.db, q as { type?: MovementType; from?: string; to?: string; limit?: number });
  });
  app.get('/api/stock/movements/:id', async (req) => {
    const d = movementDetail(ctx.db, parse(zIdParams, req.params).id);
    if (!d) throw notFound('Dokument nije pronađen.');
    return d;
  });

  app.post('/api/stock/receipts', { preHandler: editors }, async (req) => createReceipt(ctx.db, parse(receiptSchema, req.body), actorOf(req)));
  app.post('/api/stock/issues', { preHandler: editors }, async (req) => createIssue(ctx.db, parse(issueSchema, req.body), actorOf(req)));
  app.post('/api/stock/transfers', { preHandler: editors }, async (req) => createTransfer(ctx.db, parse(transferSchema, req.body), actorOf(req)));
  app.post('/api/stock/openings', { preHandler: editors }, async (req) => createOpening(ctx.db, parse(openingSchema, req.body), actorOf(req)));

  app.post('/api/stock/movements/:id/reverse', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ reason: z.string().trim().min(3, 'navedite razlog storna').max(500), docDate: zIsoDate.optional() }), req.body);
    return reverseMovement(ctx.db, id, { reason: b.reason, docDate: b.docDate ?? todayLocal() }, actorOf(req));
  });
  app.post('/api/stock/movements/:id/correct', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(
      z.object({
        reason: z.string().trim().min(3, 'navedite razlog ispravka').max(500),
        type: z.enum(['receipt', 'issue', 'transfer']),
        data: z.unknown(),
      }),
      req.body,
    );
    const correction =
      b.type === 'receipt'
        ? { type: 'receipt' as const, data: parse(receiptSchema, b.data) }
        : b.type === 'issue'
          ? { type: 'issue' as const, data: parse(issueSchema, b.data) }
          : { type: 'transfer' as const, data: parse(transferSchema, b.data) };
    return correctMovement(ctx.db, id, correction, b.reason, actorOf(req));
  });
  app.patch('/api/stock/movements/:id', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ note: zOptText(1000), documentRef: zOptText(100) }), req.body);
    updateMovementMeta(ctx.db, id, b, actorOf(req));
    return { ok: true };
  });

  // Inventura
  app.get('/api/stock/counts', async () => listInventoryCounts(ctx.db));
  app.get('/api/stock/counts/:id', async (req) => getInventoryCount(ctx.db, parse(zIdParams, req.params).id));
  app.post('/api/stock/counts', { preHandler: editors }, async (req) => {
    const b = parse(
      z.object({ locationId: z.number().int().positive(), countDate: zIsoDate, note: zOptText(500), productIds: z.array(z.number().int().positive()).max(5000).optional() }),
      req.body,
    );
    return { id: createInventoryCount(ctx.db, b, actorOf(req)) };
  });
  app.put('/api/stock/counts/:id/lines', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ lines: z.array(z.object({ productId: z.number().int().positive(), countedQty: z.number().finite().min(0).max(1e9).nullable() })).max(10000) }), req.body);
    updateInventoryCountLines(ctx.db, id, b.lines, actorOf(req));
    return { ok: true };
  });
  app.post('/api/stock/counts/:id/post', { preHandler: editors }, async (req) => postInventoryCount(ctx.db, parse(zIdParams, req.params).id, actorOf(req)));
  app.post('/api/stock/counts/:id/cancel', { preHandler: editors }, async (req) => {
    cancelInventoryCount(ctx.db, parse(zIdParams, req.params).id, actorOf(req));
    return { ok: true };
  });

  // Rezervacije
  app.get('/api/stock/reservations', async (req) => {
    const q = parse(z.object({ all: z.enum(['0', '1']).optional() }), req.query);
    return listReservations(ctx.db, q.all === '1');
  });
  app.post('/api/stock/reservations', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ productId: z.number().int().positive(), qty, note: zOptText(300) }), req.body);
    return { id: createReservation(ctx.db, b, actorOf(req)) };
  });
  app.post('/api/stock/reservations/:id/release', { preHandler: editors }, async (req) => {
    releaseReservation(ctx.db, parse(zIdParams, req.params).id, actorOf(req));
    return { ok: true };
  });

  // Integritet knjige
  app.get('/api/stock/integrity', { preHandler: adminOnly }, async () => verifyLedgerIntegrity(ctx.db));

  // Dopune automata iz Televenda i usklađivanje
  app.get('/api/refills', async (req) => {
    const q = parse(z.object({ status: z.enum(['pending', 'reconciled', 'booked', 'ignored']).optional(), machineId: z.coerce.number().int().positive().optional() }), req.query);
    return listRefills(ctx.db, q);
  });
  app.get('/api/refills/:id/matches', async (req) => suggestRefillMatches(ctx.db, parse(zIdParams, req.params).id));
  app.post('/api/refills/:id/reconcile', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ movementId: z.number().int().positive() }), req.body);
    reconcileRefill(ctx.db, parse(zIdParams, req.params).id, b.movementId, actorOf(req));
    return { ok: true };
  });
  app.post('/api/refills/:id/book', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ fromLocationId: z.number().int().positive() }), req.body);
    return bookRefill(ctx.db, parse(zIdParams, req.params).id, b.fromLocationId, actorOf(req));
  });
  app.post('/api/refills/:id/ignore', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ note: zOptText(300) }), req.body);
    ignoreRefill(ctx.db, parse(zIdParams, req.params).id, b.note, actorOf(req));
    return { ok: true };
  });

  // Knjiženje prodaje na zalihe automata (npr. nakon povezivanja artikala)
  app.post('/api/stock/post-sales', { preHandler: editors }, async (req) => postSalesToMachineStock(ctx.db, 'all', actorOf(req)));
}
