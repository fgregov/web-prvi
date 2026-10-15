// Local identity (the BETA default): members in the CRM store, credentials in
// the identity file (local-accounts.ts), the first owner from the server
// settings. supabase.ts builds the same pieces on Supabase Auth.
import { createBetaAuthProvider } from '../auth/beta-provider.ts';
import type { AuthConfig } from '../auth/config.ts';
import type { Authenticate } from '../auth/types.ts';
import type { CrmRepository } from '../crm/repository.ts';
import { bootstrapUserId, ensureBootstrapOwner } from './bootstrap.ts';
import { createLocalDirectory } from './local-directory.ts';
import { createLocalIdentity } from './local-accounts.ts';
import { createUserService, displayName, type UserService } from './user-service.ts';

export interface IdentityLayer {
  readonly kind: 'local' | 'supabase';
  readonly users: UserService;
  /** Sign-in check for the auth service. */
  readonly authenticate: Authenticate;
  /** Sessions issued before this (unix seconds) are refused. */
  readonly validAfter: (userId: string) => number;
}

/** Wraps the service's sign-in for the auth service (cookie, rate limit). */
export function authenticatorFor(users: UserService, organizationId: string): Authenticate {
  return async (identifier, password) => {
    const result = await users.authenticate(organizationId, identifier, password);
    return result
      ? {
          user: { id: result.user.id, displayName: displayName(result.user) },
          notice: result.notice,
        }
      : null;
  };
}

export async function createLocalIdentityLayer(options: {
  repo: CrmRepository;
  organizationId: string;
  /** RENVARA_IDENTITY_FILE */
  file: string;
  /** The first owner from the server settings (null: none, e.g. tests that create members). */
  config: Pick<AuthConfig, 'username' | 'password' | 'displayName'> | null;
  /** RENVARA_BETA_EMAIL: the first owner may also sign in with this address. */
  ownerEmail?: string | null;
  now?: () => Date;
}): Promise<IdentityLayer> {
  const { repo, organizationId, config } = options;
  const userId = config ? bootstrapUserId(config.username) : null;
  if (config && userId) {
    ensureBootstrapOwner(repo, organizationId, {
      userId,
      displayName: config.displayName,
      email: options.ownerEmail ?? '',
    });
  }
  const { accounts, sessions } = createLocalIdentity(
    options.file,
    config && userId
      ? {
          userId,
          username: config.username,
          provider: createBetaAuthProvider(config as AuthConfig),
        }
      : null,
    options.now,
  );
  // The first owner can also sign in with the e-mail on their profile.
  const owner = userId ? repo.data().users.find((u) => u.id === userId) : null;
  if (owner?.email) await accounts.setEmail(owner.id, owner.email);

  const directory = createLocalDirectory(repo);
  const users = createUserService({
    directory,
    accounts,
    sessions,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    kind: 'local',
    users,
    authenticate: authenticatorFor(users, organizationId),
    validAfter: (id) => sessions.validAfter(id),
  };
}
