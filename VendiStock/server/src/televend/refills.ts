import type { DB } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso, localDateOf, addDays } from '../lib/time.js';
import { audit, type Actor } from '../modules/audit/audit.js';
import { ensureMachineLocation } from '../modules/catalog/service.js';
import { createTransfer } from '../modules/inventory/operations.js';

interface RefillRow {
  id: number;
  machine_id: number;
  tv_product_id: number;
  quantity: number;
  refilled_at_utc: string;
  status: string;
  movement_id: number | null;
}

export function listRefills(db: DB, f: { status?: string; machineId?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) {
    where.push('r.status = ?');
    params.push(f.status);
  }
  if (f.machineId) {
    where.push('r.machine_id = ?');
    params.push(f.machineId);
  }
  return db
    .prepare(
      `SELECT r.*, m.name AS machine_name, tp.name AS tv_product_name, l.product_id, p.code AS product_code, p.name AS product_name,
              mv.doc_no AS movement_doc_no
       FROM tv_refills r
       JOIN machines m ON m.id = r.machine_id
       JOIN tv_products tp ON tp.id = r.tv_product_id
       LEFT JOIN product_televend_links l ON l.tv_product_id = r.tv_product_id
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN stock_movements mv ON mv.id = r.movement_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.refilled_at_utc DESC LIMIT 2000`,
    )
    .all(...params);
}

function loadRefill(db: DB, id: number): RefillRow & { product_id: number | null } {
  const r = db
    .prepare(
      'SELECT r.*, l.product_id FROM tv_refills r LEFT JOIN product_televend_links l ON l.tv_product_id = r.tv_product_id WHERE r.id = ?',
    )
    .get(id) as (RefillRow & { product_id: number | null }) | undefined;
  if (!r) throw notFound('Dopuna nije pronađena.');
  return r;
}

/** Prijedlozi lokalnih prijenosa u automat (±2 dana, isti artikl) koji još nisu povezani s dopunom. */
export function suggestRefillMatches(db: DB, id: number) {
  const r = loadRefill(db, id);
  if (!r.product_id) return [];
  const loc = ensureMachineLocation(db, r.machine_id);
  const day = localDateOf(r.refilled_at_utc);
  return db
    .prepare(
      `SELECT m.id AS movement_id, m.doc_no, m.doc_date, m.type, sl.qty_delta AS qty,
              ABS(sl.qty_delta - ?) < 0.0005 AS same_qty
       FROM stock_ledger sl JOIN stock_movements m ON m.id = sl.movement_id
       WHERE sl.location_id = ? AND sl.product_id = ? AND sl.qty_delta > 0 AND m.type IN ('issue','transfer')
         AND m.doc_date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM stock_movements rv WHERE rv.reverses_movement_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM tv_refills x JOIN product_televend_links xl ON xl.tv_product_id = x.tv_product_id
                         WHERE x.movement_id = m.id AND xl.product_id = sl.product_id)
       ORDER BY same_qty DESC, ABS(julianday(m.doc_date) - julianday(?))`,
    )
    .all(r.quantity, loc, r.product_id, addDays(day, -2), addDays(day, 2), day);
}

/**
 * Usklađivanje: dopuna iz Televenda povezuje se s već evidentiranim lokalnim prijenosom.
 * Ništa se ne knjiži ponovno – ista roba ne može se dvaput zadužiti u automat.
 */
export function reconcileRefill(db: DB, id: number, movementId: number, actor: Actor): void {
  db.transaction(() => {
    const r = loadRefill(db, id);
    if (r.status !== 'pending') throw badRequest('Dopuna je već obrađena.');
    if (!r.product_id) throw badRequest('Televend artikl nije povezan s lokalnim artiklom.');
    const valid = suggestRefillMatches(db, id).some((m) => (m as { movement_id: number }).movement_id === movementId);
    if (!valid) throw badRequest('Odabrani dokument ne odgovara ovoj dopuni (lokacija, artikl ili datum) ili je već povezan.');
    db.prepare("UPDATE tv_refills SET status = 'reconciled', movement_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
      movementId,
      actor.id,
      nowIso(),
      id,
    );
    audit(db, actor, 'refill.reconcile', 'tv_refill', id, { movementId });
  })();
}

/** Knjiženje dopune koja nije ranije evidentirana: prijenos iz odabrane lokacije (npr. vozila) u automat. */
export function bookRefill(db: DB, id: number, fromLocationId: number, actor: Actor) {
  return db.transaction(() => {
    const r = loadRefill(db, id);
    if (r.status !== 'pending') throw conflict('Dopuna je već obrađena.');
    if (!r.product_id) throw badRequest('Televend artikl nije povezan s lokalnim artiklom.');
    const to = ensureMachineLocation(db, r.machine_id);
    const result = createTransfer(
      db,
      {
        docDate: localDateOf(r.refilled_at_utc),
        fromLocationId,
        toLocationId: to,
        sourceRef: `refill:${id}`,
        note: `Dopuna automata iz Televenda #${id}`,
        lines: [{ productId: r.product_id, qty: r.quantity }],
      },
      actor,
    );
    db.prepare("UPDATE tv_refills SET status = 'booked', movement_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
      result.movementId,
      actor.id,
      nowIso(),
      id,
    );
    audit(db, actor, 'refill.book', 'tv_refill', id, { docNo: result.docNo, fromLocationId });
    return result;
  })();
}

export function ignoreRefill(db: DB, id: number, note: string | null, actor: Actor): void {
  const r = loadRefill(db, id);
  if (r.status !== 'pending') throw badRequest('Dopuna je već obrađena.');
  db.prepare("UPDATE tv_refills SET status = 'ignored', note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
    note,
    actor.id,
    nowIso(),
    id,
  );
  audit(db, actor, 'refill.ignore', 'tv_refill', id, { note });
}
