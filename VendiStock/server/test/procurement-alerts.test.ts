import { describe, expect, it } from 'vitest';
import { computeRecommendedQty, createOrdersFromRecommendations, createPurchaseOrder, receivePurchaseOrder, recommendations, setPurchaseOrderStatus } from '../src/modules/procurement/service.js';
import { createIssue, createReceipt, createReservation, releaseReservation } from '../src/modules/inventory/operations.js';
import { updateProduct } from '../src/modules/catalog/service.js';
import { dailyReminder, flushLowStockNotifications } from '../src/modules/alerts/notifier.js';
import { retryFailedEmails } from '../src/modules/email/mailer.js';
import { lowStockEmail } from '../src/modules/email/templates.js';
import { setSetting } from '../src/modules/settings/store.js';
import { roundUpToPack } from '../src/lib/num.js';
import { ACTOR, configureEmail, makeContext, product, supplier } from './helpers.js';
import type { AppContext } from '../src/context.js';

const D = '2026-10-20';
const events = (ctx: AppContext, productId: number) =>
  ctx.db.prepare('SELECT event, notify_status FROM stock_alert_events WHERE product_id = ? ORDER BY id').all(productId) as { event: string; notify_status: string }[];

describe('Izračun preporučene nabave', () => {
  it('primjer iz specifikacije: cilj 250, stanje 70, otvoreno 0 → 180', () => {
    expect(computeRecommendedQty({ targetStock: 250, available: 70, openOrders: 0, packSize: 1, roundToPacks: true })).toEqual({ rawQty: 180, orderQty: 180 });
  });

  it('MAX(0, …): nikad negativno', () => {
    expect(computeRecommendedQty({ targetStock: 100, available: 90, openOrders: 50, packSize: 1, roundToPacks: true }).orderQty).toBe(0);
  });

  it('zaokruživanje na cijela pakiranja (prema gore)', () => {
    expect(roundUpToPack(180, 24)).toBe(192);
    expect(roundUpToPack(192, 24)).toBe(192);
    expect(roundUpToPack(22, 1)).toBe(22);
    expect(roundUpToPack(1600, 100)).toBe(1600);
    expect(computeRecommendedQty({ targetStock: 30, available: 8, openOrders: 0, packSize: 1, roundToPacks: true }).orderQty).toBe(22);
  });

  it('otvorene narudžbe i rezervacije ulaze u formulu', async () => {
    const ctx = await makeContext();
    const s = supplier(ctx);
    const p = product(ctx, { supplierId: s, minStock: 100, targetStock: 250 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 70 }] }, ACTOR);
    let r = recommendations(ctx.db)[0];
    expect(r).toMatchObject({ stock: 70, available: 70, openOrders: 0, orderQty: 180, belowMin: true });
    const po = createPurchaseOrder(ctx.db, { supplierId: s, orderDate: D, lines: [{ productId: p, qty: 100 }] }, ACTOR);
    expect(recommendations(ctx.db)[0].openOrders).toBe(0); // nacrt se ne računa
    setPurchaseOrderStatus(ctx.db, po, 'ordered', ACTOR);
    r = recommendations(ctx.db)[0];
    expect(r).toMatchObject({ openOrders: 100, orderQty: 80 });
    createReservation(ctx.db, { productId: p, qty: 20 }, ACTOR);
    r = recommendations(ctx.db)[0];
    expect(r).toMatchObject({ reserved: 20, available: 50, orderQty: 100 });
    // djelomično zaprimanje smanjuje otvorenu količinu
    receivePurchaseOrder(ctx.db, po, { docDate: D, lines: [{ productId: p, qty: 60 }] }, ACTOR);
    r = recommendations(ctx.db, { onlyBelowMin: false })[0];
    expect(r).toMatchObject({ stock: 130, openOrders: 40, available: 110, orderQty: 100 });
    expect((ctx.db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po) as { status: string }).status).toBe('partial');
  });

  it('narudžbe iz preporuka grupiraju se po dobavljaču', async () => {
    const ctx = await makeContext();
    const s1 = supplier(ctx, 'Prvi');
    const s2 = supplier(ctx, 'Drugi');
    const a = product(ctx, { supplierId: s1 });
    const b = product(ctx, { supplierId: s1, name: 'Fanta' });
    const c = product(ctx, { supplierId: s2, name: 'Voda' });
    const ids = createOrdersFromRecommendations(ctx.db, [a, b, c], ACTOR);
    expect(ids).toHaveLength(2);
  });
});

