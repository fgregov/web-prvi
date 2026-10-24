import type { DB } from '../../db/index.js';
import { nextDocNo } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { roundMoney, roundQty, roundUpToPack } from '../../lib/num.js';
import { nowIso, todayLocal } from '../../lib/time.js';
import { audit, type Actor } from '../audit/audit.js';
import { createReceipt } from '../inventory/operations.js';
import { refreshPurchaseOrderStatus } from '../inventory/ledger.js';
import { getSetting } from '../settings/store.js';

export interface ProcurementSettings {
  roundToPacks: boolean;
}
export const DEFAULT_PROCUREMENT_SETTINGS: ProcurementSettings = { roundToPacks: true };

export interface Recommendation {
  productId: number;
  code: string;
  name: string;
  unit: string;
  categoryName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierEmail: string | null;
  stock: number;
  reserved: number;
  available: number;
  minStock: number;
  targetStock: number;
  openOrders: number;
  rawQty: number;
  orderQty: number;
  packSize: number;
  packs: number | null;
  purchasePrice: number;
  estimatedCost: number;
  belowMin: boolean;
}

/**
 * Preporučena nabava = MAX(0, ciljana zaliha − raspoloživa zaliha − količina na otvorenim narudžbama),
 * gdje je raspoloživa zaliha = fizička zaliha centralnog skladišta − rezervirana roba.
 * Po potrebi se zaokružuje na cijela dobavljačka pakiranja (prema gore).
 */
export function computeRecommendedQty(input: {
  targetStock: number;
  available: number;
  openOrders: number;
  packSize: number;
  roundToPacks: boolean;
}): { rawQty: number; orderQty: number } {
  const rawQty = roundQty(Math.max(0, input.targetStock - input.available - input.openOrders));
  const orderQty = input.roundToPacks ? roundUpToPack(rawQty, input.packSize) : rawQty;
  return { rawQty, orderQty };
}

export function openOrderQtyByProduct(db: DB): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT l.product_id, SUM(MAX(0, l.qty_ordered - l.qty_received)) AS open_qty
       FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.po_id
       WHERE o.status IN ('ordered', 'partial') GROUP BY l.product_id`,
    )
    .all() as { product_id: number; open_qty: number }[];
  return new Map(rows.map((r) => [r.product_id, roundQty(r.open_qty)]));
}

export function recommendations(db: DB, opts: { onlyBelowMin?: boolean; supplierId?: number } = {}): Recommendation[] {
  const settings = getSetting(db, 'procurement.config', DEFAULT_PROCUREMENT_SETTINGS);
  const open = openOrderQtyByProduct(db);
  const rows = db
    .prepare(
      `SELECT p.id, p.code, p.name, p.unit, p.pack_size, p.min_stock, p.target_stock, p.purchase_price,
              p.supplier_id, s.name AS supplier_name, s.email AS supplier_email, c.name AS category_name,
              COALESCE((SELECT b.qty FROM stock_balances b JOIN locations l ON l.id = b.location_id
                        WHERE l.type = 'central' AND b.product_id = p.id), 0) AS stock,
              COALESCE((SELECT SUM(r.qty) FROM stock_reservations r WHERE r.product_id = p.id AND r.released_at IS NULL), 0) AS reserved
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND (p.min_stock > 0 OR p.target_stock > 0)
       ORDER BY s.name, p.name`,
    )
    .all() as {
    id: number;
    code: string;
    name: string;
    unit: string;
    pack_size: number;
    min_stock: number;
    target_stock: number;
    purchase_price: number;
    supplier_id: number | null;
    supplier_name: string | null;
    supplier_email: string | null;
    category_name: string | null;
    stock: number;
    reserved: number;
  }[];
  const onlyBelowMin = opts.onlyBelowMin ?? true;
  const out: Recommendation[] = [];
  for (const r of rows) {
    if (opts.supplierId && r.supplier_id !== opts.supplierId) continue;
    const available = roundQty(r.stock - r.reserved);
    const openOrders = open.get(r.id) ?? 0;
    const belowMin = available < r.min_stock;
    const { rawQty, orderQty } = computeRecommendedQty({
      targetStock: r.target_stock,
      available,
      openOrders,
      packSize: r.pack_size,
      roundToPacks: settings.roundToPacks,
    });
    if (onlyBelowMin ? !belowMin : rawQty <= 0 && !belowMin) continue;
    out.push({
      productId: r.id,
      code: r.code,
      name: r.name,
      unit: r.unit,
      categoryName: r.category_name,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierEmail: r.supplier_email,
      stock: roundQty(r.stock),
      reserved: roundQty(r.reserved),
      available,
      minStock: r.min_stock,
      targetStock: r.target_stock,
      openOrders,
      rawQty,
      orderQty,
      packSize: r.pack_size,
      packs: r.pack_size > 0 && orderQty > 0 ? roundQty(orderQty / r.pack_size) : null,
      purchasePrice: r.purchase_price,
      estimatedCost: roundMoney(orderQty * r.purchase_price),
      belowMin,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Narudžbe
export interface PurchaseOrderInput {
  supplierId: number | null;
  orderDate: string;
  expectedDate?: string | null;
  note?: string | null;
  lines: { productId: number; qty: number; unitPrice?: number | null }[];
}

export function createPurchaseOrder(db: DB, input: PurchaseOrderInput, actor: Actor): number {
  return db.transaction(() => {
    if (!input.lines.length) throw badRequest('Narudžba mora imati barem jednu stavku.');
    const seen = new Set<number>();
    for (const l of input.lines) {
      if (seen.has(l.productId)) throw badRequest('Isti artikl je naveden više puta.');
      seen.add(l.productId);
      if (!(l.qty > 0)) throw badRequest('Količina mora biti veća od 0.');
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(l.productId)) throw badRequest('Artikl ne postoji.');
    }
    const poNo = nextDocNo(db, 'NAR', Number(input.orderDate.slice(0, 4)));
    const r = db
      .prepare(
        `INSERT INTO purchase_orders (po_no, supplier_id, status, order_date, expected_date, note, created_by)
         VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .run(poNo, input.supplierId, input.orderDate, input.expectedDate ?? null, input.note ?? null, actor.id);
    const poId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO purchase_order_lines (po_id, product_id, qty_ordered, unit_price) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) ins.run(poId, l.productId, roundQty(l.qty), l.unitPrice ?? null);
    audit(db, actor, 'po.create', 'purchase_order', poId, { poNo, ...input });
    return poId;
  })();
}

