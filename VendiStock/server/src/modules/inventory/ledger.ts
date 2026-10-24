import { type DB, nextDocNo } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { roundQty } from '../../lib/num.js';
import { nowIso } from '../../lib/time.js';
import { audit, type Actor } from '../audit/audit.js';
import { evaluateLowStock } from '../alerts/lowStock.js';

export type MovementType = 'opening' | 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'sale' | 'reversal';
export type LocationType = 'central' | 'vehicle' | 'machine' | 'other';

export const MOVEMENT_PREFIX: Record<MovementType, string> = {
  opening: 'POC',
  receipt: 'ULZ',
  issue: 'IZL',
  transfer: 'PRI',
  adjustment: 'INV',
  sale: 'PRD',
  reversal: 'STO',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: 'Početno stanje',
  receipt: 'Ulaz robe',
  issue: 'Izlaz robe',
  transfer: 'Prijenos',
  adjustment: 'Inventurna korekcija',
  sale: 'Prodaja (Televend)',
  reversal: 'Storno',
};

export interface LedgerLineInput {
  productId: number;
  locationId: number;
  qtyDelta: number;
  unitCost?: number | null;
}

export interface MovementInput {
  type: MovementType;
  docDate: string;
  lines: LedgerLineInput[];
  supplierId?: number | null;
  documentRef?: string | null;
  destinationType?: 'vehicle' | 'machine' | 'other' | null;
  note?: string | null;
  sourceRef?: string | null;
  reversesMovementId?: number | null;
  correctsMovementId?: number | null;
  inventoryCountId?: number | null;
  purchaseOrderId?: number | null;
  /** Prodaja iz Televenda smije odvesti stanje automata u minus (stanje automata nije uvijek poznato). */
  allowNegativeAtMachine?: boolean;
}

export interface MovementResult {
  movementId: number;
  docNo: string;
  productIds: number[];
}

interface LocationRow {
  id: number;
  type: LocationType;
  name: string;
  active: number;
}

