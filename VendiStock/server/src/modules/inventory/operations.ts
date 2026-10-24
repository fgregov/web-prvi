import type { DB } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { roundPrice, roundQty } from '../../lib/num.js';
import { nowIso } from '../../lib/time.js';
import { audit, type Actor } from '../audit/audit.js';
import { getSetting } from '../settings/store.js';
import { evaluateLowStock } from '../alerts/lowStock.js';
import {
  centralLocationId,
  getBalance,
  getMovement,
  postMovement,
  reverseMovement,
  type MovementResult,
} from './ledger.js';

export interface InventorySettings {
  /** Ažuriraj nabavnu cijenu artikla prema posljednjem ulazu. */
  updatePurchasePriceOnReceipt: boolean;
  /** Datum od kojeg se prodaja iz Televenda knjiži na zalihe automata (null = isključeno). */
  salesPostingStartDate: string | null;
}

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  updatePurchasePriceOnReceipt: true,
  salesPostingStartDate: null,
};

export const inventorySettings = (db: DB) => getSetting(db, 'inventory.config', DEFAULT_INVENTORY_SETTINGS);

function assertProductsActive(db: DB, productIds: number[]): void {
  for (const id of productIds) {
    const p = db.prepare('SELECT active, name FROM products WHERE id = ?').get(id) as
      | { active: number; name: string }
      | undefined;
    if (!p) throw badRequest(`Artikl #${id} ne postoji.`);
    if (!p.active) throw badRequest(`Artikl „${p.name}” nije aktivan.`);
  }
}

function assertLocation(db: DB, id: number, types?: string[]): { id: number; type: string; name: string } {
  const loc = db.prepare('SELECT id, type, name, active FROM locations WHERE id = ?').get(id) as
    | { id: number; type: string; name: string; active: number }
    | undefined;
  if (!loc) throw badRequest('Lokacija ne postoji.');
  if (!loc.active) throw badRequest(`Lokacija „${loc.name}” nije aktivna.`);
  if (types && !types.includes(loc.type)) throw badRequest(`Lokacija „${loc.name}” nije dopuštena za ovu radnju.`);
  return loc;
}

function mergeLines<T extends { productId: number; qty: number }>(lines: T[]): T[] {
  const seen = new Set<number>();
  for (const l of lines) {
    if (seen.has(l.productId)) throw badRequest('Isti artikl je naveden više puta na dokumentu.');
    seen.add(l.productId);
    if (!(l.qty > 0)) throw badRequest('Količina mora biti veća od 0.');
  }
  return lines;
}

// ---------------------------------------------------------------- Ulaz robe
export interface ReceiptInput {
  docDate: string;
  supplierId?: number | null;
  documentRef?: string | null;
  note?: string | null;
  lines: { productId: number; qty: number; unitPrice?: number | null }[];
  purchaseOrderId?: number | null;
  correctsMovementId?: number | null;
}

export function createReceipt(db: DB, input: ReceiptInput, actor: Actor): MovementResult {
  return db.transaction(() => {
    const lines = mergeLines(input.lines);
    assertProductsActive(db, lines.map((l) => l.productId));
    if (input.supplierId) {
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(input.supplierId)) throw badRequest('Dobavljač ne postoji.');
    }
    const central = centralLocationId(db);
    const result = postMovement(
      db,
      {
        type: 'receipt',
        docDate: input.docDate,
        supplierId: input.supplierId ?? null,
        documentRef: input.documentRef ?? null,
        note: input.note ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        correctsMovementId: input.correctsMovementId ?? null,
        lines: lines.map((l) => ({
          productId: l.productId,
          locationId: central,
          qtyDelta: l.qty,
          unitCost: l.unitPrice ?? null,
        })),
      },
      actor,
    );
    if (inventorySettings(db).updatePurchasePriceOnReceipt) {
      const upd = db.prepare('UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?');
      for (const l of lines) {
        if (l.unitPrice !== null && l.unitPrice !== undefined && l.unitPrice >= 0) {
          upd.run(roundPrice(l.unitPrice), nowIso(), l.productId);
        }
      }
    }
    return result;
  })();
}

