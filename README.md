# RENVARA

B2B sales execution platform: personal AI sales assistant, lightweight CRM and
follow-up engine.

> Users manage relationships. Renvara remembers what happens next.
> **No active sales opportunity should exist without a known next action.**

**Status: Phase 1, technical foundation.** Schema, security model, domain rules,
tooling and docs. No user-facing app yet.

## Repository layout

```
apps/
  beta-web/           the web app (browser, every device; ADR-0013): Node server, pages, in-browser demo build
packages/
  domain/             @renvara/domain: pure business rules (next action, lifecycle, time, permissions)
  database/           @renvara/database: generated DB types and the domain↔DB enum contract
supabase/
  migrations/         PostgreSQL schema, RLS, invariants (source of truth)
  tests/database/     pgTAP tests: tenant isolation, roles, invariants
deploy/               the BETA web app in the cloud: Docker Compose + Caddy, Fly.io (README in Croatian)
demo-app/             the demo as pages that open from disk (README in Croatian)
                      the real app on one computer: `pnpm --filter @renvara/beta-web localhost:build`
                      → apps/beta-web/dist/renvara-localhost.zip (needs only Node.js; README inside)
scripts/release-zip.mjs  the whole project for npm: dist/release/RENVARA_CRM_REPORTS_v1.0.zip
                      (`npm install`, `npm run dev` → http://localhost:3000; POKRETANJE-LOKALNO.md)
docs/
  reports/            IZVJEŠTAJI v1.0: rules, migrations, configuration, limits (Croatian)
  architecture/       how the system is built (start here)
  adr/                architecture decision records
  open-questions.md   decisions waiting for product input
```

## Quick start

Requirements: Node 22+, pnpm 10, Docker.

```bash
pnpm install
pnpm dev          # the web app on http://localhost:3000 (first start asks for the owner)
pnpm db:start     # local Supabase; applies migrations
pnpm db:test      # database security & invariant tests
pnpm check        # format, typecheck, unit tests
```

With npm instead (RENVARA_CRM_REPORTS_v1.0.zip): `npm install`, `npm run dev`
— see POKRETANJE-LOKALNO.md (Croatian).

Supabase Studio runs at http://localhost:54323 after `pnpm db:start`.

## Documentation

Start with [docs/architecture](docs/architecture/README.md).
