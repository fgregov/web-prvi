import type { DB } from '../../db/index.js';
import { nowIso } from '../../lib/time.js';

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value) as T;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && parsed && typeof parsed === 'object') {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

export function patchSetting<T extends object>(db: DB, key: string, fallback: T, patch: Partial<T>): T {
  const next = { ...getSetting(db, key, fallback), ...patch };
  setSetting(db, key, next);
  return next;
}
