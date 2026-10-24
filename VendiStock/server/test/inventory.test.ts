import { describe, expect, it } from 'vitest';
import { centralLocationId, reverseMovement, verifyLedgerIntegrity } from '../src/modules/inventory/ledger.js';
import {
  correctMovement,
  createInventoryCount,
  createIssue,
  createOpening,
  createReceipt,
  createReservation,
  createTransfer,
  postInventoryCount,
  updateInventoryCountLines,
} from '../src/modules/inventory/operations.js';
import { saveMachine } from '../src/modules/catalog/service.js';
import { stockHistory } from '../src/modules/inventory/queries.js';
import { centralStockInfo } from '../src/modules/alerts/lowStock.js';
import { ACTOR, balance, makeContext, product, totalQty, vehicle } from './helpers.js';

const D = '2026-10-20';

describe('Izračun stanja skladišta i ulaz/izlaz robe', () => {
  it('ulaz robe povećava stanje centralnog skladišta i bilježi kretanje u knjizi', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const c = centralLocationId(ctx.db);
    const r = createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 120, unitPrice: 0.6 }] }, ACTOR);
    expect(r.docNo).toMatch(/^ULZ-2026-\d{6}$/);
    expect(balance(ctx, p, c)).toBe(120);
    const h = stockHistory(ctx.db, { productId: p });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ qty_in: 120, qty_out: null, balance_after: 120, type: 'receipt' });
    // nabavna cijena ažurirana prema ulazu
    expect((ctx.db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(p) as { purchase_price: number }).purchase_price).toBe(0.6);
  });

  it('izlaz u vozilo smanjuje centralno i povećava vozilo (ukupna količina ista)', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const v = vehicle(ctx);
    const c = centralLocationId(ctx.db);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 100 }] }, ACTOR);
    createIssue(ctx.db, { docDate: D, destinationType: 'vehicle', destinationLocationId: v, lines: [{ productId: p, qty: 30 }] }, ACTOR);
    expect(balance(ctx, p, c)).toBe(70);
    expect(balance(ctx, p, v)).toBe(30);
    expect(totalQty(ctx, p)).toBe(100);
  });

  it('izlaz „ostalo” trajno smanjuje zalihu', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 4 }] }, ACTOR);
    expect(totalQty(ctx, p)).toBe(6);
  });

  it('ne dopušta izlaz veći od stanja (nema negativnog stanja centralnog skladišta)', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 5 }] }, ACTOR);
    expect(() => createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 6 }] }, ACTOR)).toThrow(/Nedovoljna zaliha/);
    expect(balance(ctx, p, centralLocationId(ctx.db))).toBe(5);
    // neuspjeli dokument ne ostavlja nikakav trag (transakcija)
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'issue'").get()).toEqual({ n: 0 });
  });

  it('decimalne količine (kg) bez greške zaokruživanja', async () => {
    const ctx = await makeContext();
    const p = product(ctx, { unit: 'kg', name: 'Kava u zrnu', minStock: 10, targetStock: 30 });
    for (let i = 0; i < 10; i++) createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 0.1 }] }, ACTOR);
    expect(balance(ctx, p, centralLocationId(ctx.db))).toBe(1);
  });
});

describe('Interni prijenosi', () => {
  it('centralno → vozilo → automat: ukupna količina se ne mijenja', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const v = vehicle(ctx);
    const m = saveMachine(ctx.db, null, { name: 'Automat Bolnica', locationText: null, serialNo: null, active: true }, ACTOR);
    const ml = (ctx.db.prepare('SELECT id FROM locations WHERE machine_id = ?').get(m) as { id: number }).id;
    const c = centralLocationId(ctx.db);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 200 }] }, ACTOR);
    createTransfer(ctx.db, { docDate: D, fromLocationId: c, toLocationId: v, lines: [{ productId: p, qty: 80 }] }, ACTOR);
    createTransfer(ctx.db, { docDate: D, fromLocationId: v, toLocationId: ml, lines: [{ productId: p, qty: 50 }] }, ACTOR);
    expect([balance(ctx, p, c), balance(ctx, p, v), balance(ctx, p, ml)]).toEqual([120, 30, 50]);
    expect(totalQty(ctx, p)).toBe(200);
    const sum = ctx.db.prepare("SELECT SUM(l.qty_delta) AS s FROM stock_ledger l JOIN stock_movements m ON m.id = l.movement_id WHERE m.type = 'transfer'").get() as { s: number };
    expect(sum.s).toBe(0);
  });

  it('ne dopušta prijenos na istu lokaciju niti prijenos veći od stanja vozila', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const v = vehicle(ctx);
    const c = centralLocationId(ctx.db);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    expect(() => createTransfer(ctx.db, { docDate: D, fromLocationId: c, toLocationId: c, lines: [{ productId: p, qty: 1 }] }, ACTOR)).toThrow(/različite/);
    expect(() => createTransfer(ctx.db, { docDate: D, fromLocationId: v, toLocationId: c, lines: [{ productId: p, qty: 1 }] }, ACTOR)).toThrow(/Nedovoljna/);
  });
});

