import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { parse, zIdParams, zIsoDate, zOptText } from '../lib/validate.js';
import { actorOf, editors } from '../http/helpers.js';
import {
  createOrdersFromRecommendations,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  recommendations,
  setPurchaseOrderStatus,
} from '../modules/procurement/service.js';
import { alertHistory } from '../modules/alerts/notifier.js';

export function registerProcurementRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/procurement/recommendations', async (req) => {
    const q = parse(z.object({ all: z.enum(['0', '1']).optional(), supplierId: z.coerce.number().int().positive().optional() }), req.query);
    return recommendations(ctx.db, { onlyBelowMin: q.all !== '1', supplierId: q.supplierId });
  });
  app.post('/api/procurement/orders/from-recommendations', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ productIds: z.array(z.number().int().positive()).min(1).max(5000) }), req.body);
    return { ids: createOrdersFromRecommendations(ctx.db, b.productIds, actorOf(req)) };
  });
  app.get('/api/procurement/orders', async () => listPurchaseOrders(ctx.db));
  app.get('/api/procurement/orders/:id', async (req) => getPurchaseOrder(ctx.db, parse(zIdParams, req.params).id));
  app.post('/api/procurement/orders', { preHandler: editors }, async (req) => {
    const b = parse(
      z.object({
        supplierId: z.number().int().positive().nullable(),
        orderDate: zIsoDate,
        expectedDate: zIsoDate.nullable().optional(),
        note: zOptText(1000),
        lines: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().positive().max(1e9), unitPrice: z.number().min(0).max(1e7).nullable().optional() })).min(1).max(500),
      }),
      req.body,
    );
    return { id: createPurchaseOrder(ctx.db, b, actorOf(req)) };
  });
  app.post('/api/procurement/orders/:id/status', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ status: z.enum(['ordered', 'cancelled']) }), req.body);
    setPurchaseOrderStatus(ctx.db, parse(zIdParams, req.params).id, b.status, actorOf(req));
    return { ok: true };
  });
  app.post('/api/procurement/orders/:id/receive', { preHandler: editors }, async (req) => {
    const b = parse(
      z.object({
        docDate: zIsoDate,
        documentRef: zOptText(100),
        note: zOptText(1000),
        lines: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().min(0).max(1e9), unitPrice: z.number().min(0).max(1e7).nullable().optional() })).min(1),
      }),
      req.body,
    );
    return receivePurchaseOrder(ctx.db, parse(zIdParams, req.params).id, b, actorOf(req));
  });
  app.get('/api/alerts/history', async () => alertHistory(ctx.db));
}
