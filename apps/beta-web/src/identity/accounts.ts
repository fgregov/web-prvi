// Credentials: the only place passwords are handled. Two back ends:
//   local-accounts.ts    the BETA server's own accounts file (scrypt hashes)
//   supabase-accounts.ts Supabase Auth (GoTrue), with the service role key on the server only
// Neither stores a password in the CRM data, logs it, or returns it.

/** How a new member, or one who needs a password, gets their link. */
export type PasswordLink =
  /** The identity provider e-mailed it (Supabase Auth). */
  | { readonly delivery: 'email' }
  /** No e-mail here: the administrator passes the link on; it works once, until `expiresAt`. */
  | { readonly delivery: 'link'; readonly url: string; readonly expiresAt: string }
  /** The in-browser demo: no accounts, no links. */
  | { readonly delivery: 'none' };

export type PasswordState =
  /** The member has set a password. */
  | 'set'
  /** Invited, no password yet. */
  | 'pending'
  /** The first owner of a BETA server: the password is in the server settings. */
  | 'server'
  /** The in-browser demo: nobody signs in with a password. */
  | 'unavailable';

export interface AccountStore {
  readonly kind: 'local' | 'supabase' | 'demo';
  /** The user id for exact credentials, else null. Never throws for wrong credentials. */
  verify(identifier: string, password: string): Promise<string | null>;
  /** Whether `password` is the current password of `userId` (re-authentication). */
  confirm(userId: string, email: string, password: string): Promise<boolean>;
  /** A new account (no password yet) and how its owner sets one. */
  create(
    input: { email: string; firstName: string; lastName: string },
    origin: string,
  ): Promise<{ userId: string; link: PasswordLink }>;
  /** Undoes create() when the member could not be saved. */
  remove(userId: string): Promise<void>;
  setEmail(userId: string, email: string): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  /** A link to set a new password (reset). */
  passwordLink(userId: string, email: string, origin: string): Promise<PasswordLink>;
  /** The user a live password link is for, or null (unknown, used or expired). Does not use it. */
  linkUser(token: string): Promise<string | null>;
  /** Sets the password from a link; the user id it was for, or null (unknown, used or expired). */
  completeLink(token: string, password: string): Promise<string | null>;
  /** Deactivated members cannot sign in at the provider either. */
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  passwordState(userId: string): Promise<PasswordState>;
}

/**
 * Sessions are this server's signed cookies. A member's sessions issued before
 * `validAfter` are refused (deactivation, password change), and the time is
 * kept on disk, so it holds after a restart.
 */
export interface SessionPolicy {
  validAfter(userId: string): number;
  revokeAll(userId: string, atSeconds: number): void;
}
