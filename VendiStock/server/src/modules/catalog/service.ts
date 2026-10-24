import { z } from 'zod';
import type { DB } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { roundPrice, roundQty } from '../../lib/num.js';
import { nowIso } from '../../lib/time.js';
import { zOptText } from '../../lib/validate.js';
import { audit, type Actor } from '../audit/audit.js';
import { evaluateLowStock } from '../alerts/lowStock.js';

export const UNITS = ['kom', 'kg', 'g', 'l', 'ml', 'pak', 'kut'] as const;

export const productSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    categoryId: z.number().int().positive().nullable().optional(),
    supplierId: z.number().int().positive().nullable().optional(),
    purchasePrice: z.number().finite().min(0).max(1e7),
    unit: z.enum(UNITS),
    packSize: z.number().finite().positive().max(1e6),
    minStock: z.number().finite().min(0).max(1e9),
    targetStock: z.number().finite().min(0).max(1e9),
    active: z.boolean(),
    note: zOptText(1000),
  })
  .refine((p) => p.targetStock >= p.minStock, {
    message: 'Ciljana zaliha mora biti veća ili jednaka minimalnoj zalihi.',
    path: ['targetStock'],
  });
export type ProductInput = z.infer<typeof productSchema>;

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, s.name AS supplier_name,
         COALESCE((SELECT b.qty FROM stock_balances b JOIN locations l ON l.id = b.location_id
                   WHERE l.type = 'central' AND b.product_id = p.id), 0) AS current_stock,
         COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.product_id = p.id), 0) AS total_stock,
         COALESCE((SELECT SUM(r.qty) FROM stock_reservations r WHERE r.product_id = p.id AND r.released_at IS NULL), 0) AS reserved_qty,
         (SELECT COUNT(*) FROM product_televend_links t WHERE t.product_id = p.id) AS televend_links,
         (SELECT GROUP_CONCAT(tp.name, ' | ') FROM product_televend_links t JOIN tv_products tp ON tp.id = t.tv_product_id
            WHERE t.product_id = p.id) AS televend_names,
         COALESCE(st.is_low, 0) AS is_low
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN stock_alert_state st ON st.product_id = p.id`;

export function listProducts(db: DB) {
  return db.prepare(`${PRODUCT_SELECT} ORDER BY p.name`).all();
}

export function getProduct(db: DB, id: number) {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  if (!p) throw notFound('Artikl nije pronađen.');
  return p as Record<string, unknown>;
}

function checkRefs(db: DB, input: ProductInput) {
  if (input.categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(input.categoryId)) {
    throw badRequest('Kategorija ne postoji.');
  }
  if (input.supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(input.supplierId)) {
    throw badRequest('Dobavljač ne postoji.');
  }
}

export function createProduct(db: DB, input: ProductInput, actor: Actor): number {
  return db.transaction(() => {
    checkRefs(db, input);
    if (db.prepare('SELECT 1 FROM products WHERE code = ?').get(input.code)) {
      throw conflict(`Interna šifra „${input.code}” već postoji.`);
    }
    const r = db
      .prepare(
        `INSERT INTO products (code, name, category_id, supplier_id, purchase_price, unit, pack_size, min_stock, target_stock, active, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.code,
        input.name,
        input.categoryId ?? null,
        input.supplierId ?? null,
        roundPrice(input.purchasePrice),
        input.unit,
        roundQty(input.packSize),
        roundQty(input.minStock),
        roundQty(input.targetStock),
        input.active ? 1 : 0,
        input.note ?? null,
      );
    const id = Number(r.lastInsertRowid);
    // Novi artikl nema kretanja: upozorenje nastaje tek kad nakon knjiženja (ili promjene minimuma) zaliha bude ispod minimuma,
    // kako unos šifrarnika ne bi generirao poruke za artikle koji tek čekaju početno stanje.
    audit(db, actor, 'product.create', 'product', id, input);
    return id;
  })();
}

