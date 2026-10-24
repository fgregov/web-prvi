import { parseLocaleNumber, roundMoney, roundPrice, roundQty } from '../lib/num.js';
import { parseSourceDateTime } from '../lib/time.js';
import { DATASET_FIELDS, type Dataset, type DatasetConfig } from './config.js';
import type { Cell } from './parse.js';

export const normHeader = (s: unknown) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function machineKeyOf(sourceId: string | null, name: string | null): string | null {
  if (sourceId) return `id:${sourceId.trim()}`;
  if (name) return `name:${normName(name)}`;
  return null;
}

export function productKeyOf(sourceId: string | null, name: string, machineKey: string | null, perMachine: boolean): string {
  const base = sourceId ? `id:${sourceId.trim()}` : `name:${normName(name)}`;
  return perMachine && machineKey ? `${base}@${machineKey}` : base;
}

export interface RejectedRow {
  rowNo: number;
  reason: string;
  raw: Record<string, Cell>;
}

export interface MappedRow<T> {
  rowNo: number;
  record: T;
  raw: Record<string, Cell>;
}

export interface MappingResult<T> {
  headerRowIndex: number;
  headers: string[];
  missingColumns: string[];
  records: MappedRow<T>[];
  rejected: RejectedRow[];
  totalRows: number;
}

export interface MachineRef {
  machineSourceId: string | null;
  machineName: string | null;
  machineKey: string | null;
}
export interface ProductRef {
  productSourceId: string | null;
  productName: string;
  productKey: string;
}

export interface SalesRecord extends MachineRef, ProductRef {
  transactionId: string | null;
  soldAtUtc: string;
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
  paymentMethod: string | null;
  cancelled: boolean;
}
export interface MachineRecord {
  sourceId: string | null;
  name: string;
  location: string | null;
  serialNo: string | null;
  machineKey: string;
}
export interface ProductRecord extends MachineRef, ProductRef {
  price: number | null;
  category: string | null;
}
export interface StockRecord extends MachineRef, ProductRef {
  quantity: number;
  capacity: number | null;
  measuredAtUtc: string | null;
}
export interface RefillRecord extends MachineRef, ProductRef {
  refillId: string | null;
  refilledAtUtc: string;
  quantity: number;
}

export type DatasetRecord = {
  machines: MachineRecord;
  products: ProductRecord;
  sales: SalesRecord;
  machine_stock: StockRecord;
  refills: RefillRecord;
};

export function findHeaderRow(rows: Cell[][], columns: Record<string, string>, headerRow: number | null): number {
  if (headerRow) return Math.min(headerRow - 1, Math.max(rows.length - 1, 0));
  const mapped = Object.values(columns).filter(Boolean).map(normHeader);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const set = new Set(rows[i].map(normHeader));
    const nonEmpty = rows[i].filter((c) => c !== null && String(c).trim() !== '').length;
    const score = mapped.length ? mapped.filter((m) => set.has(m)).length : nonEmpty >= 2 ? 1 : 0;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best < 0 ? 0 : best;
}

function cellText(c: Cell | undefined): string | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return c.toISOString();
  const s = String(c).trim();
  return s === '' ? null : s;
}

/**
 * Pretvara retke izvještaja u zapise prema mapiranju stupaca. Ne pretpostavlja nazive stupaca –
 * mapiranje zadaje korisnik na temelju stvarnog izvještaja s portala.
 */
