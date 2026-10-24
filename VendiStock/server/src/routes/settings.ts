import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION } from '../config.js';
import type { AppContext } from '../context.js';
import { currentSchemaVersion } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { parse, zIdParams, zIsoDate } from '../lib/validate.js';
import { actorOf, adminOnly, sendFile } from '../http/helpers.js';
import { audit } from '../modules/audit/audit.js';
import { alertSettings, dailyReminder, DEFAULT_ALERT_SETTINGS, emailHistory, flushLowStockNotifications } from '../modules/alerts/notifier.js';
import {
  backupFilePath,
  backupSettings,
  createBackup,
  DEFAULT_BACKUP_SETTINGS,
  deleteBackup,
  listBackups,
  restoreBackup,
  validateBackup,
} from '../modules/backup/service.js';
import {
  DEFAULT_EMAIL_CONFIG,
  EMAIL_SECRET_OAUTH_CLIENT_SECRET,
  EMAIL_SECRET_OAUTH_REFRESH_TOKEN,
  EMAIL_SECRET_PASSWORD,
  emailConfigProblem,
  emailConfigSchema,
  getEmailConfig,
  resendEmail,
  sendEmail,
  verifySmtp,
} from '../modules/email/mailer.js';
import { testEmail } from '../modules/email/templates.js';
import { DEFAULT_INVENTORY_SETTINGS, inventorySettings } from '../modules/inventory/operations.js';
import { DEFAULT_PROCUREMENT_SETTINGS } from '../modules/procurement/service.js';
import { getSetting, setSetting } from '../modules/settings/store.js';
import { createUser, listUsers, setPassword, updateUser } from '../modules/users/service.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { postSalesToMachineStock } from '../televend/salesPosting.js';
import { autoBookRefills, autoCreateProducts, automationOverview, automationSettings, DEFAULT_AUTOMATION } from '../modules/automation/service.js';