export function updateProduct(db: DB, id: number, input: ProductInput, actor: Actor): void {
  db.transaction(() => {
    const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!before) throw notFound('Artikl nije pronađen.');
    checkRefs(db, input);
    const dup = db.prepare('SELECT id FROM products WHERE code = ? AND id <> ?').get(input.code, id);
    if (dup) throw conflict(`Interna šifra „${input.code}” već postoji.`);
    db.prepare(
      `UPDATE products SET code = ?, name = ?, category_id = ?, supplier_id = ?, purchase_price = ?, unit = ?, pack_size = ?,
         min_stock = ?, target_stock = ?, active = ?, note = ?, updated_at = ?, price_set = 1 WHERE id = ?`,
    ).run(
      input.code,
      input.name,
      input.categoryId ?? null,
      input.supplierId ?? null,
      roundPrice(input.purchasePrice),
      input.unit,
      roundQty(input.packSize),
      roundQty(input.minStock),
      roundQty(input.targetStock),
      input.active ? 1 : 0,
      input.note ?? null,
      nowIso(),
      id,
    );
    evaluateLowStock(db, [id]);
    audit(db, actor, 'product.update', 'product', id, { before, after: input });
  })();
}

/** Ručni unos nabavnih cijena (jedini ručni unos za artikle koje aplikacija stvara iz Televenda). */
export function setPurchasePrices(db: DB, items: { id: number; purchasePrice: number }[], actor: Actor): number {
  return db.transaction(() => {
    const get = db.prepare('SELECT purchase_price, price_set FROM products WHERE id = ?');
    const upd = db.prepare('UPDATE products SET purchase_price = ?, price_set = 1, updated_at = ? WHERE id = ?');
    let n = 0;
    for (const it of items) {
      const before = get.get(it.id) as { purchase_price: number; price_set: number } | undefined;
      if (!before) throw notFound(`Artikl #${it.id} nije pronađen.`);
      const price = roundPrice(it.purchasePrice);
      if (before.price_set === 1 && before.purchase_price === price) continue;
      upd.run(price, nowIso(), it.id);
      audit(db, actor, 'product.purchase_price', 'product', it.id, { before: before.purchase_price, after: price });
      n++;
    }
    return n;
  })();
}

export function deleteProduct(db: DB, id: number, actor: Actor): 'deleted' | 'deactivated' {
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) throw notFound('Artikl nije pronađen.');
    const used =
      db.prepare('SELECT 1 FROM stock_ledger WHERE product_id = ? LIMIT 1').get(id) ||
      db.prepare('SELECT 1 FROM purchase_order_lines WHERE product_id = ? LIMIT 1').get(id) ||
      db.prepare('SELECT 1 FROM recipe_ingredients WHERE product_id = ? LIMIT 1').get(id);
    if (used) {
      db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
      evaluateLowStock(db, [id]);
      audit(db, actor, 'product.deactivate', 'product', id, { reason: 'artikl ima povijest kretanja' });
      return 'deactivated';
    }
    db.prepare('DELETE FROM stock_balances WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM stock_reservations WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    audit(db, actor, 'product.delete', 'product', id, p);
    return 'deleted';
  })();
}

// ---------------------------------------------------------------- Kategorije
export function listCategories(db: DB) {
  return db
    .prepare(
      'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.name',
    )
    .all();
}

export function saveCategory(db: DB, id: number | null, name: string, actor: Actor): number {
  const n = name.trim();
  if (!n) throw badRequest('Naziv kategorije je obavezan.');
  const dup = db.prepare('SELECT id FROM categories WHERE name = ? AND id <> ?').get(n, id ?? 0);
  if (dup) throw conflict('Kategorija s tim nazivom već postoji.');
  if (id) {
    if (db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(n, id).changes === 0) throw notFound();
    audit(db, actor, 'category.update', 'category', id, { name: n });
    return id;
  }
  const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(n);
  audit(db, actor, 'category.create', 'category', Number(r.lastInsertRowid), { name: n });
  return Number(r.lastInsertRowid);
}

