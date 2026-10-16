// Credentials in Supabase Auth (GoTrue). Passwords go straight to Auth and
// are never stored, logged or returned here. Invitations and reset links are
// e-mailed by Supabase Auth; the link opens /set-password with the session
// token in the address fragment (never sent to a server log).
import { CrmValidationError } from '../crm/errors.ts';
import type { AccountStore, PasswordLink, PasswordState } from './accounts.ts';
import { SupabaseError, type SupabaseClient } from './supabase-client.ts';

interface AuthUser {
  readonly id: string;
  readonly email?: string;
  readonly email_confirmed_at?: string | null;
  readonly last_sign_in_at?: string | null;
}

/** Banned for a century: deactivated members cannot sign in at Supabase Auth either. */
const BLOCKED = '876000h';

export function createSupabaseAccounts(client: SupabaseClient): AccountStore {
  const setPasswordPage = (origin: string) => `${origin.replace(/\/+$/, '')}/set-password`;

  /** The user a sign-in for these credentials belongs to; the session is ended right away. */
  async function signIn(email: string, password: string): Promise<string | null> {
    if (!email.includes('@') || !password) return null;
    try {
      const session = await client.auth<{ access_token: string; user: AuthUser }>(
        '/token?grant_type=password',
        { method: 'POST', body: { email, password }, key: 'anon' },
      );
      await client
        .auth('/logout?scope=local', { method: 'POST', key: 'anon', bearer: session.access_token })
        .catch(() => {});
      return session.user.id;
    } catch (error) {
      if (error instanceof SupabaseError && error.status >= 400 && error.status < 500) return null;
      throw error;
    }
  }

  async function userOfToken(token: string): Promise<AuthUser | null> {
    if (!/^[A-Za-z0-9._-]{20,4096}$/.test(token)) return null;
    try {
      return await client.auth<AuthUser>('/user', { key: 'anon', bearer: token });
    } catch (error) {
      if (error instanceof SupabaseError && error.status >= 400 && error.status < 500) return null;
      throw error;
    }
  }

  const admin = (userId: string, body: Record<string, unknown>) =>
    client.auth(`/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body,
      key: 'service',
    });

  return {
    kind: 'supabase',

    verify: (identifier, password) => signIn(identifier.trim().toLowerCase(), password),

    async confirm(userId, email, password) {
      return (await signIn(email, password)) === userId;
    },

    async create(input, origin) {
      try {
        const user = await client.auth<AuthUser>(
          `/invite?redirect_to=${encodeURIComponent(setPasswordPage(origin))}`,
          {
            method: 'POST',
            body: {
              email: input.email,
              data: {
                full_name: `${input.firstName} ${input.lastName}`.trim(),
                first_name: input.firstName,
                last_name: input.lastName,
              },
            },
            key: 'service',
          },
        );
        const link: PasswordLink = { delivery: 'email' };
        return { userId: user.id, link };
      } catch (error) {
        if (
          error instanceof SupabaseError &&
          (error.status === 422 || error.code === 'email_exists')
        ) {
          throw new CrmValidationError({
            email: 'Ova e-mail adresa već ima račun u sustavu za prijavu.',
          });
        }
        throw error;
      }
    },

    async remove(userId) {
      await client.auth(`/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        key: 'service',
      });
    },

    async setEmail(userId, email) {
      await admin(userId, { email, email_confirm: true });
    },

    async setPassword(userId, password) {
      await admin(userId, { password });
    },

    async passwordLink(_userId, email, origin) {
      await client.auth(`/recover?redirect_to=${encodeURIComponent(setPasswordPage(origin))}`, {
        method: 'POST',
        body: { email },
        key: 'anon',
      });
      return { delivery: 'email' };
    },

    async linkUser(token) {
      return (await userOfToken(token))?.id ?? null;
    },

    async completeLink(token, password) {
      const user = await userOfToken(token);
      if (!user) return null;
      await admin(user.id, { password });
      // The link's session is used up: it cannot set the password again.
      await client
        .auth('/logout?scope=global', { method: 'POST', key: 'anon', bearer: token })
        .catch(() => {});
      return user.id;
    },

    async setBlocked(userId, blocked) {
      await admin(userId, { ban_duration: blocked ? BLOCKED : 'none' });
    },

    async passwordState(userId): Promise<PasswordState> {
      const user = await client.auth<AuthUser>(`/admin/users/${encodeURIComponent(userId)}`, {
        key: 'service',
      });
      return user.email_confirmed_at ? 'set' : 'pending';
    },
  };
}