// ---------------------------------------------------------------- Izlaz robe
export interface IssueInput {
  docDate: string;
  destinationType: 'vehicle' | 'machine' | 'other';
  destinationLocationId?: number | null;
  note?: string | null;
  lines: { productId: number; qty: number }[];
  correctsMovementId?: number | null;
}

/**
 * Izlaz iz centralnog skladišta. Ako je odredište vozilo ili automat, roba se ne gubi nego
 * prelazi na odredišnu lokaciju (ukupna količina ostaje ista). „Ostalo” je trajni izlaz (potrošnja, otpis).
 */
export function createIssue(db: DB, input: IssueInput, actor: Actor): MovementResult {
  return db.transaction(() => {
    const lines = mergeLines(input.lines);
    assertProductsActive(db, lines.map((l) => l.productId));
    const central = centralLocationId(db);
    let destId: number | null = null;
    if (input.destinationType === 'vehicle' || input.destinationType === 'machine') {
      if (!input.destinationLocationId) throw badRequest('Odaberite odredišnu lokaciju.');
      destId = assertLocation(db, input.destinationLocationId, [input.destinationType]).id;
    }
    const ledgerLines = lines.flatMap((l) => {
      const out = [{ productId: l.productId, locationId: central, qtyDelta: -l.qty }];
      if (destId) out.push({ productId: l.productId, locationId: destId, qtyDelta: l.qty });
      return out;
    });
    return postMovement(
      db,
      {
        type: 'issue',
        docDate: input.docDate,
        destinationType: input.destinationType,
        note: input.note ?? null,
        correctsMovementId: input.correctsMovementId ?? null,
        lines: ledgerLines,
      },
      actor,
    );
  })();
}

// ---------------------------------------------------------------- Prijenos
export interface TransferInput {
  docDate: string;
  fromLocationId: number;
  toLocationId: number;
  note?: string | null;
  lines: { productId: number; qty: number }[];
  sourceRef?: string | null;
  correctsMovementId?: number | null;
}

/** Interni prijenos (npr. centralno skladište → vozilo → automat). Zbroj promjena je uvijek 0. */
export function createTransfer(db: DB, input: TransferInput, actor: Actor): MovementResult {
  return db.transaction(() => {
    if (input.fromLocationId === input.toLocationId) throw badRequest('Polazna i odredišna lokacija moraju biti različite.');
    const lines = mergeLines(input.lines);
    assertProductsActive(db, lines.map((l) => l.productId));
    const from = assertLocation(db, input.fromLocationId);
    const to = assertLocation(db, input.toLocationId);
    return postMovement(
      db,
      {
        type: 'transfer',
        docDate: input.docDate,
        destinationType: to.type === 'vehicle' || to.type === 'machine' ? (to.type as 'vehicle' | 'machine') : 'other',
        note: input.note ?? null,
        sourceRef: input.sourceRef ?? null,
        correctsMovementId: input.correctsMovementId ?? null,
        lines: lines.flatMap((l) => [
          { productId: l.productId, locationId: from.id, qtyDelta: -l.qty },
          { productId: l.productId, locationId: to.id, qtyDelta: l.qty },
        ]),
      },
      actor,
    );
  })();
}

// ---------------------------------------------------------------- Početno stanje
export interface OpeningInput {
  docDate: string;
  locationId: number;
  note?: string | null;
  lines: { productId: number; qty: number; unitCost?: number | null }[];
}

/** Početno stanje dopušteno je samo za artikl/lokaciju bez ranijih kretanja; kasnije razlike rješava inventura. */
export function createOpening(db: DB, input: OpeningInput, actor: Actor): MovementResult {
  return db.transaction(() => {
    const lines = mergeLines(input.lines);
    const loc = assertLocation(db, input.locationId);
    for (const l of lines) {
      const used = db
        .prepare('SELECT 1 FROM stock_ledger WHERE product_id = ? AND location_id = ? LIMIT 1')
        .get(l.productId, loc.id);
      if (used) {
        const p = db.prepare('SELECT name FROM products WHERE id = ?').get(l.productId) as { name: string };
        throw badRequest(
          `Artikl „${p.name}” već ima kretanja na lokaciji „${loc.name}”. Za ispravak stanja koristite inventuru.`,
        );
      }
    }
    assertProductsActive(db, lines.map((l) => l.productId));
    return postMovement(
      db,
      {
        type: 'opening',
        docDate: input.docDate,
        note: input.note ?? null,
        lines: lines.map((l) => ({ productId: l.productId, locationId: loc.id, qtyDelta: l.qty, unitCost: l.unitCost ?? null })),
      },
      actor,
    );
  })();
}

