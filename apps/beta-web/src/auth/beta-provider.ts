import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from './config.ts';
import type { AuthProvider, AuthUser } from './types.ts';

/**
 * BETA provider: the first owner, configured through environment variables.
 * This is the ONLY place that account's credentials are compared.
 *
 * The username is compared as a SHA-256 digest with timingSafeEqual; the
 * password either the same way (RENVARA_BETA_PASSWORD) or against its scrypt
 * hash (RENVARA_BETA_PASSWORD_HASH). Both comparisons always run, so response
 * timing does not reveal which part was wrong or how much of it matched.
 */
export function createBetaAuthProvider(config: AuthConfig): AuthProvider {
  const expectedUsername = digest(config.username);
  const passwordOk = config.passwordHash
    ? scryptCheck(config.passwordHash)
    : plainCheck(config.password ?? '');
  const user: AuthUser = Object.freeze({
    id: `beta-${config.username}`,
    displayName: config.displayName,
  });

  return {
    authenticate(username: string, password: string): AuthUser | null {
      const usernameOk = timingSafeEqual(digest(username), expectedUsername);
      const passwordMatches = passwordOk(password);
      return usernameOk && passwordMatches ? user : null;
    },
  };
}

function plainCheck(expected: string) {
  const digestOfExpected = digest(expected);
  return (password: string) => timingSafeEqual(digest(password), digestOfExpected);
}

/** scrypt$N$r$p$salt$key (base64url), the format of identity/local-accounts.ts. */
function scryptCheck(stored: string) {
  const [, n, r, p, salt, key] = stored.split('$');
  const expected = Buffer.from(key as string, 'base64url');
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 };
  const saltBytes = Buffer.from(salt as string, 'base64url');
  return (password: string) =>
    timingSafeEqual(scryptSync(password, saltBytes, expected.length, options), expected);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
