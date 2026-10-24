import type { DB } from '../../db/index.js';
import { MOVEMENT_LABEL, type MovementType } from './ledger.js';

export interface HistoryFilters {
  from?: string;
  to?: string;
  productId?: number;
  locationId?: number;
  type?: MovementType;
  search?: string;
  limit?: number;
}

export interface HistoryRow {
  ledger_id: number;
  movement_id: number;
  doc_no: string;
  doc_date: string;
  type: MovementType;
  type_label: string;
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  location_id: number;
  location_name: string;
  location_type: string;
  qty_in: number | null;
  qty_out: number | null;
  balance_after: number;
  unit_cost: number | null;
  note: string | null;
  document_ref: string | null;
  source_ref: string | null;
  reversed: number;
  reverses_doc_no: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Povijest skladišta: Datum | Artikl | Vrsta promjene | Ulaz | Izlaz | Lokacija | Stanje nakon knjiženja */
export function stockHistory(db: DB, f: HistoryFilters): HistoryRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    where.push('m.doc_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('m.doc_date <= ?');
    params.push(f.to);
  }
  if (f.productId) {
    where.push('sl.product_id = ?');
    params.push(f.productId);
  }
  if (f.locationId) {
    where.push('sl.location_id = ?');
    params.push(f.locationId);
  }
  if (f.type) {
    where.push('m.type = ?');
    params.push(f.type);
  }
  if (f.search) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR m.doc_no LIKE ? OR m.note LIKE ? OR m.document_ref LIKE ?)');
    const s = `%${f.search}%`;
    params.push(s, s, s, s, s);
  }
  const limit = Math.min(Math.max(f.limit ?? 5000, 1), 100_000);
  const rows = db
    .prepare(
      `SELECT sl.id AS ledger_id, m.id AS movement_id, m.doc_no, m.doc_date, m.type,
              p.id AS product_id, p.code AS product_code, p.name AS product_name, p.unit,
              l.id AS location_id, l.name AS location_name, l.type AS location_type,
              CASE WHEN sl.qty_delta > 0 THEN sl.qty_delta END AS qty_in,
              CASE WHEN sl.qty_delta < 0 THEN -sl.qty_delta END AS qty_out,
              sl.balance_after, sl.unit_cost, m.note, m.document_ref, m.source_ref,
              EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_movement_id = m.id) AS reversed,
              (SELECT o.doc_no FROM stock_movements o WHERE o.id = m.reverses_movement_id) AS reverses_doc_no,
              COALESCE(NULLIF(u.full_name, ''), u.username) AS created_by_name, m.created_at
       FROM stock_ledger sl
       JOIN stock_movements m ON m.id = sl.movement_id
       JOIN products p ON p.id = sl.product_id
       JOIN locations l ON l.id = sl.location_id
       LEFT JOIN users u ON u.id = m.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY m.doc_date DESC, sl.id DESC
       LIMIT ${limit}`,
    )
    .all(...params) as Omit<HistoryRow, 'type_label'>[];
  return rows.map((r) => ({ ...r, type_label: MOVEMENT_LABEL[r.type] }));
}

