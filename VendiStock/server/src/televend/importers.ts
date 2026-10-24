import crypto from 'node:crypto';
import type { DB } from '../db/index.js';
import { localDateOf, localMonthOf, nowIso } from '../lib/time.js';
import { ensureMachineLocation } from '../modules/catalog/service.js';
import type { Dataset, DatasetConfig } from './config.js';
import type { Cell } from './parse.js';
import {
  mapRows,
  normName,
  type DatasetRecord,
  type MachineRef,
  type MappingResult,
  type ProductRef,
  type RefillRecord,
  type SalesRecord,
} from './mapping.js';

export type ImportSource = 'televend_portal' | 'manual_upload';

export interface ImportMeta {
  source: ImportSource;
  fileName: string | null;
  fileBuffer: Buffer | null;
  period: { from: string; to: string } | null;
  syncRunId: number | null;
  userId: number | null;
  fetchedAt: string;
}

export interface ImportSummary {
  batchId: number;
  dataset: Dataset;
  status: 'committed' | 'rejected' | 'failed';
  rowsTotal: number;
  inserted: number;
  updated: number;
  duplicate: number;
  rejected: number;
  message: string | null;
  missingColumns: string[];
  rejectedRows: { rowNo: number; reason: string }[];
  /** ID-jevi transakcija prodaje koje su nove ili promijenjene (za knjiženje na zalihe automata). */
  changedSalesIds: number[];
}

const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

function serializeRaw(raw: Record<string, Cell>): string {
  return JSON.stringify(raw, (_k, v) => (v instanceof Date ? v.toISOString() : v));
}

/**
 * Pronalazi postojeći automat: po ključu izvora, zatim po nazivu. Ako se automat najprije pojavio samo
 * s nazivom (npr. u izvještaju prodaje), a kasnije s ID-om (lista automata), zapis se nadograđuje ID-om
 * umjesto stvaranja duplikata.
 */
function findMachine(db: DB, ref: MachineRef): number | null {
  if (!ref.machineKey) return null;
  const byKey = db.prepare('SELECT id FROM machines WHERE ext_key = ?').get(ref.machineKey) as { id: number } | undefined;
  if (byKey) return byKey.id;
  if (!ref.machineName) return null;
  const name = normName(ref.machineName);
  const byNameKey = db.prepare('SELECT id FROM machines WHERE ext_key = ?').get(`name:${name}`) as { id: number } | undefined;
  if (byNameKey && ref.machineSourceId) {
    db.prepare('UPDATE machines SET ext_key = ?, source_id = ? WHERE id = ?').run(ref.machineKey, ref.machineSourceId, byNameKey.id);
    return byNameKey.id;
  }
  if (byNameKey) return byNameKey.id;
  const same = (db.prepare('SELECT id, name FROM machines').all() as { id: number; name: string }[]).filter((m) => normName(m.name) === name);
  return same.length === 1 ? same[0].id : null;
}

