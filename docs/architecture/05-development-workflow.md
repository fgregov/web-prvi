# 5. Development workflow

## Prerequisites
Node 22+, pnpm 10, and Docker for the local Supabase stack.

```bash
pnpm install
pnpm db:start        # local Supabase (Postgres, Auth, Studio…), applies migrations
pnpm db:test         # pgTAP: RLS + invariants
pnpm check           # prettier + typecheck + unit tests
```

## Commands
| Command | Does |
|---|---|
| `pnpm db:start` / `db:stop` | start or stop the local Supabase stack |
| `pnpm db:reset` | recreate the local DB from migrations and seed |
| `pnpm db:test` | run `supabase/tests/database/*.test.sql` |
| `pnpm db:types` | regenerate `packages/database/src/database.types.ts` |
| `pnpm db:new-migration <name>` | create a timestamped migration file |
| `pnpm test` / `typecheck` / `format` | workspace-wide |

## Changing the schema
1. `pnpm db:new-migration <name>`, then write forward-only SQL. Never edit a
   migration that has been applied anywhere shared.
2. `pnpm db:reset && pnpm db:test`
3. `pnpm db:types`, then fix any compile errors. The enum contract in
   `packages/database` fails if the domain vocabulary drifted.
4. Commit the migration, the regenerated types and tests together.

### Checklist for a new tenant table
- [ ] `organization_id uuid not null references organizations on delete cascade`
- [ ] `unique (organization_id, id)` if other tables will reference it
- [ ] composite FKs `(organization_id, x_id)` for every reference to a tenant table, and to `organization_members (organization_id, user_id)` for people
- [ ] `created_at`, `updated_at`, `created_by`, `updated_by`, plus the `private.stamp_tenant_row()` trigger
- [ ] `enable row level security`, then policies for select, insert, update and delete via `private.current_user_org_ids*()`
- [ ] `revoke all … from anon`, then explicit grants to `authenticated`
- [ ] indexes for every FK column and for the main list query
- [ ] pgTAP tests for isolation and for every invariant
- [ ] if it's a view: `with (security_invoker = true)`

`01_security_baseline.test.sql` catches the most dangerous omissions automatically.

## Code conventions (TypeScript)
* Strict TypeScript, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
* `@renvara/domain` stays pure: no I/O, no `Date.now()`, no framework imports.
  Expected rule violations return `Result`. They do not throw.
* Tests sit next to the code (`*.test.ts`, Vitest).

## CI
`.github/workflows/ci.yml` runs on every push and PR:
* **typescript**: format check, typecheck, unit tests.
* **database**: boots the real Supabase Postgres image, applies all migrations,
  runs pgTAP, and fails if the generated types are stale.