export function movementsList(db: DB, f: { type?: MovementType; from?: string; to?: string; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.type) {
    where.push('m.type = ?');
    params.push(f.type);
  }
  if (f.from) {
    where.push('m.doc_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('m.doc_date <= ?');
    params.push(f.to);
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.doc_no, m.type, m.doc_date, m.document_ref, m.note, m.destination_type, m.source_ref,
              m.reverses_movement_id, m.corrects_movement_id, m.purchase_order_id, m.created_at,
              s.name AS supplier_name,
              COALESCE(NULLIF(u.full_name, ''), u.username) AS created_by_name,
              EXISTS (SELECT 1 FROM stock_movements r WHERE r.reverses_movement_id = m.id) AS reversed,
              (SELECT COUNT(DISTINCT product_id) FROM stock_ledger WHERE movement_id = m.id) AS product_count,
              (SELECT GROUP_CONCAT(DISTINCT l.name) FROM stock_ledger x JOIN locations l ON l.id = x.location_id
                 WHERE x.movement_id = m.id AND x.qty_delta > 0) AS to_locations,
              (SELECT GROUP_CONCAT(DISTINCT l.name) FROM stock_ledger x JOIN locations l ON l.id = x.location_id
                 WHERE x.movement_id = m.id AND x.qty_delta < 0) AS from_locations,
              (SELECT ROUND(SUM(ABS(x.qty_delta) * COALESCE(x.unit_cost, 0)), 2) FROM stock_ledger x
                 WHERE x.movement_id = m.id AND x.qty_delta > 0) AS value_in
       FROM stock_movements m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       LEFT JOIN users u ON u.id = m.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY m.id DESC LIMIT ?`,
    )
    .all(...params, Math.min(f.limit ?? 500, 5000)) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, type_label: MOVEMENT_LABEL[r.type as MovementType] }));
}

export function movementDetail(db: DB, id: number) {
  const movement = db
    .prepare(
      `SELECT m.*, s.name AS supplier_name, COALESCE(NULLIF(u.full_name, ''), u.username) AS created_by_name,
              (SELECT r.doc_no FROM stock_movements r WHERE r.reverses_movement_id = m.id) AS reversed_by_doc_no,
              (SELECT o.doc_no FROM stock_movements o WHERE o.id = m.reverses_movement_id) AS reverses_doc_no,
              (SELECT o.doc_no FROM stock_movements o WHERE o.id = m.corrects_movement_id) AS corrects_doc_no
       FROM stock_movements m LEFT JOIN suppliers s ON s.id = m.supplier_id LEFT JOIN users u ON u.id = m.created_by
       WHERE m.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!movement) return null;
  const lines = db
    .prepare(
      `SELECT sl.*, p.code, p.name, p.unit, l.name AS location_name, l.type AS location_type
       FROM stock_ledger sl JOIN products p ON p.id = sl.product_id JOIN locations l ON l.id = sl.location_id
       WHERE sl.movement_id = ? ORDER BY sl.id`,
    )
    .all(id);
  const auditTrail = db
    .prepare(
      "SELECT created_at, username, action, details FROM audit_log WHERE entity = 'stock_movement' AND entity_id = ? ORDER BY id",
    )
    .all(String(id));
  return { movement: { ...movement, type_label: MOVEMENT_LABEL[movement.type as MovementType] }, lines, auditTrail };
}

/** Stanja po lokacijama (matrica artikl × lokacija). */
export function stockBalances(db: DB, f: { locationId?: number; includeZero?: boolean }) {
  const params: unknown[] = [];
  let where = 'WHERE 1 = 1';
  if (f.locationId) {
    where += ' AND b.location_id = ?';
    params.push(f.locationId);
  }
  if (!f.includeZero) where += ' AND b.qty <> 0';
  return db
    .prepare(
      `SELECT b.product_id, p.code, p.name, p.unit, p.purchase_price, c.name AS category_name,
              b.location_id, l.name AS location_name, l.type AS location_type, b.qty,
              ROUND(b.qty * p.purchase_price, 2) AS value, b.updated_at
       FROM stock_balances b
       JOIN products p ON p.id = b.product_id
       JOIN locations l ON l.id = b.location_id
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       ORDER BY l.type = 'central' DESC, l.name, p.name`,
    )
    .all(...params);
}

/** Pregled po artiklu: centralno skladište, vozila, automati, rezervirano, raspoloživo. */
export function stockOverview(db: DB) {
  return db
    .prepare(
      `SELECT p.id, p.code, p.name, p.unit, p.purchase_price, p.min_stock, p.target_stock, p.active,
              c.name AS category_name, s.name AS supplier_name,
              COALESCE(SUM(CASE WHEN l.type = 'central' THEN b.qty END), 0) AS central_qty,
              COALESCE(SUM(CASE WHEN l.type = 'vehicle' THEN b.qty END), 0) AS vehicle_qty,
              COALESCE(SUM(CASE WHEN l.type = 'machine' THEN b.qty END), 0) AS machine_qty,
              COALESCE(SUM(CASE WHEN l.type = 'other' THEN b.qty END), 0) AS other_qty,
              COALESCE(SUM(b.qty), 0) AS total_qty,
              COALESCE((SELECT SUM(r.qty) FROM stock_reservations r WHERE r.product_id = p.id AND r.released_at IS NULL), 0) AS reserved_qty
       FROM products p
       LEFT JOIN stock_balances b ON b.product_id = p.id
       LEFT JOIN locations l ON l.id = b.location_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       GROUP BY p.id
       ORDER BY p.name`,
    )
    .all() as Record<string, number | string | null>[];
}

export function stockValue(db: DB): { central: number; total: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.type = 'central' AND b.qty > 0 THEN b.qty * p.purchase_price END), 0) AS central,
              COALESCE(SUM(CASE WHEN b.qty > 0 THEN b.qty * p.purchase_price END), 0) AS total
       FROM stock_balances b JOIN products p ON p.id = b.product_id JOIN locations l ON l.id = b.location_id`,
    )
    .get() as { central: number; total: number };
  return { central: Math.round(row.central * 100) / 100, total: Math.round(row.total * 100) / 100 };
}