export function deleteCategory(db: DB, id: number, actor: Actor): void {
  if (db.prepare('SELECT 1 FROM products WHERE category_id = ? LIMIT 1').get(id)) {
    throw badRequest('Kategorija se koristi na artiklima i ne može se obrisati.');
  }
  if (db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes === 0) throw notFound();
  audit(db, actor, 'category.delete', 'category', id);
}

// ---------------------------------------------------------------- Dobavljači
export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactPerson: zOptText(200),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'neispravna e-mail adresa'),
  phone: zOptText(60),
  oib: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{11}$/.test(v), 'OIB mora imati 11 znamenki'),
  address: zOptText(300),
  note: zOptText(1000),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export function listSuppliers(db: DB) {
  return db
    .prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count FROM suppliers s ORDER BY s.name',
    )
    .all();
}

export function saveSupplier(db: DB, id: number | null, input: SupplierInput, actor: Actor): number {
  const dup = db.prepare('SELECT id FROM suppliers WHERE name = ? AND id <> ?').get(input.name, id ?? 0);
  if (dup) throw conflict('Dobavljač s tim nazivom već postoji.');
  const vals = [
    input.name,
    input.contactPerson,
    input.email,
    input.phone,
    input.oib,
    input.address,
    input.note,
    input.active ? 1 : 0,
  ];
  if (id) {
    const r = db
      .prepare(
        'UPDATE suppliers SET name = ?, contact_person = ?, email = ?, phone = ?, oib = ?, address = ?, note = ?, active = ?, updated_at = ? WHERE id = ?',
      )
      .run(...vals, nowIso(), id);
    if (r.changes === 0) throw notFound('Dobavljač nije pronađen.');
    audit(db, actor, 'supplier.update', 'supplier', id, input);
    return id;
  }
  const r = db
    .prepare(
      'INSERT INTO suppliers (name, contact_person, email, phone, oib, address, note, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(...vals);
  audit(db, actor, 'supplier.create', 'supplier', Number(r.lastInsertRowid), input);
  return Number(r.lastInsertRowid);
}

export function deleteSupplier(db: DB, id: number, actor: Actor): void {
  if (
    db.prepare('SELECT 1 FROM products WHERE supplier_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM stock_movements WHERE supplier_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM purchase_orders WHERE supplier_id = ? LIMIT 1').get(id)
  ) {
    throw badRequest('Dobavljač se koristi (artikli, primke ili narudžbe). Umjesto brisanja ga deaktivirajte.');
  }
  if (db.prepare('DELETE FROM suppliers WHERE id = ?').run(id).changes === 0) throw notFound();
  audit(db, actor, 'supplier.delete', 'supplier', id);
}

// ---------------------------------------------------------------- Lokacije
export const locationSchema = z.object({
  type: z.enum(['vehicle', 'machine', 'other']),
  name: z.string().trim().min(1).max(120),
  machineId: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
  note: zOptText(500),
});
export type LocationInput = z.infer<typeof locationSchema>;

export function listLocations(db: DB) {
  return db
    .prepare(
      `SELECT l.*, m.name AS machine_name,
              (SELECT COUNT(*) FROM stock_balances b WHERE b.location_id = l.id AND b.qty <> 0) AS product_count
       FROM locations l LEFT JOIN machines m ON m.id = l.machine_id
       ORDER BY CASE l.type WHEN 'central' THEN 0 WHEN 'vehicle' THEN 1 WHEN 'machine' THEN 2 ELSE 3 END, l.name`,
    )
    .all();
}

export function saveLocation(db: DB, id: number | null, input: LocationInput, actor: Actor): number {
  return db.transaction(() => {
    const dup = db.prepare('SELECT id FROM locations WHERE name = ? AND id <> ?').get(input.name, id ?? 0);
    if (dup) throw conflict('Lokacija s tim nazivom već postoji.');
    if (input.type !== 'machine' && input.machineId) throw badRequest('Samo lokacija tipa automat može biti povezana s automatom.');
    if (input.machineId) {
      const taken = db.prepare('SELECT id FROM locations WHERE machine_id = ? AND id <> ?').get(input.machineId, id ?? 0);
      if (taken) throw conflict('Automat je već povezan s drugom lokacijom.');
    }
    if (id) {
      const cur = db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as { type: string } | undefined;
      if (!cur) throw notFound('Lokacija nije pronađena.');
      if (cur.type === 'central') throw badRequest('Centralno skladište se ne može mijenjati ovdje.');
      if (cur.type !== input.type && db.prepare('SELECT 1 FROM stock_ledger WHERE location_id = ? LIMIT 1').get(id)) {
        throw badRequest('Vrsta lokacije s kretanjima se ne može mijenjati.');
      }
      if (!input.active) {
        const stock = db.prepare('SELECT 1 FROM stock_balances WHERE location_id = ? AND qty <> 0 LIMIT 1').get(id);
        if (stock) throw badRequest('Lokacija sa zalihom ne može se deaktivirati. Najprije prenesite robu.');
      }
      db.prepare('UPDATE locations SET type = ?, name = ?, machine_id = ?, active = ?, note = ? WHERE id = ?').run(
        input.type,
        input.name,
        input.machineId ?? null,
        input.active ? 1 : 0,
        input.note,
        id,
      );
      audit(db, actor, 'location.update', 'location', id, input);
      return id;
    }
    const r = db
      .prepare('INSERT INTO locations (type, name, machine_id, active, note) VALUES (?, ?, ?, ?, ?)')
      .run(input.type, input.name, input.machineId ?? null, input.active ? 1 : 0, input.note);
    audit(db, actor, 'location.create', 'location', Number(r.lastInsertRowid), input);
    return Number(r.lastInsertRowid);
  })();
}

// ---------------------------------------------------------------- Automati
export const machineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  locationText: zOptText(300),
  serialNo: zOptText(100),
  active: z.boolean().default(true),
});

