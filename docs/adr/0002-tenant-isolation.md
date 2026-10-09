# ADR-0002: Tenant isolation by RLS plus composite foreign keys

**Context.** Isolation must hold at the database level even if a client sends
arbitrary IDs. RLS filters what a user can *see and write*. However, foreign key
checks run with elevated rights and ignore RLS. With plain `company_id → companies(id)`,
a user in Org B could create a contact in Org B pointing to an Org A company
whose UUID they obtained. The row would be accepted and the tenants would be
cross-linked.

**Decision.**
1. RLS on every table, keyed on `organization_id in (select private.current_user_org_ids())`.
2. Every tenant table has `unique (organization_id, id)`. Every reference is
   composite: `(organization_id, x_id) → x(organization_id, id)`.
3. People references (owner, assignee, performer) target
   `organization_members (organization_id, user_id)`.
4. `ON DELETE SET NULL (column)` (PostgreSQL 15+) nulls only the reference
   column, never `organization_id`.
5. `organization_id` is immutable (trigger).

**Consequences.** Cross-tenant links are structurally impossible. One extra
unique index per referenced table is a small cost. Tested in
`02_tenant_isolation.test.sql`.

**Alternatives.** Trigger-based validation is slower and easy to forget on new
tables. Schema-per-tenant or database-per-tenant gives operational overhead
that grows with tenant count, and cross-tenant analytics and migrations become
hard. Both may be reconsidered only for enterprise data-residency needs.