export function centralLocationId(db: DB): number {
  const row = db.prepare("SELECT id FROM locations WHERE type = 'central' ORDER BY id LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (!row) throw new Error('Centralno skladište nije definirano.');
  return row.id;
}

export function getBalance(db: DB, productId: number, locationId: number): number {
  const row = db
    .prepare('SELECT qty FROM stock_balances WHERE product_id = ? AND location_id = ?')
    .get(productId, locationId) as { qty: number } | undefined;
  return row ? row.qty : 0;
}

function getLocation(db: DB, id: number): LocationRow {
  const loc = db.prepare('SELECT id, type, name, active FROM locations WHERE id = ?').get(id) as
    | LocationRow
    | undefined;
  if (!loc) throw badRequest(`Lokacija #${id} ne postoji.`);
  return loc;
}

function productLabel(db: DB, id: number): string {
  const p = db.prepare('SELECT code, name FROM products WHERE id = ?').get(id) as
    | { code: string; name: string }
    | undefined;
  if (!p) throw badRequest(`Artikl #${id} ne postoji.`);
  return `${p.name} (${p.code})`;
}

/**
 * Jedino mjesto na kojem se mijenjaju zalihe. Svako kretanje se zapisuje u skladišnu knjigu
 * (stock_ledger) i u istoj transakciji ažurira materijalizirano stanje (stock_balances).
 * Stanja se nikad ne mijenjaju izravno bez zapisa u knjizi.
 */
export function postMovement(db: DB, input: MovementInput, actor: Actor): MovementResult {
  return db.transaction((): MovementResult => {
    if (!input.lines.length) throw badRequest('Dokument mora imati barem jednu stavku.');
    if (input.sourceRef) {
      const dup = db.prepare('SELECT doc_no FROM stock_movements WHERE source_ref = ?').get(input.sourceRef) as
        | { doc_no: string }
        | undefined;
      if (dup) throw conflict(`Ovaj događaj je već proknjižen (dokument ${dup.doc_no}).`, { code: 'DUPLICATE_SOURCE' });
    }
    const year = Number(input.docDate.slice(0, 4));
    const docNo = nextDocNo(db, MOVEMENT_PREFIX[input.type], year);
    const header = db
      .prepare(
        `INSERT INTO stock_movements (doc_no, type, doc_date, supplier_id, document_ref, destination_type, note,
           source_ref, reverses_movement_id, corrects_movement_id, inventory_count_id, purchase_order_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        docNo,
        input.type,
        input.docDate,
        input.supplierId ?? null,
        input.documentRef ?? null,
        input.destinationType ?? null,
        input.note ?? null,
        input.sourceRef ?? null,
        input.reversesMovementId ?? null,
        input.correctsMovementId ?? null,
        input.inventoryCountId ?? null,
        input.purchaseOrderId ?? null,
        actor.id,
        nowIso(),
      );
    const movementId = Number(header.lastInsertRowid);
    const insLine = db.prepare(
      `INSERT INTO stock_ledger (movement_id, product_id, location_id, qty_delta, unit_cost, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertBal = db.prepare(
      `INSERT INTO stock_balances (product_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, location_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at`,
    );
    const productIds = new Set<number>();
    for (const line of input.lines) {
      const delta = roundQty(line.qtyDelta);
      if (delta === 0) throw badRequest('Količina stavke ne smije biti 0.');
      const label = productLabel(db, line.productId);
      const loc = getLocation(db, line.locationId);
      const before = getBalance(db, line.productId, line.locationId);
      const after = roundQty(before + delta);
      if (after < 0) {
        const negativeAllowed = loc.type === 'machine' && input.allowNegativeAtMachine === true;
        if (!negativeAllowed) {
          throw badRequest(
            `Nedovoljna zaliha: ${label} na lokaciji „${loc.name}” (stanje ${before}, potrebno ${Math.abs(delta)}).`,
            { code: 'INSUFFICIENT_STOCK', productId: line.productId, locationId: loc.id, available: before },
          );
        }
      }
      const now = nowIso();
      insLine.run(movementId, line.productId, line.locationId, delta, line.unitCost ?? null, after, now);
      upsertBal.run(line.productId, line.locationId, after, now);
      productIds.add(line.productId);
    }
    evaluateLowStock(db, [...productIds]);
    audit(db, actor, `stock.${input.type}`, 'stock_movement', movementId, {
      docNo,
      docDate: input.docDate,
      sourceRef: input.sourceRef ?? undefined,
      lines: input.lines,
      note: input.note ?? undefined,
    });
    return { movementId, docNo, productIds: [...productIds] };
  })();
}

export interface MovementRow {
  id: number;
  doc_no: string;
  type: MovementType;
  doc_date: string;
  supplier_id: number | null;
  document_ref: string | null;
  destination_type: string | null;
  note: string | null;
  source_ref: string | null;
  reverses_movement_id: number | null;
  corrects_movement_id: number | null;
  inventory_count_id: number | null;
  purchase_order_id: number | null;
  created_by: number | null;
  created_at: string;
}

export interface LedgerRow {
  id: number;
  movement_id: number;
  product_id: number;
  location_id: number;
  qty_delta: number;
  unit_cost: number | null;
  balance_after: number;
}

export function getMovement(db: DB, id: number): { movement: MovementRow; lines: LedgerRow[] } {
  const movement = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id) as MovementRow | undefined;
  if (!movement) throw notFound('Dokument nije pronađen.');
  const lines = db.prepare('SELECT * FROM stock_ledger WHERE movement_id = ? ORDER BY id').all(id) as LedgerRow[];
  return { movement, lines };
}

export function isReversed(db: DB, movementId: number): boolean {
  return !!db.prepare('SELECT 1 FROM stock_movements WHERE reverses_movement_id = ?').get(movementId);
}

/**
 * Storno dokumenta: knjiži suprotne stavke. Originalni dokument ostaje nepromijenjen (revizijski trag).
 * Isti dokument se ne može stornirati dva puta (UNIQUE reverses_movement_id).
 */
export function reverseMovement(
  db: DB,
  movementId: number,
  opts: { reason: string; docDate: string; allowSale?: boolean },
  actor: Actor,
): MovementResult {
  return db.transaction((): MovementResult => {
    const { movement, lines } = getMovement(db, movementId);
    if (movement.type === 'reversal') throw badRequest('Storno dokument se ne može ponovno stornirati.');
    if (movement.type === 'sale' && !opts.allowSale) {
      throw badRequest('Knjiženja prodaje prate podatke iz Televenda i ne storniraju se ručno.');
    }
    if (isReversed(db, movementId)) throw conflict(`Dokument ${movement.doc_no} je već storniran.`);
    const result = postMovement(
      db,
      {
        type: 'reversal',
        docDate: opts.docDate,
        reversesMovementId: movementId,
        note: `Storno ${movement.doc_no}: ${opts.reason}`,
        lines: lines.map((l) => ({
          productId: l.product_id,
          locationId: l.location_id,
          qtyDelta: -l.qty_delta,
          unitCost: l.unit_cost,
        })),
        allowNegativeAtMachine: movement.type === 'sale' || hasMachineLocation(db, lines),
      },
      actor,
    );
    if (movement.purchase_order_id) {
      for (const l of lines) {
        if (l.qty_delta > 0) {
          db.prepare(
            'UPDATE purchase_order_lines SET qty_received = MAX(0, ROUND(qty_received - ?, 3)) WHERE po_id = ? AND product_id = ?',
          ).run(l.qty_delta, movement.purchase_order_id, l.product_id);
        }
      }
      refreshPurchaseOrderStatus(db, movement.purchase_order_id);
    }
    // Povezane dopune iz Televenda vraćaju se u status „na čekanju”
    db.prepare(
      "UPDATE tv_refills SET status = 'pending', movement_id = NULL, resolved_at = NULL, resolved_by = NULL WHERE movement_id = ?",
    ).run(movementId);
    audit(db, actor, 'stock.reverse', 'stock_movement', movementId, {
      reversedDocNo: movement.doc_no,
      reversalDocNo: result.docNo,
      reason: opts.reason,
    });
    return result;
  })();
}

function hasMachineLocation(db: DB, lines: LedgerRow[]): boolean {
  // Storno prijenosa u automat smije ostaviti automat u minusu ako je prodaja u međuvremenu već knjižena.
  return lines.some((l) => l.qty_delta > 0 && getLocation(db, l.location_id).type === 'machine');
}

export function refreshPurchaseOrderStatus(db: DB, poId: number): void {
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as { status: string } | undefined;
  if (!po || po.status === 'cancelled' || po.status === 'draft') return;
  const agg = db
    .prepare(
      `SELECT SUM(MIN(qty_received, qty_ordered)) AS rec, SUM(qty_ordered) AS ord,
              SUM(CASE WHEN qty_received > 0 THEN 1 ELSE 0 END) AS anyrec
       FROM purchase_order_lines WHERE po_id = ?`,
    )
    .get(poId) as { rec: number | null; ord: number | null; anyrec: number | null };
  let status = 'ordered';
  if ((agg.ord ?? 0) > 0 && roundQty(agg.rec ?? 0) >= roundQty(agg.ord ?? 0)) status = 'received';
  else if ((agg.anyrec ?? 0) > 0) status = 'partial';
  db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), poId);
}

