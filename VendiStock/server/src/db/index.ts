import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './schema.js';

export type DB = Database.Database;

export function openDatabase(file: string, opts: { readonly?: boolean } = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function currentSchemaVersion(db: DB): number {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!exists) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db: DB): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const current = currentSchemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Baza ima noviju verziju sheme (${current}) od aplikacije (${LATEST_SCHEMA_VERSION}). Ažurirajte aplikaciju.`,
    );
  }
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    })();
    applied.push(m.version);
  }
  return applied;
}

/** Sljedeći broj dokumenta, npr. ULZ-2026-000001. Mora se pozivati unutar transakcije. */
export function nextDocNo(db: DB, prefix: string, year: number): string {
  db.prepare(
    `INSERT INTO doc_sequences (prefix, year, last_no) VALUES (?, ?, 1)
     ON CONFLICT(prefix, year) DO UPDATE SET last_no = last_no + 1`,
  ).run(prefix, year);
  const row = db.prepare('SELECT last_no FROM doc_sequences WHERE prefix = ? AND year = ?').get(prefix, year) as {
    last_no: number;
  };
  return `${prefix}-${year}-${String(row.last_no).padStart(6, '0')}`;
}
