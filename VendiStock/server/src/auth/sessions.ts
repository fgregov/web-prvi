import crypto from 'node:crypto';
import type { DB } from '../db/index.js';

export const SESSION_COOKIE = 'vs_session';
const ABSOLUTE_MAX_HOURS = 24 * 7;

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: 'admin' | 'user' | 'viewer';
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(
  db: DB,
  userId: number,
  ttlHours: number,
  meta: { ip?: string; userAgent?: string },
): { token: string; csrfToken: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    csrfToken,
    now.toISOString(),
    expiresAt,
    now.toISOString(),
    meta.ip ?? null,
    (meta.userAgent ?? '').slice(0, 300),
  );
  return { token, csrfToken, expiresAt };
}

export function loadSession(
  db: DB,
  token: string,
  ttlHours: number,
): { session: SessionRow; user: SessionUser } | null {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!session) return null;
  const now = Date.now();
  const absoluteLimit = new Date(session.created_at).getTime() + ABSOLUTE_MAX_HOURS * 3600_000;
  if (new Date(session.expires_at).getTime() < now || absoluteLimit < now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const user = db
    .prepare('SELECT id, username, full_name, email, role FROM users WHERE id = ? AND active = 1')
    .get(session.user_id) as SessionUser | undefined;
  if (!user) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  // Klizno produženje (najviše jednom u minuti kako bi se smanjilo pisanje u bazu)
  if (now - new Date(session.last_seen_at).getTime() > 60_000) {
    const newExpiry = new Date(Math.min(now + ttlHours * 3600_000, absoluteLimit)).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
      new Date(now).toISOString(),
      newExpiry,
      id,
    );
  }
  return { session, user };
}

export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

export function destroyUserSessions(db: DB, userId: number, exceptToken?: string): void {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, hashToken(exceptToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function purgeExpiredSessions(db: DB): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()).changes;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
