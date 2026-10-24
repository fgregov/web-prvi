import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { AppContext } from './context.js';
import { migrate, openDatabase } from './db/index.js';
import { SecretStore } from './lib/crypto/secretStore.js';
import { createLogger, type Logger } from './logger.js';
import { Scheduler } from './scheduler/scheduler.js';
import { TelevendService } from './televend/service.js';

export async function createContext(config: AppConfig, logger?: Logger): Promise<AppContext> {
  const log = logger ?? createLogger(config);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.backupDir, { recursive: true });
  const db = openDatabase(config.dbFile);
  const applied = migrate(db);
  if (applied.length) log.info({ applied }, 'Primijenjene migracije baze');
  const secrets = new SecretStore({
    keyFile: path.join(config.dataDir, 'keys', config.mode === 'demo' ? 'master-demo.key.json' : 'master.key.json'),
    protection: config.keyProtection,
    dpapiScope: config.dpapiScope,
  });
  const keyStatus = await secrets.init();
  if (keyStatus === 'unavailable') {
    log.error({ err: secrets.lastError }, 'Ključ za šifriranje tajni nije dostupan – spremljene lozinke nisu čitljive');
  } else if (config.keyProtection === 'file' && config.mode === 'production') {
    log.warn('Ključ za šifriranje zaštićen je samo datotečnim pravima (nije Windows/DPAPI). Za produkciju koristite Windows.');
  }
  const ctx = new AppContext(config, db, secrets, log);
  ctx.televend = new TelevendService(ctx);
  ctx.scheduler = new Scheduler(ctx);
  return ctx;
}