/** Provjera integriteta: stanje mora biti jednako zbroju knjige, a balance_after mora biti kontinuiran. */
export function verifyLedgerIntegrity(db: DB): {
  ok: boolean;
  mismatches: { productId: number; locationId: number; balance: number; ledgerSum: number }[];
  continuityErrors: number;
} {
  const mismatches = db
    .prepare(
      `SELECT k.product_id AS productId, k.location_id AS locationId,
              COALESCE(b.qty, 0) AS balance, ROUND(k.s, 3) AS ledgerSum
       FROM (SELECT product_id, location_id, SUM(qty_delta) AS s FROM stock_ledger GROUP BY product_id, location_id) k
       LEFT JOIN stock_balances b ON b.product_id = k.product_id AND b.location_id = k.location_id
       WHERE ABS(COALESCE(b.qty, 0) - k.s) > 0.0005`,
    )
    .all() as { productId: number; locationId: number; balance: number; ledgerSum: number }[];
  const rows = db
    .prepare('SELECT product_id, location_id, qty_delta, balance_after FROM stock_ledger ORDER BY product_id, location_id, id')
    .all() as { product_id: number; location_id: number; qty_delta: number; balance_after: number }[];
  let continuityErrors = 0;
  let key = '';
  let running = 0;
  for (const r of rows) {
    const k = `${r.product_id}:${r.location_id}`;
    if (k !== key) {
      key = k;
      running = 0;
    }
    running = roundQty(running + r.qty_delta);
    if (Math.abs(running - r.balance_after) > 0.0005) continuityErrors++;
  }
  return { ok: mismatches.length === 0 && continuityErrors === 0, mismatches, continuityErrors };
}
