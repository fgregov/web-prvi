import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from './config.ts';
import type { AuthProvider, AuthUser } from './types.ts';

/**
 * BETA provider: exactly one account, configured through environment
 * variables. This is the ONLY place credentials are compared.
 *
 * Both values are compared as SHA-256 digests with timingSafeEqual, and both
 * comparisons always run, so response timing does not reveal which part was
 * wrong or how much of it matched.
 */
export function createBetaAuthProvider(config: AuthConfig): AuthProvider {
  const expectedUsername = digest(config.username);
  const expectedPassword = digest(config.password);
  const user: AuthUser = Object.freeze({
    id: `beta-${config.username}`,
    username: config.username,
    displayName: config.displayName,
    role: 'beta_admin',
  });

  return {
    authenticate(username: string, password: string): AuthUser | null {
      const usernameOk = timingSafeEqual(digest(username), expectedUsername);
      const passwordOk = timingSafeEqual(digest(password), expectedPassword);
      return usernameOk && passwordOk ? user : null;
    },
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
