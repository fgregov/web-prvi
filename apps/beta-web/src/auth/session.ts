import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthSession, AuthUser } from './types.ts';

/**
 * Signed, stateless session tokens:  base64url(payload) "." base64url(HMAC-SHA256)
 *
 * The payload holds only non-sensitive identity data plus iat/exp and a
 * unique id. It never contains the password. Logout revokes the id so a
 * copied cookie stops working before it expires (see SessionRevocations).
 */

interface SessionPayload {
  v: 1;
  jti: string;
  sub: string;
  username: string;
  name: string;
  role: 'beta_admin';
  iat: number;
  exp: number;
}

export type SessionCheck =
  | { readonly status: 'valid'; readonly session: AuthSession }
  | { readonly status: 'expired' }
  | { readonly status: 'invalid' };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLOCK_SKEW_SECONDS = 60;

export function createSessionToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number,
  nowSeconds: number,
): { token: string; session: AuthSession } {
  const payload: SessionPayload = {
    v: 1,
    jti: randomUUID(),
    sub: user.id,
    username: user.username,
    name: user.displayName,
    role: user.role,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${body}.${sign(body, secret)}`, session: toSession(payload) };
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds: number,
): SessionCheck {
  if (!token || token.length > 4096 || !TOKEN_SHAPE.test(token)) return { status: 'invalid' };

  const [body, signature] = token.split('.') as [string, string];
  const expected = Buffer.from(sign(body, secret), 'base64url');
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { status: 'invalid' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (!isPayload(payload) || payload.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { status: 'invalid' };
  }
  if (nowSeconds >= payload.exp) return { status: 'expired' };

  return { status: 'valid', session: toSession(payload) };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function toSession(p: SessionPayload): AuthSession {
  return {
    id: p.jti,
    issuedAt: p.iat,
    expiresAt: p.exp,
    user: { id: p.sub, username: p.username, displayName: p.name, role: p.role },
  };
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.jti === 'string' &&
    typeof p.sub === 'string' &&
    typeof p.username === 'string' &&
    typeof p.name === 'string' &&
    p.role === 'beta_admin' &&
    Number.isInteger(p.iat) &&
    Number.isInteger(p.exp) &&
    (p.exp as number) > (p.iat as number)
  );
}

/**
 * Session ids revoked by logout, kept until their natural expiry.
 * In memory: a server restart forgets revocations (documented BETA limitation).
 */
export class SessionRevocations {
  readonly #revoked = new Map<string, number>();

  revoke(sessionId: string, expiresAt: number, nowSeconds: number): void {
    this.#revoked.set(sessionId, expiresAt);
    for (const [id, exp] of this.#revoked) if (exp <= nowSeconds) this.#revoked.delete(id);
  }

  isRevoked(sessionId: string): boolean {
    return this.#revoked.has(sessionId);
  }
}
