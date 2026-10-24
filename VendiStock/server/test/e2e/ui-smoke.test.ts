/**
 * E2E provjera korisničkog sučelja u stvarnom pregledniku (Chromium/Playwright):
 * prijava, sve stranice i kartice, primarne akcije, bez JavaScript grešaka i bez HTTP 5xx odgovora.
 * Preduvjet: izgrađen klijent (npm run build).
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createUser } from '../../src/modules/users/service.js';
import { createReceipt } from '../../src/modules/inventory/operations.js';
import { defaultDatasetConfig } from '../../src/televend/config.js';
import { importDataset } from '../../src/televend/importers.js';
import { ACTOR, makeContext, product, supplier, vehicle } from '../helpers.js';

const PASS = 'Sigurna!Lozinka2026';

describe('Korisničko sučelje (E2E)', () => {
  it('sve stranice se učitavaju bez grešaka; ulaz robe kroz sučelje mijenja stanje', async (t) => {
    const ctx = await makeContext();
    if (!fs.existsSync(`${ctx.config.clientDistDir}/index.html`)) t.skip();
    await createUser(ctx.db, { username: 'admin', fullName: 'Test Admin', password: PASS, role: 'admin' });
    const s = supplier(ctx);
    const p = product(ctx, { code: 'GAZ-001', name: 'Coca-Cola 0,5 L', supplierId: s });
    vehicle(ctx);
    createReceipt(ctx.db, { docDate: '2026-10-20', lines: [{ productId: p, qty: 70, unitPrice: 0.6 }] }, ACTOR);
    importDataset(
      ctx.db,
      'sales',
      [
        ['ID', 'Vrijeme', 'Automat', 'Artikl', 'Količina', 'Iznos'],
        ['1', '20.10.2026 08:00:00', 'Automat A', 'Coca Cola 0.5', '2', '5,00'],
      ],
      { ...defaultDatasetConfig(), columns: { transactionId: 'ID', soldAt: 'Vrijeme', machineName: 'Automat', productName: 'Artikl', quantity: 'Količina', amount: 'Iznos' } },
      { source: 'manual_upload', fileName: 'e2e.csv', fileBuffer: null, period: null, syncRunId: null, userId: null, fetchedAt: new Date().toISOString() },
    );
    const app = await buildApp(ctx);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch();
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
      await page.goto(base);
      await page.fill('input[autocomplete=username]', 'admin');
      await page.fill('input[type=password]', PASS);
      await page.click('button[type=submit]');
      await page.getByText('Ukupna vrijednost skladišta').waitFor();
      const pages: [string, string[]][] = [
        ['/artikli', ['Kategorije', 'Dobavljači', 'Televend povezivanje', 'Normativi']],
        ['/skladiste', ['Dokumenti', 'Povijest skladišta', 'Inventura', 'Lokacije', 'Rezervacije']],
        ['/automati', ['Dopune iz Televenda']],
        ['/analitika', ['TOP po prihodu', 'Po automatima', 'Po kategorijama', 'Dnevno / mjesečno', 'Najmanja prodaja', 'Usporedba razdoblja']],
        ['/nabava', ['Narudžbe', 'Povijest upozorenja']],
        ['/izvjestaji', []],
        ['/postavke', ['Izvori podataka', 'Uvoz datoteke', 'Povijest sinkronizacija', 'E-mail i upozorenja', 'Skladište i nabava', 'Korisnici', 'Backup', 'Revizijski zapis', 'Sustav', 'Moj račun']],
      ];
      for (const [path, tabs] of pages) {
        await page.goto(base + path);
        await page.waitForLoadState('networkidle');
        for (const tab of tabs) {
          await page.getByRole('button', { name: tab, exact: true }).first().click();
          await page.waitForLoadState('networkidle');
        }
      }
      // Ulaz robe kroz sučelje
      await page.goto(base + '/skladiste');
      await page.getByRole('button', { name: 'Novi ulaz' }).click();
      await page.getByRole('button', { name: /Odaberite artikl/ }).click();
      await page.getByRole('button', { name: /GAZ-001/ }).click();
      await page.locator('input[type=number]').first().fill('30');
      await page.getByRole('button', { name: 'Potvrdi ulaz' }).click();
      await page.getByText(/proknjižen/).waitFor();
      const bal = ctx.db.prepare("SELECT qty FROM stock_balances b JOIN locations l ON l.id = b.location_id WHERE l.type = 'central' AND b.product_id = ?").get(p) as { qty: number };
      expect(bal.qty).toBe(100);
    } finally {
      await browser.close();
      await app.close();
    }
    expect(errors).toEqual([]);
  });
});