// ---------------------------------------------------------------- Ispravak (storno + novi dokument)
export type CorrectionInput =
  | { type: 'receipt'; data: ReceiptInput }
  | { type: 'issue'; data: IssueInput }
  | { type: 'transfer'; data: TransferInput };

/**
 * Ispravak evidentiranog kretanja: originalni dokument se stornira i knjiži se novi, povezan s originalom.
 * Oba dokumenta i razlog ostaju u revizijskom tragu.
 */
export function correctMovement(
  db: DB,
  movementId: number,
  correction: CorrectionInput,
  reason: string,
  actor: Actor,
): { reversal: MovementResult; replacement: MovementResult } {
  return db.transaction(() => {
    const { movement } = getMovement(db, movementId);
    if (movement.type !== correction.type) throw badRequest('Vrsta ispravka mora odgovarati vrsti dokumenta.');
    if (movement.purchase_order_id) throw badRequest('Primke po narudžbi ispravljaju se stornom i ponovnim zaprimanjem.');
    const reversal = reverseMovement(db, movementId, { reason: `Ispravak: ${reason}`, docDate: correction.data.docDate }, actor);
    let replacement: MovementResult;
    if (correction.type === 'receipt') replacement = createReceipt(db, { ...correction.data, correctsMovementId: movementId }, actor);
    else if (correction.type === 'issue') replacement = createIssue(db, { ...correction.data, correctsMovementId: movementId }, actor);
    else replacement = createTransfer(db, { ...correction.data, correctsMovementId: movementId }, actor);
    audit(db, actor, 'stock.correct', 'stock_movement', movementId, {
      originalDocNo: movement.doc_no,
      reversalDocNo: reversal.docNo,
      replacementDocNo: replacement.docNo,
      reason,
    });
    return { reversal, replacement };
  })();
}

/** Izmjena opisnih podataka dokumenta (napomena, broj dokumenta) uz zapis prije/poslije. */
export function updateMovementMeta(
  db: DB,
  movementId: number,
  patch: { note?: string | null; documentRef?: string | null },
  actor: Actor,
): void {
  const { movement } = getMovement(db, movementId);
  const next = {
    note: patch.note === undefined ? movement.note : patch.note,
    document_ref: patch.documentRef === undefined ? movement.document_ref : patch.documentRef,
  };
  db.prepare('UPDATE stock_movements SET note = ?, document_ref = ? WHERE id = ?').run(next.note, next.document_ref, movementId);
  audit(db, actor, 'stock.update_meta', 'stock_movement', movementId, {
    before: { note: movement.note, documentRef: movement.document_ref },
    after: { note: next.note, documentRef: next.document_ref },
  });
}

