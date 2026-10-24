import { DateTime } from 'luxon';
import { TIMEZONE } from '../../config.js';
import type { DB } from '../../db/index.js';
import { roundMoney, roundQty } from '../../lib/num.js';
import { daysBetweenInclusive } from '../../lib/time.js';

export interface SalesFilters {
  from: string;
  to: string;
  machineId?: number;
  productId?: number;
  categoryId?: number;
}

const BASE = `
  FROM sales_transactions s
  LEFT JOIN tv_products tp ON tp.id = s.tv_product_id
  LEFT JOIN product_televend_links pl ON pl.tv_product_id = s.tv_product_id
  LEFT JOIN products p ON p.id = pl.product_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN machines m ON m.id = s.machine_id`;

/** Prihod: iznos iz izvještaja ili količina × jedinična cijena; NULL ako izvor ne daje cijenu. */
const REVENUE = 'COALESCE(s.amount, s.quantity * s.unit_price)';
const PRODUCT_KEY = "CASE WHEN p.id IS NOT NULL THEN 'p:' || p.id ELSE 'tv:' || COALESCE(s.tv_product_id, 0) END";
const PRODUCT_NAME = 'COALESCE(p.name, tp.name, s.product_name_raw)';

function where(f: SalesFilters): { sql: string; params: unknown[] } {
  const parts = ["s.status = 'valid'", 's.sold_date_local BETWEEN ? AND ?'];
  const params: unknown[] = [f.from, f.to];
  if (f.machineId) {
    parts.push('s.machine_id = ?');
    params.push(f.machineId);
  }
  if (f.productId) {
    parts.push('p.id = ?');
    params.push(f.productId);
  }
  if (f.categoryId) {
    parts.push('p.category_id = ?');
    params.push(f.categoryId);
  }
  return { sql: `WHERE ${parts.join(' AND ')}`, params };
}

export function hasAnySales(db: DB): boolean {
  return !!db.prepare('SELECT 1 FROM sales_transactions LIMIT 1').get();
}

export interface Summary {
  hasData: boolean;
  totalQty: number;
  totalRevenue: number | null;
  revenueCoverage: number;
  transactions: number;
  days: number;
  avgDailyQty: number;
  avgDailyRevenue: number | null;
  machines: number;
  products: number;
  topProduct: { key: string; name: string; qty: number } | null;
  firstSaleDate: string | null;
  lastSaleAt: string | null;
}