describe('Storno, ispravak i revizijski trag', () => {
  it('storno vraća stanje, original ostaje, dvostruki storno nije moguć', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const c = centralLocationId(ctx.db);
    const r = createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 50 }] }, ACTOR);
    const s = reverseMovement(ctx.db, r.movementId, { reason: 'pogrešan unos', docDate: D }, ACTOR);
    expect(s.docNo).toMatch(/^STO-/);
    expect(balance(ctx, p, c)).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual({ n: 2 });
    expect(() => reverseMovement(ctx.db, r.movementId, { reason: 'opet', docDate: D }, ACTOR)).toThrow(/već storniran/);
    expect(() => reverseMovement(ctx.db, s.movementId, { reason: 'x', docDate: D }, ACTOR)).toThrow(/ne može ponovno/);
    const trail = ctx.db.prepare("SELECT action FROM audit_log WHERE entity = 'stock_movement' AND entity_id = ?").all(String(r.movementId));
    expect(trail.map((t) => (t as { action: string }).action)).toEqual(['stock.receipt', 'stock.reverse']);
  });

  it('storno ulaza nije moguć ako je roba već izdana (stanje bi otišlo u minus)', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const r = createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 8 }] }, ACTOR);
    expect(() => reverseMovement(ctx.db, r.movementId, { reason: 'x', docDate: D }, ACTOR)).toThrow(/Nedovoljna/);
  });

  it('ispravak = storno + novi dokument povezan s originalom', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const c = centralLocationId(ctx.db);
    const r = createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 100 }] }, ACTOR);
    const res = correctMovement(ctx.db, r.movementId, { type: 'receipt', data: { docDate: D, lines: [{ productId: p, qty: 90 }] } }, 'krivo prebrojano', ACTOR);
    expect(balance(ctx, p, c)).toBe(90);
    const repl = ctx.db.prepare('SELECT corrects_movement_id FROM stock_movements WHERE doc_no = ?').get(res.replacement.docNo) as { corrects_movement_id: number };
    expect(repl.corrects_movement_id).toBe(r.movementId);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock.correct'").get()).toEqual({ n: 1 });
  });
});

describe('Inventura i početno stanje', () => {
  it('inventura knjiži razliku prebrojano − knjigovodstveno', async () => {
    const ctx = await makeContext();
    const a = product(ctx, { name: 'A' });
    const b = product(ctx, { name: 'B' });
    const c = centralLocationId(ctx.db);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: a, qty: 50 }, { productId: b, qty: 20 }] }, ACTOR);
    const id = createInventoryCount(ctx.db, { locationId: c, countDate: D, productIds: [a, b] }, ACTOR);
    updateInventoryCountLines(ctx.db, id, [{ productId: a, countedQty: 47 }, { productId: b, countedQty: 20 }], ACTOR);
    const r = postInventoryCount(ctx.db, id, ACTOR);
    expect(r.differences).toBe(1);
    expect(balance(ctx, a, c)).toBe(47);
    expect(balance(ctx, b, c)).toBe(20);
    const line = ctx.db.prepare('SELECT book_qty, difference FROM inventory_count_lines WHERE count_id = ? AND product_id = ?').get(id, a);
    expect(line).toEqual({ book_qty: 50, difference: -3 });
    expect(() => postInventoryCount(ctx.db, id, ACTOR)).toThrow(/već proknjižena/);
  });

  it('početno stanje samo za artikl bez kretanja na lokaciji', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const c = centralLocationId(ctx.db);
    createOpening(ctx.db, { docDate: D, locationId: c, lines: [{ productId: p, qty: 40, unitCost: 0.5 }] }, ACTOR);
    expect(balance(ctx, p, c)).toBe(40);
    expect(() => createOpening(ctx.db, { docDate: D, locationId: c, lines: [{ productId: p, qty: 5 }] }, ACTOR)).toThrow(/inventuru/);
  });
});

describe('Integritet knjige i rezervacije', () => {
  it('stanja uvijek odgovaraju zbroju knjige', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    const v = vehicle(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 33.5 }] }, ACTOR);
    createIssue(ctx.db, { docDate: D, destinationType: 'vehicle', destinationLocationId: v, lines: [{ productId: p, qty: 12.25 }] }, ACTOR);
    const r = createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 1 }] }, ACTOR);
    reverseMovement(ctx.db, r.movementId, { reason: 'test', docDate: D }, ACTOR);
    expect(verifyLedgerIntegrity(ctx.db).ok).toBe(true);
  });

  it('rezervacija umanjuje raspoloživu zalihu', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 100 }] }, ACTOR);
    createReservation(ctx.db, { productId: p, qty: 25 }, ACTOR);
    expect(centralStockInfo(ctx.db, p)).toEqual({ stock: 100, reserved: 25, available: 75 });
  });
});
