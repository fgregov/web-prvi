/**
 * Automatizacija: ručno se unosi samo ulaz robe s nabavnom cijenom; artikle, automate i kretanja zaliha
 * (prodaja, dopune, usklađenje stanja automata) aplikacija generira sama iz uvezenih Televend podataka.
 * Izvještaji u testu imaju IZMIŠLJENU strukturu stupaca (ne predstavljaju stvarni Televend izvoz).
 */
import { describe, expect, it } from 'vitest';
import { defaultDatasetConfig, type Dataset, type DatasetConfig } from '../src/televend/config.js';
import { importDataset } from '../src/televend/importers.js';
import { runAutomation } from '../src/televend/automationRunner.js';
import { automationOverview, automationSettings, DEFAULT_AUTOMATION } from '../src/modules/automation/service.js';
import { setSetting } from '../src/modules/settings/store.js';
import { centralLocationId, reverseMovement, verifyLedgerIntegrity } from '../src/modules/inventory/ledger.js';
import { createReceipt, createTransfer } from '../src/modules/inventory/operations.js';
import { setPurchasePrices } from '../src/modules/catalog/service.js';
import { recommendations } from '../src/modules/procurement/service.js';
import { stockValue } from '../src/modules/inventory/queries.js';
import { todayLocal, addDays } from '../src/lib/time.js';
import { ACTOR, balance, makeContext } from './helpers.js';
import type { AppContext } from '../src/context.js';
import type { Cell } from '../src/televend/parse.js';

