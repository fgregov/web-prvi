import type { DB } from '../../db/index.js';

export interface Actor {
  id: number | null;
  username: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, username: 'sustav', ip: null };

const SENSITIVE = /pass|lozink|secret|token|cookie/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '***' : sanitize(v)]),
    );
  }
  return value;
}

export function audit(
  db: DB,
  actor: Actor,
  action: string,
  entity?: string | null,
  entityId?: string | number | null,
  details?: unknown,
): void {
  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    actor.id,
    actor.username,
    action,
    entity ?? null,
    entityId === undefined || entityId === null ? null : String(entityId),
    details === undefined ? null : JSON.stringify(sanitize(details)),
    actor.ip ?? null,
  );
}
