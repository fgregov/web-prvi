/**
 * DEMO PODACI – samo za razvoj i prikaz sučelja.
 * Upisuju se isključivo u zasebnu demo bazu (VENDISTOCK_MODE=demo → data/vendistock-demo.db).
 * Svi nazivi, količine i prodaje su IZMIŠLJENI i nisu preuzeti iz Televenda.
 */
import fs from 'node:fs';
import { DateTime } from 'luxon';
import { loadConfig, TIMEZONE } from '../config.js';
import { migrate, openDatabase } from '../db/index.js';
import { createProduct, linkTelevendProduct, saveCategory, saveLocation, saveMachine, saveSupplier } from '../modules/catalog/service.js';
import { centralLocationId, getBalance } from '../modules/inventory/ledger.js';
import { createIssue, createOpening, createReceipt, createTransfer } from '../modules/inventory/operations.js';
import { createPurchaseOrder, setPurchaseOrderStatus } from '../modules/procurement/service.js';
import { setSetting } from '../modules/settings/store.js';
import { createUser } from '../modules/users/service.js';
import { defaultDatasetConfig } from '../televend/config.js';
import { importDataset } from '../televend/importers.js';
import type { Cell } from '../televend/parse.js';
import type { Actor } from '../modules/audit/audit.js';

const DEMO_PASSWORD = 'Demo!Lozinka2026';

