// Supabase identity (RENVARA_IDENTITY=supabase): credentials in Supabase Auth,
// members, rights and the administration log in the database (RLS, admin_*
// functions). The same user service and rules as the local identity.
// Session cut-offs (deactivation, password change) are this server's own
// cookies, kept in a small file next to the data (single server instance).
import type { IdentityLayer } from './local.ts';
import { authenticatorFor } from './local.ts';
import { createLocalIdentity } from './local-accounts.ts';
import { createSupabaseAccounts } from './supabase-accounts.ts';
import { createSupabaseClient, type SupabaseConfig } from './supabase-client.ts';
import { createSupabaseDirectory } from './supabase-directory.ts';
import { createUserService } from './user-service.ts';

export interface SupabaseIdentityConfig extends SupabaseConfig {
  /** The organization (uuid) this server works for: RENVARA_BETA_ORG_ID. */
  readonly organizationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RENVARA_IDENTITY=supabase needs SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY (server only) and RENVARA_BETA_ORG_ID (uuid).
 * Null for the local identity (the default).
 */
export function loadSupabaseIdentityConfig(
  env: Record<string, string | undefined>,
): SupabaseIdentityConfig | null {
  const mode = (env.RENVARA_IDENTITY ?? 'local').trim().toLowerCase();
  if (mode === 'local' || mode === '') return null;
  if (mode !== 'supabase') throw new Error('RENVARA_IDENTITY must be "local" or "supabase".');
  const url = env.SUPABASE_URL?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL must be the project URL (https://<project>.supabase.co).');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('SUPABASE_URL must use https (http only for a local Supabase).');
  }
  const anonKey = env.SUPABASE_ANON_KEY?.trim() ?? '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!anonKey || !serviceRoleKey) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  if (anonKey === serviceRoleKey) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be different keys.');
  }
  const organizationId = env.RENVARA_BETA_ORG_ID?.trim() ?? '';
  if (!UUID.test(organizationId)) {
    throw new Error('RENVARA_BETA_ORG_ID must be the organization id (uuid) in Supabase.');
  }
  return { url: parsed.origin, anonKey, serviceRoleKey, organizationId };
}

export function createSupabaseIdentityLayer(options: {
  config: SupabaseIdentityConfig;
  /** Session cut-offs (RENVARA_IDENTITY_FILE). */
  sessionsFile: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): IdentityLayer {
  const client = createSupabaseClient(options.config, options.fetch);
  const { sessions } = createLocalIdentity(options.sessionsFile, null, options.now);
  const users = createUserService({
    directory: createSupabaseDirectory(client),
    accounts: createSupabaseAccounts(client),
    sessions,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    kind: 'supabase',
    users,
    authenticate: authenticatorFor(users, options.config.organizationId),
    validAfter: (id) => sessions.validAfter(id),
  };
}
