import { describe, expect, it } from 'vitest';
import { defaultDatasetConfig, type DatasetConfig } from '../src/televend/config.js';
import { importDataset, type ImportMeta } from '../src/televend/importers.js';
import { parseCsvBuffer, parseReportFile } from '../src/televend/parse.js';
import { postSalesToMachineStock } from '../src/televend/salesPosting.js';
import { centralLocationId } from '../src/modules/inventory/ledger.js';
import { createReceipt, createTransfer } from '../src/modules/inventory/operations.js';
import { linkTelevendProduct } from '../src/modules/catalog/service.js';
import { setSetting } from '../src/modules/settings/store.js';
import { DEFAULT_AUTOMATION } from '../src/modules/automation/service.js';
import { byCategory, byMachine, comparePeriods, leastSold, summary, timeseries, topProducts, transactionsList } from '../src/modules/sales/analytics.js';
import { saveCategory, updateProduct } from '../src/modules/catalog/service.js';
import { buildXlsx } from '../src/lib/export/xlsx.js';
import { ACTOR, balance, makeContext, product } from './helpers.js';
import type { AppContext } from '../src/context.js';

/** Testni izvještaj – struktura stupaca je IZMIŠLJENA za test i ne predstavlja stvarni Televend izvoz. */
const cfg = (over: Partial<DatasetConfig> = {}): DatasetConfig => ({
  ...defaultDatasetConfig(),
  enabled: true,
  columns: {
    transactionId: 'Txn',
    soldAt: 'Vrijeme',
    machineName: 'Automat',
    productName: 'Artikl',
    quantity: 'Kol',
    amount: 'Iznos',
    status: 'Status',
  },
  ...over,
});

const meta = (fileName = 'test.csv'): ImportMeta => ({
  source: 'manual_upload',
  fileName,
  fileBuffer: Buffer.from(fileName),
  period: null,
  syncRunId: null,
  userId: null,
  fetchedAt: new Date().toISOString(),
});

function csv(rows: string[]): Buffer {
  return Buffer.from(['Txn;Vrijeme;Automat;Artikl;Kol;Iznos;Status', ...rows].join('\n'), 'utf8');
}

function importCsv(ctx: AppContext, buf: Buffer, c = cfg()) {
  return importDataset(ctx.db, 'sales', parseCsvBuffer(buf).rows, c, meta());
}

const count = (ctx: AppContext) => (ctx.db.prepare('SELECT COUNT(*) AS n FROM sales_transactions').get() as { n: number }).n;