export function listMachines(db: DB, period?: { from: string; to: string }) {
  const from = period?.from ?? '0000-01-01';
  const to = period?.to ?? '9999-12-31';
  return db
    .prepare(
      `SELECT m.id, m.name, m.location_text, m.serial_no, m.active, m.source, m.source_id, m.last_seen_at, m.fetched_at,
              l.id AS location_id, l.name AS stock_location_name,
              (SELECT COALESCE(SUM(s.quantity), 0) FROM sales_transactions s
                 WHERE s.machine_id = m.id AND s.status = 'valid' AND s.sold_date_local BETWEEN ? AND ?) AS sold_qty,
              (SELECT SUM(COALESCE(s.amount, s.quantity * s.unit_price)) FROM sales_transactions s
                 WHERE s.machine_id = m.id AND s.status = 'valid' AND s.sold_date_local BETWEEN ? AND ?) AS revenue,
              (SELECT MAX(s.sold_at_utc) FROM sales_transactions s WHERE s.machine_id = m.id) AS last_sale_at,
              (SELECT COALESCE(SUM(b.qty), 0) FROM stock_balances b WHERE b.location_id = l.id) AS stock_qty,
              (SELECT COUNT(*) FROM tv_refills r WHERE r.machine_id = m.id AND r.status = 'pending') AS pending_refills
       FROM machines m LEFT JOIN locations l ON l.machine_id = m.id
       ORDER BY m.name`,
    )
    .all(from, to, from, to);
}

