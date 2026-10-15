// Who may do what to whom in Korisnici (ADR-0014). Pure functions: the user
// service runs them for both identity back ends, and the Supabase functions
// (supabase/migrations/20261017120000_user_management.sql) enforce the same
// rules again in the database.
import { permissionLabel, permissionSetErrors } from '../../public/app/js/core/permissions.js';
import type { MemberAccess, MemberRole, MemberStatus } from '../crm/types.ts';

export interface Actor extends MemberAccess {
  readonly id: string;
}

export interface Target {
  readonly id: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
}

export const DENIED = {
  forbidden: 'Nemate pravo pristupa ovoj funkcionalnosti.',
  ownerOnly: 'Administratore i vlasnike mijenja samo vlasnik organizacije.',
  selfDeactivate: 'Ne možete deaktivirati vlastiti račun.',
  selfAccess: 'Ne možete mijenjati vlastitu ulogu ni vlastita prava.',
  roleOwnerOnly: 'Uloge dodjeljuje samo vlasnik organizacije.',
  lastOwner: 'Organizacija mora imati barem jednog aktivnog vlasnika.',
  passwordOthers: 'Za promjenu lozinke drugog korisnika potrebno je posebno pravo.',
} as const;

/** Actions on another member that need more than seeing them. */
export type ManageAction = 'edit' | 'deactivate' | 'change_password' | 'manage_permissions';

const PERMISSION_OF: Record<ManageAction, string> = {
  edit: 'users.edit',
  deactivate: 'users.deactivate',
  change_password: 'users.change_password',
  manage_permissions: 'users.manage_permissions',
};

/**
 * Why `actor` may not do `action` to `target`, or null when allowed.
 * Administrators and owners are changed only by an owner; nobody deactivates
 * themselves or changes their own rights. (Changing one's own password is the
 * separate self-service path: changePasswordDenial.)
 */
export function manageDenial(actor: Actor, target: Target, action: ManageAction): string | null {
  if (!actor.permissions.has(PERMISSION_OF[action])) return DENIED.forbidden;
  if (actor.id === target.id) {
    if (action === 'deactivate') return DENIED.selfDeactivate;
    if (action === 'manage_permissions') return DENIED.selfAccess;
    return null; // own data
  }
  if (target.role !== 'user' && actor.role !== 'owner') return DENIED.ownerOnly;
  return null;
}

/** Own password: always (with the current password); someone else's: the right and the role rule. */
export function changePasswordDenial(actor: Actor, target: Target): string | null {
  if (actor.id === target.id) return null;
  if (!actor.permissions.has('users.change_password')) return DENIED.passwordOthers;
  return manageDenial(actor, target, 'change_password');
}

export interface AccessState {
  readonly role: MemberRole;
  readonly permissions: readonly string[];
}

export interface AccessChangeCheck {
  readonly denial: string | null;
  readonly errors: Record<string, string>;
  readonly granted: string[];
  readonly revoked: string[];
}

/**
 * A change of role and rights. Only an owner changes roles; nobody changes
 * their own; a right can only be given or taken away by someone who has it
 * (an owner has all); the new set must be consistent for the new role.
 * `activeOwnersAfter`: active owners the organization would keep.
 */
export function accessChangeCheck(
  actor: Actor,
  target: Target,
  current: AccessState,
  next: AccessState,
  activeOwnersAfter: number,
): AccessChangeCheck {
  const granted = next.permissions.filter((k) => !current.permissions.includes(k));
  const revoked = current.permissions.filter((k) => !next.permissions.includes(k));
  const result = (denial: string | null, errors: Record<string, string> = {}) => ({
    denial,
    errors,
    granted,
    revoked,
  });

  const base = manageDenial(actor, target, 'manage_permissions');
  if (base) return result(base);
  if (next.role !== current.role) {
    if (actor.role !== 'owner') return result(DENIED.roleOwnerOnly);
    if (current.role === 'owner' && target.status === 'active' && activeOwnersAfter < 1) {
      return result(DENIED.lastOwner);
    }
  }
  if (next.role === 'owner') return result(null); // an owner has every right; none are stored
  const errors = permissionSetErrors(next.permissions, next.role);
  if (Object.keys(errors).length) return result(null, errors);
  const beyond = [...granted, ...revoked].filter((k) => !actor.permissions.has(k));
  if (beyond.length) {
    return result(
      `Ne možete dodijeliti ni oduzeti pravo koje sami nemate: ${beyond.map(permissionLabel).join(', ')}.`,
    );
  }
  return result(null);
}

/** Deactivating or reactivating `target`; `activeOwnersAfter` as above. */
export function statusChangeDenial(
  actor: Actor,
  target: Target,
  next: MemberStatus,
  activeOwnersAfter: number,
): string | null {
  const base = manageDenial(actor, target, 'deactivate');
  if (base) return base;
  if (next === 'inactive' && target.role === 'owner' && activeOwnersAfter < 1) {
    return DENIED.lastOwner;
  }
  return null;
}