/** Iz preporuka stvara po jednu narudžbu (nacrt) za svakog dobavljača. */
export function createOrdersFromRecommendations(db: DB, productIds: number[], actor: Actor): number[] {
  return db.transaction(() => {
    const recs = recommendations(db, { onlyBelowMin: false }).filter(
      (r) => productIds.includes(r.productId) && r.orderQty > 0,
    );
    if (!recs.length) throw badRequest('Odabrani artikli nemaju preporučenu količinu za narudžbu.');
    const bySupplier = new Map<number | null, Recommendation[]>();
    for (const r of recs) {
      const list = bySupplier.get(r.supplierId) ?? [];
      list.push(r);
      bySupplier.set(r.supplierId, list);
    }
    const ids: number[] = [];
    for (const [supplierId, list] of bySupplier) {
      ids.push(
        createPurchaseOrder(
          db,
          {
            supplierId,
            orderDate: todayLocal(),
            note: 'Izrađeno iz preporuke nabave',
            lines: list.map((r) => ({ productId: r.productId, qty: r.orderQty, unitPrice: r.purchasePrice })),
          },
          actor,
        ),
      );
    }
    return ids;
  })();
}

export function listPurchaseOrders(db: DB) {
  return db
    .prepare(
      `SELECT o.*, s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id = o.id) AS line_count,
              (SELECT ROUND(SUM(l.qty_ordered * COALESCE(l.unit_price, 0)), 2) FROM purchase_order_lines l WHERE l.po_id = o.id) AS total_value
       FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id ORDER BY o.id DESC`,
    )
    .all();
}

export function getPurchaseOrder(db: DB, id: number) {
  const order = db
    .prepare(
      'SELECT o.*, s.name AS supplier_name, s.email AS supplier_email FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ?',
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!order) throw notFound('Narudžba nije pronađena.');
  const lines = db
    .prepare(
      `SELECT l.*, p.code, p.name, p.unit FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
       WHERE l.po_id = ? ORDER BY p.name`,
    )
    .all(id);
  const receipts = db
    .prepare("SELECT id, doc_no, doc_date FROM stock_movements WHERE purchase_order_id = ? AND type = 'receipt' ORDER BY id")
    .all(id);
  return { order, lines, receipts };
}

export function setPurchaseOrderStatus(db: DB, id: number, status: 'ordered' | 'cancelled', actor: Actor): void {
  db.transaction(() => {
    const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id) as { status: string } | undefined;
    if (!po) throw notFound('Narudžba nije pronađena.');
    if (status === 'ordered' && po.status !== 'draft') throw badRequest('Samo nacrt narudžbe može se označiti kao naručen.');
    if (status === 'cancelled' && !['draft', 'ordered'].includes(po.status)) {
      throw badRequest('Djelomično ili potpuno zaprimljena narudžba ne može se otkazati.');
    }
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
    audit(db, actor, `po.${status}`, 'purchase_order', id, { from: po.status });
  })();
}

/** Zaprimanje robe po narudžbi: stvara primku (ulaz u centralno skladište) i ažurira zaprimljene količine. */
export function receivePurchaseOrder(
  db: DB,
  id: number,
  input: { docDate: string; documentRef?: string | null; note?: string | null; lines: { productId: number; qty: number; unitPrice?: number | null }[] },
  actor: Actor,
) {
  return db.transaction(() => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as
      | { id: number; status: string; supplier_id: number | null; po_no: string }
      | undefined;
    if (!po) throw notFound('Narudžba nije pronađena.');
    if (!['ordered', 'partial'].includes(po.status)) throw badRequest('Zaprimati se može samo naručena narudžba.');
    const lines = input.lines.filter((l) => l.qty > 0);
    if (!lines.length) throw badRequest('Unesite barem jednu zaprimljenu količinu.');
    for (const l of lines) {
      const pl = db.prepare('SELECT 1 FROM purchase_order_lines WHERE po_id = ? AND product_id = ?').get(id, l.productId);
      if (!pl) throw badRequest('Artikl nije na ovoj narudžbi.');
    }
    const result = createReceipt(
      db,
      {
        docDate: input.docDate,
        supplierId: po.supplier_id,
        documentRef: input.documentRef ?? null,
        note: input.note ?? `Zaprimanje narudžbe ${po.po_no}`,
        purchaseOrderId: id,
        lines,
      },
      actor,
    );
    const upd = db.prepare(
      'UPDATE purchase_order_lines SET qty_received = ROUND(qty_received + ?, 3) WHERE po_id = ? AND product_id = ?',
    );
    for (const l of lines) upd.run(l.qty, id, l.productId);
    refreshPurchaseOrderStatus(db, id);
    audit(db, actor, 'po.receive', 'purchase_order', id, { docNo: result.docNo, lines });
    return result;
  })();
}
