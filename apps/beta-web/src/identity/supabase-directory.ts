// Members, rights and the administration log in Supabase, through the
// admin_* functions (supabase/migrations/20261017120000_user_management.sql).
// The user service has checked the rules; the database checks them again and
// writes each change with its log entry in one transaction.
import { CrmForbiddenError, CrmValidationError } from '../crm/errors.ts';
import type { AuditEntry } from '../crm/types.ts';
import type { UserDirectory, UserRecord, UserSummary } from './directory.ts';
import { DENIED } from './rules.ts';
import { SupabaseError, type SupabaseClient } from './supabase-client.ts';

const REASONS: Record<string, string> = {
  forbidden: DENIED.forbidden,
  owner_only: DENIED.ownerOnly,
  self_deactivate: DENIED.selfDeactivate,
  self_access: DENIED.selfAccess,
  role_owner_only: DENIED.roleOwnerOnly,
  beyond_own_rights: 'Ne možete dodijeliti ni oduzeti pravo koje sami nemate.',
  not_found: DENIED.forbidden,
};

/** The database refused: the same answers as the service's own checks. */
function refused(error: unknown): never {
  if (error instanceof SupabaseError) {
    if (error.code === '42501')
      throw new CrmForbiddenError(REASONS[error.reason] ?? DENIED.forbidden);
    if (error.code === '23505' && error.reason === 'email_taken') {
      throw new CrmValidationError({ email: 'Korisnik s ovom e-mail adresom već postoji.' });
    }
    if (error.code === '23514' && error.reason) {
      if (/^requires|^admin_only|^unknown/.test(error.reason)) {
        throw new CrmValidationError({}, 'Provjerite prava pristupa.');
      }
      if (error.reason === 'unchanged') throw new CrmValidationError({}, 'Status je već takav.');
    }
    if (error.code === '23514') throw new CrmForbiddenError(DENIED.lastOwner);
  }
  throw error;
}

export function createSupabaseDirectory(client: SupabaseClient): UserDirectory {
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    try {
      return await client.rpc<T>(name, args);
    } catch (error) {
      return refused(error);
    }
  };
  const actor = (note: { actorUserId: string | null }) => {
    if (!note.actorUserId) throw new CrmForbiddenError();
    return note.actorUserId;
  };

  return {
    async list(organizationId, filter) {
      return call<{ items: UserSummary[]; total: number }>('admin_list_members', {
        p_org: organizationId,
        p_status: filter.status,
        p_q: filter.q,
        p_sort: filter.sort,
        p_dir: filter.dir,
        p_page: filter.page,
        p_page_size: filter.pageSize,
      });
    },

    async get(organizationId, userId) {
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return null; // not a Supabase user id
      return call<UserRecord | null>('admin_get_member', { p_org: organizationId, p_user: userId });
    },

    async findByEmail(organizationId, email) {
      return call<UserRecord | null>('admin_find_member_by_email', {
        p_org: organizationId,
        p_email: email,
      });
    },

    async activeOwnerCount(organizationId) {
      return call<number>('admin_active_owner_count', { p_org: organizationId });
    },

    async insert(organizationId, user, note) {
      return call<UserRecord>('admin_create_member', {
        p_org: organizationId,
        p_actor: actor(note),
        p_user: user.id,
        p_first_name: user.firstName,
        p_last_name: user.lastName,
        p_oib: user.oib,
        p_email: user.email,
        p_phone: user.phone,
        p_role: user.role,
        p_permissions: user.role === 'owner' ? [] : [...user.permissions],
      });
    },

    async updateProfile(organizationId, userId, patch, note) {
      return call<UserRecord>('admin_update_member', {
        p_org: organizationId,
        p_actor: actor(note),
        p_user: userId,
        p_first_name: patch.firstName,
        p_last_name: patch.lastName,
        p_oib: patch.oib,
        p_email: patch.email,
        p_phone: patch.phone,
      });
    },

    async setStatus(organizationId, userId, status, note) {
      return call<UserRecord>('admin_set_member_status', {
        p_org: organizationId,
        p_actor: actor(note),
        p_user: userId,
        p_status: status,
      });
    },

    async setAccess(organizationId, userId, role, permissions, note) {
      return call<UserRecord>('admin_set_member_access', {
        p_org: organizationId,
        p_actor: actor(note),
        p_user: userId,
        p_role: role,
        p_permissions: role === 'owner' ? [] : [...permissions],
      });
    },

    async touchLogin(organizationId, userId) {
      await call('admin_touch_login', { p_org: organizationId, p_user: userId });
    },

    async log(entry) {
      await call('admin_log', {
        p_org: entry.organizationId,
        p_actor: entry.actorUserId,
        p_target: entry.targetUserId,
        p_action: entry.action,
        p_result: entry.result,
        p_details: entry.details,
      });
    },

    async auditFor(organizationId, userId, limit) {
      return call<AuditEntry[]>('admin_member_audit', {
        p_org: organizationId,
        p_user: userId,
        p_limit: limit,
      });
    },
  };
}