describe('Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova', () => {
  it('prvi pad ispod minimuma stvara JEDNO upozorenje; daljnji padovi ne stvaraju nova', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    const p = product(ctx, { minStock: 100, targetStock: 250 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 150 }] }, ACTOR);
    expect(events(ctx, p)).toEqual([]);
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 60 }] }, ACTOR); // 90 < 100
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 10 }] }, ACTOR); // 80
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 10 }] }, ACTOR); // 70
    expect(events(ctx, p)).toEqual([{ event: 'entered_low', notify_status: 'pending' }]);
    const f = await flushLowStockNotifications(ctx);
    expect(f.sent).toBe(1);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].subject).toBe('VendiStock – Upozorenje o niskim zalihama');
    expect(ctx.sent[0].text).toContain('Coca-Cola 0,5 L');
    expect(ctx.sent[0].text).toContain('180'); // preporučena količina (250 − 70)
    // ponovni pokušaj slanja ne šalje istu poruku
    await flushLowStockNotifications(ctx);
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 5 }] }, ACTOR);
    await flushLowStockNotifications(ctx);
    expect(ctx.sent).toHaveLength(1);
  });

  it('povratak na minimum resetira stanje; sljedeći pad stvara novo upozorenje', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    const p = product(ctx, { minStock: 100, targetStock: 250 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 50 }] }, ACTOR); // odmah ispod
    await flushLowStockNotifications(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 50 }] }, ACTOR); // 100 = minimum → reset
    createIssue(ctx.db, { docDate: D, destinationType: 'other', lines: [{ productId: p, qty: 1 }] }, ACTOR); // 99 → novo
    await flushLowStockNotifications(ctx);
    expect(events(ctx, p).map((e) => e.event)).toEqual(['entered_low', 'recovered', 'entered_low']);
    expect(ctx.sent).toHaveLength(2);
  });

  it('artikl koji se oporavi prije slanja ne dobiva upozorenje (objedinjavanje)', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    setSetting(ctx.db, 'alerts.config', { enabled: true, debounceSeconds: 3600, dailyReminderEnabled: false, dailyReminderTime: '08:00' });
    const p = product(ctx, { minStock: 10, targetStock: 20 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 5 }] }, ACTOR);
    expect((await flushLowStockNotifications(ctx)).sent).toBe(0); // čeka objedinjavanje
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    await flushLowStockNotifications(ctx, { force: true });
    expect(ctx.sent).toHaveLength(0);
  });

  it('više artikala u jednoj poruci', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    const a = product(ctx, { name: 'Coca-Cola 0,5 L' });
    const b = product(ctx, { name: 'Kava u zrnu', unit: 'kg', minStock: 10, targetStock: 30 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: a, qty: 70 }, { productId: b, qty: 8 }] }, ACTOR);
    await flushLowStockNotifications(ctx);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].text).toContain('8 kg');
    expect(ctx.sent[0].text).toContain('22 kg');
  });

  it('neuspjelo slanje se ponavlja na istom zapisu – bez duplikata nakon uspjeha', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    ctx.failNext.count = 1;
    const f = await flushLowStockNotifications(ctx);
    expect(f.status).toBe('failed');
    expect(events(ctx, p)[0].notify_status).toBe('failed');
    ctx.db.prepare("UPDATE email_log SET next_attempt_at = '2000-01-01T00:00:00.000Z'").run();
    expect(await retryFailedEmails(ctx)).toBe(1);
    expect(ctx.sent).toHaveLength(1);
    expect(events(ctx, p)[0].notify_status).toBe('sent');
    expect(await retryFailedEmails(ctx)).toBe(0);
    await flushLowStockNotifications(ctx);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM email_log').get()).toEqual({ n: 1 });
  });

  it('bez konfiguriranog e-maila upozorenje se evidentira, ali se ne šalje kasnije „zastarjelo”', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    await flushLowStockNotifications(ctx, { force: true });
    expect(events(ctx, p)[0].notify_status).toBe('skipped');
    configureEmail(ctx);
    await flushLowStockNotifications(ctx, { force: true });
    expect(ctx.sent).toHaveLength(0);
  });

  it('promjena minimuma na kartici artikla aktivira upozorenje', async () => {
    const ctx = await makeContext();
    const p = product(ctx, { minStock: 10, targetStock: 20 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 15 }] }, ACTOR);
    expect(events(ctx, p)).toEqual([]);
    updateProduct(ctx.db, p, { code: 'X1', name: 'X', categoryId: null, supplierId: null, purchasePrice: 1, unit: 'kom', packSize: 1, minStock: 20, targetStock: 40, active: true, note: null }, ACTOR);
    expect(events(ctx, p).map((e) => e.event)).toEqual(['entered_low']);
  });

  it('rezervacija može aktivirati, a otpuštanje resetirati upozorenje', async () => {
    const ctx = await makeContext();
    const p = product(ctx, { minStock: 10, targetStock: 20 });
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 15 }] }, ACTOR);
    const r = createReservation(ctx.db, { productId: p, qty: 10 }, ACTOR);
    releaseReservation(ctx.db, r, ACTOR);
    expect(events(ctx, p).map((e) => e.event)).toEqual(['entered_low', 'recovered']);
  });

  it('dnevni podsjetnik šalje se najviše jednom dnevno', async () => {
    const ctx = await makeContext();
    configureEmail(ctx);
    setSetting(ctx.db, 'alerts.config', { enabled: true, debounceSeconds: 0, dailyReminderEnabled: true, dailyReminderTime: '00:00' });
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: D, lines: [{ productId: p, qty: 10 }] }, ACTOR);
    const r1 = await dailyReminder(ctx);
    const r2 = await dailyReminder(ctx);
    expect(r1.sent).toBe(true);
    expect(r2).toMatchObject({ sent: false, reason: 'already_sent' });
    expect(ctx.sent.filter((m) => m.subject.includes('podsjetnik'))).toHaveLength(1);
  });

  it('sadržaj e-maila prema predlošku (HTML escaping)', () => {
    const m = lowStockEmail([{ name: 'Čaše 180 ml <b>', code: 'C1', unit: 'kom', available: 400, minStock: 500, orderQty: 1600, supplierName: null }], 'alert');
    expect(m.text).toContain('Poštovani,');
    expect(m.text).toContain('1.600');
    expect(m.text).toContain('Podaci su informativni i generirani na temelju aktualne lokalne skladišne evidencije.');
    expect(m.html).toContain('Čaše 180 ml &lt;b&gt;');
    expect(m.html).not.toContain('<b>');
  });
});