const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'vrijeme u formatu HH:mm');

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext) {
  // ------------------------------------------------ E-mail
  app.get('/api/settings/email', { preHandler: adminOnly }, async () => ({
    config: getEmailConfig(ctx.db),
    password: ctx.secrets.info(ctx.db, EMAIL_SECRET_PASSWORD),
    oauth2ClientSecret: ctx.secrets.info(ctx.db, EMAIL_SECRET_OAUTH_CLIENT_SECRET),
    oauth2RefreshToken: ctx.secrets.info(ctx.db, EMAIL_SECRET_OAUTH_REFRESH_TOKEN),
    problem: emailConfigProblem(ctx),
  }));
  app.put('/api/settings/email', { preHandler: adminOnly }, async (req) => {
    const b = parse(
      emailConfigSchema.extend({
        password: z.string().max(500).optional().nullable(),
        oauth2ClientSecret: z.string().max(1000).optional().nullable(),
        oauth2RefreshToken: z.string().max(4000).optional().nullable(),
        clearPassword: z.boolean().optional(),
      }),
      req.body,
    );
    const { password, oauth2ClientSecret, oauth2RefreshToken, clearPassword, ...cfg } = b;
    if ((password || oauth2ClientSecret || oauth2RefreshToken) && !ctx.secrets.available) {
      throw badRequest('Ključ za šifriranje nije dostupan – tajne se ne mogu sigurno spremiti.');
    }
    if (password) ctx.secrets.set(ctx.db, EMAIL_SECRET_PASSWORD, password);
    if (clearPassword) ctx.secrets.delete(ctx.db, EMAIL_SECRET_PASSWORD);
    if (oauth2ClientSecret) ctx.secrets.set(ctx.db, EMAIL_SECRET_OAUTH_CLIENT_SECRET, oauth2ClientSecret);
    if (oauth2RefreshToken) ctx.secrets.set(ctx.db, EMAIL_SECRET_OAUTH_REFRESH_TOKEN, oauth2RefreshToken);
    setSetting(ctx.db, 'email.config', { ...DEFAULT_EMAIL_CONFIG, ...cfg });
    audit(ctx.db, actorOf(req), 'settings.email', 'settings', 'email', { ...cfg, passwordChanged: !!password });
    return { ok: true, problem: emailConfigProblem(ctx) };
  });
  app.post('/api/settings/email/test', { preHandler: adminOnly, config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } }, async (req) => {
    const b = parse(z.object({ to: z.email().optional() }), req.body ?? {});
    await verifySmtp(ctx).catch((e) => {
      throw badRequest(`Spajanje na SMTP poslužitelj nije uspjelo: ${(e as Error).message}`);
    });
    const t = testEmail();
    const r = await sendEmail(ctx, { kind: 'test', ...t, to: b.to ? [b.to] : undefined });
    audit(ctx.db, actorOf(req), 'settings.email_test', 'email_log', r.emailId, { status: r.status });
    if (r.status !== 'sent') throw badRequest(`Slanje nije uspjelo: ${r.error}`);
    return r;
  });
  app.get('/api/email/log', { preHandler: adminOnly }, async () => emailHistory(ctx.db));
  app.post('/api/email/log/:id/resend', { preHandler: adminOnly }, async (req) => resendEmail(ctx, parse(zIdParams, req.params).id));

  // ------------------------------------------------ Upozorenja
  app.get('/api/settings/alerts', async () => alertSettings(ctx.db));
  app.put('/api/settings/alerts', { preHandler: adminOnly }, async (req) => {
    const b = parse(
      z.object({ enabled: z.boolean(), debounceSeconds: z.number().int().min(0).max(3600), dailyReminderEnabled: z.boolean(), dailyReminderTime: timeHHmm }),
      req.body,
    );
    setSetting(ctx.db, 'alerts.config', { ...DEFAULT_ALERT_SETTINGS, ...b });
    audit(ctx.db, actorOf(req), 'settings.alerts', 'settings', 'alerts', b);
    return b;
  });
  app.post('/api/alerts/flush', { preHandler: adminOnly }, async () => flushLowStockNotifications(ctx, { force: true }));
  app.post('/api/alerts/reminder', { preHandler: adminOnly }, async () => dailyReminder(ctx, { force: true }));

  // ------------------------------------------------ Skladište i nabava
  app.get('/api/settings/inventory', async () => ({
    inventory: inventorySettings(ctx.db),
    procurement: getSetting(ctx.db, 'procurement.config', DEFAULT_PROCUREMENT_SETTINGS),
  }));
  app.put('/api/settings/inventory', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ updatePurchasePriceOnReceipt: z.boolean(), roundToPacks: z.boolean() }), req.body);
    const before = { inventory: inventorySettings(ctx.db), procurement: getSetting(ctx.db, 'procurement.config', DEFAULT_PROCUREMENT_SETTINGS) };
    setSetting(ctx.db, 'inventory.config', { ...DEFAULT_INVENTORY_SETTINGS, updatePurchasePriceOnReceipt: b.updatePurchasePriceOnReceipt });
    setSetting(ctx.db, 'procurement.config', { ...DEFAULT_PROCUREMENT_SETTINGS, roundToPacks: b.roundToPacks });
    audit(ctx.db, actorOf(req), 'settings.inventory', 'settings', 'inventory', { before, after: b });
    return { ok: true };
  });

  // ------------------------------------------------ Automatizacija (artikli i skladište iz Televenda)
  app.get('/api/settings/automation', async () => automationOverview(ctx.db));
  app.put('/api/settings/automation', { preHandler: adminOnly }, async (req) => {
    const b = parse(
      z.object({
        autoCreateProducts: z.boolean(),
        autoPostSales: z.boolean(),
        autoBookRefills: z.boolean(),
        autoSyncMachineStock: z.boolean(),
        refillSourceLocationId: z.number().int().positive().nullable(),
        startDate: zIsoDate.nullable(),
      }),
      req.body,
    );
    if (b.refillSourceLocationId && !ctx.db.prepare("SELECT 1 FROM locations WHERE id = ? AND type <> 'machine' AND active = 1").get(b.refillSourceLocationId)) {
      throw badRequest('Izvorna lokacija dopuna mora biti aktivno skladište ili vozilo.');
    }
    const before = automationSettings(ctx.db);
    setSetting(ctx.db, 'automation.config', { ...DEFAULT_AUTOMATION, ...b });
    audit(ctx.db, actorOf(req), 'settings.automation', 'settings', 'automation', { before, after: b });
    // primijeni odmah na već preuzete podatke (od datuma početka)
    const created = b.autoCreateProducts ? autoCreateProducts(ctx.db, actorOf(req)).length : 0;
    const sales = postSalesToMachineStock(ctx.db, 'all', actorOf(req));
    const refills = autoBookRefills(ctx.db, actorOf(req));
    return { ok: true, createdProducts: created, sales, refills, overview: automationOverview(ctx.db) };
  });

  // ------------------------------------------------ Backup
  app.get('/api/backups', { preHandler: adminOnly }, async () => ({ settings: backupSettings(ctx), backups: listBackups(ctx), dir: ctx.config.backupDir }));
  app.put('/api/backups/settings', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ autoEnabled: z.boolean(), time: timeHHmm, keep: z.number().int().min(1).max(365) }), req.body);
    setSetting(ctx.db, 'backup.config', { ...DEFAULT_BACKUP_SETTINGS, ...b });
    audit(ctx.db, actorOf(req), 'settings.backup', 'settings', 'backup', b);
    return b;
  });
  app.post('/api/backups', { preHandler: adminOnly }, async (req) => createBackup(ctx, 'manual', actorOf(req)));
  const nameParams = z.object({ name: z.string().max(100) });
  app.get('/api/backups/:name/validate', { preHandler: adminOnly }, async (req) => validateBackup(ctx, parse(nameParams, req.params).name));
  app.post('/api/backups/:name/restore', { preHandler: adminOnly }, async (req) => {
    const { name } = parse(nameParams, req.params);
    const b = parse(z.object({ confirm: z.literal(name, { message: 'potvrdite unosom naziva kopije' }) }), req.body);
    void b;
    return restoreBackup(ctx, name, actorOf(req));
  });
  app.delete('/api/backups/:name', { preHandler: adminOnly }, async (req) => {
    deleteBackup(ctx, parse(nameParams, req.params).name, actorOf(req));
    return { ok: true };
  });
  app.get('/api/backups/:name/download', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = parse(nameParams, req.params);
    const file = backupFilePath(ctx, name);
    audit(ctx.db, actorOf(req), 'backup.download', 'backup', name);
    return sendFile(reply, fs.readFileSync(file), name);
  });

  // ------------------------------------------------ Korisnici
  const roleZ = z.enum(['admin', 'user', 'viewer']);
  app.get('/api/users', { preHandler: adminOnly }, async () => listUsers(ctx.db));
  app.post('/api/users', { preHandler: adminOnly }, async (req) => {
    const b = parse(
      z.object({ username: z.string().trim().min(3).max(40), fullName: z.string().trim().max(100).optional(), email: z.email().nullable().optional(), password: z.string().max(200), role: roleZ }),
      req.body,
    );
    const id = await createUser(ctx.db, b);
    audit(ctx.db, actorOf(req), 'user.create', 'user', id, { username: b.username, role: b.role });
    return { id };
  });
  app.put('/api/users/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ fullName: z.string().trim().max(100).optional(), email: z.email().nullable().optional(), role: roleZ.optional(), active: z.boolean().optional() }), req.body);
    if (id === req.user!.id && (b.active === false || (b.role && b.role !== 'admin'))) {
      throw badRequest('Ne možete deaktivirati vlastiti račun niti si ukloniti administratorsku ulogu.');
    }
    updateUser(ctx.db, id, b);
    audit(ctx.db, actorOf(req), 'user.update', 'user', id, b);
    return { ok: true };
  });
  app.post('/api/users/:id/password', { preHandler: adminOnly }, async (req) => {
    const { id } = parse(zIdParams, req.params);
    const b = parse(z.object({ password: z.string().max(200) }), req.body);
    await setPassword(ctx.db, id, b.password);
    if (id !== req.user!.id) destroyUserSessions(ctx.db, id);
    audit(ctx.db, actorOf(req), 'user.password_reset', 'user', id);
    return { ok: true };
  });

  // ------------------------------------------------ Revizijski zapis
  app.get('/api/audit', { preHandler: adminOnly }, async (req) => {
    const q = parse(
      z.object({ from: zIsoDate.optional(), to: zIsoDate.optional(), search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(20000).optional() }),
      req.query,
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.from) {
      where.push('created_at >= ?');
      params.push(`${q.from}T00:00:00`);
    }
    if (q.to) {
      where.push('created_at <= ?');
      params.push(`${q.to}T23:59:59.999Z`);
    }
    if (q.search) {
      where.push('(action LIKE ? OR username LIKE ? OR entity LIKE ? OR details LIKE ?)');
      const s = `%${q.search}%`;
      params.push(s, s, s, s);
    }
    return ctx.db
      .prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...params, q.limit ?? 2000);
  });

  // ------------------------------------------------ Sustav
  app.get('/api/system', { preHandler: adminOnly }, async () => ({
    version: APP_VERSION,
    mode: ctx.config.mode,
    node: process.version,
    platform: `${os.type()} ${os.release()} (${process.arch})`,
    hostname: os.hostname(),
    uptimeSeconds: Math.round(process.uptime()),
    schemaVersion: currentSchemaVersion(ctx.db),
    dbFile: ctx.config.dbFile,
    dbSizeBytes: fs.existsSync(ctx.config.dbFile) ? fs.statSync(ctx.config.dbFile).size : 0,
    backupDir: ctx.config.backupDir,
    logDir: ctx.config.logDir,
    https: ctx.config.https.enabled,
    port: ctx.config.port,
    host: ctx.config.host,
    publicUrl: ctx.config.publicUrl,
    allowedClientCidrs: ctx.config.allowedClientCidrs,
    keyProtection: ctx.config.keyProtection,
    dpapiScope: ctx.config.dpapiScope,
    secretKey: { status: ctx.secrets.status, keyId: ctx.secrets.keyId, error: ctx.secrets.lastError },
    televendAllowedHosts: ctx.config.televend.allowedHosts,
    lanAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address),
  }));
  app.post('/api/system/regenerate-key', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ confirm: z.literal('NOVI KLJUČ') }), req.body);
    void b;
    await ctx.secrets.createKey();
    audit(ctx.db, actorOf(req), 'system.regenerate_key', 'system', null, { keyId: ctx.secrets.keyId });
    return { ok: true, keyId: ctx.secrets.keyId, note: 'Postojeće spremljene lozinke više nisu čitljive – ponovno ih unesite.' };
  });
}
