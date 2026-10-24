import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBackup, listBackups, pruneBackups, restoreBackup, validateBackup } from '../src/modules/backup/service.js';
import { createReceipt } from '../src/modules/inventory/operations.js';
import { setSetting } from '../src/modules/settings/store.js';
import { ACTOR, makeContext, product } from './helpers.js';

describe('Sigurnosne kopije i vraćanje', () => {
  it('konzistentna kopija tijekom rada, s manifestom i kontrolnim zbrojem; bez sesije portala', async () => {
    const ctx = await makeContext();
    const p = product(ctx);
    createReceipt(ctx.db, { docDate: '2026-10-20', lines: [{ productId: p, qty: 10 }] }, ACTOR);
    ctx.secrets.set(ctx.db, 'televend.session', '{"cookies":[]}');
    ctx.secrets.set(ctx.db, 'televend.password', 'x');
    const m = await createBackup(ctx, 'manual', ACTOR);
    expect(m.integrity).toBe('ok');
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.counts.products).toBe(1);
    const v = validateBackup(ctx, m.file);
    expect(v.ok).toBe(true);
    // kopija ne sadrži kolačiće sesije portala, a lozinka je i dalje šifrirana
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(path.join(ctx.config.backupDir, m.file), { readonly: true });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM secrets WHERE name = 'televend.session'").get()).toEqual({ n: 0 });
    const pw = copy.prepare("SELECT ciphertext FROM secrets WHERE name = 'televend.password'").get() as { ciphertext: string };
    expect(pw.ciphertext.startsWith('v1:')).toBe(true);
    copy.close();
  });

  it('validacija odbija izmijenjenu ili oštećenu kopiju', async () => {
    const ctx = await makeContext();
    const m = await createBackup(ctx, 'manual', ACTOR);
    const file = path.join(ctx.config.backupDir, m.file);
    const buf = fs.readFileSync(file);
    buf[200] = buf[200] ^ 0xff;
    fs.writeFileSync(file, buf);
    const v = validateBackup(ctx, m.file);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/SHA-256/);
    await expect(restoreBackup(ctx, m.file, ACTOR)).rejects.toThrow(/nije ispravna/);
  });

  it('vraćanje: prethodno stanje se sprema, baza se vraća, sesije se poništavaju', async () => {
    const ctx = await makeContext();
    const p = product(ctx, { name: 'Prije backupa' });
    const m = await createBackup(ctx, 'manual', ACTOR);
    product(ctx, { name: 'Nakon backupa' });
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(2);
    const r = await restoreBackup(ctx, m.file, ACTOR);
    expect(r.safetyBackup).toMatch(/pre_restore/);
    const names = (ctx.db.prepare('SELECT name FROM products').all() as { name: string }[]).map((x) => x.name);
    expect(names).toEqual(['Prije backupa']);
    expect(p).toBeGreaterThan(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(listBackups(ctx).map((b) => b.reason).sort()).toEqual(['manual', 'pre_restore']);
  });

  it('automatske kopije: čuva se zadani broj najnovijih', async () => {
    const ctx = await makeContext();
    setSetting(ctx.db, 'backup.config', { autoEnabled: true, time: '02:30', keep: 2 });
    await createBackup(ctx, 'auto', null);
    await createBackup(ctx, 'auto', null);
    await createBackup(ctx, 'auto', null);
    await createBackup(ctx, 'manual', null);
    pruneBackups(ctx);
    const list = listBackups(ctx);
    expect(list.filter((b) => b.reason === 'auto')).toHaveLength(2);
    expect(list.filter((b) => b.reason === 'manual')).toHaveLength(1);
  });

  it('naziv kopije ne smije izaći iz mape (path traversal)', async () => {
    const ctx = await makeContext();
    expect(() => validateBackup(ctx, '../../etc/passwd')).toThrow(/Neispravan naziv/);
  });
});
