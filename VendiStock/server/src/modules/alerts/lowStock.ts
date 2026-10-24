import type { DB } from '../../db/index.js';
import { roundQty } from '../../lib/num.js';
import { nowIso } from '../../lib/time.js';

/** Fizička zaliha centralnog skladišta umanjena za aktivne rezervacije. */
export function centralStockInfo(db: DB, productId: number): { stock: number; reserved: number; available: number } {
  const row = db
    .prepare(
      `SELECT COALESCE((SELECT b.qty FROM stock_balances b JOIN locations l ON l.id = b.location_id
                        WHERE l.type = 'central' AND b.product_id = ?), 0) AS stock,
              COALESCE((SELECT SUM(qty) FROM stock_reservations WHERE product_id = ? AND released_at IS NULL), 0) AS reserved`,
    )
    .get(productId, productId) as { stock: number; reserved: number };
  return { stock: roundQty(row.stock), reserved: roundQty(row.reserved), available: roundQty(row.stock - row.reserved) };
}

interface StateRow {
  product_id: number;
  is_low: number;
  low_since: string | null;
}

/**
 * Automat stanja upozorenja: događaj „entered_low” nastaje samo pri prijelazu u nisku zalihu.
 * Daljnje smanjenje dok je artikl već ispod minimuma ne stvara novo upozorenje.
 * Kad zaliha dosegne minimum, stanje se resetira (događaj „recovered”).
 */
export function evaluateLowStock(db: DB, productIds: number[]): { entered: number[]; recovered: number[] } {
  const entered: number[] = [];
  const recovered: number[] = [];
  const getProduct = db.prepare('SELECT id, min_stock, active FROM products WHERE id = ?');
  const getState = db.prepare('SELECT product_id, is_low, low_since FROM stock_alert_state WHERE product_id = ?');
  const upsert = db.prepare(
    `INSERT INTO stock_alert_state (product_id, is_low, low_since, last_available, last_min, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET is_low = excluded.is_low, low_since = excluded.low_since,
       last_available = excluded.last_available, last_min = excluded.last_min, updated_at = excluded.updated_at`,
  );
  const insEvent = db.prepare(
    'INSERT INTO stock_alert_events (product_id, event, available_qty, min_qty, notify_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const id of new Set(productIds)) {
    const p = getProduct.get(id) as { id: number; min_stock: number; active: number } | undefined;
    if (!p) continue;
    const { available } = centralStockInfo(db, id);
    const state = getState.get(id) as StateRow | undefined;
    const wasLow = state?.is_low === 1;
    const isLow = p.active === 1 && p.min_stock > 0 && available < p.min_stock;
    const now = nowIso();
    if (isLow && !wasLow) {
      upsert.run(id, 1, now, available, p.min_stock, now);
      insEvent.run(id, 'entered_low', available, p.min_stock, 'pending', now);
      entered.push(id);
    } else if (!isLow && wasLow) {
      upsert.run(id, 0, null, available, p.min_stock, now);
      insEvent.run(id, 'recovered', available, p.min_stock, 'not_required', now);
      recovered.push(id);
    } else {
      upsert.run(id, isLow ? 1 : 0, isLow ? (state?.low_since ?? now) : null, available, p.min_stock, now);
    }
  }
  return { entered, recovered };
}
