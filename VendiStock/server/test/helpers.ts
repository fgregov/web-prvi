import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createContext } from '../src/bootstrap.js';
import type { AppContext } from '../src/context.js';
import { createProduct, saveLocation, saveSupplier } from '../src/modules/catalog/service.js';
import type { Actor } from '../src/modules/audit/audit.js';
import type { MailMessage } from '../src/modules/email/mailer.js';
import { setSetting } from '../src/modules/settings/store.js';

export const ACTOR: Actor = { id: null, username: 'test', ip: '127.0.0.1' };

export function tmpDir(prefix = 'vs-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function makeContext(overrides: Partial<AppConfig> = {}): Promise<AppContext & { sent: MailMessage[]; failNext: { count: number } }> {
  const dir = tmpDir();
  const base = loadConfig();
  const config: AppConfig = {
    ...base,
    dataDir: dir,
    dbFile: path.join(dir, 'test.db'),
    backupDir: path.join(dir, 'backups'),
    logDir: path.join(dir, 'logs'),
    keyProtection: 'file',
    ...overrides,
  };
  const ctx = (await createContext(config)) as AppContext & { sent: MailMessage[]; failNext: { count: number } };
  ctx.sent = [];
  ctx.failNext = { count: 0 };
  ctx.mailTransportFactory = () => ({
    async sendMail(msg: MailMessage) {
      if (ctx.failNext.count > 0) {
        ctx.failNext.count--;
        throw new Error('SMTP privremeno nedostupan (test)');
      }
      ctx.sent.push(msg);
      return { messageId: `test-${ctx.sent.length}` };
    },
    async verify() {
      return true;
    },
  });
  ctx.televend.retryDelaysMs = [10, 10];
  ctx.televend.discoveryDelayMs = 10;
  return ctx;
}

export function configureEmail(ctx: AppContext) {
  setSetting(ctx.db, 'email.config', {
    host: 'smtp.test.local',
    port: 587,
    security: 'starttls',
    authMethod: 'none',
    username: null,
    fromAddress: 'vendistock@test.local',
    fromName: 'VendiStock',
    toAddress: 'nabava@test.local',
    ccAddresses: [],
    oauth2ClientId: null,
    oauth2AccessUrl: null,
    tlsRejectUnauthorized: true,
  });
  setSetting(ctx.db, 'alerts.config', { enabled: true, debounceSeconds: 0, dailyReminderEnabled: false, dailyReminderTime: '08:00' });
}

export function product(ctx: AppContext, overrides: Partial<Parameters<typeof createProduct>[1]> = {}): number {
  return createProduct(
    ctx.db,
    {
      code: `A${Math.random().toString(36).slice(2, 8)}`,
      name: 'Coca-Cola 0,5 L',
      categoryId: null,
      supplierId: null,
      purchasePrice: 0.65,
      unit: 'kom',
      packSize: 1,
      minStock: 100,
      targetStock: 250,
      active: true,
      note: null,
      ...overrides,
    },
    ACTOR,
  );
}

export function vehicle(ctx: AppContext, name = 'Vozilo ZG-1234-AB'): number {
  return saveLocation(ctx.db, null, { type: 'vehicle', name, machineId: null, active: true, note: null }, ACTOR);
}

export function supplier(ctx: AppContext, name = 'Dobavljač d.o.o.'): number {
  return saveSupplier(ctx.db, null, { name, contactPerson: null, email: 'nabava@dobavljac.hr', phone: null, oib: null, address: null, note: null, active: true }, ACTOR);
}

export function balance(ctx: AppContext, productId: number, locationId: number): number {
  const r = ctx.db.prepare('SELECT qty FROM stock_balances WHERE product_id = ? AND location_id = ?').get(productId, locationId) as { qty: number } | undefined;
  return r?.qty ?? 0;
}

export function totalQty(ctx: AppContext, productId: number): number {
  const r = ctx.db.prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_balances WHERE product_id = ?').get(productId) as { q: number };
  return Math.round(r.q * 1000) / 1000;
}
