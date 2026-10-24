import { z } from 'zod';
import type { DB } from '../db/index.js';
import { getSetting, setSetting } from '../modules/settings/store.js';

export const TELEVEND_SECRET_PASSWORD = 'televend.password';
export const TELEVEND_SECRET_SESSION = 'televend.session';

export const DATASETS = ['machines', 'products', 'sales', 'machine_stock', 'refills'] as const;
export type Dataset = (typeof DATASETS)[number];

export const DATASET_LABEL: Record<Dataset, string> = {
  machines: 'Lista samoposlužnih automata',
  products: 'Lista artikala',
  sales: 'Prodaja (količine, datum i vrijeme, prihod, automat)',
  machine_stock: 'Stanja artikala u automatima',
  refills: 'Evidencija dopunjavanja automata',
};

/** Ciljna polja po skupu podataka. `required` polja moraju biti mapirana na stupac izvještaja. */
export const DATASET_FIELDS: Record<Dataset, { key: string; label: string; required?: boolean; kind: 'text' | 'number' | 'datetime' | 'date' | 'time' }[]> = {
  machines: [
    { key: 'machineId', label: 'ID automata', kind: 'text' },
    { key: 'machineName', label: 'Naziv automata', required: true, kind: 'text' },
    { key: 'location', label: 'Lokacija / adresa', kind: 'text' },
    { key: 'serialNo', label: 'Serijski broj', kind: 'text' },
  ],
  products: [
    { key: 'productId', label: 'ID artikla', kind: 'text' },
    { key: 'productName', label: 'Naziv artikla', required: true, kind: 'text' },
    { key: 'machineName', label: 'Automat', kind: 'text' },
    { key: 'price', label: 'Cijena', kind: 'number' },
    { key: 'category', label: 'Kategorija', kind: 'text' },
  ],
  sales: [
    { key: 'transactionId', label: 'ID transakcije', kind: 'text' },
    { key: 'soldAt', label: 'Datum i vrijeme prodaje', kind: 'datetime' },
    { key: 'soldDate', label: 'Datum prodaje (zaseban stupac)', kind: 'date' },
    { key: 'soldTime', label: 'Vrijeme prodaje (zaseban stupac)', kind: 'time' },
    { key: 'machineId', label: 'ID automata', kind: 'text' },
    { key: 'machineName', label: 'Naziv automata', kind: 'text' },
    { key: 'productId', label: 'ID artikla', kind: 'text' },
    { key: 'productName', label: 'Naziv artikla', required: true, kind: 'text' },
    { key: 'quantity', label: 'Količina', kind: 'number' },
    { key: 'unitPrice', label: 'Jedinična cijena', kind: 'number' },
    { key: 'amount', label: 'Iznos / prihod', kind: 'number' },
    { key: 'paymentMethod', label: 'Način plaćanja', kind: 'text' },
    { key: 'status', label: 'Status (storno/poništeno)', kind: 'text' },
  ],
  machine_stock: [
    { key: 'machineId', label: 'ID automata', kind: 'text' },
    { key: 'machineName', label: 'Naziv automata', kind: 'text' },
    { key: 'productId', label: 'ID artikla', kind: 'text' },
    { key: 'productName', label: 'Naziv artikla', required: true, kind: 'text' },
    { key: 'quantity', label: 'Količina u automatu', required: true, kind: 'number' },
    { key: 'capacity', label: 'Kapacitet', kind: 'number' },
    { key: 'measuredAt', label: 'Vrijeme stanja', kind: 'datetime' },
  ],
  refills: [
    { key: 'refillId', label: 'ID dopune', kind: 'text' },
    { key: 'refilledAt', label: 'Datum i vrijeme dopune', required: true, kind: 'datetime' },
    { key: 'machineId', label: 'ID automata', kind: 'text' },
    { key: 'machineName', label: 'Naziv automata', kind: 'text' },
    { key: 'productId', label: 'ID artikla', kind: 'text' },
    { key: 'productName', label: 'Naziv artikla', required: true, kind: 'text' },
    { key: 'quantity', label: 'Dopunjena količina', required: true, kind: 'number' },
  ],
};

const zSelectorOrText = z.object({
  by: z.enum(['text', 'selector']),
  value: z.string().trim().min(1).max(300),
});

const zFill = z.object({
  selector: z.string().trim().min(1).max(300),
  /** Podržani predlošci: {from:FORMAT} i {to:FORMAT}, npr. {from:dd.MM.yyyy} */
  value: z.string().max(200),
});

export const datasetConfigSchema = z.object({
  enabled: z.boolean(),
  method: z.enum(['export', 'table']),
  /** Putanja ili puni URL stranice na portalu; dopušteni predlošci {from:FORMAT}/{to:FORMAT}. */
  pageUrl: z.string().trim().max(1000),
  /** Polja koja treba popuniti prije izvoza (npr. razdoblje). */
  fills: z.array(zFill).max(10),
  /** Gumb/poveznica koja se klikne nakon popunjavanja (npr. „Prikaži”). */
  applyTrigger: zSelectorOrText.nullable(),
  /** Gumb/poveznica za izvoz (CSV/XLSX). */
  exportTrigger: zSelectorOrText.nullable(),
  /** Selektor tablice (za metodu „table”). */
  tableSelector: z.string().trim().max(300).nullable(),
  /** Selektor gumba „sljedeća stranica” za tablice s paginacijom. */
  nextPageSelector: z.string().trim().max(300).nullable(),
  maxPages: z.number().int().min(1).max(200),
  /** Mapiranje: ciljno polje → naziv stupca u izvještaju. */
  columns: z.record(z.string(), z.string().trim().max(200)),
  headerRow: z.number().int().min(1).max(50).nullable(),
  dateFormat: z.string().trim().max(60).nullable(),
  decimalSeparator: z.enum([',', '.', 'auto']),
  /** Vrijednosti stupca „status” koje znače storno/poništenje. */
  cancelledValues: z.array(z.string().trim().max(60)).max(20),
  /** Prag odbijenih redaka (%) iznad kojeg se cijeli izvještaj smatra nepotpunim i ne uvozi. */
  maxRejectedPercent: z.number().min(0).max(100),
  /** Artikli su specifični po automatu (isti naziv u dva automata = dva Televend artikla). */
  productsPerMachine: z.boolean(),
});
export type DatasetConfig = z.infer<typeof datasetConfigSchema>;

