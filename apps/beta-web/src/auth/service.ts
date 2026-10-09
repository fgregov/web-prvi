import type { AuthConfig } from './config.ts';
import { FailedLoginLimiter } from './rate-limit.ts';
import {
  createSessionToken,
  SessionRevocations,
  verifySessionToken,
  type SessionCheck,
} from './session.ts';
import type { AuthProvider, AuthSession } from './types.ts';

export type LoginOutcome =
  | { readonly kind: 'success'; readonly token: string; readonly session: AuthSession }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number };

export interface AuthService {
  readonly cookieName: string;
  readonly cookieOptions: { readonly secure: boolean; readonly maxAgeSeconds: number };
  /** The single authoritative login path: rate limit → provider → session. */
  login(username: string, password: string, clientKey: string): LoginOutcome;
  /** Validates a session token, including logout revocation. */
  checkSession(token: string | undefined): SessionCheck;
  logout(token: string | undefined): void;
}

export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

export function createAuthService(
  config: AuthConfig,
  provider: AuthProvider,
  clock: Clock = systemClock,
  limiter = new FailedLoginLimiter(),
): AuthService {
  const revocations = new SessionRevocations();
  const nowSeconds = () => Math.floor(clock.nowMs() / 1000);

  // __Host- prefix: browser-enforced Secure + Path=/ + no Domain. Only valid over HTTPS.
  const cookieName = config.secureCookies ? '__Host-renvara_session' : 'renvara_session';

  const checkSession = (token: string | undefined): SessionCheck => {
    const result = verifySessionToken(token, config.sessionSecret, nowSeconds());
    if (result.status === 'valid' && revocations.isRevoked(result.session.id)) {
      return { status: 'invalid' };
    }
    return result;
  };

  return {
    cookieName,
    cookieOptions: { secure: config.secureCookies, maxAgeSeconds: config.sessionTtlSeconds },

    login(username, password, clientKey) {
      const retryAfterSeconds = limiter.retryAfterSeconds(clientKey, clock.nowMs());
      if (retryAfterSeconds > 0) return { kind: 'rate_limited', retryAfterSeconds };

      const user = provider.authenticate(username, password);
      if (!user) {
        limiter.recordFailure(clientKey, clock.nowMs());
        return { kind: 'invalid_credentials' };
      }

      limiter.reset(clientKey);
      const { token, session } = createSessionToken(
        user,
        config.sessionSecret,
        config.sessionTtlSeconds,
        nowSeconds(),
      );
      return { kind: 'success', token, session };
    },

    checkSession,

    logout(token) {
      const result = checkSession(token);
      if (result.status === 'valid') {
        revocations.revoke(result.session.id, result.session.expiresAt, nowSeconds());
      }
    },
  };
}
