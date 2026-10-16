import type { AuthConfig } from './config.ts';
import { FailedLoginLimiter } from './rate-limit.ts';
import {
  createSessionToken,
  SessionRevocations,
  verifySessionToken,
  type SessionCheck,
} from './session.ts';
import type { Authenticate, AuthProvider, AuthSession, AuthUser } from './types.ts';

export type LoginOutcome =
  | {
      readonly kind: 'success';
      readonly token: string;
      readonly session: AuthSession;
      readonly notice?: unknown;
    }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number };

export interface AuthService {
  readonly cookieName: string;
  readonly cookieOptions: { readonly secure: boolean; readonly maxAgeSeconds: number };
  /** The single authoritative login path: rate limit → identity check → session. */
  login(username: string, password: string, clientKey: string): Promise<LoginOutcome>;
  /**
   * Validates a session token: signature, expiry, logout revocation, and the
   * member's "sessions valid after" time (deactivation, password change).
   */
  checkSession(token: string | undefined): SessionCheck;
  logout(token: string | undefined): void;
  /** A new session for an already verified member (after changing one's own password). */
  issue(user: AuthUser): { token: string; session: AuthSession };
}

export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

export function createAuthService(
  config: AuthConfig,
  authenticate: Authenticate | AuthProvider,
  clock: Clock = systemClock,
  limiter = new FailedLoginLimiter(),
  validAfter: (userId: string) => number = () => 0,
): AuthService {
  const revocations = new SessionRevocations();
  const nowSeconds = () => Math.floor(clock.nowMs() / 1000);
  const check: Authenticate =
    typeof authenticate === 'function'
      ? authenticate
      : async (identifier, password) => {
          const user = authenticate.authenticate(identifier, password);
          return user ? { user } : null;
        };

  // __Host- prefix: browser-enforced Secure + Path=/ + no Domain. Only valid over HTTPS.
  const cookieName = config.secureCookies ? '__Host-renvara_session' : 'renvara_session';

  const checkSession = (token: string | undefined): SessionCheck => {
    const result = verifySessionToken(token, config.sessionSecret, nowSeconds());
    if (
      result.status === 'valid' &&
      (revocations.isRevoked(result.session.id) ||
        result.session.issuedAt < validAfter(result.session.user.id))
    ) {
      return { status: 'invalid' };
    }
    return result;
  };

  const issue = (user: AuthUser) =>
    createSessionToken(
      user,
      config.sessionSecret,
      config.sessionTtlSeconds,
      Math.max(nowSeconds(), validAfter(user.id)),
    );

  return {
    cookieName,
    cookieOptions: { secure: config.secureCookies, maxAgeSeconds: config.sessionTtlSeconds },

    async login(username, password, clientKey) {
      const retryAfterSeconds = limiter.retryAfterSeconds(clientKey, clock.nowMs());
      if (retryAfterSeconds > 0) return { kind: 'rate_limited', retryAfterSeconds };

      const result = await check(username, password);
      if (!result) {
        limiter.recordFailure(clientKey, clock.nowMs());
        return { kind: 'invalid_credentials' };
      }

      limiter.reset(clientKey);
      const { token, session } = issue(result.user);
      return { kind: 'success', token, session, notice: result.notice };
    },

    checkSession,
    issue,

    logout(token) {
      const result = checkSession(token);
      if (result.status === 'valid') {
        revocations.revoke(result.session.id, result.session.expiresAt, nowSeconds());
      }
    },
  };
}