const TODAY = todayLocal();
const hr = (iso: string, time = '10:00:00') => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${time}`;

const CFG: Record<string, DatasetConfig> = {
  products: { ...defaultDatasetConfig(), columns: { productId: 'Šifra', productName: 'Naziv', price: 'Cijena', category: 'Grupa' } },
  sales: { ...defaultDatasetConfig(), columns: { transactionId: 'ID', soldAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', productId: 'Šifra', quantity: 'Kol', amount: 'Iznos', status: 'Status' } },
  refills: { ...defaultDatasetConfig(), columns: { refillId: 'ID', refilledAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', productId: 'Šifra', quantity: 'Kol' } },
  machine_stock: { ...defaultDatasetConfig(), columns: { machineName: 'Automat', productName: 'Artikl', productId: 'Šifra', quantity: 'Stanje', measuredAt: 'Vrijeme' } },
};

function imp(ctx: AppContext, dataset: Dataset, rows: Cell[][]) {
  const summary = importDataset(ctx.db, dataset, rows, CFG[dataset], {
    source: 'televend_portal',
    fileName: `${dataset}.csv`,
    fileBuffer: Buffer.from(JSON.stringify(rows)),
    period: null,
    syncRunId: null,
    userId: null,
    fetchedAt: new Date().toISOString(),
  });
  return { dataset, summary };
}

const sales = (rows: [string, string, string, string, string, number, string?][]): Cell[][] => [
  ['ID', 'Vrijeme', 'Automat', 'Artikl', 'Šifra', 'Kol', 'Iznos', 'Status'],
  ...rows.map(([id, at, m, p, code, q, st]) => [id, at, m, p, code, String(q), '2,50', st ?? 'OK']),
];
const refills = (rows: [string, string, string, string, string, number][]): Cell[][] => [
  ['ID', 'Vrijeme', 'Automat', 'Artikl', 'Šifra', 'Kol'],
  ...rows.map(([id, at, m, p, code, q]) => [id, at, m, p, code, String(q)]),
];
const stock = (rows: [string, string, string, number][], at = hr(TODAY, '12:00:00')): Cell[][] => [
  ['Automat', 'Artikl', 'Šifra', 'Stanje', 'Vrijeme'],
  ...rows.map(([m, p, code, q]) => [m, p, code, String(q), at]),
];

const product = (ctx: AppContext, code: string) =>
  ctx.db.prepare('SELECT * FROM products WHERE code = ?').get(code) as { id: number; name: string; purchase_price: number; price_set: number; auto_created: number; category_id: number | null };
const machineLoc = (ctx: AppContext, name: string) =>
  (ctx.db.prepare('SELECT l.id FROM locations l JOIN machines m ON m.id = l.machine_id WHERE m.name = ?').get(name) as { id: number }).id;
const startWeekAgo = (ctx: AppContext) => setSetting(ctx.db, 'automation.config', { ...DEFAULT_AUTOMATION, startDate: addDays(TODAY, -7) });

describe('Automatsko stvaranje artikala; ručno se unosi samo nabavna cijena', () => {
  it('novi Televend artikli postaju lokalni artikli (šifra TV-…, cijena 0, „cijena nije unesena”)', async () => {
    const ctx = await makeContext();
    const r = runAutomation(ctx.db, [imp(ctx, 'products', [['Šifra', 'Naziv', 'Cijena', 'Grupa'], ['1001', 'Coca-Cola 0,5', '2,50', 'Pića'], ['1002', 'Kava espresso', '1,20', 'Topli napitci']])]);
    expect(r.createdProducts).toBe(2);
    const p = product(ctx, 'TV-1001');
    expect(p).toMatchObject({ name: 'Coca-Cola 0,5', purchase_price: 0, price_set: 0, auto_created: 1 });
    expect((ctx.db.prepare('SELECT name FROM categories WHERE id = ?').get(p.category_id) as { name: string }).name).toBe('Pića');
    expect(automationOverview(ctx.db).productsWithoutPrice).toBe(2);
    runAutomation(ctx.db, [imp(ctx, 'products', [['Šifra', 'Naziv', 'Cijena', 'Grupa'], ['1001', 'Coca-Cola 0,5', '2,50', 'Pića']])]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 2 });
    expect(setPurchasePrices(ctx.db, [{ id: p.id, purchasePrice: 0.68 }], ACTOR)).toBe(1);
    expect(product(ctx, 'TV-1001')).toMatchObject({ purchase_price: 0.68, price_set: 1 });
    expect(automationOverview(ctx.db).productsWithoutPrice).toBe(1);
  });

  it('ručno uneseni artikl istog naziva se povezuje umjesto stvaranja duplikata', async () => {
    const ctx = await makeContext();
    ctx.db.prepare("INSERT INTO products (code, name, purchase_price) VALUES ('GAZ-001', 'Coca-Cola 0,5', 0.7)").run();
    runAutomation(ctx.db, [imp(ctx, 'sales', sales([['S1', hr(TODAY), 'Automat A', 'Coca-Cola 0,5', '1001', 1]]))]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 1 });
    expect(ctx.db.prepare('SELECT p.code FROM product_televend_links l JOIN products p ON p.id = l.product_id').get()).toEqual({ code: 'GAZ-001' });
  });
});

describe('Automatsko skladište iz Televend podataka', () => {
  it('datum početka postavlja se pri prvom uvozu; povijesna prodaja se analizira, ali ne knjiži', async () => {
    const ctx = await makeContext();
    const yesterday = addDays(TODAY, -1);
    const r = runAutomation(ctx.db, [imp(ctx, 'sales', sales([['S1', hr(yesterday), 'Automat A', 'Kava', 'K1', 3], ['S2', hr(TODAY), 'Automat A', 'Kava', 'K1', 2]]))]);
    expect(automationSettings(ctx.db).startDate).toBe(TODAY);
    expect(r.sales).toMatchObject({ posted: 1 });
    const p = product(ctx, 'TV-K1');
    expect(balance(ctx, p.id, machineLoc(ctx, 'Automat A'))).toBe(-2);
    expect(balance(ctx, p.id, centralLocationId(ctx.db))).toBe(0);
  });

  it('dopuna: centralno → automat automatski; prodaja smanjuje automat; ponovni uvoz ništa ne udvostručuje', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [imp(ctx, 'products', [['Šifra', 'Naziv', 'Cijena', 'Grupa'], ['1001', 'Coca-Cola 0,5', '2,50', '']])]);
    const p = product(ctx, 'TV-1001');
    createReceipt(ctx.db, { docDate: addDays(TODAY, -5), lines: [{ productId: p.id, qty: 100, unitPrice: 0.68 }] }, ACTOR);
    expect(product(ctx, 'TV-1001')).toMatchObject({ purchase_price: 0.68, price_set: 1 });
    const run = () =>
      runAutomation(ctx.db, [
        imp(ctx, 'sales', sales([['S1', hr(addDays(TODAY, -2), '11:00:00'), 'Automat A', 'Coca-Cola 0,5', '1001', 1], ['S2', hr(addDays(TODAY, -1)), 'Automat A', 'Coca-Cola 0,5', '1001', 2]])),
        imp(ctx, 'refills', refills([['R1', hr(addDays(TODAY, -3)), 'Automat A', 'Coca-Cola 0,5', '1001', 24]])),
      ]);
    const r1 = run();
    expect(r1.refills).toMatchObject({ booked: 1 });
    expect(r1.sales).toMatchObject({ posted: 2 });
    const ml = machineLoc(ctx, 'Automat A');
    const c = centralLocationId(ctx.db);
    expect(balance(ctx, p.id, c)).toBe(76);
    expect(balance(ctx, p.id, ml)).toBe(21);
    run();
    expect(balance(ctx, p.id, c)).toBe(76);
    expect(balance(ctx, p.id, ml)).toBe(21);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE auto_generated = 1').get()).toEqual({ n: 3 });
    expect(verifyLedgerIntegrity(ctx.db).ok).toBe(true);
  });

  it('dopuna koja je već ručno evidentirana prijenosom samo se povezuje (bez dvostrukog knjiženja)', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [imp(ctx, 'sales', sales([['S0', hr(addDays(TODAY, -6)), 'Automat A', 'Voda', 'V1', 1]]))]);
    const p = product(ctx, 'TV-V1');
    const c = centralLocationId(ctx.db);
    const ml = machineLoc(ctx, 'Automat A');
    createReceipt(ctx.db, { docDate: addDays(TODAY, -5), lines: [{ productId: p.id, qty: 50, unitPrice: 0.3 }] }, ACTOR);
    createTransfer(ctx.db, { docDate: addDays(TODAY, -3), fromLocationId: c, toLocationId: ml, lines: [{ productId: p.id, qty: 12 }] }, ACTOR);
    const r = runAutomation(ctx.db, [imp(ctx, 'refills', refills([['R1', hr(addDays(TODAY, -3)), 'Automat A', 'Voda', 'V1', 12]]))]);
    expect(r.refills).toMatchObject({ booked: 0, reconciled: 1 });
    expect(balance(ctx, p.id, c)).toBe(38);
  });

  it('nedostaje ručni ulaz robe: automatska dopuna se ipak knjiži, centralno stanje ide u minus i to se prijavljuje', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [imp(ctx, 'refills', refills([['R1', hr(addDays(TODAY, -1)), 'Automat A', 'Čips', 'C1', 10]]))]);
    const p = product(ctx, 'TV-C1');
    expect(balance(ctx, p.id, centralLocationId(ctx.db))).toBe(-10);
    expect(automationOverview(ctx.db).negativeCentral).toBe(1);
    expect(() =>
      createTransfer(ctx.db, { docDate: TODAY, fromLocationId: centralLocationId(ctx.db), toLocationId: machineLoc(ctx, 'Automat A'), lines: [{ productId: p.id, qty: 1 }] }, ACTOR),
    ).toThrow(/Nedovoljna/);
  });

  it('usklađenje stanja automata s Televendom knjiži samo razliku; isto stanje ponovno → bez novog dokumenta', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [
      imp(ctx, 'refills', refills([['R1', hr(addDays(TODAY, -2)), 'Automat A', 'Kava', 'K1', 20]])),
      imp(ctx, 'sales', sales([['S1', hr(addDays(TODAY, -1)), 'Automat A', 'Kava', 'K1', 5]])),
    ]);
    const p = product(ctx, 'TV-K1');
    const ml = machineLoc(ctx, 'Automat A');
    expect(balance(ctx, p.id, ml)).toBe(15);
    const r = runAutomation(ctx.db, [imp(ctx, 'machine_stock', stock([['Automat A', 'Kava', 'K1', 13]]))]);
    expect(r.machineStock).toEqual({ movements: 1, lines: 1 });
    expect(balance(ctx, p.id, ml)).toBe(13);
    const r2 = runAutomation(ctx.db, [imp(ctx, 'machine_stock', stock([['Automat A', 'Kava', 'K1', 13]]))]);
    expect(r2.machineStock).toEqual({ movements: 0, lines: 0 });
    expect(ctx.db.prepare("SELECT note FROM stock_movements WHERE type = 'adjustment'").all()).toHaveLength(1);
  });

  it('storno prodaje u Televendu vraća zalihu automata; ručni storno automatske dopune vraća dopunu na čekanje', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [
      imp(ctx, 'refills', refills([['R1', hr(addDays(TODAY, -2)), 'Automat A', 'Sok', 'S1', 6]])),
      imp(ctx, 'sales', sales([['T1', hr(addDays(TODAY, -1)), 'Automat A', 'Sok', 'S1', 1]])),
    ]);
    const p = product(ctx, 'TV-S1');
    const ml = machineLoc(ctx, 'Automat A');
    expect(balance(ctx, p.id, ml)).toBe(5);
    runAutomation(ctx.db, [imp(ctx, 'sales', sales([['T1', hr(addDays(TODAY, -1)), 'Automat A', 'Sok', 'S1', 1, 'storno']]))]);
    expect(balance(ctx, p.id, ml)).toBe(6);
    const refillMv = ctx.db.prepare("SELECT m.id FROM stock_movements m JOIN tv_refills r ON r.movement_id = m.id").get() as { id: number };
    reverseMovement(ctx.db, refillMv.id, { reason: 'pogrešna dopuna', docDate: TODAY }, ACTOR);
    expect(ctx.db.prepare('SELECT status FROM tv_refills').get()).toEqual({ status: 'pending' });
  });

  it('vrijednost skladišta i nabava koriste ručno unesene nabavne cijene', async () => {
    const ctx = await makeContext();
    startWeekAgo(ctx);
    runAutomation(ctx.db, [imp(ctx, 'products', [['Šifra', 'Naziv', 'Cijena', 'Grupa'], ['1001', 'Coca-Cola 0,5', '2,50', '']])]);
    const p = product(ctx, 'TV-1001');
    createReceipt(ctx.db, { docDate: TODAY, lines: [{ productId: p.id, qty: 10 }] }, ACTOR);
    expect(stockValue(ctx.db).central).toBe(0);
    setPurchasePrices(ctx.db, [{ id: p.id, purchasePrice: 0.5 }], ACTOR);
    expect(stockValue(ctx.db).central).toBe(5);
    ctx.db.prepare('UPDATE products SET min_stock = 20, target_stock = 50 WHERE id = ?').run(p.id);
    expect(recommendations(ctx.db)[0]).toMatchObject({ orderQty: 40, estimatedCost: 20 });
  });
});
