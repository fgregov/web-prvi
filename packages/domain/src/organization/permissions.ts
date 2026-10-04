import type { MemberRole } from '../shared/vocabulary';

/**
 * Phase 1 permission model: coarse roles mapped to named permissions.
 *
 * The DATABASE (RLS policies + triggers) is the enforcement point; this map
 * mirrors it so clients can hide actions a user cannot perform and services
 * can fail fast with a clear message. Keep both in sync: a change here without
 * a matching migration grants nothing.
 *
 * Granular/custom permissions later: replace ROLE_PERMISSIONS with data loaded
 * per organization; the `can()` signature does not change.
 */
export const PERMISSIONS = [
  'organization.update',
  'members.manage',
  'members.grant_owner',
  'records.hard_delete',
  'activities.moderate',
  'tasks.manage_all',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<MemberRole, ReadonlySet<Permission>>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set([
    'organization.update',
    'members.manage',
    'records.hard_delete',
    'activities.moderate',
    'tasks.manage_all',
  ]),
  manager: new Set(['records.hard_delete', 'tasks.manage_all']),
  sales: new Set(),
};

export function can(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Every active member may read, create and update CRM records (companies,
 * contacts, opportunities, activities they authored, tasks assigned to or
 * created by them). Those baseline abilities are intentionally not modelled as
 * permissions until a customer needs to restrict them.
 */