export function summary(db: DB, f: SalesFilters): Summary {
  const w = where(f);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(s.quantity), 0) AS qty, SUM(${REVENUE}) AS revenue,
              SUM(CASE WHEN ${REVENUE} IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue,
              COUNT(DISTINCT s.machine_id) AS machines, COUNT(DISTINCT ${PRODUCT_KEY}) AS products,
              MIN(s.sold_date_local) AS first_date, MAX(s.sold_at_utc) AS last_at
       ${BASE} ${w.sql}`,
    )
    .get(...w.params) as {
    n: number;
    qty: number;
    revenue: number | null;
    with_revenue: number;
    machines: number;
    products: number;
    first_date: string | null;
    last_at: string | null;
  };
  const days = daysBetweenInclusive(f.from, f.to);
  const top = topProducts(db, f, 'qty', 1)[0] ?? null;
  return {
    hasData: row.n > 0,
    totalQty: roundQty(row.qty),
    totalRevenue: row.with_revenue ? roundMoney(row.revenue ?? 0) : null,
    revenueCoverage: row.n ? row.with_revenue / row.n : 0,
    transactions: row.n,
    days,
    avgDailyQty: roundQty(row.qty / days),
    avgDailyRevenue: row.with_revenue ? roundMoney((row.revenue ?? 0) / days) : null,
    machines: row.machines,
    products: row.products,
    topProduct: top ? { key: top.key, name: top.name, qty: top.qty } : null,
    firstSaleDate: row.first_date,
    lastSaleAt: row.last_at,
  };
}

export interface ProductSales {
  key: string;
  productId: number | null;
  code: string | null;
  name: string;
  categoryName: string | null;
  mapped: boolean;
  qty: number;
  revenue: number | null;
  transactions: number;
  avgDailyQty: number;
}

/** Najprodavaniji artikli: primarni kriterij je broj prodanih jedinica; prihod je zaseban kriterij. */
export function topProducts(db: DB, f: SalesFilters, by: 'qty' | 'revenue', limit = 10, order: 'desc' | 'asc' = 'desc'): ProductSales[] {
  const w = where(f);
  const days = daysBetweenInclusive(f.from, f.to);
  const orderBy =
    by === 'qty'
      ? `qty ${order}, revenue ${order}, name`
      : `revenue IS NULL, revenue ${order}, qty ${order}, name`;
  const rows = db
    .prepare(
      `SELECT ${PRODUCT_KEY} AS key, p.id AS product_id, p.code, MAX(${PRODUCT_NAME}) AS name, c.name AS category_name,
              SUM(s.quantity) AS qty, SUM(${REVENUE}) AS revenue, COUNT(*) AS transactions,
              SUM(CASE WHEN ${REVENUE} IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue
       ${BASE} ${w.sql}
       GROUP BY key ORDER BY ${orderBy} LIMIT ?`,
    )
    .all(...w.params, limit) as {
    key: string;
    product_id: number | null;
    code: string | null;
    name: string;
    category_name: string | null;
    qty: number;
    revenue: number | null;
    transactions: number;
    with_revenue: number;
  }[];
  return rows.map((r) => ({
    key: r.key,
    productId: r.product_id,
    code: r.code,
    name: r.name,
    categoryName: r.category_name,
    mapped: r.product_id !== null,
    qty: roundQty(r.qty),
    revenue: r.with_revenue ? roundMoney(r.revenue ?? 0) : null,
    transactions: r.transactions,
    avgDailyQty: roundQty(r.qty / days),
  }));
}

/** Artikli s najmanjom prodajom – uključuje i aktivne artikle bez ijedne prodaje u razdoblju. */
export function leastSold(db: DB, f: SalesFilters, limit = 20): ProductSales[] {
  const sold = topProducts(db, f, 'qty', 100_000, 'asc');
  const soldIds = new Set(sold.filter((s) => s.productId).map((s) => s.productId));
  const linkedActive = db
    .prepare(
      `SELECT p.id, p.code, p.name, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND EXISTS (SELECT 1 FROM product_televend_links l WHERE l.product_id = p.id)
       ${f.categoryId ? 'AND p.category_id = ?' : ''} ${f.productId ? 'AND p.id = ?' : ''}`,
    )
    .all(...[f.categoryId, f.productId].filter((x) => x !== undefined)) as { id: number; code: string; name: string; category_name: string | null }[];
  const zero: ProductSales[] = f.machineId
    ? []
    : linkedActive
        .filter((p) => !soldIds.has(p.id))
        .map((p) => ({ key: `p:${p.id}`, productId: p.id, code: p.code, name: p.name, categoryName: p.category_name, mapped: true, qty: 0, revenue: 0, transactions: 0, avgDailyQty: 0 }));
  return [...zero, ...sold].slice(0, limit);
}

export function byMachine(db: DB, f: SalesFilters) {
  const w = where(f);
  return (
    db
      .prepare(
        `SELECT s.machine_id, COALESCE(m.name, s.machine_name_raw, 'Nepoznat automat') AS name, m.location_text,
                SUM(s.quantity) AS qty, SUM(${REVENUE}) AS revenue, COUNT(*) AS transactions,
                SUM(CASE WHEN ${REVENUE} IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue
         ${BASE} ${w.sql} GROUP BY s.machine_id ORDER BY qty DESC`,
      )
      .all(...w.params) as { machine_id: number | null; name: string; location_text: string | null; qty: number; revenue: number | null; transactions: number; with_revenue: number }[]
  ).map((r) => ({
    machineId: r.machine_id,
    name: r.name,
    location: r.location_text,
    qty: roundQty(r.qty),
    revenue: r.with_revenue ? roundMoney(r.revenue ?? 0) : null,
    transactions: r.transactions,
  }));
}

export function byCategory(db: DB, f: SalesFilters) {
  const w = where(f);
  return (
    db
      .prepare(
        `SELECT MAX(p.category_id) AS category_id,
                COALESCE(c.name, CASE WHEN p.id IS NULL THEN 'Nepovezani Televend artikli' ELSE 'Bez kategorije' END) AS category_label,
                SUM(s.quantity) AS qty, SUM(${REVENUE}) AS revenue, COUNT(*) AS transactions,
                SUM(CASE WHEN ${REVENUE} IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue
         ${BASE} ${w.sql} GROUP BY category_label ORDER BY qty DESC`,
      )
      .all(...w.params) as { category_id: number | null; category_label: string; qty: number; revenue: number | null; transactions: number; with_revenue: number }[]
  ).map((r) => ({
    categoryId: r.category_id,
    name: r.category_label,
    qty: roundQty(r.qty),
    revenue: r.with_revenue ? roundMoney(r.revenue ?? 0) : null,
    transactions: r.transactions,
  }));
}

/** Vremenski niz (dnevno ili mjesečno, lokalno vrijeme) s popunjenim praznim razdobljima. */
export function timeseries(db: DB, f: SalesFilters, granularity: 'day' | 'month') {
  const w = where(f);
  const col = granularity === 'day' ? 's.sold_date_local' : 's.sold_month_local';
  const rows = db
    .prepare(
      `SELECT ${col} AS period, SUM(s.quantity) AS qty, SUM(${REVENUE}) AS revenue, COUNT(*) AS transactions,
              SUM(CASE WHEN ${REVENUE} IS NOT NULL THEN 1 ELSE 0 END) AS with_revenue
       ${BASE} ${w.sql} GROUP BY period ORDER BY period`,
    )
    .all(...w.params) as { period: string; qty: number; revenue: number | null; transactions: number; with_revenue: number }[];
  const map = new Map(rows.map((r) => [r.period, r]));
  const out: { period: string; qty: number; revenue: number | null; transactions: number }[] = [];
  let cur = DateTime.fromISO(f.from, { zone: TIMEZONE }).startOf(granularity);
  const end = DateTime.fromISO(f.to, { zone: TIMEZONE }).startOf(granularity);
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    const key = granularity === 'day' ? cur.toISODate()! : cur.toFormat('yyyy-MM');
    const r = map.get(key);
    out.push({
      period: key,
      qty: r ? roundQty(r.qty) : 0,
      revenue: r && r.with_revenue ? roundMoney(r.revenue ?? 0) : r ? null : 0,
      transactions: r ? r.transactions : 0,
    });
    cur = cur.plus(granularity === 'day' ? { days: 1 } : { months: 1 });
  }
  return out;
}

/** Usporedba dvaju razdoblja (ukupno i po artiklu). */
export function comparePeriods(db: DB, a: SalesFilters, b: SalesFilters) {
  const sa = summary(db, a);
  const sb = summary(db, b);
  const pa = topProducts(db, a, 'qty', 100_000);
  const pb = topProducts(db, b, 'qty', 100_000);
  const keys = new Map<string, { name: string; code: string | null }>();
  for (const p of [...pa, ...pb]) keys.set(p.key, { name: p.name, code: p.code });
  const ma = new Map(pa.map((p) => [p.key, p]));
  const mb = new Map(pb.map((p) => [p.key, p]));
  const pct = (x: number, y: number) => (y === 0 ? null : roundQty(((x - y) / y) * 100));
  const products = [...keys.entries()]
    .map(([key, info]) => {
      const qa = ma.get(key)?.qty ?? 0;
      const qb = mb.get(key)?.qty ?? 0;
      return { key, name: info.name, code: info.code, qtyA: qa, qtyB: qb, diff: roundQty(qa - qb), diffPct: pct(qa, qb), revenueA: ma.get(key)?.revenue ?? null, revenueB: mb.get(key)?.revenue ?? null };
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  return {
    a: sa,
    b: sb,
    qtyDiff: roundQty(sa.totalQty - sb.totalQty),
    qtyDiffPct: pct(sa.totalQty, sb.totalQty),
    revenueDiff: sa.totalRevenue !== null && sb.totalRevenue !== null ? roundMoney(sa.totalRevenue - sb.totalRevenue) : null,
    revenueDiffPct: sa.totalRevenue !== null && sb.totalRevenue !== null ? pct(sa.totalRevenue, sb.totalRevenue) : null,
    avgDailyDiffPct: pct(sa.avgDailyQty, sb.avgDailyQty),
    products,
  };
}

export function transactionsList(db: DB, f: SalesFilters, limit = 5000) {
  const w = where({ ...f });
  return db
    .prepare(
      `SELECT s.id, s.source_txn_id, s.sold_at_utc, s.sold_date_local, COALESCE(m.name, s.machine_name_raw) AS machine_name,
              ${PRODUCT_NAME} AS product_name, p.code AS product_code, p.id IS NOT NULL AS mapped, s.quantity, s.unit_price,
              ${REVENUE} AS revenue, s.payment_method, s.status, s.source, s.fetched_at, s.revision, s.import_batch_id,
              s.stock_movement_id
       ${BASE} ${w.sql.replace("s.status = 'valid' AND ", '')}
       ORDER BY s.sold_at_utc DESC LIMIT ?`,
    )
    .all(...w.params, limit);
}
