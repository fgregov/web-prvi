import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/modules/users/service.js';
import { createReceipt, createInventoryCount } from '../src/modules/inventory/operations.js';
import { centralLocationId } from '../src/modules/inventory/ledger.js';
import { createPurchaseOrder } from '../src/modules/procurement/service.js';
import { defaultDatasetConfig } from '../src/televend/config.js';
import { importDataset } from '../src/televend/importers.js';
import { linkTelevendProduct, saveCategory } from '../src/modules/catalog/service.js';
import { ACTOR, makeContext, product, supplier, vehicle } from './helpers.js';

const PASS = 'Sigurna!Lozinka2026';

describe('API: sve rute za čitanje i izvozi rade nad stvarnim podacima', () => {
  it('GET rute vraćaju 200, izvozi vraćaju ispravne XLSX/PDF datoteke', async () => {
    const ctx = await makeContext();
    await createUser(ctx.db, { username: 'admin', password: PASS, role: 'admin' });
    const cat = saveCategory(ctx.db, null, 'Napitci', ACTOR);
    const s = supplier(ctx);
    const p = product(ctx, { name: 'Coca-Cola 0,5 L', categoryId: cat, supplierId: s });
    vehicle(ctx);
    createReceipt(ctx.db, { docDate: '2026-10-20', supplierId: s, lines: [{ productId: p, qty: 70, unitPrice: 0.6 }] }, ACTOR);
    const count = createInventoryCount(ctx.db, { locationId: centralLocationId(ctx.db), countDate: '2026-10-21' }, ACTOR);
    const po = createPurchaseOrder(ctx.db, { supplierId: s, orderDate: '2026-10-21', lines: [{ productId: p, qty: 24 }] }, ACTOR);
    importDataset(
      ctx.db,
      'sales',
      [
        ['ID', 'Vrijeme', 'Automat', 'Artikl', 'Količina', 'Iznos'],
        ['1', '20.10.2026 08:00:00', 'Automat A', 'Coca Cola 0.5', '2', '5,00'],
        ['2', '21.10.2026 09:00:00', 'Automat B', 'Voda', '1', '1,50'],
      ],
      { ...defaultDatasetConfig(), columns: { transactionId: 'ID', soldAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', quantity: 'Količina', amount: 'Iznos' } },
      { source: 'manual_upload', fileName: 't.csv', fileBuffer: null, period: null, syncRunId: null, userId: null, fetchedAt: new Date().toISOString() },
    );
    const tv = ctx.db.prepare("SELECT id FROM tv_products WHERE name = 'Coca Cola 0.5'").get() as { id: number };
    linkTelevendProduct(ctx.db, tv.id, p, ACTOR);
    const machineId = (ctx.db.prepare('SELECT id FROM machines LIMIT 1').get() as { id: number }).id;
    const movementId = (ctx.db.prepare('SELECT id FROM stock_movements LIMIT 1').get() as { id: number }).id;

    const app = await buildApp(ctx);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PASS }, remoteAddress: '127.0.0.1' });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const q = 'from=2026-10-01&to=2026-10-31';
    const gets = [
      '/api/auth/me',
      `/api/dashboard?${q}`,
      '/api/products',
      `/api/products/${p}`,
      '/api/categories',
      '/api/suppliers',
      '/api/locations',
      `/api/machines?${q}`,
      `/api/machines/${machineId}?${q}`,
      '/api/televend/products',
      '/api/televend/products?unlinked=1',
      '/api/recipes',
      `/api/recipes/consumption?${q}`,
      '/api/stock/overview',
      '/api/stock/balances',
      `/api/stock/history?${q}`,
      `/api/stock/movements?${q}`,
      `/api/stock/movements/${movementId}`,
      '/api/stock/counts',
      `/api/stock/counts/${count}`,
      '/api/stock/reservations',
      '/api/stock/integrity',
      '/api/refills',
      `/api/analytics/report?${q}`,
      `/api/analytics/report?${q}&categoryId=${cat}&machineId=${machineId}&productId=${p}`,
      '/api/analytics/compare?fromA=2026-10-01&toA=2026-10-31&fromB=2026-09-01&toB=2026-09-30',
      `/api/sales/transactions?${q}`,
      '/api/procurement/recommendations',
      '/api/procurement/recommendations?all=1',
      '/api/procurement/orders',
      `/api/procurement/orders/${po}`,
      '/api/alerts/history',
      '/api/televend/state',
      '/api/televend/datasets',
      '/api/televend/discovery',
      '/api/televend/runs',
      '/api/televend/imports',
      '/api/settings/email',
      '/api/settings/alerts',
      '/api/settings/inventory',
      '/api/email/log',
      '/api/backups',
      '/api/users',
      '/api/audit',
      '/api/system',
    ];
    for (const url of gets) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie }, remoteAddress: '127.0.0.1' });
      expect(r.statusCode, `${url}: ${r.body.slice(0, 200)}`).toBe(200);
    }
    const files: [string, string][] = [
      [`/api/reports/stock-history.xlsx?${q}`, 'PK'],
      ['/api/reports/stock/xlsx', 'PK'],
      ['/api/reports/stock/pdf', '%PDF'],
      ['/api/reports/procurement/xlsx', 'PK'],
      ['/api/reports/procurement/pdf', '%PDF'],
      [`/api/reports/sales/xlsx?${q}`, 'PK'],
      [`/api/reports/sales/pdf?${q}`, '%PDF'],
      ['/api/reports/compare/xlsx?fromA=2026-10-01&toA=2026-10-31&fromB=2026-09-01&toB=2026-09-30', 'PK'],
      ['/api/reports/compare/pdf?fromA=2026-10-01&toA=2026-10-31&fromB=2026-09-01&toB=2026-09-30', '%PDF'],
      [`/api/reports/purchase-order/${po}/pdf`, '%PDF'],
      [`/api/reports/inventory-count/${count}/xlsx`, 'PK'],
    ];
    for (const [url, magic] of files) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie }, remoteAddress: '127.0.0.1' });
      expect(r.statusCode, `${url}: ${r.body.slice(0, 200)}`).toBe(200);
      expect(r.rawPayload.subarray(0, magic.length).toString('latin1'), url).toBe(magic);
      expect(String(r.headers['content-disposition'])).toContain('attachment');
    }
    const csrf = (login.json() as { csrfToken: string }).csrfToken;
    const exp = await app.inject({
      method: 'POST',
      url: '/api/export/xlsx',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { fileName: 'artikli', title: 'Artikli', columns: [{ header: 'Naziv', key: 'name' }], rows: [{ name: 'Čaše 180 ml' }] },
      remoteAddress: '127.0.0.1',
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
