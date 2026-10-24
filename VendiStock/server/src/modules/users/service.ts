import type { DB } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { getDummyHash, hashPassword, validatePasswordStrength, verifyPassword } from '../../auth/passwords.js';
import type { SessionUser } from '../../auth/sessions.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export type Role = 'admin' | 'user' | 'viewer';

export interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  password_hash: string;
  role: Role;
  active: number;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function listUsers(db: DB) {
  return db
    .prepare(
      'SELECT id, username, full_name, email, role, active, last_login_at, locked_until, created_at FROM users ORDER BY username',
    )
    .all();
}

export async function createUser(
  db: DB,
  input: { username: string; fullName?: string; email?: string | null; password: string; role: Role },
): Promise<number> {
  const err = validatePasswordStrength(input.password);
  if (err) throw badRequest(err);
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(input.username)) {
    throw badRequest('Korisničko ime smije sadržavati slova, brojke, točku, crticu i podvlaku (3–40 znakova).');
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username);
  if (exists) throw conflict('Korisnik s tim korisničkim imenom već postoji.');
  const hash = await hashPassword(input.password);
  const r = db
    .prepare(
      'INSERT INTO users (username, full_name, email, password_hash, role, password_changed_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(input.username, input.fullName ?? '', input.email ?? null, hash, input.role, nowIso());
  return Number(r.lastInsertRowid);
}

export function updateUser(
  db: DB,
  id: number,
  patch: { fullName?: string; email?: string | null; role?: Role; active?: boolean },
): void {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!u) throw notFound('Korisnik nije pronađen.');
  const nextRole = patch.role ?? u.role;
  const nextActive = patch.active === undefined ? u.active === 1 : patch.active;
  if (u.role === 'admin' && (nextRole !== 'admin' || !nextActive)) {
    const admins = (
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id) as {
        n: number;
      }
    ).n;
    if (admins === 0) throw badRequest('Mora postojati barem jedan aktivni administrator.');
  }
  db.prepare(
    'UPDATE users SET full_name = ?, email = ?, role = ?, active = ?, updated_at = ? WHERE id = ?',
  ).run(
    patch.fullName ?? u.full_name,
    patch.email === undefined ? u.email : patch.email,
    nextRole,
    nextActive ? 1 : 0,
    nowIso(),
    id,
  );
  if (!nextActive) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

export async function setPassword(db: DB, id: number, password: string): Promise<void> {
  const err = validatePasswordStrength(password);
  if (err) throw badRequest(err);
  const hash = await hashPassword(password);
  const r = db
    .prepare(
      'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    )
    .run(hash, nowIso(), nowIso(), id);
  if (r.changes === 0) throw notFound('Korisnik nije pronađen.');
}

export type LoginOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive'; lockedUntil?: string };

/**
 * Provjera prijave s ograničenjem neuspjelih pokušaja (zaključavanje računa na 15 minuta nakon 5 pogrešaka).
 * Poruka korisniku ne otkriva postoji li korisničko ime.
 */
export async function verifyLogin(db: DB, username: string, password: string): Promise<LoginOutcome> {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!u) {
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: 'invalid' };
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: 'locked', lockedUntil: u.locked_until };
  }
  const valid = await verifyPassword(password, u.password_hash);
  if (!valid) {
    const failed = u.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(
      lock ? 0 : failed,
      lock,
      u.id,
    );
    return lock ? { ok: false, reason: 'locked', lockedUntil: lock } : { ok: false, reason: 'invalid' };
  }
  if (!u.active) return { ok: false, reason: 'inactive' };
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(
    nowIso(),
    u.id,
  );
  return {
    ok: true,
    user: { id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role },
  };
}
