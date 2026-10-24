import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { parse, zIdParams, zIsoDate } from '../lib/validate.js';
import { actorOf, editors } from '../http/helpers.js';
import {
  createProduct,
  deleteCategory,
  deleteProduct,
  deleteSupplier,
  getProduct,
  linkTelevendProduct,
  listCategories,
  listLocations,
  listMachines,
  listProducts,
  listSuppliers,
  listTelevendProducts,
  locationSchema,
  machineSchema,
  productSchema,
  saveCategory,
  saveLocation,
  saveMachine,
  saveSupplier,
  supplierSchema,
  updateProduct,
  setPurchasePrices,
} from '../modules/catalog/service.js';
import { consumptionPreview, deleteRecipe, listRecipes, recipeSchema, saveRecipe } from '../modules/recipes/service.js';
import { byMachine, timeseries, topProducts } from '../modules/sales/analytics.js';
import { addDays, todayLocal } from '../lib/time.js';
import { notFound } from '../lib/errors.js';

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext) {
  // Artikli
  app.get('/api/products', async () => listProducts(ctx.db));
  app.get('/api/products/:id', async (req) => {
    const { id } = parse(zIdParams, req.params);
    const product = getProduct(ctx.db, id);
    const links = ctx.db
      .prepare(
        `SELECT tp.id, tp.name, tp.ext_key, tp.source_id, m.name AS machine_name FROM product_televend_links l
         JOIN tv_products tp ON tp.id = l.tv_product_id LEFT JOIN machines m ON m.id = tp.machine_id WHERE l.product_id = ?`,
      )
      .all(id);
    const balances = ctx.db
      .prepare('SELECT b.location_id, l.name, l.type, b.qty FROM stock_balances b JOIN locations l ON l.id = b.location_id WHERE b.product_id = ? AND b.qty <> 0 ORDER BY l.type, l.name')
      .all(id);
    return { product, links, balances };
  });
  app.post('/api/products', { preHandler: editors }, async (req) => ({ id: createProduct(ctx.db, parse(productSchema, req.body), actorOf(req)) }));
  app.put('/api/products/:id', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    updateProduct(ctx.db, id, parse(productSchema, req.body), actorOf(req));
    return { ok: true };
  });
  // Ručni unos nabavnih (ulaznih) cijena – više artikala odjednom
  app.put('/api/products/prices', { preHandler: editors }, async (req) => {
    const b = parse(
      z.object({ items: z.array(z.object({ id: z.number().int().positive(), purchasePrice: z.number().finite().min(0).max(1e7) })).min(1).max(5000) }),
      req.body,
    );
    return { updated: setPurchasePrices(ctx.db, b.items, actorOf(req)) };
  });
  app.delete('/api/products/:id', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    return { result: deleteProduct(ctx.db, id, actorOf(req)) };
  });

  // Kategorije i dobavljači
  app.get('/api/categories', async () => listCategories(ctx.db));
  app.post('/api/categories', { preHandler: editors }, async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    return { id: saveCategory(ctx.db, null, b.name, actorOf(req)) };
  });
  app.put('/api/categories/:id', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    return { id: saveCategory(ctx.db, id, b.name, actorOf(req)) };
  });
  app.delete('/api/categories/:id', { preHandler: editors }, async (req) => {
    deleteCategory(ctx.db, parse(zIdParams, req.params).id, actorOf(req));
    return { ok: true };
  });
  app.get('/api/suppliers', async () => listSuppliers(ctx.db));
  app.post('/api/suppliers', { preHandler: editors }, async (req) => ({ id: saveSupplier(ctx.db, null, parse(supplierSchema, req.body), actorOf(req)) }));
  app.put('/api/suppliers/:id', { preHandler: editors }, async (req) => ({
    id: saveSupplier(ctx.db, parse(zIdParams, req.params).id, parse(supplierSchema, req.body), actorOf(req)),
  }));
  app.delete('/api/suppliers/:id', { preHandler: editors }, async (req) => {
    deleteSupplier(ctx.db, parse(zIdParams, req.params).id, actorOf(req));
    return { ok: true };
  });

  // Lokacije
  app.get('/api/locations', async () => listLocations(ctx.db));
  app.post('/api/locations', { preHandler: editors }, async (req) => ({ id: saveLocation(ctx.db, null, parse(locationSchema, req.body), actorOf(req)) }));
  app.put('/api/locations/:id', { preHandler: editors }, async (req) => ({
    id: saveLocation(ctx.db, parse(zIdParams, req.params).id, parse(locationSchema, req.body), actorOf(req)),
  }));

  // Automati
  const periodQ = z.object({ from: zIsoDate.optional(), to: zIsoDate.optional() });
  app.get('/api/machines', async (req) => {
    const q = parse(periodQ, req.query);
    const to = q.to ?? todayLocal();
    const from = q.from ?? addDays(to, -29);
    return { period: { from, to }, machines: listMachines(ctx.db, { from, to }) };
  });
  app.post('/api/machines', { preHandler: editors }, async (req) => ({ id: saveMachine(ctx.db, null, parse(machineSchema, req.body), actorOf(req)) }));
  app.put('/api/machines/:id', { preHandler: editors }, async (req) => ({
    id: saveMachine(ctx.db, parse(zIdParams, req.params).id, parse(machineSchema, req.body), actorOf(req)),
  }));
  app.get('/api/machines/:id', async (req) => {
    const { id } = parse(zIdParams, req.params);
    const q = parse(periodQ, req.query);
    const to = q.to ?? todayLocal();
    const from = q.from ?? addDays(to, -29);
    const machine = ctx.db
      .prepare('SELECT m.*, l.id AS location_id, l.name AS stock_location_name FROM machines m LEFT JOIN locations l ON l.machine_id = m.id WHERE m.id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!machine) throw notFound('Automat nije pronađen.');
    const f = { from, to, machineId: id };
    const localStock = machine.location_id
      ? ctx.db
          .prepare('SELECT b.product_id, p.code, p.name, p.unit, b.qty FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE b.location_id = ? AND b.qty <> 0 ORDER BY p.name')
          .all(machine.location_id)
      : [];
    const televendStock = ctx.db
      .prepare(
        `SELECT s.tv_product_id, tp.name, s.quantity, s.capacity, s.measured_at_utc, s.fetched_at
         FROM tv_machine_stock s JOIN tv_products tp ON tp.id = s.tv_product_id
         WHERE s.machine_id = ? AND s.id IN (SELECT MAX(id) FROM tv_machine_stock WHERE machine_id = ? GROUP BY tv_product_id)
         ORDER BY tp.name`,
      )
      .all(id, id);
    return {
      machine,
      period: { from, to },
      summary: byMachine(ctx.db, f)[0] ?? null,
      topProducts: topProducts(ctx.db, f, 'qty', 20),
      series: timeseries(ctx.db, f, 'day'),
      localStock,
      televendStock,
    };
  });

  // Televend artikli i ručno povezivanje
  app.get('/api/televend/products', async (req) => {
    const q = parse(z.object({ unlinked: z.enum(['0', '1']).optional() }), req.query);
    return listTelevendProducts(ctx.db, q.unlinked === '1');
  });
  app.put('/api/televend/products/:id/link', { preHandler: editors }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ productId: z.number().int().positive().nullable() }), req.body);
    linkTelevendProduct(ctx.db, id, b.productId, actorOf(req));
    return { ok: true };
  });

  // Normativi (priprema)
  app.get('/api/recipes', async () => listRecipes(ctx.db));
  app.post('/api/recipes', { preHandler: editors }, async (req) => ({ id: saveRecipe(ctx.db, null, parse(recipeSchema, req.body), actorOf(req)) }));
  app.put('/api/recipes/:id', { preHandler: editors }, async (req) => ({
    id: saveRecipe(ctx.db, parse(zIdParams, req.params).id, parse(recipeSchema, req.body), actorOf(req)),
  }));
  app.delete('/api/recipes/:id', { preHandler: editors }, async (req) => {
    deleteRecipe(ctx.db, parse(zIdParams, req.params).id, actorOf(req));
    return { ok: true };
  });
  app.get('/api/recipes/consumption', async (req) => {
    const q = parse(periodQ, req.query);
    const to = q.to ?? todayLocal();
    return consumptionPreview(ctx.db, q.from ?? addDays(to, -29), to);
  });
}