/** Svaki automat dobiva vlastitu skladišnu lokaciju kako bi se pratila roba u automatu. */
export function ensureMachineLocation(db: DB, machineId: number): number {
  const existing = db.prepare('SELECT id FROM locations WHERE machine_id = ?').get(machineId) as { id: number } | undefined;
  if (existing) return existing.id;
  const m = db.prepare('SELECT name FROM machines WHERE id = ?').get(machineId) as { name: string } | undefined;
  if (!m) throw notFound('Automat nije pronađen.');
  let name = `Automat: ${m.name}`.slice(0, 120);
  let n = 2;
  while (db.prepare('SELECT 1 FROM locations WHERE name = ?').get(name)) name = `Automat: ${m.name} (${n++})`.slice(0, 120);
  const r = db.prepare("INSERT INTO locations (type, name, machine_id) VALUES ('machine', ?, ?)").run(name, machineId);
  return Number(r.lastInsertRowid);
}

export function saveMachine(db: DB, id: number | null, input: z.infer<typeof machineSchema>, actor: Actor): number {
  return db.transaction(() => {
    if (id) {
      const cur = db.prepare('SELECT source FROM machines WHERE id = ?').get(id) as { source: string } | undefined;
      if (!cur) throw notFound('Automat nije pronađen.');
      db.prepare('UPDATE machines SET name = ?, location_text = ?, serial_no = ?, active = ?, updated_at = ? WHERE id = ?').run(
        input.name,
        input.locationText,
        input.serialNo,
        input.active ? 1 : 0,
        nowIso(),
        id,
      );
      audit(db, actor, 'machine.update', 'machine', id, input);
      return id;
    }
    const r = db
      .prepare("INSERT INTO machines (name, location_text, serial_no, active, source) VALUES (?, ?, ?, ?, 'manual')")
      .run(input.name, input.locationText, input.serialNo, input.active ? 1 : 0);
    const mid = Number(r.lastInsertRowid);
    ensureMachineLocation(db, mid);
    audit(db, actor, 'machine.create', 'machine', mid, input);
    return mid;
  })();
}

// ---------------------------------------------------------------- Povezivanje s Televendom
export function listTelevendProducts(db: DB, onlyUnlinked = false) {
  return db
    .prepare(
      `SELECT tp.id, tp.ext_key, tp.source_id, tp.name, tp.last_price, tp.first_seen_at, tp.last_seen_at, tp.source,
              m.name AS machine_name, l.product_id, p.code AS product_code, p.name AS product_name,
              (SELECT COALESCE(SUM(s.quantity), 0) FROM sales_transactions s WHERE s.tv_product_id = tp.id AND s.status = 'valid') AS sold_qty
       FROM tv_products tp
       LEFT JOIN machines m ON m.id = tp.machine_id
       LEFT JOIN product_televend_links l ON l.tv_product_id = tp.id
       LEFT JOIN products p ON p.id = l.product_id
       ${onlyUnlinked ? 'WHERE l.id IS NULL' : ''}
       ORDER BY tp.name`,
    )
    .all();
}

export function linkTelevendProduct(db: DB, tvProductId: number, productId: number | null, actor: Actor): void {
  db.transaction(() => {
    const tp = db.prepare('SELECT name FROM tv_products WHERE id = ?').get(tvProductId) as { name: string } | undefined;
    if (!tp) throw notFound('Televend artikl nije pronađen.');
    const before = db.prepare('SELECT product_id FROM product_televend_links WHERE tv_product_id = ?').get(tvProductId) as
      | { product_id: number }
      | undefined;
    db.prepare('DELETE FROM product_televend_links WHERE tv_product_id = ?').run(tvProductId);
    if (productId) {
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw badRequest('Artikl ne postoji.');
      db.prepare('INSERT INTO product_televend_links (product_id, tv_product_id, created_by) VALUES (?, ?, ?)').run(
        productId,
        tvProductId,
        actor.id,
      );
    }
    audit(db, actor, productId ? 'televend.link_product' : 'televend.unlink_product', 'tv_product', tvProductId, {
      televendName: tp.name,
      before: before?.product_id ?? null,
      after: productId,
    });
  })();
}
