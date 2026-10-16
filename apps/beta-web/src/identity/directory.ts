// The organization's members (profiles, roles, rights) and the administration
// log, independent of where they live: the BETA store (local-directory.ts) or
// Supabase (supabase-directory.ts). Credentials are never here (accounts).
import type { AuditEntry, MemberRole, MemberStatus, UserProfile } from '../crm/types.ts';

export type UserSortKey =
  'firstName' | 'lastName' | 'email' | 'phone' | 'status' | 'lastLoginAt' | 'createdAt';

export interface UserListFilter {
  readonly status: 'active' | 'inactive' | 'all';
  readonly q: string;
  readonly sort: UserSortKey;
  readonly dir: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
}

/** A row of the list: no OIB (personal data stays on the detail page). */
export interface UserSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

/** One member with the rights stored for them (an owner's are implicit). */
export interface UserRecord extends Omit<UserProfile, 'organizationId'> {
  readonly permissions: readonly string[];
}

export interface ProfileInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly oib: string;
  readonly email: string;
  readonly phone: string;
}

/** What a change did, for the log (written with it, in the same transaction). */
export interface AuditNote {
  readonly actorUserId: string | null;
  readonly details?: Record<string, unknown>;
}

export interface UserDirectory {
  list(
    organizationId: string,
    filter: UserListFilter,
  ): Promise<{ items: UserSummary[]; total: number }>;
  get(organizationId: string, userId: string): Promise<UserRecord | null>;
  /** The member signing in with `email` (lower case), if any. */
  findByEmail(organizationId: string, email: string): Promise<UserRecord | null>;
  activeOwnerCount(organizationId: string): Promise<number>;
  /** A new member (its account already exists with `id`). Logs user.create. */
  insert(
    organizationId: string,
    user: ProfileInput & { id: string; role: MemberRole; permissions: readonly string[] },
    note: AuditNote,
  ): Promise<UserRecord>;
  /** Logs user.update with the names of the changed fields. */
  updateProfile(
    organizationId: string,
    userId: string,
    patch: ProfileInput,
    note: AuditNote,
  ): Promise<UserRecord>;
  /** Logs user.deactivate / user.activate. */
  setStatus(
    organizationId: string,
    userId: string,
    status: MemberStatus,
    note: AuditNote,
  ): Promise<UserRecord>;
  /** Replaces role and rights. Logs user.access with what changed. */
  setAccess(
    organizationId: string,
    userId: string,
    role: MemberRole,
    permissions: readonly string[],
    note: AuditNote,
  ): Promise<UserRecord>;
  touchLogin(organizationId: string, userId: string, at: Date): Promise<void>;
  /** An event that is not a directory change (password, link, refused attempt). */
  log(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }): Promise<void>;
  auditFor(organizationId: string, userId: string, limit: number): Promise<AuditEntry[]>;
}
