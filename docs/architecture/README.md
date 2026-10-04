# RENVARA architecture

> "Users manage relationships. Renvara remembers what happens next."

This folder is the source of truth for how RENVARA is built. Read in order:

1. [System overview](01-system-overview.md): layers, packages, where logic lives, AI and billing seams.
2. [Domain model](02-domain-model.md): entities, relationships, the next-action rule, future entities.
3. [Tenancy & security](03-tenancy-and-security.md): RLS, tenant-safe foreign keys, roles.
4. [Data conventions](04-data-conventions.md): IDs, time, money, enums, JSONB, deletion.
5. [Development workflow](05-development-workflow.md): commands, adding a table, testing.

Decisions with lasting consequences are recorded as ADRs in [`../adr`](../adr).
Items that need a product decision are tracked in [`../open-questions.md`](../open-questions.md).

## Phase 1 scope (this foundation)

In scope: monorepo, PostgreSQL schema for the core entities, Row Level
Security, database invariants, the pure domain package, generated types,
automated tests and CI.

Deliberately not built yet: mobile/web UI, auth screens, invitations, offers,
notifications, AI assistant, billing. The schema leaves room for each of
them (see the domain model's "Future entities" section).
