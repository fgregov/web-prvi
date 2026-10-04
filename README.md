# RENVARA

B2B sales execution platform: personal AI sales assistant, lightweight CRM and
follow-up engine.

> Users manage relationships. Renvara remembers what happens next.
> **No active sales opportunity should exist without a known next action.**

**Status: Phase 1, technical foundation.** Schema, security model, domain rules,
tooling and docs. No user-facing app yet.

## Repository layout

```
apps/                 mobile (Expo) and web (Next.js), added in later phases
packages/
  domain/             @renvara/domain: pure business rules (next action, lifecycle, time, permissions)
  database/           @renvara/database: generated DB types and the domain↔DB enum contract
supabase/
  migrations/         PostgreSQL schema, RLS, invariants (source of truth)
  tests/database/     pgTAP tests: tenant isolation, roles, invariants
docs/
  architecture/       how the system is built (start here)
  adr/                architecture decision records
  open-questions.md   decisions waiting for product input
```

## Quick start

Requirements: Node 22+, pnpm 10, Docker.

```bash
pnpm install
pnpm db:start     # local Supabase; applies migrations
pnpm db:test      # database security & invariant tests
pnpm check        # format, typecheck, unit tests
```

Supabase Studio runs at http://localhost:54323 after `pnpm db:start`.

## Documentation

Start with [docs/architecture](docs/architecture/README.md).