export function mapRows<D extends Dataset>(dataset: D, rows: Cell[][], cfg: DatasetConfig): MappingResult<DatasetRecord[D]> {
  const fields = DATASET_FIELDS[dataset];
  const headerRowIndex = findHeaderRow(rows, cfg.columns, cfg.headerRow);
  const headers = (rows[headerRowIndex] ?? []).map((h) => (h === null ? '' : String(h).trim()));
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = normHeader(h);
    if (k && !index.has(k)) index.set(k, i);
  });
  const colOf = (field: string): number | null => {
    const src = cfg.columns[field];
    if (!src) return null;
    const i = index.get(normHeader(src));
    return i === undefined ? null : i;
  };
  const missingColumns: string[] = [];
  for (const f of fields) {
    if (cfg.columns[f.key] && colOf(f.key) === null) missingColumns.push(`${f.label} („${cfg.columns[f.key]}”)`);
    else if (f.required && !cfg.columns[f.key]) missingColumns.push(`${f.label} (nije mapirano)`);
  }
  if (dataset === 'sales' && !cfg.columns.soldAt && !cfg.columns.soldDate) {
    missingColumns.push('Datum i vrijeme prodaje (nije mapirano)');
  }
  const records: MappedRow<DatasetRecord[D]>[] = [];
  const rejected: RejectedRow[] = [];
  const dataRows = rows.slice(headerRowIndex + 1);
  if (missingColumns.length) {
    return { headerRowIndex, headers, missingColumns, records, rejected, totalRows: dataRows.length };
  }
  const get = (row: Cell[], field: string): Cell => {
    const i = colOf(field);
    return i === null ? null : (row[i] ?? null);
  };
  const num = (row: Cell[], field: string) => parseLocaleNumber(get(row, field), cfg.decimalSeparator);
  const cancelledSet = new Set(cfg.cancelledValues.map(normName));

  dataRows.forEach((row, idx) => {
    const rowNo = headerRowIndex + idx + 2; // 1-based broj retka u datoteci
    const raw: Record<string, Cell> = {};
    headers.forEach((h, i) => {
      if (h) raw[h] = row[i] ?? null;
    });
    // Preskoči retke sažetka (npr. „Ukupno”) i prazne retke
    const firstText = cellText(row.find((c) => cellText(c) !== null) ?? null);
    if (!firstText) return;
    if (/^(ukupno|total|sum|zbroj)\b/i.test(firstText)) return;
    try {
      const machineSourceId = cellText(get(row, 'machineId'));
      const machineName = cellText(get(row, 'machineName'));
      const machineKey = machineKeyOf(machineSourceId, machineName);
      const mref: MachineRef = { machineSourceId, machineName, machineKey };
      const pref = (): ProductRef => {
        const productSourceId = cellText(get(row, 'productId'));
        const productName = cellText(get(row, 'productName'));
        if (!productName) throw new Error('nedostaje naziv artikla');
        return { productSourceId, productName, productKey: productKeyOf(productSourceId, productName, machineKey, cfg.productsPerMachine) };
      };
      let rec: unknown;
      if (dataset === 'machines') {
        if (!machineName) throw new Error('nedostaje naziv automata');
        rec = {
          sourceId: machineSourceId,
          name: machineName,
          location: cellText(get(row, 'location')),
          serialNo: cellText(get(row, 'serialNo')),
          machineKey: machineKey!,
        } satisfies MachineRecord;
      } else if (dataset === 'products') {
        rec = { ...mref, ...pref(), price: num(row, 'price'), category: cellText(get(row, 'category')) } satisfies ProductRecord;
      } else if (dataset === 'sales') {
        let soldAtUtc: string | null = null;
        if (cfg.columns.soldAt) soldAtUtc = parseSourceDateTime(get(row, 'soldAt'), cfg.dateFormat);
        else {
          const d = get(row, 'soldDate');
          const t = get(row, 'soldTime');
          if (d instanceof Date && !cfg.columns.soldTime) soldAtUtc = parseSourceDateTime(d, null);
          else {
            const ds = d instanceof Date ? d.toISOString().slice(0, 10) : cellText(d);
            const ts = t instanceof Date ? t.toISOString().slice(11, 19) : cellText(t);
            soldAtUtc = parseSourceDateTime(ts ? `${ds} ${ts}` : ds, cfg.dateFormat);
          }
        }
        if (!soldAtUtc) throw new Error('neispravan ili prazan datum prodaje');
        const quantity = cfg.columns.quantity ? num(row, 'quantity') : 1;
        if (quantity === null || quantity === 0) throw new Error('neispravna količina');
        let unitPrice = num(row, 'unitPrice');
        let amount = num(row, 'amount');
        if (amount === null && unitPrice !== null) amount = roundMoney(unitPrice * quantity);
        if (unitPrice === null && amount !== null && quantity) unitPrice = roundPrice(amount / quantity);
        const statusText = cellText(get(row, 'status'));
        rec = {
          ...mref,
          ...pref(),
          transactionId: cellText(get(row, 'transactionId')),
          soldAtUtc,
          quantity: roundQty(quantity),
          unitPrice,
          amount: amount === null ? null : roundMoney(amount),
          paymentMethod: cellText(get(row, 'paymentMethod')),
          cancelled: statusText ? cancelledSet.has(normName(statusText)) : false,
        } satisfies SalesRecord;
      } else if (dataset === 'machine_stock') {
        if (!machineKey) throw new Error('nedostaje automat');
        const quantity = num(row, 'quantity');
        if (quantity === null) throw new Error('neispravna količina');
        const measured = get(row, 'measuredAt');
        rec = {
          ...mref,
          ...pref(),
          quantity: roundQty(quantity),
          capacity: num(row, 'capacity'),
          measuredAtUtc: measured === null ? null : parseSourceDateTime(measured, cfg.dateFormat),
        } satisfies StockRecord;
      } else {
        if (!machineKey) throw new Error('nedostaje automat');
        const quantity = num(row, 'quantity');
        if (quantity === null || quantity <= 0) throw new Error('neispravna količina');
        const refilledAtUtc = parseSourceDateTime(get(row, 'refilledAt'), cfg.dateFormat);
        if (!refilledAtUtc) throw new Error('neispravan datum dopune');
        rec = { ...mref, ...pref(), refillId: cellText(get(row, 'refillId')), refilledAtUtc, quantity: roundQty(quantity) } satisfies RefillRecord;
      }
      records.push({ rowNo, record: rec as DatasetRecord[D], raw });
    } catch (e) {
      rejected.push({ rowNo, reason: (e as Error).message, raw });
    }
  });
  return { headerRowIndex, headers, missingColumns, records, rejected, totalRows: records.length + rejected.length };
}

/** Pretvara pročitanu HTML tablicu u isti oblik kao CSV. */
export function tableToCells(rows: string[][]): Cell[][] {
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}
