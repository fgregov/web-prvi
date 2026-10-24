import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../config.js';
import type { AppContext } from '../../context.js';
import { currentSchemaVersion, LATEST_SCHEMA_VERSION, migrate, openDatabase } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { nowIso, nowLocal } from '../../lib/time.js';
import { audit, type Actor } from '../audit/audit.js';
import { getSetting } from '../settings/store.js';

export interface BackupSettings {
  autoEnabled: boolean;
  /** Vrijeme dnevnog backupa (Europe/Zagreb, HH:mm). */
  time: string;
  /** Broj automatskih kopija koje se čuvaju. */
  keep: number;
}
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { autoEnabled: true, time: '02:30', keep: 30 };
export const backupSettings = (ctx: AppContext) => getSetting(ctx.db, 'backup.config', DEFAULT_BACKUP_SETTINGS);

export interface BackupManifest {
  file: string;
  createdAt: string;
  reason: 'auto' | 'manual' | 'pre_restore';
  appVersion: string;
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  integrity: string;
  counts: Record<string, number>;
}

const REQUIRED_TABLES = ['schema_migrations', 'users', 'products', 'stock_movements', 'stock_ledger', 'stock_balances', 'locations'];
const NAME_RE = /^vendistock-\d{8}-\d{6}-(auto|manual|pre_restore)\.db$/;

const sha256File = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function manifestPath(file: string) {
  return file.replace(/\.db$/, '.json');
}

function resolveBackupFile(ctx: AppContext, name: string): string {
  if (!NAME_RE.test(name)) throw badRequest('Neispravan naziv sigurnosne kopije.');
  const file = path.join(ctx.config.backupDir, name);
  if (!fs.existsSync(file)) throw notFound('Sigurnosna kopija nije pronađena.');
  return file;
}

/**
 * Konzistentna sigurnosna kopija pomoću SQLite online backup API-ja (sigurno tijekom rada aplikacije).
 * Iz kopije se uklanja spremljena sesija portala (kolačići); šifrirane lozinke ostaju šifrirane
 * ključem zaštićenim DPAPI-jem na ovom računalu i bez njega su neupotrebljive.
 */