export const defaultDatasetConfig = (): DatasetConfig => ({
  enabled: false,
  method: 'export',
  pageUrl: '',
  fills: [],
  applyTrigger: null,
  exportTrigger: null,
  tableSelector: null,
  nextPageSelector: null,
  maxPages: 20,
  columns: {},
  headerRow: null,
  dateFormat: null,
  decimalSeparator: 'auto',
  cancelledValues: ['storno', 'stornirano', 'poništeno', 'ponisteno', 'cancelled', 'canceled', 'refunded'],
  maxRejectedPercent: 5,
  productsPerMachine: false,
});

export const loginSelectorsSchema = z.object({
  username: z.string().trim().max(300).nullable(),
  password: z.string().trim().max(300).nullable(),
  submit: z.string().trim().max(300).nullable(),
  /** Element koji postoji samo kad je korisnik prijavljen (npr. poveznica za odjavu). */
  loggedInIndicator: z.string().trim().max(300).nullable(),
});

export const connectorConfigSchema = z.object({
  portalUrl: z.string().trim().max(500),
  username: z.string().trim().max(200),
  autoSync: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(1440),
  /** Preklapanje razdoblja prodaje kod svake sinkronizacije (dani) – duplikati se prepoznaju i preskaču. */
  salesOverlapDays: z.number().int().min(0).max(31),
  /** Razdoblje koje se preuzima kod prve sinkronizacije prodaje (dani). */
  initialSalesDays: z.number().int().min(1).max(366),
  navigationTimeoutSeconds: z.number().int().min(10).max(180),
  loginSelectors: loginSelectorsSchema,
  datasets: z.object({
    machines: datasetConfigSchema,
    products: datasetConfigSchema,
    sales: datasetConfigSchema,
    machine_stock: datasetConfigSchema,
    refills: datasetConfigSchema,
  }),
});
export type ConnectorConfig = z.infer<typeof connectorConfigSchema>;

export const DEFAULT_CONNECTOR_CONFIG: ConnectorConfig = {
  portalUrl: '',
  username: '',
  autoSync: false,
  intervalMinutes: 15,
  salesOverlapDays: 2,
  initialSalesDays: 30,
  navigationTimeoutSeconds: 45,
  loginSelectors: { username: null, password: null, submit: null, loggedInIndicator: null },
  datasets: {
    machines: defaultDatasetConfig(),
    products: defaultDatasetConfig(),
    sales: defaultDatasetConfig(),
    machine_stock: defaultDatasetConfig(),
    refills: defaultDatasetConfig(),
  },
};

export type ConnectionState =
  | 'not_configured'
  | 'configured'
  | 'connected'
  | 'auth_failed'
  | 'mfa_required'
  | 'captcha_required'
  | 'form_not_found'
  | 'error'
  | 'disconnected';

export interface ConnectorStatus {
  state: ConnectionState;
  message: string | null;
  lastLoginAt: string | null;
  lastLoginOk: boolean | null;
  lastSyncAt: string | null;
  lastSyncOkAt: string | null;
  lastSyncDurationMs: number | null;
  lastSyncRecords: number | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  consecutiveAuthFailures: number;
  autoSyncSuspended: boolean;
  suspendedReason: string | null;
  lastAttemptAt: string | null;
  salesSyncedThrough: string | null;
}

export const DEFAULT_STATUS: ConnectorStatus = {
  state: 'not_configured',
  message: null,
  lastLoginAt: null,
  lastLoginOk: null,
  lastSyncAt: null,
  lastSyncOkAt: null,
  lastSyncDurationMs: null,
  lastSyncRecords: null,
  lastSyncStatus: null,
  lastError: null,
  consecutiveAuthFailures: 0,
  autoSyncSuspended: false,
  suspendedReason: null,
  lastAttemptAt: null,
  salesSyncedThrough: null,
};

export function getConnectorConfig(db: DB): ConnectorConfig {
  const stored = getSetting<Partial<ConnectorConfig>>(db, 'televend.config', {});
  return {
    ...DEFAULT_CONNECTOR_CONFIG,
    ...stored,
    loginSelectors: { ...DEFAULT_CONNECTOR_CONFIG.loginSelectors, ...(stored.loginSelectors ?? {}) },
    datasets: Object.fromEntries(
      DATASETS.map((d) => [d, { ...defaultDatasetConfig(), ...(stored.datasets?.[d] ?? {}) }]),
    ) as ConnectorConfig['datasets'],
  };
}

export const saveConnectorConfig = (db: DB, cfg: ConnectorConfig) => setSetting(db, 'televend.config', cfg);
export const getConnectorStatus = (db: DB): ConnectorStatus => getSetting(db, 'televend.status', DEFAULT_STATUS);
export function patchConnectorStatus(db: DB, patch: Partial<ConnectorStatus>): ConnectorStatus {
  const next = { ...getConnectorStatus(db), ...patch };
  setSetting(db, 'televend.status', next);
  return next;
}
