/**
 * Provider-neutral authentication contracts.
 *
 * Routes, page protection and the dashboard depend only on these types. The
 * BETA implementation (single account from environment variables) is one
 * provider; a Supabase Auth provider can replace it later without touching
 * routing or the protected pages.
 */

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: 'beta_admin';
}

export interface AuthSession {
  /** Unique session id (used for logout revocation). */
  readonly id: string;
  readonly user: AuthUser;
  /** Unix seconds. */
  readonly issuedAt: number;
  /** Unix seconds. */
  readonly expiresAt: number;
}

export interface AuthProvider {
  /** Returns the user for an exact credential match, otherwise null. Never throws for bad credentials. */
  authenticate(username: string, password: string): AuthUser | null;
}