function upsertMachine(db: DB, ref: MachineRef, source: ImportSource, fetchedAt: string, extra?: { location?: string | null; serialNo?: string | null; raw?: string }): number | null {
  if (!ref.machineKey) return null;
  const existingId = findMachine(db, ref);
  const src = source === 'televend_portal' ? 'televend' : 'upload';
  if (existingId) {
    db.prepare(
      `UPDATE machines SET last_seen_at = ?, fetched_at = ?,
         name = COALESCE(?, name), location_text = COALESCE(?, location_text), serial_no = COALESCE(?, serial_no),
         raw = COALESCE(?, raw), updated_at = ? WHERE id = ?`,
    ).run(fetchedAt, fetchedAt, ref.machineName, extra?.location ?? null, extra?.serialNo ?? null, extra?.raw ?? null, nowIso(), existingId);
    return existingId;
  }
  const r = db
    .prepare(
      `INSERT INTO machines (ext_key, source_id, name, location_text, serial_no, source, raw, first_seen_at, last_seen_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.machineKey,
      ref.machineSourceId,
      ref.machineName ?? ref.machineSourceId ?? 'Nepoznat automat',
      extra?.location ?? null,
      extra?.serialNo ?? null,
      src,
      extra?.raw ?? null,
      fetchedAt,
      fetchedAt,
      fetchedAt,
    );
  const id = Number(r.lastInsertRowid);
  ensureMachineLocation(db, id);
  return id;
}

/** Isto usklađivanje za Televend artikle (ID iz liste artikala ↔ naziv iz izvještaja prodaje). */
function findTvProduct(db: DB, ref: ProductRef, machineId: number | null, perMachine: boolean): number | null {
  const byKey = db.prepare('SELECT id FROM tv_products WHERE ext_key = ?').get(ref.productKey) as { id: number } | undefined;
  if (byKey) return byKey.id;
  const name = normName(ref.productName);
  const candidates = (
    db.prepare('SELECT id, name, ext_key, machine_id FROM tv_products').all() as { id: number; name: string; ext_key: string; machine_id: number | null }[]
  ).filter((p) => normName(p.name) === name && (!perMachine || p.machine_id === machineId));
  if (candidates.length !== 1) return null;
  const c = candidates[0];
  if (ref.productSourceId && c.ext_key.startsWith('name:')) {
    db.prepare('UPDATE tv_products SET ext_key = ?, source_id = ? WHERE id = ?').run(ref.productKey, ref.productSourceId, c.id);
  }
  return c.id;
}

function upsertTvProduct(
  db: DB,
  ref: ProductRef,
  machineId: number | null,
  perMachine: boolean,
  source: ImportSource,
  fetchedAt: string,
  price?: number | null,
  category?: string | null,
): number {
  const existingId = findTvProduct(db, ref, machineId, perMachine);
  if (existingId) {
    db.prepare(
      'UPDATE tv_products SET last_seen_at = ?, name = ?, last_price = COALESCE(?, last_price), category_raw = COALESCE(?, category_raw) WHERE id = ?',
    ).run(fetchedAt, ref.productName, price ?? null, category ?? null, existingId);
    return existingId;
  }
  const r = db
    .prepare(
      `INSERT INTO tv_products (ext_key, source_id, name, machine_id, last_price, first_seen_at, last_seen_at, source, category_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ref.productKey, ref.productSourceId, ref.productName, perMachine ? machineId : null, price ?? null, fetchedAt, fetchedAt, source, category ?? null);
  return Number(r.lastInsertRowid);
}

/**
 * Ključ za prepoznavanje duplikata. Ako izvor ima ID transakcije, koristi se on.
 * Inače: hash sadržaja + redni broj pojavljivanja istog sadržaja unutar izvještaja,
 * kako se dvije stvarne, jednake prodaje u istoj sekundi ne bi spojile u jednu.
 */
export function salesDedupeKey(rec: SalesRecord, occurrence: number): string {
  if (rec.transactionId) return `id:${rec.transactionId}`;
  // Status (storno) namjerno nije dio ključa: isti redak koji kasnije postane storniran prepoznaje se kao ispravak.
  const base = [rec.machineKey ?? '', rec.productKey, rec.soldAtUtc, rec.quantity, rec.amount ?? ''].join('|');
  return `h:${sha256(base).slice(0, 40)}#${occurrence}`;
}

export function refillDedupeKey(rec: RefillRecord, occurrence: number): string {
  if (rec.refillId) return `id:${rec.refillId}`;
  const base = [rec.machineKey ?? '', rec.productKey, rec.refilledAtUtc, rec.quantity].join('|');
  return `h:${sha256(base).slice(0, 40)}#${occurrence}`;
}

function createBatch(db: DB, dataset: Dataset, meta: ImportMeta, status: 'committed' | 'rejected' | 'failed', fields: Partial<Record<string, unknown>>): number {
  const r = db
    .prepare(
      `INSERT INTO import_batches (sync_run_id, dataset, source, file_name, file_sha256, period_from, period_to,
         rows_total, rows_inserted, rows_updated, rows_duplicate, rows_rejected, status, error_message, rejected_rows, fetched_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      meta.syncRunId,
      dataset,
      meta.source,
      meta.fileName,
      meta.fileBuffer ? sha256(meta.fileBuffer) : null,
      meta.period?.from ?? null,
      meta.period?.to ?? null,
      fields.rowsTotal ?? 0,
      fields.inserted ?? 0,
      fields.updated ?? 0,
      fields.duplicate ?? 0,
      fields.rejected ?? 0,
      status,
      (fields.message as string | null) ?? null,
      fields.rejectedRows ? JSON.stringify(fields.rejectedRows) : null,
      meta.fetchedAt,
      meta.userId,
    );
  return Number(r.lastInsertRowid);
}

/**
 * Uvoz jednog izvještaja. Cijeli uvoz je jedna transakcija: ili se zapiše sve, ili ništa.
 * Izvještaj se odbija (status „rejected”) ako nedostaju stupci ili je previše neispravnih redaka –
 * tako djelomični/oštećeni izvještaj ne može pokvariti evidenciju.
 */
export function importDataset(db: DB, dataset: Dataset, rows: Cell[][], cfg: DatasetConfig, meta: ImportMeta): ImportSummary {
  const mapped = mapRows(dataset, rows, cfg) as MappingResult<DatasetRecord[Dataset]>;
  const rejectedRows = mapped.rejected.slice(0, 50).map((r) => ({ rowNo: r.rowNo, reason: r.reason }));
  const base = {
    dataset,
    rowsTotal: mapped.totalRows,
    missingColumns: mapped.missingColumns,
    rejectedRows,
    changedSalesIds: [] as number[],
  };
  if (mapped.missingColumns.length) {
    const message = `Izvještaj nema očekivane stupce: ${mapped.missingColumns.join(', ')}. Pronađeni stupci: ${mapped.headers.filter(Boolean).join(', ') || '—'}.`;
    const batchId = createBatch(db, dataset, meta, 'rejected', { rowsTotal: mapped.totalRows, message });
    return { ...base, batchId, status: 'rejected', inserted: 0, updated: 0, duplicate: 0, rejected: mapped.rejected.length, message };
  }
  const rejectedPct = mapped.totalRows ? (mapped.rejected.length / mapped.totalRows) * 100 : 0;
  if (mapped.totalRows > 0 && rejectedPct > cfg.maxRejectedPercent) {
    const message = `Izvještaj je odbijen kao nepotpun ili neispravan: ${mapped.rejected.length} od ${mapped.totalRows} redaka (${rejectedPct.toFixed(1)} %) nije moguće pročitati (dopušteno ${cfg.maxRejectedPercent} %).`;
    const batchId = createBatch(db, dataset, meta, 'rejected', {
      rowsTotal: mapped.totalRows,
      rejected: mapped.rejected.length,
      message,
      rejectedRows,
    });
    return { ...base, batchId, status: 'rejected', inserted: 0, updated: 0, duplicate: 0, rejected: mapped.rejected.length, message };
  }

  return db.transaction((): ImportSummary => {
    const batchId = createBatch(db, dataset, meta, 'committed', { rowsTotal: mapped.totalRows, rejected: mapped.rejected.length, rejectedRows });
    let inserted = 0;
    let updated = 0;
    let duplicate = 0;
    const changedSalesIds: number[] = [];
    const fetchedAt = meta.fetchedAt;

    if (dataset === 'machines') {
      for (const { record, raw } of mapped.records as { record: DatasetRecord['machines']; raw: Record<string, Cell> }[]) {
        const existed = findMachine(db, { machineKey: record.machineKey, machineName: record.name, machineSourceId: record.sourceId }) !== null;
        upsertMachine(db, { machineKey: record.machineKey, machineName: record.name, machineSourceId: record.sourceId }, meta.source, fetchedAt, {
          location: record.location,
          serialNo: record.serialNo,
          raw: serializeRaw(raw),
        });
        if (existed) updated++;
        else inserted++;
      }
    } else if (dataset === 'products') {
      for (const { record } of mapped.records as { record: DatasetRecord['products'] }[]) {
        const machineId = upsertMachine(db, record, meta.source, fetchedAt);
        const existed = findTvProduct(db, record, machineId, cfg.productsPerMachine) !== null;
        upsertTvProduct(db, record, machineId, cfg.productsPerMachine, meta.source, fetchedAt, record.price, record.category);
        if (existed) updated++;
        else inserted++;
      }
    } else if (dataset === 'sales') {
      const occurrences = new Map<string, number>();
      const getByKey = db.prepare('SELECT * FROM sales_transactions WHERE dedupe_key = ?');
      const ins = db.prepare(
        `INSERT INTO sales_transactions (dedupe_key, source_txn_id, machine_id, tv_product_id, machine_name_raw, product_name_raw,
           quantity, unit_price, amount, payment_method, sold_at_utc, sold_date_local, sold_month_local, status, source,
           import_batch_id, fetched_at, source_ref, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { record, raw, rowNo } of mapped.records as { record: SalesRecord; raw: Record<string, Cell>; rowNo: number }[]) {
        const contentKey = salesDedupeKey(record, 0);
        const occ = (occurrences.get(contentKey) ?? 0) + 1;
        occurrences.set(contentKey, occ);
        const key = record.transactionId ? contentKey : salesDedupeKey(record, occ);
        if (record.transactionId && occ > 1) {
          duplicate++; // isti ID transakcije dvaput u istom izvještaju
          continue;
        }
        const machineId = upsertMachine(db, record, meta.source, fetchedAt);
        const tvProductId = upsertTvProduct(db, record, machineId, cfg.productsPerMachine, meta.source, fetchedAt, record.unitPrice);
        const status = record.cancelled ? 'cancelled' : 'valid';
        const existing = getByKey.get(key) as Record<string, unknown> | undefined;
        if (!existing) {
          const r = ins.run(
            key,
            record.transactionId,
            machineId,
            tvProductId,
            record.machineName,
            record.productName,
            record.quantity,
            record.unitPrice,
            record.amount,
            record.paymentMethod,
            record.soldAtUtc,
            localDateOf(record.soldAtUtc),
            localMonthOf(record.soldAtUtc),
            status,
            meta.source,
            batchId,
            fetchedAt,
            `${meta.fileName ?? 'tablica'}#${rowNo}`,
            serializeRaw(raw),
          );
          changedSalesIds.push(Number(r.lastInsertRowid));
          inserted++;
          continue;
        }
        // Postojeći zapis: ako izvor ima ID transakcije, promjena vrijednosti = ispravak ili storno
        const after = {
          machine_id: machineId,
          tv_product_id: tvProductId,
          quantity: record.quantity,
          unit_price: record.unitPrice,
          amount: record.amount,
          sold_at_utc: record.soldAtUtc,
          status,
        };
        const before = {
          machine_id: existing.machine_id,
          tv_product_id: existing.tv_product_id,
          quantity: existing.quantity,
          unit_price: existing.unit_price,
          amount: existing.amount,
          sold_at_utc: existing.sold_at_utc,
          status: existing.status,
        };
        if (JSON.stringify(before) === JSON.stringify(after)) {
          duplicate++;
          continue;
        }
        const revision = Number(existing.revision) + 1;
        db.prepare(
          `INSERT INTO sales_transaction_revisions (transaction_id, revision, import_batch_id, before, after) VALUES (?, ?, ?, ?, ?)`,
        ).run(existing.id, revision, batchId, JSON.stringify(before), JSON.stringify(after));
        db.prepare(
          `UPDATE sales_transactions SET machine_id = ?, tv_product_id = ?, quantity = ?, unit_price = ?, amount = ?, sold_at_utc = ?,
             sold_date_local = ?, sold_month_local = ?, status = ?, revision = ?, import_batch_id = ?, fetched_at = ?, raw = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          machineId,
          tvProductId,
          record.quantity,
          record.unitPrice,
          record.amount,
          record.soldAtUtc,
          localDateOf(record.soldAtUtc),
          localMonthOf(record.soldAtUtc),
          status,
          revision,
          batchId,
          fetchedAt,
          serializeRaw(raw),
          nowIso(),
          existing.id,
        );
        changedSalesIds.push(Number(existing.id));
        updated++;
      }
    } else if (dataset === 'machine_stock') {
      const ins = db.prepare(
        `INSERT INTO tv_machine_stock (machine_id, tv_product_id, quantity, capacity, measured_at_utc, fetched_at, import_batch_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { record } of mapped.records as { record: DatasetRecord['machine_stock'] }[]) {
        const machineId = upsertMachine(db, record, meta.source, fetchedAt)!;
        const tvProductId = upsertTvProduct(db, record, machineId, cfg.productsPerMachine, meta.source, fetchedAt);
        ins.run(machineId, tvProductId, record.quantity, record.capacity, record.measuredAtUtc, fetchedAt, batchId, meta.source);
        inserted++;
      }
    } else if (dataset === 'refills') {
      const occurrences = new Map<string, number>();
      const ins = db.prepare(
        `INSERT OR IGNORE INTO tv_refills (dedupe_key, source_refill_id, machine_id, tv_product_id, quantity, refilled_at_utc, fetched_at, import_batch_id, source, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { record, raw } of mapped.records as { record: RefillRecord; raw: Record<string, Cell> }[]) {
        const contentKey = refillDedupeKey(record, 0);
        const occ = (occurrences.get(contentKey) ?? 0) + 1;
        occurrences.set(contentKey, occ);
        const key = record.refillId ? contentKey : refillDedupeKey(record, occ);
        const machineId = upsertMachine(db, record, meta.source, fetchedAt)!;
        const tvProductId = upsertTvProduct(db, record, machineId, cfg.productsPerMachine, meta.source, fetchedAt);
        const r = ins.run(key, record.refillId, machineId, tvProductId, record.quantity, record.refilledAtUtc, fetchedAt, batchId, meta.source, serializeRaw(raw));
        if (r.changes) inserted++;
        else duplicate++;
      }
    }
    db.prepare('UPDATE import_batches SET rows_inserted = ?, rows_updated = ?, rows_duplicate = ? WHERE id = ?').run(
      inserted,
      updated,
      duplicate,
      batchId,
    );
    return {
      ...base,
      batchId,
      status: 'committed',
      inserted,
      updated,
      duplicate,
      rejected: mapped.rejected.length,
      message: null,
      changedSalesIds,
    };
  })();
}

export function listImportBatches(db: DB, limit = 200) {
  return db
    .prepare(
      `SELECT b.*, COALESCE(NULLIF(u.full_name, ''), u.username) AS created_by_name
       FROM import_batches b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC LIMIT ?`,
    )
    .all(limit);
}
