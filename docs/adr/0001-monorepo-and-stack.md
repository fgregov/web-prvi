# ADR-0001: Monorepo and technology stack

**Context.** Mobile (primary daily interface) and web (admin and reporting)
must share one backend, one permission model and the same business rules.

**Decision.**
* One pnpm-workspace monorepo: `apps/*` (mobile, web), `packages/domain`
  (pure rules), `packages/database` (generated types), and `supabase/`
  (migrations and tests).
* Supabase (PostgreSQL, Auth, Storage, Edge Functions) is the single backend.
  Expo with Expo Router for mobile, and Next.js for web, as proposed.
* PostgreSQL is the system of record *and* the security boundary (RLS). No
  separate custom API server in Phase 1. Multi-step operations use RPC
  functions or Edge Functions.

**Consequences.** One place to change a rule. Types flow from the DB schema to
every client. The supported scale is Postgres scale: thousands of
organizations and millions of rows are well within a single instance with the
indexes defined here. Heavy compute such as AI and document rendering runs in
Edge Functions or workers, never in the DB.

**Alternatives.** A dedicated Node API in front of Postgres was rejected for
now. It duplicates authorization and adds a deployable without a current need.
It can be introduced later for specific use cases without changing the data model.