// ---------------------------------------------------------------- Inventura
export function createInventoryCount(
  db: DB,
  input: { locationId: number; countDate: string; note?: string | null; productIds?: number[] },
  actor: Actor,
): number {
  return db.transaction(() => {
    const loc = assertLocation(db, input.locationId);
    const open = db
      .prepare("SELECT id FROM inventory_counts WHERE location_id = ? AND status = 'draft'")
      .get(loc.id) as { id: number } | undefined;
    if (open) throw conflict(`Za lokaciju „${loc.name}” već postoji otvorena inventura (#${open.id}).`);
    const r = db
      .prepare('INSERT INTO inventory_counts (location_id, status, count_date, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(loc.id, 'draft', input.countDate, input.note ?? null, actor.id);
    const countId = Number(r.lastInsertRowid);
    const productIds =
      input.productIds && input.productIds.length
        ? input.productIds
        : (
            db
              .prepare(
                `SELECT id FROM products WHERE active = 1
                 UNION SELECT product_id FROM stock_balances WHERE location_id = ? AND qty <> 0`,
              )
              .all(loc.id) as { id: number }[]
          ).map((x) => x.id);
    const ins = db.prepare('INSERT INTO inventory_count_lines (count_id, product_id, book_qty) VALUES (?, ?, ?)');
    for (const pid of new Set(productIds)) ins.run(countId, pid, getBalance(db, pid, loc.id));
    audit(db, actor, 'inventory.create', 'inventory_count', countId, { location: loc.name, lines: productIds.length });
    return countId;
  })();
}

export function getInventoryCount(db: DB, id: number) {
  const count = db
    .prepare(
      `SELECT ic.*, l.name AS location_name, m.doc_no AS movement_doc_no
       FROM inventory_counts ic JOIN locations l ON l.id = ic.location_id
       LEFT JOIN stock_movements m ON m.id = ic.movement_id WHERE ic.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!count) throw notFound('Inventura nije pronađena.');
  const lines = db
    .prepare(
      `SELECT icl.*, p.code, p.name, p.unit,
              COALESCE((SELECT qty FROM stock_balances b WHERE b.product_id = icl.product_id AND b.location_id = ?), 0) AS current_qty
       FROM inventory_count_lines icl JOIN products p ON p.id = icl.product_id
       WHERE icl.count_id = ? ORDER BY p.name`,
    )
    .all(count.location_id, id);
  return { count, lines };
}

export function updateInventoryCountLines(
  db: DB,
  countId: number,
  lines: { productId: number; countedQty: number | null }[],
  actor: Actor,
): void {
  db.transaction(() => {
    const c = db.prepare('SELECT status FROM inventory_counts WHERE id = ?').get(countId) as { status: string } | undefined;
    if (!c) throw notFound('Inventura nije pronađena.');
    if (c.status !== 'draft') throw badRequest('Proknjižena ili otkazana inventura se ne može mijenjati.');
    const upd = db.prepare('UPDATE inventory_count_lines SET counted_qty = ? WHERE count_id = ? AND product_id = ?');
    const ins = db.prepare(
      'INSERT OR IGNORE INTO inventory_count_lines (count_id, product_id, book_qty, counted_qty) VALUES (?, ?, 0, ?)',
    );
    for (const l of lines) {
      if (l.countedQty !== null && l.countedQty < 0) throw badRequest('Prebrojana količina ne može biti negativna.');
      const v = l.countedQty === null ? null : roundQty(l.countedQty);
      if (upd.run(v, countId, l.productId).changes === 0) ins.run(countId, l.productId, v);
    }
    audit(db, actor, 'inventory.update_lines', 'inventory_count', countId, { lines: lines.length });
  })();
}

/**
 * Knjiženje inventure: razlika = prebrojano − knjigovodstveno stanje u trenutku knjiženja.
 * Svaka razlika postaje stavka inventurne korekcije u skladišnoj knjizi.
 */
export function postInventoryCount(db: DB, countId: number, actor: Actor): { movement: MovementResult | null; differences: number } {
  return db.transaction(() => {
    const c = db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(countId) as
      | { id: number; status: string; location_id: number; count_date: string; note: string | null }
      | undefined;
    if (!c) throw notFound('Inventura nije pronađena.');
    if (c.status !== 'draft') throw badRequest('Inventura je već proknjižena ili otkazana.');
    const lines = db
      .prepare('SELECT product_id, counted_qty FROM inventory_count_lines WHERE count_id = ? AND counted_qty IS NOT NULL')
      .all(countId) as { product_id: number; counted_qty: number }[];
    if (!lines.length) throw badRequest('Nije unesena nijedna prebrojana količina.');
    const upd = db.prepare('UPDATE inventory_count_lines SET book_qty = ?, difference = ? WHERE count_id = ? AND product_id = ?');
    const adjustments: { productId: number; locationId: number; qtyDelta: number }[] = [];
    for (const l of lines) {
      const book = getBalance(db, l.product_id, c.location_id);
      const diff = roundQty(l.counted_qty - book);
      upd.run(book, diff, countId, l.product_id);
      if (diff !== 0) adjustments.push({ productId: l.product_id, locationId: c.location_id, qtyDelta: diff });
    }
    let movement: MovementResult | null = null;
    if (adjustments.length) {
      movement = postMovement(
        db,
        {
          type: 'adjustment',
          docDate: c.count_date,
          inventoryCountId: countId,
          note: `Inventura #${countId}${c.note ? `: ${c.note}` : ''}`,
          lines: adjustments,
        },
        actor,
      );
    }
    db.prepare(
      "UPDATE inventory_counts SET status = 'posted', movement_id = ?, posted_by = ?, posted_at = ? WHERE id = ?",
    ).run(movement?.movementId ?? null, actor.id, nowIso(), countId);
    audit(db, actor, 'inventory.post', 'inventory_count', countId, { differences: adjustments.length, docNo: movement?.docNo });
    return { movement, differences: adjustments.length };
  })();
}