describe('Uvoz ponovljenih Televend transakcija (deduplikacija)', () => {
  it('isti izvještaj uvezen dvaput ne stvara duplikate (ID transakcije)', async () => {
    const ctx = await makeContext();
    const buf = csv(['T1;24.10.2026 08:15:00;Automat A;Coca-Cola 0,5;1;2,50;OK', 'T2;24.10.2026 09:00:10;Automat A;Voda 0,5;2;3,00;OK']);
    const a = importCsv(ctx, buf);
    const b = importCsv(ctx, buf);
    expect(a).toMatchObject({ status: 'committed', inserted: 2, duplicate: 0 });
    expect(b).toMatchObject({ status: 'committed', inserted: 0, duplicate: 2 });
    expect(count(ctx)).toBe(2);
  });

  it('preklapajuća razdoblja bez ID-a: dvije stvarne jednake prodaje ostaju dvije, ponovni uvoz ne dodaje nove', async () => {
    const ctx = await makeContext();
    const c = cfg({ columns: { soldAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', quantity: 'Kol', amount: 'Iznos' } });
    const day1 = ['x;23.10.2026 10:00:00;Automat A;Kava;1;1,20;', 'x;23.10.2026 10:00:00;Automat A;Kava;1;1,20;'];
    const day2 = ['x;24.10.2026 11:30:00;Automat A;Kava;1;1,20;'];
    const r1 = importCsv(ctx, csv(day1), c);
    expect(r1.inserted).toBe(2); // dvije stvarne prodaje u istoj sekundi
    const r2 = importCsv(ctx, csv([...day1, ...day2]), c); // novo razdoblje s preklapanjem
    expect(r2).toMatchObject({ inserted: 1, duplicate: 2 });
    expect(count(ctx)).toBe(3);
  });

  it('storno u izvoru (status) ažurira postojeću transakciju i bilježi reviziju', async () => {
    const ctx = await makeContext();
    importCsv(ctx, csv(['T9;24.10.2026 12:00:00;Automat A;Sok;1;2,00;OK']));
    const r = importCsv(ctx, csv(['T9;24.10.2026 12:00:00;Automat A;Sok;1;2,00;storno']));
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const t = ctx.db.prepare("SELECT status, revision FROM sales_transactions WHERE source_txn_id = 'T9'").get();
    expect(t).toEqual({ status: 'cancelled', revision: 2 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sales_transaction_revisions').get()).toEqual({ n: 1 });
    const s = summary(ctx.db, { from: '2026-10-24', to: '2026-10-24' });
    expect(s.totalQty).toBe(0); // stornirana prodaja se ne broji
  });

  it('ispravak količine u izvoru (isti ID) mijenja zapis umjesto dodavanja novog', async () => {
    const ctx = await makeContext();
    importCsv(ctx, csv(['T5;24.10.2026 12:00:00;Automat A;Sok;1;2,00;OK']));
    importCsv(ctx, csv(['T5;24.10.2026 12:00:00;Automat A;Sok;2;4,00;OK']));
    expect(count(ctx)).toBe(1);
    expect(summary(ctx.db, { from: '2026-10-24', to: '2026-10-24' }).totalQty).toBe(2);
  });
});

describe('Kontrola nepotpunih izvještaja', () => {
  it('odbija izvještaj kojem nedostaje mapirani stupac – ništa se ne upisuje', async () => {
    const ctx = await makeContext();
    const buf = Buffer.from('Txn;Vrijeme;Automat;Kol\nT1;24.10.2026 08:00:00;A;1\n');
    const r = importCsv(ctx, buf);
    expect(r.status).toBe('rejected');
    expect(r.message).toMatch(/Naziv artikla/);
    expect(count(ctx)).toBe(0);
    expect(ctx.db.prepare("SELECT status FROM import_batches ORDER BY id DESC LIMIT 1").get()).toEqual({ status: 'rejected' });
  });

  it('odbija izvještaj s previše neispravnih redaka (oštećen/odrezan izvoz)', async () => {
    const ctx = await makeContext();
    const r = importCsv(ctx, csv(['T1;24.10.2026 08:00:00;A;Kava;1;1,20;OK', 'T2;nije-datum;A;Kava;1;1,20;OK', 'T3;;A;Kava;1;1,20;OK']));
    expect(r.status).toBe('rejected');
    expect(count(ctx)).toBe(0);
  });

  it('pojedinačni neispravan redak ispod praga se preskače i evidentira', async () => {
    const ctx = await makeContext();
    const rows = Array.from({ length: 40 }, (_, i) => `T${i};24.10.2026 08:${String(i).padStart(2, '0')}:00;A;Kava;1;1,20;OK`);
    rows.push('T99;krivi datum;A;Kava;1;1,20;OK');
    const r = importCsv(ctx, csv(rows));
    expect(r).toMatchObject({ status: 'committed', inserted: 40, rejected: 1 });
    expect(r.rejectedRows[0].reason).toMatch(/datum/);
  });

  it('preskače retke sažetka (Ukupno)', async () => {
    const ctx = await makeContext();
    const r = importCsv(ctx, csv(['T1;24.10.2026 08:00:00;A;Kava;1;1,20;OK', 'Ukupno;;;;1;1,20;']));
    expect(r).toMatchObject({ status: 'committed', inserted: 1, rejected: 0 });
  });
});

describe('Vremenska zona i formati', () => {
  it('lokalno vrijeme Europe/Zagreb pretvara se u UTC (zimsko/ljetno računanje)', async () => {
    const ctx = await makeContext();
    importCsv(ctx, csv(['S1;15.07.2026 10:00:00;A;Kava;1;1,20;OK', 'W1;15.12.2026 10:00:00;A;Kava;1;1,20;OK', 'N1;24.10.2026 00:30:00;A;Kava;1;1,20;OK']));
    const get = (id: string) => ctx.db.prepare('SELECT sold_at_utc, sold_date_local FROM sales_transactions WHERE source_txn_id = ?').get(id) as { sold_at_utc: string; sold_date_local: string };
    expect(get('S1').sold_at_utc).toBe('2026-07-15T08:00:00.000Z'); // CEST = UTC+2
    expect(get('W1').sold_at_utc).toBe('2026-12-15T09:00:00.000Z'); // CET = UTC+1
    // prodaja u 00:30 lokalno pripada 24.10., iako je u UTC još 23.10.
    expect(get('N1')).toEqual({ sold_at_utc: '2026-10-23T22:30:00.000Z', sold_date_local: '2026-10-24' });
  });

  it('vrijeme preuzimanja se ne koristi kao vrijeme prodaje; zapis nosi izvor i referencu', async () => {
    const ctx = await makeContext();
    importCsv(ctx, csv(['T1;01.10.2026 08:00:00;A;Kava;1;1,20;OK']));
    const t = ctx.db.prepare('SELECT sold_date_local, fetched_at, source, source_ref, raw FROM sales_transactions').get() as Record<string, string>;
    expect(t.sold_date_local).toBe('2026-10-01');
    expect(t.fetched_at.slice(0, 10)).not.toBe('2026-10-01');
    expect(t.source).toBe('manual_upload');
    expect(t.source_ref).toBe('test.csv#2');
    expect(JSON.parse(t.raw).Txn).toBe('T1');
  });

  it('CSV u Windows-1250 kodiranju s hrvatskim znakovima i decimalnim zarezom', async () => {
    const iconv = (await import('iconv-lite')).default;
    const text = 'Txn;Vrijeme;Automat;Artikl;Kol;Iznos;Status\nT1;24.10.2026 08:00:00;Čakovec Žitnjak;Čaj šipak;1;1.234,50;OK\n';
    const p = parseCsvBuffer(iconv.encode(text, 'win1250'));
    expect(p.encoding).toBe('windows-1250');
    expect(p.rows[1][3]).toBe('Čaj šipak');
    const ctx = await makeContext();
    const r = importDataset(ctx.db, 'sales', p.rows, cfg(), meta());
    expect(r.inserted).toBe(1);
    expect(ctx.db.prepare('SELECT amount, machine_name_raw FROM sales_transactions').get()).toEqual({ amount: 1234.5, machine_name_raw: 'Čakovec Žitnjak' });
  });

  it('XLSX izvoz s datumskim ćelijama', async () => {
    const buf = await buildXlsx([
      {
        name: 'Prodaja',
        columns: [
          { header: 'Txn', key: 'txn' },
          { header: 'Vrijeme', key: 'at', type: 'datetime' },
          { header: 'Automat', key: 'm' },
          { header: 'Artikl', key: 'p' },
          { header: 'Kol', key: 'q', type: 'number' },
          { header: 'Iznos', key: 'a', type: 'money' },
          { header: 'Status', key: 's' },
        ],
        rows: [{ txn: 'X1', at: '2026-10-24T06:15:00.000Z', m: 'A', p: 'Kava', q: 2, a: 2.4, s: 'OK' }],
      },
    ]);
    const parsed = await parseReportFile(buf, 'izvoz.xlsx');
    expect(parsed.format).toBe('xlsx');
    const ctx = await makeContext();
    const r = importDataset(ctx.db, 'sales', parsed.rows, cfg(), meta('izvoz.xlsx'));
    expect(r.inserted).toBe(1);
    // XLSX sadrži lokalno vrijeme 08:15 (Europe/Zagreb) → 06:15 UTC
    expect(ctx.db.prepare('SELECT sold_at_utc FROM sales_transactions').get()).toEqual({ sold_at_utc: '2026-10-24T06:15:00.000Z' });
  });

  it('odbija HTML stranicu poslanu umjesto izvoza', async () => {
    await expect(parseReportFile(Buffer.from('<!DOCTYPE html><html><body>Prijava</body></html>'), 'x.csv')).rejects.toThrow(/HTML/);
  });
});

describe('Sprječavanje dvostrukog skidanja zaliha (prodaja → automat)', () => {
  async function setup() {
    const ctx = await makeContext();
    const p = product(ctx, { name: 'Coca-Cola 0,5 L' });
    importCsv(ctx, csv(['T1;24.10.2026 08:00:00;Automat A;Coca-Cola 0,5;1;2,50;OK']));
    const tv = ctx.db.prepare('SELECT id FROM tv_products').get() as { id: number };
    linkTelevendProduct(ctx.db, tv.id, p, ACTOR);
    const machineLoc = (ctx.db.prepare('SELECT l.id FROM locations l JOIN machines m ON m.id = l.machine_id').get() as { id: number }).id;
    const central = centralLocationId(ctx.db);
    createReceipt(ctx.db, { docDate: '2026-10-20', lines: [{ productId: p, qty: 100 }] }, ACTOR);
    createTransfer(ctx.db, { docDate: '2026-10-20', fromLocationId: central, toLocationId: machineLoc, lines: [{ productId: p, qty: 20 }] }, ACTOR);
    return { ctx, p, machineLoc, central };
  }

  it('knjiženje je isključeno dok nije zadan datum početka', async () => {
    const { ctx, p, machineLoc } = await setup();
    const r = postSalesToMachineStock(ctx.db, 'all');
    expect(r.enabled).toBe(false);
    expect(balance(ctx, p, machineLoc)).toBe(20);
  });

  it('prodaja smanjuje automat, NE centralno skladište; ponovno knjiženje ne skida ponovno', async () => {
    const { ctx, p, machineLoc, central } = await setup();
    setSetting(ctx.db, 'automation.config', { ...DEFAULT_AUTOMATION, startDate: '2026-10-01' });
    const first = postSalesToMachineStock(ctx.db, 'all');
    expect(first.posted).toBe(1);
    expect(balance(ctx, p, machineLoc)).toBe(19);
    expect(balance(ctx, p, central)).toBe(80);
    const again = postSalesToMachineStock(ctx.db, 'all');
    expect(again).toMatchObject({ posted: 0, unchanged: 1 });
    // ponovni uvoz istog izvještaja također ne skida ponovno
    const imp = importCsv(ctx, csv(['T1;24.10.2026 08:00:00;Automat A;Coca-Cola 0,5;1;2,50;OK']));
    postSalesToMachineStock(ctx.db, imp.changedSalesIds);
    expect(balance(ctx, p, machineLoc)).toBe(19);
    expect(balance(ctx, p, central)).toBe(80);
  });

  it('storno u Televendu stornira knjiženje (zaliha automata se vraća)', async () => {
    const { ctx, p, machineLoc } = await setup();
    setSetting(ctx.db, 'automation.config', { ...DEFAULT_AUTOMATION, startDate: '2026-10-01' });
    postSalesToMachineStock(ctx.db, 'all');
    const imp = importCsv(ctx, csv(['T1;24.10.2026 08:00:00;Automat A;Coca-Cola 0,5;1;2,50;storno']));
    const r = postSalesToMachineStock(ctx.db, imp.changedSalesIds);
    expect(r.reversed).toBe(1);
    expect(balance(ctx, p, machineLoc)).toBe(20);
  });

  it('jedinstveni source_ref onemogućuje dvostruko knjiženje iste verzije transakcije', async () => {
    const { ctx } = await setup();
    setSetting(ctx.db, 'automation.config', { ...DEFAULT_AUTOMATION, startDate: '2026-10-01' });
    postSalesToMachineStock(ctx.db, 'all');
    ctx.db.prepare('UPDATE sales_transactions SET stock_movement_id = NULL').run(); // simulacija prekida između koraka
    expect(() => postSalesToMachineStock(ctx.db, 'all')).toThrow(/već proknjižen/);
  });

  it('TOP artikli po količini (primarno) i prihodu (zasebno)', async () => {
    const ctx = await makeContext();
    importCsv(ctx, csv(['A1;24.10.2026 08:00:00;A;Voda;5;5,00;OK', 'A2;24.10.2026 08:01:00;A;Kava;2;9,00;OK']));
    const f = { from: '2026-10-24', to: '2026-10-24' };
    expect(topProducts(ctx.db, f, 'qty')[0].name).toBe('Voda');
    expect(topProducts(ctx.db, f, 'revenue')[0].name).toBe('Kava');
    expect(summary(ctx.db, f).topProduct?.name).toBe('Voda');
  });

  it('svi analitički izvještaji (automati, kategorije, dnevno/mjesečno, najmanja prodaja, usporedba)', async () => {
    const ctx = await makeContext();
    const cat = saveCategory(ctx.db, null, 'Napitci', ACTOR);
    const p = product(ctx, { name: 'Kava' });
    updateProduct(ctx.db, p, { code: 'K1', name: 'Kava', categoryId: cat, supplierId: null, purchasePrice: 1, unit: 'kom', packSize: 1, minStock: 0, targetStock: 0, active: true, note: null }, ACTOR);
    importCsv(ctx, csv(['B1;23.10.2026 08:00:00;Automat A;Kava;3;3,60;OK', 'B2;24.10.2026 08:01:00;Automat B;Voda;1;1,50;OK', 'B3;01.09.2026 08:01:00;Automat B;Voda;4;6,00;OK']));
    const tv = ctx.db.prepare("SELECT id FROM tv_products WHERE name = 'Kava'").get() as { id: number };
    linkTelevendProduct(ctx.db, tv.id, p, ACTOR);
    const f = { from: '2026-10-01', to: '2026-10-31' };
    expect(byMachine(ctx.db, f).map((m) => [m.name, m.qty])).toEqual([['Automat A', 3], ['Automat B', 1]]);
    expect(byCategory(ctx.db, f).map((c) => [c.name, c.qty])).toEqual([['Napitci', 3], ['Nepovezani Televend artikli', 1]]);
    const daily = timeseries(ctx.db, f, 'day');
    expect(daily).toHaveLength(31);
    expect(daily.find((d) => d.period === '2026-10-23')?.qty).toBe(3);
    expect(timeseries(ctx.db, { from: '2026-09-01', to: '2026-10-31' }, 'month').map((m) => m.qty)).toEqual([4, 4]);
    expect(leastSold(ctx.db, f)[0].name).toBe('Voda');
    const cmp = comparePeriods(ctx.db, f, { from: '2026-09-01', to: '2026-09-30' });
    expect(cmp).toMatchObject({ qtyDiff: 0, qtyDiffPct: 0 });
    expect(summary(ctx.db, { ...f, categoryId: cat }).totalQty).toBe(3);
    expect(summary(ctx.db, { ...f, productId: p }).totalQty).toBe(3);
    expect(transactionsList(ctx.db, f)).toHaveLength(2);
  });
});