async function main() {
  const config = loadConfig();
  if (config.mode !== 'demo') {
    console.error('Demo podaci smiju se upisati samo u demo bazu. Pokrenite s VENDISTOCK_MODE=demo.');
    process.exit(1);
  }
  if (fs.existsSync(config.dbFile) && !process.argv.includes('--force')) {
    console.error(`Demo baza već postoji (${config.dbFile}). Za ponovno stvaranje dodajte --force.`);
    process.exit(1);
  }
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${config.dbFile}${ext}`, { force: true });
  const db = openDatabase(config.dbFile);
  migrate(db);
  const uid = await createUser(db, { username: 'demo', fullName: 'Demo Administrator', password: DEMO_PASSWORD, role: 'admin' });
  const actor: Actor = { id: uid, username: 'demo', ip: null };

  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const cat = Object.fromEntries(['Gazirani napitci', 'Voda', 'Sokovi', 'Kava i napitci', 'Grickalice', 'Čokolade', 'Potrošni materijal'].map((n) => [n, saveCategory(db, null, n, actor)]));
  const sup = {
    pice: saveSupplier(db, null, { name: 'DEMO Distribucija pića d.o.o.', contactPerson: 'Ana Horvat', email: 'narudzbe@demo-pice.test', phone: '01 000 0001', oib: null, address: 'Zagreb', note: 'Demo dobavljač', active: true }, actor),
    kava: saveSupplier(db, null, { name: 'DEMO Kava & Co.', contactPerson: 'Marko Kovač', email: 'prodaja@demo-kava.test', phone: '01 000 0002', oib: null, address: 'Zagreb', note: 'Demo dobavljač', active: true }, actor),
    snack: saveSupplier(db, null, { name: 'DEMO Grickalice j.d.o.o.', contactPerson: null, email: 'info@demo-snack.test', phone: null, oib: null, address: 'Split', note: 'Demo dobavljač', active: true }, actor),
  };
  const products: { code: string; name: string; cat: string; sup: number; price: number; unit: 'kom' | 'kg'; pack: number; min: number; target: number; tvName: string; sell: number; weight: number }[] = [
    { code: 'GAZ-001', name: 'Coca-Cola 0,5 L', cat: 'Gazirani napitci', sup: sup.pice, price: 0.68, unit: 'kom', pack: 24, min: 100, target: 250, tvName: 'Coca Cola 0.5', sell: 2.5, weight: 10 },
    { code: 'GAZ-002', name: 'Coca-Cola Zero 0,5 L', cat: 'Gazirani napitci', sup: sup.pice, price: 0.68, unit: 'kom', pack: 24, min: 60, target: 150, tvName: 'Coca Cola Zero 0.5', sell: 2.5, weight: 6 },
    { code: 'GAZ-003', name: 'Fanta 0,5 L', cat: 'Gazirani napitci', sup: sup.pice, price: 0.66, unit: 'kom', pack: 24, min: 48, target: 120, tvName: 'Fanta 0.5', sell: 2.4, weight: 4 },
    { code: 'VOD-001', name: 'Prirodna voda 0,5 L', cat: 'Voda', sup: sup.pice, price: 0.32, unit: 'kom', pack: 12, min: 120, target: 300, tvName: 'Voda 0.5', sell: 1.5, weight: 9 },
    { code: 'VOD-002', name: 'Mineralna voda 0,5 L', cat: 'Voda', sup: sup.pice, price: 0.41, unit: 'kom', pack: 12, min: 60, target: 150, tvName: 'Mineralna 0.5', sell: 1.8, weight: 5 },
    { code: 'SOK-001', name: 'Ledeni čaj breskva 0,5 L', cat: 'Sokovi', sup: sup.pice, price: 0.72, unit: 'kom', pack: 12, min: 48, target: 120, tvName: 'Ice Tea breskva', sell: 2.4, weight: 5 },
    { code: 'SOK-002', name: 'Sok od naranče 0,33 L', cat: 'Sokovi', sup: sup.pice, price: 0.8, unit: 'kom', pack: 24, min: 30, target: 90, tvName: 'Sok naranca 0.33', sell: 2.2, weight: 3 },
    { code: 'KAV-001', name: 'Kava u zrnu', cat: 'Kava i napitci', sup: sup.kava, price: 14.5, unit: 'kg', pack: 1, min: 10, target: 30, tvName: 'Espresso', sell: 1.2, weight: 0 },
    { code: 'KAV-002', name: 'Mlijeko u prahu', cat: 'Kava i napitci', sup: sup.kava, price: 8.9, unit: 'kg', pack: 1, min: 5, target: 15, tvName: 'Mlijeko u prahu', sell: 0, weight: 0 },
    { code: 'KAV-003', name: 'Čaše 180 ml', cat: 'Potrošni materijal', sup: sup.kava, price: 0.03, unit: 'kom', pack: 100, min: 500, target: 2000, tvName: 'Case 180', sell: 0, weight: 0 },
    { code: 'GRI-001', name: 'Čips paprika 40 g', cat: 'Grickalice', sup: sup.snack, price: 0.55, unit: 'kom', pack: 20, min: 40, target: 100, tvName: 'Cips paprika', sell: 1.8, weight: 4 },
    { code: 'GRI-002', name: 'Kikiriki slani 50 g', cat: 'Grickalice', sup: sup.snack, price: 0.6, unit: 'kom', pack: 20, min: 30, target: 80, tvName: 'Kikiriki', sell: 1.6, weight: 2 },
    { code: 'ČOK-001', name: 'Čokoladica s lješnjakom 45 g', cat: 'Čokolade', sup: sup.snack, price: 0.62, unit: 'kom', pack: 24, min: 48, target: 120, tvName: 'Cokoladica ljesnjak', sell: 1.9, weight: 6 },
    { code: 'ČOK-002', name: 'Vafel kakao 50 g', cat: 'Čokolade', sup: sup.snack, price: 0.45, unit: 'kom', pack: 24, min: 48, target: 120, tvName: 'Vafel kakao', sell: 1.5, weight: 5 },
  ];
  const ids = new Map<string, number>();
  for (const p of products) {
    ids.set(p.code, createProduct(db, { code: p.code, name: p.name, categoryId: cat[p.cat], supplierId: p.sup, purchasePrice: p.price, unit: p.unit, packSize: p.pack, minStock: p.min, targetStock: p.target, active: true, note: 'DEMO artikl' }, actor));
  }
  const central = centralLocationId(db);
  const van = saveLocation(db, null, { type: 'vehicle', name: 'Vozilo ZG-0000-DEMO', machineId: null, active: true, note: 'Demo vozilo' }, actor);
  const machineNames = ['DEMO Automat – Bolnica', 'DEMO Automat – Fakultet', 'DEMO Automat – Kolodvor', 'DEMO Automat – Poslovni centar'];
  const machines = machineNames.map((n, i) => saveMachine(db, null, { name: n, locationText: ['Zagreb', 'Zagreb', 'Split', 'Rijeka'][i], serialNo: `DEMO-${i + 1}`, active: true }, actor));
  const machineLoc = machines.map((m) => (db.prepare('SELECT id FROM locations WHERE machine_id = ?').get(m) as { id: number }).id);

  const start = DateTime.now().setZone(TIMEZONE).minus({ days: 75 }).startOf('day');
  const startDate = start.toISODate()!;
  createOpening(db, { docDate: startDate, locationId: central, note: 'DEMO početno stanje', lines: products.map((p) => ({ productId: ids.get(p.code)!, qty: p.unit === 'kg' ? 25 : p.target * 1.4, unitCost: p.price })) }, actor);
  for (let w = 0; w < 10; w++) {
    const day = start.plus({ days: w * 7 + 1 }).toISODate()!;
    const lines = products
      .filter((p) => p.weight > 0)
      .map((p) => ({ productId: ids.get(p.code)!, qty: Math.min(getBalance(db, ids.get(p.code)!, central), Math.round(p.weight * 4 + rnd() * 6)) }))
      .filter((l) => l.qty >= 4);
    if (!lines.length) continue;
    createIssue(db, { docDate: day, destinationType: 'vehicle', destinationLocationId: van, note: 'DEMO utovar', lines }, actor);
    machineLoc.forEach((loc, i) => {
      const part = lines.map((l) => ({ productId: l.productId, qty: Math.max(1, Math.floor(l.qty / 4) - (i === 3 ? 1 : 0)) }));
      createTransfer(db, { docDate: day, fromLocationId: van, toLocationId: loc, note: 'DEMO dopuna automata', lines: part }, actor);
    });
    if (w % 3 === 2) {
      for (const sid of [sup.pice, sup.snack]) {
        createReceipt(db, { docDate: day, supplierId: sid, documentRef: `DEMO-OTP-${w}-${sid}`, lines: products.filter((p) => p.sup === sid).map((p) => ({ productId: ids.get(p.code)!, qty: p.pack * 2, unitPrice: p.price })) }, actor);
      }
    }
  }
  createIssue(db, { docDate: DateTime.now().setZone(TIMEZONE).toISODate()!, destinationType: 'other', note: 'DEMO potrošnja', lines: [{ productId: ids.get('KAV-001')!, qty: 17 }, { productId: ids.get('KAV-003')!, qty: 2400 }] }, actor);

  // Demo prodaja – uvozi se kroz isti uvoznik kao stvarni izvještaji (izvor: ručni uvoz „DEMO”)
  const rows: Cell[][] = [['ID', 'Vrijeme', 'Automat', 'Artikl', 'Količina', 'Iznos', 'Status']];
  let n = 1;
  for (let d = 0; d < 75; d++) {
    const day = start.plus({ days: d });
    const weekend = day.weekday >= 6;
    machines.forEach((_, mi) => {
      for (const p of products.filter((x) => x.weight > 0)) {
        const count = Math.floor(rnd() * p.weight * (weekend ? 0.5 : 1.1) * (mi === 0 ? 1.3 : 1));
        for (let k = 0; k < count; k++) {
          const t = day.set({ hour: 7 + Math.floor(rnd() * 13), minute: Math.floor(rnd() * 60), second: Math.floor(rnd() * 60) });
          rows.push([`DEMO-${n++}`, t.toFormat('dd.MM.yyyy HH:mm:ss'), machineNames[mi], p.tvName, 1, p.sell.toFixed(2).replace('.', ','), rnd() < 0.004 ? 'storno' : 'OK']);
        }
      }
    });
  }
  const cfg = { ...defaultDatasetConfig(), columns: { transactionId: 'ID', soldAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', quantity: 'Količina', amount: 'Iznos', status: 'Status' } };
  const sum = importDataset(db, 'sales', rows, cfg, { source: 'manual_upload', fileName: 'DEMO-prodaja.csv', fileBuffer: Buffer.from('demo'), period: null, syncRunId: null, userId: uid, fetchedAt: new Date().toISOString() });
  for (const p of products.filter((x) => x.weight > 0 && x.code !== 'GRI-002')) {
    const tv = db.prepare('SELECT id FROM tv_products WHERE name = ?').get(p.tvName) as { id: number } | undefined;
    if (tv) linkTelevendProduct(db, tv.id, ids.get(p.code)!, actor);
  }
  const po = createPurchaseOrder(db, { supplierId: sup.snack, orderDate: DateTime.now().setZone(TIMEZONE).minus({ days: 1 }).toISODate()!, expectedDate: DateTime.now().setZone(TIMEZONE).plus({ days: 3 }).toISODate()!, note: 'DEMO narudžba', lines: [{ productId: ids.get('ČOK-001')!, qty: 48, unitPrice: 0.62 }] }, actor);
  setPurchaseOrderStatus(db, po, 'ordered', actor);
  setSetting(db, 'alerts.config', { enabled: true, debounceSeconds: 60, dailyReminderEnabled: false, dailyReminderTime: '08:00' });
  db.close();
  console.log(`DEMO baza stvorena: ${config.dbFile}`);
  console.log(`Uvezeno demo transakcija: ${sum.inserted}`);
  console.log(`Prijava: korisnik „demo”, lozinka „${DEMO_PASSWORD}” (samo demo baza).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