export function cancelInventoryCount(db: DB, countId: number, actor: Actor): void {
  const r = db.prepare("UPDATE inventory_counts SET status = 'cancelled' WHERE id = ? AND status = 'draft'").run(countId);
  if (r.changes === 0) throw badRequest('Samo otvorena inventura se može otkazati.');
  audit(db, actor, 'inventory.cancel', 'inventory_count', countId);
}

export function listInventoryCounts(db: DB) {
  return db
    .prepare(
      `SELECT ic.id, ic.status, ic.count_date, ic.note, ic.created_at, ic.posted_at, l.name AS location_name,
              m.doc_no AS movement_doc_no,
              (SELECT COUNT(*) FROM inventory_count_lines x WHERE x.count_id = ic.id) AS line_count,
              (SELECT COUNT(*) FROM inventory_count_lines x WHERE x.count_id = ic.id AND x.counted_qty IS NOT NULL) AS counted_count,
              (SELECT COUNT(*) FROM inventory_count_lines x WHERE x.count_id = ic.id AND x.difference <> 0) AS diff_count
       FROM inventory_counts ic JOIN locations l ON l.id = ic.location_id
       LEFT JOIN stock_movements m ON m.id = ic.movement_id
       ORDER BY ic.id DESC`,
    )
    .all();
}

// ---------------------------------------------------------------- Rezervacije
export function createReservation(db: DB, input: { productId: number; qty: number; note?: string | null }, actor: Actor): number {
  return db.transaction(() => {
    assertProductsActive(db, [input.productId]);
    const r = db
      .prepare('INSERT INTO stock_reservations (product_id, qty, note, created_by) VALUES (?, ?, ?, ?)')
      .run(input.productId, roundQty(input.qty), input.note ?? null, actor.id);
    const id = Number(r.lastInsertRowid);
    evaluateLowStock(db, [input.productId]);
    audit(db, actor, 'reservation.create', 'stock_reservation', id, input);
    return id;
  })();
}

export function releaseReservation(db: DB, id: number, actor: Actor): number {
  const row = db.prepare('SELECT product_id FROM stock_reservations WHERE id = ? AND released_at IS NULL').get(id) as
    | { product_id: number }
    | undefined;
  if (!row) throw notFound('Aktivna rezervacija nije pronađena.');
  db.transaction(() => {
    db.prepare('UPDATE stock_reservations SET released_at = ? WHERE id = ?').run(nowIso(), id);
    evaluateLowStock(db, [row.product_id]);
    audit(db, actor, 'reservation.release', 'stock_reservation', id);
  })();
  return row.product_id;
}

export function listReservations(db: DB, includeReleased = false) {
  return db
    .prepare(
      `SELECT r.*, p.code, p.name, p.unit FROM stock_reservations r JOIN products p ON p.id = r.product_id
       ${includeReleased ? '' : 'WHERE r.released_at IS NULL'} ORDER BY r.id DESC`,
    )
    .all();
}
