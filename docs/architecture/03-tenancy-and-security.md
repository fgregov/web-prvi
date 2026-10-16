# 3. Tenancy & security

## Threat model in one sentence

A signed-in user controls their client completely: they can call the API with
any parameters, IDs or payloads. **They must still never read, change or
reference another organization's data, nor exceed their role.**

## Four layers of tenant isolation

1. **Row Level Security on every table.** Every policy keys off the caller's
   active memberships:
   ```sql
   using (organization_id in (select private.current_user_org_ids()))
   ```
   The helper is `SECURITY DEFINER` (no recursion through the memberships
   table's own RLS), answers only for `auth.uid()`, and is wrapped in a
   sub-select so Postgres evaluates it **once per statement**. Suspended and
   removed members match nothing.
2. **Tenant-safe foreign keys.** Every cross-table reference is composite:
   `(organization_id, company_id) → companies(organization_id, id)`. Even with
   a guessed UUID, a row cannot point into another tenant. RLS alone would
   not prevent this, because FK checks bypass RLS. See ADR-0002.
3. **Immutable tenancy.** A trigger rejects any change to `organization_id`.
4. **Least-privilege grants.** `anon` has no privileges on anything in
   `public`, and default privileges are revoked so future tables start closed.
   `authenticated` only ever receives DML (`SELECT`, `INSERT`, `UPDATE`,
   `DELETE`), never `TRUNCATE`, which would bypass RLS. Where only some
   columns are user-editable, such as profiles, organizations and memberships,
   `UPDATE` is granted per column.

Views are created `with (security_invoker = true)`, so the RLS of the
underlying tables applies to the caller.

## Authorship cannot be forged

`created_by`, `updated_by`, `created_at` and `updated_at` are set by trigger
from the JWT. Client-supplied values are overwritten. Activities with
`source = 'system'` can only be written by database functions.

## Roles and permissions (Phase 1)

Coarse roles in `organization_members.role`. Enforcement is in the database.
`@renvara/domain`'s `can(role, permission)` mirrors it for UI gating.

| Capability | owner | admin | manager | sales |
|---|:-:|:-:|:-:|:-:|
| Read all org CRM data (companies, contacts, opportunities, activities, tasks) | ✓ | ✓ | ✓ | ✓ |
| Create / edit companies, contacts, opportunities | ✓ | ✓ | ✓ | ✓ |
| Create tasks, edit tasks assigned to or created by self | ✓ | ✓ | ✓ | ✓ |
| Edit / delete **any** task | ✓ | ✓ | ✓ | |
| Hard-delete companies, contacts, opportunities | ✓ | ✓ | ✓ | |
| Edit / delete own manual activities | ✓ | ✓ | ✓ | ✓ |
| Edit / delete **any** activity (moderation) | ✓ | ✓ | | |
| Update organization settings | ✓ | ✓ | | |
| Change member roles / suspend / remove | ✓ | ✓ (not owners) | | |
| Grant or revoke ownership | ✓ | | | |

Always enforced: nobody changes their own role or status, and an organization
keeps at least one active owner.

**Visibility.** All members see all organization data in Phase 1, which suits
small teams with a shared CRM. "Sales sees only own records" or team-scoped
visibility can be added later by changing only the `select` policies. Tables
and clients stay the same.

**Granular permissions later.** Replace the role → permission map with an
`organization_role_permissions` table and a `private.has_permission(org, perm)`
helper. Policies switch from role lists to named permissions, and the `can()`
API is unchanged.

## Multiple organizations per user

Fully supported by the schema: memberships are N:M, and every policy checks
membership of the *row's* organization. The client chooses an "active
organization" for display, which is a UI concern and not a security boundary.
This means switching organizations needs no new token.

## Keys and secrets

* Clients only ever hold the anon key and the user's JWT.
* The `service_role` key bypasses RLS. It is restricted to Edge Functions and
  back-office jobs, which must themselves scope every query by organization.
* `private` schema functions are not exposed by the Data API.

## How this is verified

`supabase/tests/database/*.test.sql` (pgTAP, run in CI against the real
Supabase Postgres image):

* `01_security_baseline`: RLS is enabled on every table, `anon` has zero
  grants, `authenticated` has DML only, every view is security-invoker, and
  every business table has a `NOT NULL organization_id`. These guards fail automatically if a future
  migration forgets them.
* `02_tenant_isolation`: a member of another organization cannot read,
  insert, update, delete or reference across tenants, including through the
  view. A suspended member loses access, and `anon` is denied.
* `03_membership_and_roles`: the role and ownership rules above.
* `04_domain_invariants`: the next-action derivation, lifecycle stamps,
  subject-link derivation, deletion rights and cascades.
