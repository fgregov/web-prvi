import type { AppContext } from '../../context.js';
import { stockValue } from '../inventory/queries.js';
import { recommendations } from '../procurement/service.js';
import { hasAnySales, summary, timeseries, topProducts } from '../sales/analytics.js';
import { getConnectorStatus } from '../../televend/config.js';
import { lastBackup } from '../backup/service.js';

export function dashboard(ctx: AppContext, period: { from: string; to: string }) {
  const db = ctx.db;
  const activeProducts = (db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get() as { n: number }).n;
  const recs = recommendations(db, { onlyBelowMin: true });
  const toOrder = recs.filter((r) => r.orderQty > 0);
  const anySales = hasAnySales(db);
  const s = anySales ? summary(db, period) : null;
  const machines = db
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN source = 'televend' THEN 1 ELSE 0 END) AS televend FROM machines WHERE active = 1")
    .get() as { total: number; televend: number | null };
  const tv = getConnectorStatus(db);
  return {
    period,
    kpi: {
      stockValue: stockValue(db),
      activeProducts,
      belowMinimum: recs.length,
      toOrder: toOrder.length,
      sales: s ? { qty: s.totalQty, revenue: s.totalRevenue, transactions: s.transactions, hasData: s.hasData } : null,
      topProduct: s?.topProduct ?? null,
      machines: { total: machines.total, televend: machines.televend ?? 0 },
      lastSync: { at: tv.lastSyncAt, okAt: tv.lastSyncOkAt, status: tv.lastSyncStatus, state: tv.state },
    },
    salesSeries: anySales ? timeseries(db, period, 'day') : null,
    top10: anySales ? topProducts(db, period, 'qty', 10) : null,
    procurement: recs.slice(0, 12),
    televend: {
      state: tv.state,
      message: tv.message,
      lastLoginAt: tv.lastLoginAt,
      lastLoginOk: tv.lastLoginOk,
      lastSyncAt: tv.lastSyncAt,
      lastSyncOkAt: tv.lastSyncOkAt,
      lastSyncStatus: tv.lastSyncStatus,
      lastSyncRecords: tv.lastSyncRecords,
      lastSyncDurationMs: tv.lastSyncDurationMs,
      lastError: tv.lastError,
      autoSyncSuspended: tv.autoSyncSuspended,
    },
    lastBackup: lastBackup(ctx),
    demoMode: ctx.config.mode === 'demo',
  };
}