export async function createBackup(ctx: AppContext, reason: BackupManifest['reason'], actor: Actor | null): Promise<BackupManifest> {
  fs.mkdirSync(ctx.config.backupDir, { recursive: true });
  const stamp = nowLocal().toFormat('yyyyMMdd-HHmmss');
  let name = `vendistock-${stamp}-${reason}.db`;
  let n = 1;
  while (fs.existsSync(path.join(ctx.config.backupDir, name))) {
    name = `vendistock-${nowLocal().plus({ seconds: n++ }).toFormat('yyyyMMdd-HHmmss')}-${reason}.db`;
  }
  const finalFile = path.join(ctx.config.backupDir, name);
  const tmp = `${finalFile}.tmp`;
  await ctx.db.backup(tmp);
  const copy = openDatabase(tmp);
  let integrity = 'unknown';
  const counts: Record<string, number> = {};
  try {
    copy.prepare("DELETE FROM secrets WHERE name = 'televend.session'").run();
    copy.prepare('DELETE FROM sessions').run();
    integrity = String((copy.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check);
    for (const t of ['products', 'stock_movements', 'stock_ledger', 'sales_transactions', 'purchase_orders', 'users']) {
      counts[t] = (copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
    copy.pragma('wal_checkpoint(TRUNCATE)');
    copy.pragma('journal_mode = DELETE');
  } finally {
    copy.close();
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${tmp}${ext}`, { force: true });
  if (integrity !== 'ok') {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Provjera integriteta kopije nije uspjela: ${integrity}`);
  }
  fs.renameSync(tmp, finalFile);
  const manifest: BackupManifest = {
    file: name,
    createdAt: nowIso(),
    reason,
    appVersion: APP_VERSION,
    schemaVersion: currentSchemaVersion(ctx.db),
    sizeBytes: fs.statSync(finalFile).size,
    sha256: sha256File(finalFile),
    integrity,
    counts,
  };
  fs.writeFileSync(manifestPath(finalFile), JSON.stringify(manifest, null, 2));
  if (actor) audit(ctx.db, actor, 'backup.create', 'backup', name, { reason, sizeBytes: manifest.sizeBytes });
  if (reason === 'auto') pruneBackups(ctx);
  ctx.log.info({ file: name, reason }, 'Sigurnosna kopija izrađena');
  return manifest;
}

export function pruneBackups(ctx: AppContext): string[] {
  const keep = backupSettings(ctx).keep;
  const autos = listBackups(ctx)
    .filter((b) => b.reason === 'auto')
    .sort((a, b) => b.file.localeCompare(a.file));
  const removed: string[] = [];
  for (const b of autos.slice(keep)) {
    const f = path.join(ctx.config.backupDir, b.file);
    fs.rmSync(f, { force: true });
    fs.rmSync(manifestPath(f), { force: true });
    removed.push(b.file);
  }
  return removed;
}

export function listBackups(ctx: AppContext): (BackupManifest & { hasManifest: boolean })[] {
  if (!fs.existsSync(ctx.config.backupDir)) return [];
  return fs
    .readdirSync(ctx.config.backupDir)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const full = path.join(ctx.config.backupDir, f);
      const mp = manifestPath(full);
      if (fs.existsSync(mp)) {
        try {
          return { ...(JSON.parse(fs.readFileSync(mp, 'utf8')) as BackupManifest), hasManifest: true };
        } catch {
          /* oštećen manifest – prikaži osnovne podatke */
        }
      }
      const st = fs.statSync(full);
      return {
        file: f,
        createdAt: st.mtime.toISOString(),
        reason: (f.match(NAME_RE)?.[1] ?? 'manual') as BackupManifest['reason'],
        appVersion: '?',
        schemaVersion: 0,
        sizeBytes: st.size,
        sha256: '',
        integrity: 'unknown',
        counts: {},
        hasManifest: false,
      };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

export interface ValidationResult {
  ok: boolean;
  /** Pogreške zbog kojih se kopija ne smije vratiti. */
  problems: string[];
  /** Upozorenja koja ne sprječavaju vraćanje. */
  warnings: string[];
  schemaVersion: number | null;
  counts: Record<string, number>;
}

/** Provjera kopije prije vraćanja: kontrolni zbroj, integritet SQLite datoteke, verzija sheme, obavezne tablice. */
export function validateBackup(ctx: AppContext, name: string): ValidationResult {
  const file = resolveBackupFile(ctx, name);
  const problems: string[] = [];
  const warnings: string[] = [];
  const mp = manifestPath(file);
  if (fs.existsSync(mp)) {
    const m = JSON.parse(fs.readFileSync(mp, 'utf8')) as BackupManifest;
    if (m.sha256 && m.sha256 !== sha256File(file)) problems.push('Kontrolni zbroj (SHA-256) ne odgovara – datoteka je promijenjena ili oštećena.');
  } else {
    warnings.push('Nedostaje manifest kopije (kontrolni zbroj se ne može provjeriti).');
  }
  let schemaVersion: number | null = null;
  const counts: Record<string, number> = {};
  try {
    const db = openDatabase(file, { readonly: true });
    try {
      const integrity = String((db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check);
      if (integrity !== 'ok') problems.push(`SQLite provjera integriteta: ${integrity}`);
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
      if (missing.length) problems.push(`Nedostaju tablice: ${missing.join(', ')}`);
      else {
        schemaVersion = currentSchemaVersion(db);
        if (schemaVersion > LATEST_SCHEMA_VERSION) problems.push(`Kopija je iz novije verzije aplikacije (shema ${schemaVersion}).`);
        for (const t of ['products', 'stock_movements', 'sales_transactions', 'users']) {
          counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
        }
        if (!counts.users) warnings.push('Kopija ne sadrži nijednog korisnika – nakon vraćanja administrator se stvara na serveru (localhost) ili naredbom npm run user:create.');
      }
    } finally {
      db.close();
    }
  } catch (e) {
    problems.push(`Datoteka se ne može otvoriti kao SQLite baza: ${(e as Error).message}`);
  }
  return { ok: problems.length === 0, problems, warnings, schemaVersion, counts };
}

/**
 * Vraćanje iz kopije: validacija → sigurnosna kopija trenutnog stanja → zamjena datoteke →
 * migracije → ponovno otvaranje. Sve sesije se poništavaju (potrebna ponovna prijava).
 */
export async function restoreBackup(ctx: AppContext, name: string, actor: Actor) {
  if (ctx.maintenance) throw conflict('Druga radnja održavanja je u tijeku.');
  if (ctx.televend?.isRunning) throw conflict('Sinkronizacija je u tijeku. Pričekajte da završi.');
  const v = validateBackup(ctx, name);
  if (!v.ok) throw badRequest(`Kopija nije ispravna: ${v.problems.join(' ')}`);
  const src = resolveBackupFile(ctx, name);
  ctx.maintenance = 'Vraćanje iz sigurnosne kopije je u tijeku.';
  try {
    const safety = await createBackup(ctx, 'pre_restore', actor);
    const dbFile = ctx.config.dbFile;
    ctx.db.close();
    const staged = `${dbFile}.restore`;
    fs.copyFileSync(src, staged);
    for (const ext of ['-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
    fs.renameSync(staged, dbFile);
    ctx.db = openDatabase(dbFile);
    migrate(ctx.db);
    ctx.db.prepare('DELETE FROM sessions').run();
    audit(ctx.db, actor, 'backup.restore', 'backup', name, { safetyBackup: safety.file });
    ctx.log.warn({ file: name, safety: safety.file }, 'Baza vraćena iz sigurnosne kopije');
    return { restored: name, safetyBackup: safety.file };
  } catch (e) {
    // Ako ponovno otvaranje ne uspije, pokušaj vratiti stanje iz sigurnosne kopije
    try {
      ctx.db.prepare('SELECT 1').get();
    } catch {
      ctx.db = openDatabase(ctx.config.dbFile);
    }
    throw e;
  } finally {
    ctx.maintenance = null;
  }
}

export function backupFilePath(ctx: AppContext, name: string): string {
  return resolveBackupFile(ctx, name);
}

export function deleteBackup(ctx: AppContext, name: string, actor: Actor): void {
  const f = resolveBackupFile(ctx, name);
  fs.rmSync(f, { force: true });
  fs.rmSync(manifestPath(f), { force: true });
  audit(ctx.db, actor, 'backup.delete', 'backup', name);
}

export function lastBackup(ctx: AppContext) {
  return listBackups(ctx)[0] ?? null;
}
